import { Application, Container, Graphics, Rectangle, Texture, TilingSprite } from 'pixi.js';
import enemiesData from '../data/enemies.json';
import evolutionsData from '../data/evolutions.json';
import passivesData from '../data/passives.json';
import pickupsData from '../data/pickups.json';
import stagesData from '../data/stages.json';
import weaponsData from '../data/weapons.json';
import levelingData from '../data/leveling.json';
import { Camera } from '../core/Camera';
import {
  ENEMY_LIMIT_PC,
  ENEMY_PROJECTILE_LIMIT,
  enemyLimit,
  GEM_LIMIT,
  PICKUP_LIMIT,
  PROJECTILE_LIMIT,
} from '../core/device';
import type { InputManager } from '../core/Input';
import { ObjectPool } from '../core/ObjectPool';
import { Random } from '../core/Random';
import { characterTexture, PLAYER_SPRITES, stageBackgroundTexture } from '../core/sprites';
import { Enemy } from '../entities/Enemy';
import { EnemyProjectile } from '../entities/EnemyProjectile';
import { Gem } from '../entities/Gem';
import { Particle } from '../entities/Particle';
import { Pickup, PickupKind } from '../entities/Pickup';
import { Player } from '../entities/Player';
import { Projectile } from '../entities/Projectile';
import { CollisionSystem } from '../systems/CollisionSystem';
import { DamageSystem } from '../systems/DamageSystem';
import { LevelSystem } from '../systems/LevelSystem';
import { MovementSystem } from '../systems/MovementSystem';
import { PickupSystem } from '../systems/PickupSystem';
import { SpawnSystem } from '../systems/SpawnSystem';
import { MAX_WEAPONS, WEAPON_IDS, WeaponSystem } from '../systems/WeaponSystem';
import type { WeaponContext, WeaponTextures } from '../weapons/WeaponBase';
import { Hud } from '../ui/Hud';
import { Joystick } from '../ui/Joystick';
import { LevelUpModal } from '../ui/LevelUpModal';
import { PauseMenu } from '../ui/PauseMenu';
import { COLORS } from '../ui/theme';
import type {
  ChoiceView,
  EvolutionMeta,
  FlameLevel,
  LevelChoice,
  Modifiers,
  PassiveDef,
  PlayResult,
  RunSetup,
  Scene,
  ShotLevel,
  StageDef,
} from '../types';

/** 索敵範囲のマージン（カメラ可視半径に加算。§8-1 の合意事項） */
const SEARCH_MARGIN = 100;

/** 自機スプライトの表示身長（px）。当たり判定（半径12）より大きく見せる */
const PLAYER_DISPLAY_HEIGHT = 52;

// 死亡パーティクル（§16）。1体あたり4個・プール容量256（Phase 6 計画 6-2 の暫定値）
const PARTICLES_PER_DEATH = 4;
const PARTICLE_LIMIT = 256;
const PARTICLE_SPEED_MIN = 60;
const PARTICLE_SPEED_MAX = 140;

// 画面シェイク（§16: ボス出現と爆弾のみ）。演出値なのでバランス JSON には置かない
const SHAKE_BOSS_AMP = 8;
const SHAKE_BOSS_SEC = 0.5;
const SHAKE_BOMB_AMP = 6;
const SHAKE_BOMB_SEC = 0.3;

const PASSIVES: Record<string, PassiveDef> = passivesData;
const PASSIVE_IDS = Object.keys(passivesData);

/** 進化定義（§10）。base 武器ID → 進化ID の逆引きも起動時に作る */
const EVOLUTIONS: Record<string, EvolutionMeta> = evolutionsData;
const EVOLUTION_IDS = Object.keys(evolutionsData);
const BASE_TO_EVOLUTION: Record<string, string> = {};
for (const evoId of EVOLUTION_IDS) {
  BASE_TO_EVOLUTION[EVOLUTIONS[evoId].base] = evoId;
}

/** キャラ・メタ強化なしの中立セットアップ（起動直後のプレースホルダ） */
function neutralSetup(): RunSetup {
  return {
    stage: stagesData.stages[0],
    characterId: 'runner',
    initialWeapon: 'shot',
    base: {
      damageMul: 1,
      cooldownMul: 1,
      moveSpeedMul: 1,
      pickupRangeMul: 1,
      maxHpMul: 1,
      regenPerSec: 0,
    },
    startLevel: 1,
    extraRerolls: 0,
  };
}

/** PlayScene から Game への通知 */
export interface PlaySceneEvents {
  /** クリアまたはゲームオーバー */
  onFinished: (result: PlayResult) => void;
  /** ポーズメニューからのリタイア */
  onRetire: () => void;
  /** ポーズ解除時（アキュムレータを捨てて敵の瞬間移動を防ぐ） */
  onResume: () => void;
}

/**
 * プレイ画面。レイヤー: 背景 < ワールド < HUD < レベルアップモーダル < ポーズ < ジョイスティック。
 * リトライ・ステージ変更時はシーンを作り直さず startStage() / reset() で使い回す。
 */
export class PlayScene implements Scene {
  readonly container = new Container();

  private readonly world = new Container();
  private readonly bg: TilingSprite;
  private readonly player: Player;
  private readonly camera = new Camera();
  private readonly hud = new Hud();
  private readonly joystick: Joystick;
  private readonly modal = new LevelUpModal();
  private readonly pauseMenu = new PauseMenu();

  private readonly enemies: Enemy[] = [];
  private readonly pool: ObjectPool<Enemy>;
  private readonly projectiles: Projectile[] = [];
  private readonly projectilePool: ObjectPool<Projectile>;
  private readonly enemyProjectiles: EnemyProjectile[] = [];
  private readonly enemyProjectilePool: ObjectPool<EnemyProjectile>;
  private readonly gems: Gem[] = [];
  private readonly gemPool: ObjectPool<Gem>;
  private readonly pickups: Pickup[] = [];
  private readonly pickupPool: ObjectPool<Pickup>;
  private readonly particles: Particle[] = [];
  private readonly particlePool: ObjectPool<Particle>;

