import type { Application } from 'pixi.js';
import passivesData from '../data/passives.json';
import type { Game } from './Game';
import type { GameLoop } from './GameLoop';
import type { SaveManager } from '../save/SaveManager';
import type { SaveData } from '../types';
import type { InputManager } from './Input';
import type { Enemy } from '../entities/Enemy';
import type { Gem } from '../entities/Gem';
import type { Player } from '../entities/Player';
import type { Projectile } from '../entities/Projectile';
import type { PlayScene } from '../scenes/PlayScene';
import type { LevelSystem } from '../systems/LevelSystem';
import type { PickupSystem } from '../systems/PickupSystem';
import type { SpawnSystem } from '../systems/SpawnSystem';
import { WEAPON_IDS, WeaponSystem } from '../systems/WeaponSystem';
import type { LevelChoice } from '../types';

/**
 * 自動検証・手動デバッグ用のフック。Game から DEV ビルドでのみ動的 import される
 * （本番ビルドでは import ごと削除され、このモジュールは一切含まれない）。
 * ウィンドウがオクルージョンで自動ポーズしていても、tick() でループを
 * 手動駆動して挙動を検証できる。
 */
export interface DebugApi {
  /** ループを手動で1回駆動する（deltaMS を渡す） */
  tick(ms: number): void;
  /** 描画を除いた update のみを駆動する（処理量のスケーリング計測用） */
  tickNoDraw(ms: number): void;
  /**
   * rAF からの自動駆動を切り替える。false の間は手動 tick だけがゲームを進むため、
   * 自動プレイ計測（scripts/baseline.mjs）が壁時計に依存せず決定的になる
   */
  setAutoTick(on: boolean): void;
  /** 敵を一括スポーンする */
  burst(count: number): void;
  /** 経験値を直接加算する（レベルアップモーダルの検証用） */
  giveExp(amount: number): void;
  /** ジェムを強制生成する（400上限と最古自動回収の検証用）。プレイヤーの取得範囲外に撒く */
  spawnGems(count: number): void;
  /** 経過時間をワープさせる（ボス出現 = 840s の検証用） */
  warp(sec: number): void;
  /** ボスに即死ダメージを与える（クリア遷移の検証用） */
  killBoss(): void;
  /** セーブ状態のスナップショット（§14 の永続化検証用） */
  saveState(): SaveData;
  /** 武器5種 Lv5 + パッシブ5種 Lv5 のフル装備にする（性能検証用） */
  maxLoadout(): void;
  /** 指定武器を指定レベルで付与する（性能検証・スモークテスト用） */
  addWeapon(id: string, level: number): void;
  /** 表示中のレベルアップ3択を "kind:id" 形式で返す（自動プレイ検証用。非表示時は空配列） */
  choices(): string[];
  /** プレイヤー近傍の敵座標（自動プレイの回避AI用）。maxDist px 以内のみ */
  enemySnapshot(maxDist: number): { x: number; y: number }[];
  /** ボスのワールド座標（ボス戦の自動プレイ用）。不在なら null */
  bossPos(): { x: number; y: number } | null;
  /** プレイヤー近傍のジェム座標（自動プレイの回収AI用）。maxDist px 以内のみ */
  gemSnapshot(maxDist: number): { x: number; y: number }[];
  /** 検証用の内部状態スナップショット */
  state(): {
    elapsedSec: number;
    playerX: number;
    playerY: number;
    playerHp: number;
    enemies: number;
    projectiles: number;
    enemyProjectiles: number;
    gems: number;
    gemsCollected: number;
    pickupsOnField: number;
    level: number;
    exp: number;
    expMul: number;
    pendingLevels: number;
    rerolls: number;
    kills: number;
    maxHp: number;
    shieldReady: boolean;
    coinsPending: number;
    paused: boolean;
    pauseMenuOpen: boolean;
    finished: boolean;
    bossActive: boolean;
    bossHp: number;
    weapons: string;
    moveX: number;
    moveY: number;
    worstOverlap: number;
    pendingBurst: number;
  };
}

/**
 * PlayScene の private メンバーへ検証目的でアクセスするための構造型。
 * TS の private はコンパイル時のみの制約で、Vite はプロパティ名を難読化しない
 * ため実行時にはこの名前で到達できる。PlayScene 側にデバッグ用メソッドを
 * 生やさないのは、本番バンドルに死コードを一切残さないため。
 */
interface PlaySceneInternals {
  player: Player;
  enemies: Enemy[];
  projectiles: Projectile[];
  enemyProjectiles: { length: number }[];
  gems: Gem[];
  pickups: { length: number }[];
  spawn: SpawnSystem;
  input: InputManager;
  levelSystem: LevelSystem;
  pickup: PickupSystem;
  weapons: WeaponSystem;
  damage: { kills: number };
  paused: boolean;
  finished: boolean;
  pauseMenu: { visible: boolean };
  elapsedSec: number;
  pendingBurst: number;
  currentChoices: LevelChoice[];
  applyChoice(choice: LevelChoice): void;
  coinsEarned(cleared: boolean): number;
}

/** Game の private セーブへ検証目的でアクセスする */
interface GameInternals {
  save: SaveManager;
}

/** SpawnSystem の private な経過時間へワープ用にアクセスする */
interface SpawnInternals {
  elapsedSec: number;
}