  private readonly random: Random;
  private readonly spawn: SpawnSystem;
  private readonly movement = new MovementSystem();
  private readonly collision: CollisionSystem;
  private readonly damage: DamageSystem;
  private readonly levelSystem = new LevelSystem();
  private readonly pickup: PickupSystem;
  private readonly weapons: WeaponSystem;
  private readonly weaponCtx: WeaponContext;

  /** レベルアップモーダル表示中のポーズ（§5: 遷移ではなくポーズ） */
  private paused = false;
  private elapsedSec = 0;
  private setup: RunSetup = neutralSetup();
  private stage: StageDef = stagesData.stages[0];
  private passiveLevels: Record<string, number> = {};
  private currentChoices: LevelChoice[] = [];
  private finished = false;

  /** ボスHPバー用の参照（§16）。出現時にキャッシュし、撃破で null に戻す */
  private bossRef: Enemy | null = null;
  private bossMaxHp = 1;

  /** spitter の発射コールバック（毎フレーム作らない） */
  private readonly fireEnemyProjectile = (e: Enemy): void => {
    const b = this.enemyProjectilePool.acquire();
    if (b === null) return;
    const dx = this.player.x - e.x;
    const dy = this.player.y - e.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1e-6) {
      this.enemyProjectilePool.release(b);
      return;
    }
    b.reset(
      e.x,
      e.y,
      (dx / dist) * e.projectileSpeed,
      (dy / dist) * e.projectileSpeed,
      e.projectileRadius,
      e.projectileDamage,
    );
    this.enemyProjectiles.push(b);
  };

  /** DEV: ?enemies=N の一括スポーンを最初の update まで遅延させる（カメラ確定後） */
  private pendingBurst = 0;

  /** 敵死亡時の演出（§16: パーティクル4個を放射）。sweepDeaths から呼ばれる */
  private readonly spawnDeathParticles = (e: Enemy): void => {
    for (let i = 0; i < PARTICLES_PER_DEATH; i++) {
      const p = this.particlePool.acquire();
      if (p === null) return;
      const angle = this.random.next() * Math.PI * 2;
      const speed =
        PARTICLE_SPEED_MIN + this.random.next() * (PARTICLE_SPEED_MAX - PARTICLE_SPEED_MIN);
      p.reset(e.x, e.y, Math.cos(angle) * speed, Math.sin(angle) * speed, e.tintNormal);
      this.particles.push(p);
    }
  };

  constructor(
    app: Application,
    private readonly input: InputManager,
    private readonly events: PlaySceneEvents,
  ) {
    // テクスチャ生成は初期化時の1回のみ。キャラ・敵・背景は Kenney スプライト（sprites.ts）
    const tileTexture = stageBackgroundTexture('stage1');
    const playerTexture = characterTexture(PLAYER_SPRITES.runner);
    const enemyTexture = characterTexture('zombie');
    const gemTexture = createGemTexture(app);
    const enemyBulletTexture = createEnemyBulletTexture(app);
    const pickupTextures: Record<PickupKind, Texture> = {
      heal: createPickupTexture(app, COLORS.toxic),
      magnet: createPickupTexture(app, COLORS.amber),
      bomb: createPickupTexture(app, COLORS.hpRed),
    };
    const weaponTextures: WeaponTextures = {
      shot: createBulletTexture(app, 6),
      shuriken: createBulletTexture(app, 8),
      orb: createOrbTexture(app),
      bolt: createBoltTexture(app),
      flameSectors: weaponsData.flame.levels.map((lv: FlameLevel) =>
        createFlameSectorTexture(app, lv.range, lv.arcDeg),
      ),
      boomerang: createBulletTexture(app, evolutionsData.boomerang.stats.radius),
      infernoCircle: createInfernoTexture(app, evolutionsData.inferno.stats.range),
    };

    this.bg = new TilingSprite({ texture: tileTexture });
    this.player = new Player(playerTexture);
    this.player.setAppearance(playerTexture, PLAYER_DISPLAY_HEIGHT);

    // シードは通常プレイでは起動時刻。DEV では ?seed=N で固定して再現できる
    let seed = Date.now();
    if (import.meta.env.DEV) {
      const param = new URLSearchParams(location.search).get('seed');
      if (param !== null) seed = Number(param);
      const burst = new URLSearchParams(location.search).get('enemies');
      if (burst !== null) this.pendingBurst = Number(burst);
    }
    this.random = new Random(seed);

    // 各プールは起動時に全量確保し、スプライトも一度だけワールドへ追加する
    this.pool = new ObjectPool<Enemy>(() => {
      const e = new Enemy(enemyTexture);
      this.world.addChild(e.sprite);
      return e;
    }, ENEMY_LIMIT_PC);
    this.projectilePool = new ObjectPool<Projectile>(() => {
      const p = new Projectile(weaponTextures.shot);
      this.world.addChild(p.sprite);
      return p;
    }, PROJECTILE_LIMIT);
    this.enemyProjectilePool = new ObjectPool<EnemyProjectile>(() => {
      const b = new EnemyProjectile(enemyBulletTexture);
      this.world.addChild(b.sprite);
      return b;
    }, ENEMY_PROJECTILE_LIMIT);
    this.gemPool = new ObjectPool<Gem>(() => {
      const g = new Gem(gemTexture);
      this.world.addChild(g.sprite);
      return g;
    }, GEM_LIMIT);
    this.pickupPool = new ObjectPool<Pickup>(() => {
      const p = new Pickup(pickupTextures);
      this.world.addChild(p.sprite);
      return p;
    }, PICKUP_LIMIT);
    // パーティクルは弾テクスチャ（白円）を敵ティントで染めて使う（テクスチャ追加なし）
    const particleTexture = createBulletTexture(app, 3);
    this.particlePool = new ObjectPool<Particle>(() => {
      const p = new Particle(particleTexture);
      this.world.addChild(p.sprite);
      return p;
    }, PARTICLE_LIMIT);

    // ジェム・弾より手前にプレイヤーを描く
    this.world.addChild(this.player.sprite);

    this.spawn = new SpawnSystem(
      this.stage,
      stagesData.difficulty,
      this.pool,
      this.enemies,
      this.camera,
      this.random,
    );
    this.collision = new CollisionSystem(this.random);
    this.damage = new DamageSystem(
      () => this.finish(false),
      () => this.finish(true),
    );
    this.pickup = new PickupSystem(
      this.gemPool,
      this.gems,
      this.pickupPool,
      this.pickups,
      this.player,
      this.levelSystem,
      this.random,
      (kind) => this.applyPickup(kind),
    );
    this.weapons = new WeaponSystem(this.world, weaponTextures);
    this.weapons.add(this.setup.initialWeapon);

    // WeaponContext は毎フレーム作らず、この1個のフィールドを更新して使い回す
    this.weaponCtx = {
      player: this.player,
      enemies: this.enemies,
      hash: this.collision.hash,
      random: this.random,
      camera: this.camera,
      elapsedSec: 0,
      damageMul: 1,
      cooldownMul: 1,
      searchRadius: 800,
      spawnProjectile: () => this.spawnProjectile(),
      applyDamage: (enemy, dmg) => enemy.takeDamage(dmg),
    };

    this.joystick = new Joystick(input);
    this.joystick.attach(app.canvas);

    this.modal.onPick = (i) => this.pickChoice(i);
    this.modal.onReroll = () => this.reroll();
    this.pauseMenu.onResume = () => this.closePauseMenu();
    this.pauseMenu.onRetire = () => {
      this.pauseMenu.hide();
      this.events.onRetire();
    };

    this.container.addChild(
      this.bg,
      this.world,
      this.hud.container,
      this.modal.container,
      this.pauseMenu.container,
      this.joystick,
    );

    // ESC のトグルはここで一元管理する（§17）。レベルアップモーダル中は無効
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || this.container.parent === null) return;
      if (this.paused || this.finished) return;
      if (this.pauseMenu.visible) {
        this.closePauseMenu();
      } else {
        this.pauseMenu.show();
      }
    });

    if (import.meta.env.DEV) {
      // B キーで 50 体ずつ追加スポーン（性能検証用）。プレイ画面表示中のみ反応
      window.addEventListener('keydown', (e) => {
        if (e.code !== 'KeyB' || this.container.parent === null) return;
        this.spawn.burst(50);
      });
    }
  }

  /** ステージ選択から呼ばれる。キャラ特性 × メタ強化を合成済みの構成を受け取る（§7 / §14） */
  startStage(setup: RunSetup): void {
    this.setup = setup;
    this.stage = setup.stage;
    this.spawn.setStage(setup.stage);
    // ステージ背景（§12: アスファルト / 鉄板 / 汚泥）
    this.bg.texture = stageBackgroundTexture(setup.stage.id);
    // 選択キャラの見た目（§7）。未知IDは runner の見た目にフォールバック
    this.player.setAppearance(
      characterTexture(PLAYER_SPRITES[setup.characterId] ?? PLAYER_SPRITES.runner),
      PLAYER_DISPLAY_HEIGHT,
    );
    this.reset();
  }

  /** リトライ・ステージ開始時の初期化。プールへ全返却し、シーン自体は使い回す */
  reset(): void {
    for (let i = 0; i < this.enemies.length; i++) {
      this.enemies[i].deactivate();
      this.pool.release(this.enemies[i]);
    }
    this.enemies.length = 0;
    for (let i = 0; i < this.projectiles.length; i++) {
      this.projectiles[i].deactivate();
      this.projectilePool.release(this.projectiles[i]);
    }
    this.projectiles.length = 0;
    for (let i = 0; i < this.enemyProjectiles.length; i++) {
      this.enemyProjectiles[i].deactivate();
      this.enemyProjectilePool.release(this.enemyProjectiles[i]);
    }
    this.enemyProjectiles.length = 0;
    for (let i = 0; i < this.gems.length; i++) {
      this.gems[i].deactivate();
      this.gemPool.release(this.gems[i]);
    }
    this.gems.length = 0;
    for (let i = 0; i < this.pickups.length; i++) {
      this.pickups[i].deactivate();
      this.pickupPool.release(this.pickups[i]);
    }
    this.pickups.length = 0;
    for (let i = 0; i < this.particles.length; i++) {
      this.particles[i].deactivate();
      this.particlePool.release(this.particles[i]);
    }
    this.particles.length = 0;

    this.player.reset();
    this.spawn.reset();
    this.levelSystem.reset(this.setup.startLevel, this.setup.extraRerolls);
    this.pickup.reset();
    this.damage.reset();
    this.weapons.reset();
    this.weapons.add(this.setup.initialWeapon);
    this.passiveLevels = {};
    this.applyPassives();
    // キャラ・メタの最大HP補正を反映してから全回復させる（tank 130 開始など）
    this.player.hp = this.player.maxHp;
    this.modal.hide();
    this.pauseMenu.hide();
    this.paused = false;
    this.finished = false;
    this.elapsedSec = 0;
    this.bossRef = null;
    this.hud.setBossHp(null);
    this.camera.follow(0, 0);
  }

  /** タブ非アクティブ時に Game から呼ばれる自動ポーズ（§5） */
  autoPause(): void {
    if (this.container.parent === null) return;
    if (this.paused || this.finished || this.pauseMenu.visible) return;
    this.pauseMenu.show();
  }

  private closePauseMenu(): void {
    this.pauseMenu.hide();
    this.events.onResume();
  }

  /** §4.2 の更新順序 */
  update(dtSec: number): void {
    if (this.paused || this.pauseMenu.visible || this.finished) return;

    if (import.meta.env.DEV && this.pendingBurst > 0) {
      this.spawn.burst(this.pendingBurst);
      this.pendingBurst = 0;
    }

    this.elapsedSec += dtSec;

    // 1-4: 入力 → プレイヤー → スポーン → 敵移動（spitter の発射もここ）
    this.input.update();
    this.player.update(dtSec, this.input.state);
    this.spawn.update(dtSec);
    this.movement.update(dtSec, this.enemies, this.player, this.fireEnemyProjectile);

    // 5: ハッシュ再構築（武器の索敵が同一フレームの敵位置を見る）
    this.collision.rebuild(this.enemies);

    // 6: 武器
    this.weaponCtx.elapsedSec = this.elapsedSec;
    this.weaponCtx.searchRadius =
      Math.sqrt(
        this.camera.viewHalfWidth * this.camera.viewHalfWidth +
          this.camera.viewHalfHeight * this.camera.viewHalfHeight,
      ) + SEARCH_MARGIN;
    this.weapons.update(dtSec, this.weaponCtx);

    // 7-8: 弾の移動 → 敵弾の移動
    this.updateProjectiles(dtSec);
    this.updateEnemyProjectiles(dtSec);

    // 9: 当たり判定
    this.collision.projectilesVsEnemies(this.projectiles, this.weaponCtx.applyDamage);
    const contactDamage = this.collision.playerContactDamage(this.player);
    const bulletDamage = this.collision.enemyProjectilesVsPlayer(this.enemyProjectiles, this.player);
    this.collision.pushApart();

    // 10: ダメージ適用・死亡処理（接触と敵弾は §7 の無敵仕様に合わせ1回分に統合）
    this.damage.update(dtSec, this.player, Math.max(contactDamage, bulletDamage));
    this.damage.sweepDeaths(this.enemies, this.pool, this.pickup, this.spawnDeathParticles);
    this.updateParticles(dtSec);

    // 11: 経験値・レベルアップ判定
    this.pickup.update(dtSec);
    if (!this.finished && this.levelSystem.pendingLevels > 0) {
      this.openLevelUpModal();
    }

    // 12: カメラ追従（シェイクの減衰もカメラが持つ）
    this.camera.follow(this.player.x, this.player.y);
    this.camera.updateShake(dtSec, this.random);

    // ボスHPバー用の参照更新（出現フレームでのみ線形走査が走る）
    if (this.bossRef === null && this.spawn.bossSpawned) {
      for (let i = 0; i < this.enemies.length; i++) {
        if (this.enemies[i].isBoss) {
          this.bossRef = this.enemies[i];
          this.bossMaxHp = enemiesData.boss.hp * this.stage.difficultyMul;
          // ボス出現の演出（§16: シェイクはボス出現と爆弾のみ）
          this.camera.shake(SHAKE_BOSS_AMP, SHAKE_BOSS_SEC);
          break;
        }
      }
    }
  }

  /** クリア（ボス撃破）またはゲームオーバー（§12） */
  private finish(cleared: boolean): void {
    if (this.finished) return;
    this.finished = true;
    this.events.onFinished({
      cleared,
      timeSec: Math.min(this.elapsedSec, this.stage.bossAtSec),
      kills: this.damage.kills,
      level: this.levelSystem.level,
      stageName: this.stage.name,
      coins: this.coinsEarned(cleared),
    });
  }

  /**
   * コイン計算（§14）: floor((floor(キル数/20) + 生存分数×10) × ステージ係数)、
   * クリア時はさらに ×1.5。係数はコイン専用（stages.json の coinMultiplier）
   */
  private coinsEarned(cleared: boolean): number {
    const minutes = Math.min(this.elapsedSec, this.stage.bossAtSec) / 60;
    const base = Math.floor(
      (Math.floor(this.damage.kills / levelingData.coinKillDivisor) +
        minutes * levelingData.coinPerMinute) *
        this.stage.coinMultiplier,
    );
    return cleared ? Math.floor(base * levelingData.coinClearMultiplier) : base;
  }

  private spawnProjectile(): Projectile | null {
    const p = this.projectilePool.acquire();
    if (p === null) return null;
    this.projectiles.push(p);
    return p;
  }

  private updateProjectiles(dtSec: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (p.active && !p.persistent) {
        p.x += p.vx * dtSec;
        p.y += p.vy * dtSec;
        p.lifeSec -= dtSec;
      }
      // 貫通消費・寿命切れ・武器側で deactivate されたもの（オーブ等）をまとめて回収
      const expired = !p.active || (!p.persistent && (p.lifeSec <= 0 || p.pierceLeft <= 0));
      if (expired) {
        p.deactivate();
        this.projectiles[i] = this.projectiles[this.projectiles.length - 1];
        this.projectiles.pop();
        this.projectilePool.release(p);
      }
    }
  }

  private updateParticles(dtSec: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;
      p.lifeSec -= dtSec;
      if (p.lifeSec <= 0) {
        p.deactivate();
        this.particles[i] = this.particles[this.particles.length - 1];
        this.particles.pop();
        this.particlePool.release(p);
      }
    }
  }

  private updateEnemyProjectiles(dtSec: number): void {
    for (let i = this.enemyProjectiles.length - 1; i >= 0; i--) {
      const b = this.enemyProjectiles[i];
      if (b.active) {
        b.x += b.vx * dtSec;
        b.y += b.vy * dtSec;
        b.lifeSec -= dtSec;
      }
      if (!b.active || b.lifeSec <= 0) {
        b.deactivate();
        this.enemyProjectiles[i] = this.enemyProjectiles[this.enemyProjectiles.length - 1];
        this.enemyProjectiles.pop();
        this.enemyProjectilePool.release(b);
      }
    }
  }

  // ---- ピックアップ効果（§13） ----

  private applyPickup(kind: PickupKind): void {
    if (kind === 'heal') {
      this.player.hp = Math.min(
        this.player.maxHp,
        this.player.hp + this.player.maxHp * pickupsData.heal.healRatio,
      );
      return;
    }
    const halfW = this.camera.viewHalfWidth;
    const halfH = this.camera.viewHalfHeight;
    if (kind === 'magnet') {
      // 画面内のジェムを全て吸引開始（§13）。即時取得ではなく §13 の吸引仕様に乗せる
      for (let i = 0; i < this.gems.length; i++) {
        const g = this.gems[i];
        if (Math.abs(g.x - this.camera.x) > halfW || Math.abs(g.y - this.camera.y) > halfH) {
          continue;
        }
        if (!g.magnetized) {
          g.magnetized = true;
          g.speed = levelingData.gemBaseSpeed;
        }
      }
      return;
    }
    // 爆弾: 画面内の敵に 200 ダメージ（ボスにも有効）
    this.camera.shake(SHAKE_BOMB_AMP, SHAKE_BOMB_SEC);
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (Math.abs(e.x - this.camera.x) > halfW + e.radius) continue;
      if (Math.abs(e.y - this.camera.y) > halfH + e.radius) continue;
      e.takeDamage(pickupsData.bomb.damage);
    }
  }

  // ---- レベルアップ3択（§13 / §10） ----

  private openLevelUpModal(): void {
    this.paused = true;
    this.currentChoices = this.generateChoices();
    this.modal.show(
      this.currentChoices.map((c) => this.viewOf(c)),
      this.levelSystem.rerolls,
    );
  }

  private pickChoice(index: number): void {
    if (!this.paused) return;
    const choice = this.currentChoices[index];
    if (choice === undefined) return;
    this.applyChoice(choice);
    this.levelSystem.pendingLevels--;
    if (this.levelSystem.pendingLevels > 0) {
      // 複数レベル分溜まっている場合は連続で選ばせる
      this.openLevelUpModal();
      return;
    }
    this.modal.hide();
    this.paused = false;
    // ポーズ中に溜まったデルタを解除時に一気に消化しない（敵の瞬間移動防止）
    this.events.onResume();
  }

  private reroll(): void {
    if (this.levelSystem.rerolls <= 0 || !this.paused) return;
    this.levelSystem.rerolls--;
    // 進化候補は条件から決定的に再現されるため、リロールしても同じ枠に残る（§10 の優先度）
    this.currentChoices = this.generateChoices();
    this.modal.show(
      this.currentChoices.map((c) => this.viewOf(c)),
      this.levelSystem.rerolls,
    );
  }

  private applyChoice(choice: LevelChoice): void {
    switch (choice.kind) {
      case 'weaponNew':
        this.weapons.add(choice.weaponId);
        break;
      case 'weaponUp':
        this.weapons.find(choice.weaponId)?.levelUp();
        break;
      case 'evolution': {
        const evo = EVOLUTIONS[choice.evolutionId];
        this.weapons.replace(evo.base, choice.evolutionId);
        break;
      }
      case 'passive':
        this.passiveLevels[choice.passiveId] = (this.passiveLevels[choice.passiveId] ?? 0) + 1;
        this.applyPassives();
        break;
      case 'heal':
        this.player.hp = Math.min(
          this.player.maxHp,
          this.player.hp + this.player.maxHp * levelingData.healRatio,
        );
        break;
    }
  }

  /** 候補生成（§13 / §10）。進化 → 通常候補 → 小回復の順で3枠を埋める */
  private generateChoices(): LevelChoice[] {
    const out: LevelChoice[] = [];

    // 進化（武器 Lv5 + 指定パッシブ Lv3、§10）。条件成立分を先頭枠に確定で置く
    for (const evoId of EVOLUTION_IDS) {
      if (out.length >= 3) break;
      const evo = EVOLUTIONS[evoId];
      const w = this.weapons.find(evo.base);
      if (w === null || w.evolved || w.level < 5) continue;
      if ((this.passiveLevels[evo.requiredPassive] ?? 0) < evo.requiredPassiveLevel) continue;
      out.push({ kind: 'evolution', evolutionId: evoId });
    }

    const cands: LevelChoice[] = [];
    for (const w of this.weapons.list) {
      if (!w.evolved && w.level < 5) cands.push({ kind: 'weaponUp', weaponId: w.id });
    }
    if (this.weapons.count < MAX_WEAPONS) {
      for (const id of WEAPON_IDS) {
        if (this.weapons.has(id)) continue;
        // 進化済みの元武器は再取得させない（同じ進化を2つ作れてしまうため）
        const evoId = BASE_TO_EVOLUTION[id];
        if (evoId !== undefined && this.weapons.has(evoId)) continue;
        cands.push({ kind: 'weaponNew', weaponId: id });
      }
    }
    for (const id of PASSIVE_IDS) {
      if ((this.passiveLevels[id] ?? 0) < PASSIVES[id].maxLevel) {
        cands.push({ kind: 'passive', passiveId: id });
      }
    }
    // Fisher-Yates で混ぜて残枠へ（非重複）。レベルアップ時のみの処理なので割り当ては許容
    for (let i = cands.length - 1; i > 0; i--) {
      const j = Math.floor(this.random.next() * (i + 1));
      const tmp = cands[i];
      cands[i] = cands[j];
      cands[j] = tmp;
    }
    for (let i = 0; i < cands.length && out.length < 3; i++) {
      out.push(cands[i]);
    }
    while (out.length < 3) out.push({ kind: 'heal' });
    return out;
  }

  /** カード表示用テキスト。§16: 効果説明には必ず数値を含める */
  private viewOf(choice: LevelChoice): ChoiceView {
    switch (choice.kind) {
      case 'weaponNew': {
        const def = WEAPON_DEFS[choice.weaponId];
        return { title: def.name, levelText: 'NEW', effectText: def.newText };
      }
      case 'weaponUp': {
        const w = this.weapons.find(choice.weaponId);
        const def = WEAPON_DEFS[choice.weaponId];
        const lv = w?.level ?? 1;
        return {
          title: def.name,
          levelText: `Lv.${lv} → ${lv + 1}`,
          effectText: def.upTexts[lv - 1],
        };
      }
      case 'evolution': {
        const evo = EVOLUTIONS[choice.evolutionId];
        return {
          title: evo.name,
          levelText: 'EVOLUTION',
          effectText: EVOLUTION_TEXTS[choice.evolutionId],
          evolved: true,
        };
      }
      case 'passive': {
        const def = PASSIVES[choice.passiveId];
        const lv = this.passiveLevels[choice.passiveId] ?? 0;
        return {
          title: def.name,
          levelText: lv === 0 ? 'NEW' : `Lv.${lv} → ${lv + 1}`,
          effectText: passiveEffectText(def),
        };
      }
      case 'heal':
        return {
          title: '小回復',
          levelText: '-',
          effectText: `HP ${Math.round(levelingData.healRatio * 100)}% 回復`,
        };
    }
  }

  /**
   * 補正の合成（適用順序の定義）: 基礎値 × キャラ特性 × メタ強化 × パッシブ。
   * キャラ × メタは setup.base に合成済みで、その上にパッシブを乗算する
   * （カテゴリ間は乗算 = 可換なので順序不問。回復のみ実数値/秒の加算）。
   * パッシブ取得時のみ再計算する（毎フレーム計算しない）。
   */
  private applyPassives(): void {
    const p = computeModifiers(this.passiveLevels);
    const b = this.setup.base;
    const mods: Modifiers = {
      damageMul: b.damageMul * p.damageMul,
      cooldownMul: b.cooldownMul * p.cooldownMul,
      moveSpeedMul: b.moveSpeedMul * p.moveSpeedMul,
      pickupRangeMul: b.pickupRangeMul * p.pickupRangeMul,
      maxHpMul: b.maxHpMul * p.maxHpMul,
      regenPerSec: b.regenPerSec + p.regenPerSec,
    };
    this.player.applyModifiers(mods);
    this.pickup.pickupRangeMul = mods.pickupRangeMul;
    this.weaponCtx.damageMul = mods.damageMul;
    this.weaponCtx.cooldownMul = mods.cooldownMul;
  }

  render(): void {
    this.player.syncSprite();

    // 画面外のエンティティは描画しない（§6）。更新は続けているので visible の切替のみ
    const halfW = this.camera.viewHalfWidth;
    const halfH = this.camera.viewHalfHeight;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      e.syncSprite();
      // マージンは半径×2: スプライトの見た目（身長 = 半径×4）が判定円より大きく、
      // 画面端で不自然に消えないようにするため
      e.sprite.visible =
        Math.abs(e.x - this.camera.x) < halfW + e.radius * 2 &&
        Math.abs(e.y - this.camera.y) < halfH + e.radius * 2;
    }
    for (let i = 0; i < this.projectiles.length; i++) {
      const p = this.projectiles[i];
      p.syncSprite();
      p.sprite.visible =
        Math.abs(p.x - this.camera.x) < halfW + 60 && Math.abs(p.y - this.camera.y) < halfH + 60;
    }
    for (let i = 0; i < this.enemyProjectiles.length; i++) {
      const b = this.enemyProjectiles[i];
      b.syncSprite();
      b.sprite.visible =
        Math.abs(b.x - this.camera.x) < halfW + 20 && Math.abs(b.y - this.camera.y) < halfH + 20;
    }
    for (let i = 0; i < this.gems.length; i++) {
      const g = this.gems[i];
      g.syncSprite();
      g.sprite.visible =
        Math.abs(g.x - this.camera.x) < halfW + 20 && Math.abs(g.y - this.camera.y) < halfH + 20;
    }
    for (let i = 0; i < this.particles.length; i++) {
      // 寿命 0.4s で遠くへ飛ばないため、カリング判定はせず位置とフェードのみ更新する
      this.particles[i].syncSprite();
    }

    this.camera.apply(this.world);

    // 背景をカメラと同じ量だけ逆方向に流す。TilingSprite が繰り返しを担うので
    // オフセットは剰余を取らずそのままで途切れない。シェイク込みの位置を使い、
    // ワールドと背景が一体で揺れるようにする
    const z = this.camera.zoom;
    this.bg.tileScale.set(z);
    this.bg.tilePosition.set(-this.camera.renderX * z, -this.camera.renderY * z);

    this.hud.setHp(this.player.hp, this.player.maxHp);
    this.hud.setExp(this.levelSystem.expRatio());
    this.hud.setLevel(this.levelSystem.level);
    // §12: ボス出現後はタイマー停止（残り時間は 1:00 で固定表示される）
    this.hud.setTime(this.stage.durationSec - Math.min(this.elapsedSec, this.stage.bossAtSec));
    if (this.bossRef !== null) {
      if (this.bossRef.active && this.bossRef.isBoss) {
        this.hud.setBossHp(this.bossRef.hp / this.bossMaxHp);
      } else {
        this.bossRef = null;
        this.hud.setBossHp(null);
      }
    }
    // 右下: このプレイで獲得予定のコイン（§16。クリア補正なしの現在値）
    this.hud.setCoins(this.coinsEarned(false));
    if (import.meta.env.DEV) {
      this.hud.setEnemyCount(this.enemies.length);
    }
    this.hud.render();
  }

  resize(width: number, height: number): void {
    this.camera.resize(width, height);
    this.bg.width = width;
    this.bg.height = height;
    this.joystick.resize(width);
    this.hud.resize(width, height);
    this.modal.resize(width, height);
    this.pauseMenu.resize(width, height);
    // 敵上限のスマホ/PC 判定はカメラと同じ幅基準に集約している（device.ts）
    this.spawn.maxEnemies = enemyLimit(width);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

// ---- 表示テキスト（§16: 数値を必ず含める） ----

interface WeaponViewDef {
  name: string;
  newText: string;
  /** upTexts[lv-1] = lv → lv+1 の説明 */
  upTexts: string[];
}

const WEAPON_DEFS: Record<string, WeaponViewDef> = buildWeaponViewDefs();
const EVOLUTION_TEXTS: Record<string, string> = buildEvolutionTexts();

function buildWeaponViewDefs(): Record<string, WeaponViewDef> {
  const defs: Record<string, WeaponViewDef> = {};
  const shot: ShotLevel[] = weaponsData.shot.levels;
  defs.shot = {
    name: weaponsData.shot.name,
    newText: `最も近い敵へ弾を発射 / ダメージ ${shot[0].damage}`,
    upTexts: diffTexts(shot.map((l) => ({ ダメージ: l.damage, 弾数: l.count, CD: l.cooldownSec }))),
  };
  defs.orb = {
    name: weaponsData.orb.name,
    newText: `周囲を回転 / 接触 ${weaponsData.orb.levels[0].damage} ダメージ`,
    upTexts: diffTexts(
      weaponsData.orb.levels.map((l) => ({ ダメージ: l.damage, 個数: l.count, 半径: l.orbitRadius })),
    ),
  };
  defs.shuriken = {
    name: weaponsData.shuriken.name,
    newText: `直線に飛び貫通 / ダメージ ${weaponsData.shuriken.levels[0].damage}`,
    upTexts: diffTexts(
      weaponsData.shuriken.levels.map((l) => ({
        ダメージ: l.damage,
        弾数: l.count,
        貫通: l.pierce,
        CD: l.cooldownSec,
      })),
    ),
  };
  defs.thunder = {
    name: weaponsData.thunder.name,
    newText: `ランダムな敵に範囲攻撃 / ダメージ ${weaponsData.thunder.levels[0].damage}`,
    upTexts: diffTexts(
      weaponsData.thunder.levels.map((l) => ({
        ダメージ: l.damage,
        落雷数: l.strikes,
        CD: l.cooldownSec,
      })),
    ),
  };
  defs.flame = {
    name: weaponsData.flame.name,
    newText: `前方扇形に持続ダメージ ${weaponsData.flame.levels[0].damagePerTick}/0.2s`,
    upTexts: diffTexts(
      weaponsData.flame.levels.map((l) => ({
        ダメージ: l.damagePerTick,
        射程: l.range,
        角度: l.arcDeg,
      })),
    ),
  };
  return defs;
}

/** 進化カードの効果説明（§16: 数値必須）。起動時に JSON の値から組み立てる */
function buildEvolutionTexts(): Record<string, string> {
  const g = evolutionsData.gatling.stats;
  const s = evolutionsData.satellite.stats;
  const b = evolutionsData.boomerang.stats;
  const st = evolutionsData.storm.stats;
  const inf = evolutionsData.inferno.stats;
  return {
    gatling: `連射化 / ダメージ ${g.damage} / CD ${g.cooldownSec}s`,
    satellite: `${s.count}個・二重回転 / ダメージ ${s.damage}`,
    boomerang: `貫通無制限・戻ってくる / ダメージ ${b.damage}`,
    storm: `連続落雷 ×${st.strikes} / ダメージ ${st.damage}`,
    inferno: `全方位 ${inf.damagePerTick}/0.2s / 与ダメの${inf.lifestealRatio * 100}%吸収`,
  };
}

/** レベル間の差分から「ダメージ 13→17」のような説明文を作る（起動時に1回だけ） */
function diffTexts(rows: Record<string, number>[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const parts: string[] = [];
    for (const key of Object.keys(rows[i])) {
      if (rows[i][key] !== rows[i + 1][key]) {
        parts.push(`${key} ${rows[i][key]} → ${rows[i + 1][key]}`);
      }
    }
    out.push(parts.join(' / '));
  }
  out.push('最大レベル');
  return out;
}

function passiveEffectText(def: PassiveDef): string {
  if (def.damageAddPerLevel !== undefined) return `全武器ダメージ +${def.damageAddPerLevel * 100}%`;
  if (def.cooldownCutPerLevel !== undefined) return `全武器CD -${def.cooldownCutPerLevel * 100}%`;
  if (def.moveSpeedAddPerLevel !== undefined) return `移動速度 +${def.moveSpeedAddPerLevel * 100}%`;
  if (def.pickupRangeAddPerLevel !== undefined) {
    return `ジェム取得範囲 +${def.pickupRangeAddPerLevel * 100}%`;
  }
  if (def.maxHpAddPerLevel !== undefined) {
    return `最大HP +${def.maxHpAddPerLevel * 100}% / 回復 +${def.regenAddPerLevel ?? 0}/s`;
  }
  return '';
}

/** パッシブ合算（§9）。効果はレベル加算、CD短縮は合計 -50% でクランプ */
function computeModifiers(levels: Record<string, number>): Modifiers {
  let damage = 1;
  let cooldownCut = 0;
  let cooldownCap = 0.5;
  let moveSpeed = 1;
  let pickupRange = 1;
  let maxHp = 1;
  let regen = 0;
  for (const id of Object.keys(levels)) {
    const def = PASSIVES[id];
    const lv = levels[id];
    if (def === undefined || lv <= 0) continue;
    damage += (def.damageAddPerLevel ?? 0) * lv;
    cooldownCut += (def.cooldownCutPerLevel ?? 0) * lv;
    if (def.cooldownCutCap !== undefined) cooldownCap = def.cooldownCutCap;
    moveSpeed += (def.moveSpeedAddPerLevel ?? 0) * lv;
    pickupRange += (def.pickupRangeAddPerLevel ?? 0) * lv;
    maxHp += (def.maxHpAddPerLevel ?? 0) * lv;
    regen += (def.regenAddPerLevel ?? 0) * lv;
  }
  return {
    damageMul: damage,
    cooldownMul: 1 - Math.min(cooldownCut, cooldownCap),
    moveSpeedMul: moveSpeed,
    pickupRangeMul: pickupRange,
    maxHpMul: maxHp,
    regenPerSec: regen,
  };
}

// ---- プレースホルダテクスチャ生成（初期化時に1回のみ） ----

function createGemTexture(app: Application): Texture {
  // ひし形（EXP は琥珀。§16）
  const s = 5;
  const g = new Graphics()
    .poly([s + 1, 1, s * 2 + 1, s + 1, s + 1, s * 2 + 1, 1, s + 1])
    .fill(COLORS.amber);
  const texture = app.renderer.generateTexture({
    target: g,
    frame: new Rectangle(0, 0, s * 2 + 2, s * 2 + 2),
  });
  g.destroy();
  return texture;
}

function createBulletTexture(app: Application, radius: number): Texture {
  const g = new Graphics()
    .circle(radius + 1, radius + 1, radius)
    .fill(COLORS.textMain);
  const texture = app.renderer.generateTexture({
    target: g,
    frame: new Rectangle(0, 0, (radius + 1) * 2, (radius + 1) * 2),
  });
  g.destroy();
  return texture;
}

/** 敵弾（spitter）。自弾と見分けがつくよう琥珀の小円にする */
function createEnemyBulletTexture(app: Application): Texture {
  const r = 6;
  const g = new Graphics()
    .circle(r + 1, r + 1, r)
    .fill(COLORS.amber)
    .stroke({ width: 1, color: COLORS.hpRed });
  const texture = app.renderer.generateTexture({
    target: g,
    frame: new Rectangle(0, 0, (r + 1) * 2, (r + 1) * 2),
  });
  g.destroy();
  return texture;
}

/** ピックアップ（回復=toxic / マグネット=amber / 爆弾=hpRed のリング） */
function createPickupTexture(app: Application, color: number): Texture {
  const r = 10;
  const g = new Graphics()
    .circle(r + 2, r + 2, r)
    .stroke({ width: 3, color })
    .circle(r + 2, r + 2, 3)
    .fill(color);
  const texture = app.renderer.generateTexture({
    target: g,
    frame: new Rectangle(0, 0, (r + 2) * 2, (r + 2) * 2),
  });
  g.destroy();
  return texture;
}

function createOrbTexture(app: Application): Texture {
  const r = 10;
  const g = new Graphics()
    .circle(r + 2, r + 2, r)
    .fill({ color: COLORS.amber, alpha: 0.9 })
    .stroke({ width: 2, color: COLORS.textMain });
  const texture = app.renderer.generateTexture({
    target: g,
    frame: new Rectangle(0, 0, (r + 2) * 2, (r + 2) * 2),
  });
  g.destroy();
  return texture;
}

/** 落雷の演出ボルト（縦長の琥珀の矩形） */
function createBoltTexture(app: Application): Texture {
  const g = new Graphics()
    .rect(0, 0, 8, 110)
    .fill({ color: COLORS.amber, alpha: 0.85 })
    .rect(2, 0, 4, 110)
    .fill({ color: COLORS.textMain, alpha: 0.9 });
  const texture = app.renderer.generateTexture({
    target: g,
    frame: new Rectangle(0, 0, 8, 110),
  });
  g.destroy();
  return texture;
}

/** 火炎のレベル別扇形。頂点（プレイヤー位置）が左端中央に来るように切り出す */
function createFlameSectorTexture(app: Application, range: number, arcDeg: number): Texture {
  const half = ((arcDeg / 2) * Math.PI) / 180;
  const g = new Graphics()
    .moveTo(0, 0)
    .arc(0, 0, range, -half, half)
    .lineTo(0, 0)
    .fill({ color: COLORS.amber, alpha: 0.28 });
  const spread = Math.sin(half) * range;
  const texture = app.renderer.generateTexture({
    target: g,
    frame: new Rectangle(0, -spread, range, spread * 2),
  });
  g.destroy();
  return texture;
}

/** インフェルノの全方位円（§10）。薄い琥珀のリングで範囲を示す */
function createInfernoTexture(app: Application, range: number): Texture {
  const g = new Graphics()
    .circle(range, range, range)
    .fill({ color: COLORS.amber, alpha: 0.14 })
    .circle(range, range, range)
    .stroke({ width: 2, color: COLORS.amber, alpha: 0.4 });
  const texture = app.renderer.generateTexture({
    target: g,
    frame: new Rectangle(0, 0, range * 2, range * 2),
  });
  g.destroy();
  return texture;
}