export function attachDebug(loop: GameLoop, play: PlayScene, app: Application, game: Game): void {
  const p = play as unknown as PlaySceneInternals;
  const g = game as unknown as GameInternals;
  const api: DebugApi = {
    // rAF が止まっていても画面を確認できるよう、手動 tick では描画も明示的に行う
    tick: (ms) => {
      loop.tick(ms);
      app.renderer.render(app.stage);
    },
    tickNoDraw: (ms) => loop.tick(ms),
    setAutoTick: (on) => {
      loop.autoTick = on;
      // 再開時に停止中へ溜まったデルタを一気に消化しないよう捨てる
      if (on) loop.reset();
    },
    burst: (count) => p.spawn.burst(count),
    giveExp: (amount) => p.levelSystem.addExp(amount),
    spawnGems: (count) => {
      for (let i = 0; i < count; i++) {
        // 取得範囲（基準60px×マグネット最大2.25倍=135px）の外に撒いて即回収を防ぐ
        const angle = Math.random() * Math.PI * 2;
        const dist = 200 + Math.random() * 300;
        p.pickup.spawnGem(
          'gem_small',
          p.player.x + Math.cos(angle) * dist,
          p.player.y + Math.sin(angle) * dist,
        );
      }
    },
    warp: (sec) => {
      p.elapsedSec = sec;
      (p.spawn as unknown as SpawnInternals).elapsedSec = sec;
    },
    killBoss: () => {
      for (let i = 0; i < p.enemies.length; i++) {
        if (p.enemies[i].isBoss) {
          p.enemies[i].takeDamage(Number.MAX_SAFE_INTEGER);
          return;
        }
      }
    },
    saveState: () => JSON.parse(JSON.stringify(g.save.data)) as SaveData,
    addWeapon: (id, level) => {
      p.applyChoice({ kind: 'weaponNew', weaponId: id });
      const w = p.weapons.find(id);
      if (w !== null) {
        while (w.level < level) w.levelUp();
      }
    },
    enemySnapshot: (maxDist) => {
      const out: { x: number; y: number }[] = [];
      const maxSq = maxDist * maxDist;
      for (let i = 0; i < p.enemies.length; i++) {
        const e = p.enemies[i];
        const dx = e.x - p.player.x;
        const dy = e.y - p.player.y;
        if (dx * dx + dy * dy <= maxSq) out.push({ x: e.x, y: e.y });
      }
      return out;
    },
    bossPos: () => {
      for (let i = 0; i < p.enemies.length; i++) {
        if (p.enemies[i].isBoss) return { x: p.enemies[i].x, y: p.enemies[i].y };
      }
      return null;
    },
    gemSnapshot: (maxDist) => {
      const out: { x: number; y: number }[] = [];
      const maxSq = maxDist * maxDist;
      for (let i = 0; i < p.gems.length; i++) {
        const g = p.gems[i];
        const dx = g.x - p.player.x;
        const dy = g.y - p.player.y;
        if (dx * dx + dy * dy <= maxSq) out.push({ x: g.x, y: g.y });
      }
      return out;
    },
    choices: () =>
      p.paused
        ? p.currentChoices.map((c) => {
            switch (c.kind) {
              case 'weaponNew':
              case 'weaponUp':
                return `${c.kind}:${c.weaponId}`;
              case 'evolution':
                return `evolution:${c.evolutionId}`;
              case 'passive':
                return `passive:${c.passiveId}`;
              case 'heal':
                return 'heal';
            }
          })
        : [],
    maxLoadout: () => {
      for (const id of WEAPON_IDS) {
        p.applyChoice({ kind: 'weaponNew', weaponId: id });
      }
      for (const w of p.weapons.list) {
        while (w.level < 5) w.levelUp();
      }
      for (const id of Object.keys(passivesData)) {
        for (let i = 0; i < 5; i++) {
          p.applyChoice({ kind: 'passive', passiveId: id });
        }
      }
    },
    state: () => {
      let bossActive = false;
      let bossHp = 0;
      for (let i = 0; i < p.enemies.length; i++) {
        if (p.enemies[i].isBoss) {
          bossActive = true;
          bossHp = p.enemies[i].hp;
          break;
        }
      }
      return {
        elapsedSec: p.elapsedSec,
        playerX: p.player.x,
        playerY: p.player.y,
        playerHp: p.player.hp,
        enemies: p.enemies.length,
        projectiles: p.projectiles.length,
        enemyProjectiles: p.enemyProjectiles.length,
        gems: p.gems.length,
        gemsCollected: p.pickup.gemsCollected,
        pickupsOnField: p.pickups.length,
        level: p.levelSystem.level,
        exp: p.levelSystem.exp,
        expMul: p.levelSystem.expMul,
        pendingLevels: p.levelSystem.pendingLevels,
        rerolls: p.levelSystem.rerolls,
        kills: p.damage.kills,
        maxHp: p.player.maxHp,
        shieldReady: p.player.shieldReady,
        coinsPending: p.coinsEarned(false),
        paused: p.paused,
        pauseMenuOpen: p.pauseMenu.visible,
        finished: p.finished,
        bossActive,
        bossHp,
        weapons: p.weapons.list.map((w) => `${w.id}:${w.level}`).join(','),
        moveX: p.input.state.moveX,
        moveY: p.input.state.moveY,
        worstOverlap: worstOverlap(p.enemies),
        pendingBurst: p.pendingBurst,
      };
    },
  };
  (window as Window & { __debug?: DebugApi }).__debug = api;
}

/** 押し出しの検証用: 全ペア中で最も深い重なり(px)。呼ばれた時だけ O(n²) で計算する */
function worstOverlap(enemies: Enemy[]): number {
  let worst = 0;
  for (let i = 0; i < enemies.length; i++) {
    for (let j = i + 1; j < enemies.length; j++) {
      const dx = enemies[j].x - enemies[i].x;
      const dy = enemies[j].y - enemies[i].y;
      const overlap = enemies[i].radius + enemies[j].radius - Math.sqrt(dx * dx + dy * dy);
      if (overlap > worst) worst = overlap;
    }
  }
  return worst;
}
