import enemiesData from '../data/enemies.json';
import stagesData from '../data/stages.json';
import type { Camera } from '../core/Camera';
import type { ObjectPool } from '../core/ObjectPool';
import type { Random } from '../core/Random';
import { ENEMY_LIMIT_PC } from '../core/device';
import type { Enemy } from '../entities/Enemy';
import type { ChallengeDef, DangerDef, DifficultyGrowth, EnemyStats, StageDef, WaveDef } from '../types';

const ENEMY_STATS: Record<string, EnemyStats> = enemiesData;
const DANGER: DangerDef = stagesData.danger;

/** 画面外スポーンのマージン（§12: カメラ矩形の外周 + 80px） */
const SPAWN_MARGIN = 80;

/** 抽選を O(ウェーブ切替時のみ前計算) にするための累積重みつきウェーブ */
interface PreparedWave {
  untilSec: number;
  perSec: number;
  ids: string[];
  cumWeights: number[];
  totalWeight: number;
}

/**
 * 時間経過に応じた敵の湧き（§12）。テーブルは stages.json が唯一の正。
 * スポーン位置はカメラ可視矩形の外周 + 80px のリング上。
 * 14:00 でボスを1体スポーンし、以降は湧きレートを afterBossPerSec に減衰、
 * 難易度倍率の時間成長も停止する（タイマー停止の仕様に合わせる。§12）。
 */
export class SpawnSystem {
  /** 敵の同時存在上限。resize 時に PlayScene が端末判定（device.ts）で更新する */
  maxEnemies = ENEMY_LIMIT_PC;

  /** ボスが出現済みか（PlayScene がタイマー表示の停止にも使う） */
  bossSpawned = false;

  private stage: StageDef;
  private elapsedSec = 0;
  private spawnAcc = 0;
  private waves: PreparedWave[];

  /** 危険度係数（§12 Phase 9）。危険度0 = すべて1.0 で現行バランスのまま */
  private dangerHpMul = 1;
  private dangerDamageMul = 1;
  private dangerEliteMul = 1;

  /** チャレンジ修飾子（§13 Phase 10）。null = 通常プレイ */
  private challenge: ChallengeDef | null = null;

  constructor(
    stage: StageDef,
    private readonly growth: DifficultyGrowth,
    private readonly pool: ObjectPool<Enemy>,
    private readonly enemies: Enemy[],
    private readonly camera: Camera,
    private readonly random: Random,
  ) {
    this.stage = stage;
    this.waves = stage.waves.map(prepareWave);
  }

  /**
   * 危険度（§12 Phase 9）。HP・ダメージ係数と、エリート敵（tank_z / spitter）の
   * 抽選重み倍率を設定する。湧きレートは上げない（敵上限に張り付いて無効化されるため、
   * 数ではなく質で難度を上げる）。setStage より先に呼ぶこと
   */
  setDanger(level: number): void {
    this.dangerHpMul = 1 + DANGER.hpMulPerLevel * level;
    this.dangerDamageMul = 1 + DANGER.damageMulPerLevel * level;
    this.dangerEliteMul = 1 + DANGER.eliteWeightPerLevel * level;
  }

  /**
   * チャレンジ修飾子（§13 Phase 10）。mixOverride は全ウェーブの内訳を差し替え、
   * rateMul は湧きレートに乗算、enemyHpMul は敵HPに乗算する。setStage より先に呼ぶこと
   */
  setChallenge(challenge: ChallengeDef | null): void {
    this.challenge = challenge;
  }

  /** ステージ選択（§12）。ウェーブテーブルを差し替えて初期化する */
  setStage(stage: StageDef): void {
    this.stage = stage;
    const mixOverride = this.challenge?.mixOverride;
    this.waves = stage.waves.map((w) =>
      prepareWave(mixOverride !== undefined ? { ...w, mix: mixOverride } : w, this.dangerEliteMul),
    );
    this.reset();
  }

  reset(): void {
    this.elapsedSec = 0;
    this.spawnAcc = 0;
    this.bossSpawned = false;
  }

  update(dtSec: number): void {
    this.elapsedSec += dtSec;

    if (!this.bossSpawned && this.elapsedSec >= this.stage.bossAtSec) {
      this.spawnBoss();
      this.bossSpawned = true;
    }

    const wave = this.currentWave();
    const perSec =
      (this.bossSpawned ? this.stage.afterBossPerSec : wave.perSec) *
      (this.challenge?.rateMul ?? 1);
    // 湧き数/秒を積算し、1を超えた分だけ湧かせる（端数を捨てずレートを正確に保つ）
    this.spawnAcc += perSec * dtSec;
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      this.spawnOne(wave);
    }
  }

  /** デバッグ用の一括スポーン（DEV ビルドのみから呼ばれる） */
  burst(count: number): void {
    const wave = this.currentWave();
    for (let i = 0; i < count; i++) {
      this.spawnOne(wave);
    }
  }

  private currentWave(): PreparedWave {
    for (let i = 0; i < this.waves.length; i++) {
      if (this.elapsedSec < this.waves[i].untilSec) return this.waves[i];
    }
    // ボス出現後（§12: 14:00 以降）は最終ウェーブの内訳を流用し、レートのみ変える
    return this.waves[this.waves.length - 1];
  }

  private spawnOne(wave: PreparedWave): void {
    // §15: 上限超過分はスポーンをスキップ
    if (this.enemies.length >= this.maxEnemies) return;
    const enemy = this.pool.acquire();
    if (enemy === null) return;

    const id = this.pickId(wave);

    // §12: 時間係数 × ステージ係数 × 危険度係数（× チャレンジ修飾子）。ボス出現後は時間成長を凍結する
    const minutes = Math.min(this.elapsedSec, this.stage.bossAtSec) / 60;
    const hpMul =
      (1 + minutes * this.growth.hpPerMin) *
      this.stage.difficultyMul *
      this.dangerHpMul *
      (this.challenge?.enemyHpMul ?? 1);
    const damageMul =
      (1 + minutes * this.growth.damagePerMin) * this.stage.difficultyMul * this.dangerDamageMul;

    this.spawnAt(enemy, id, hpMul, damageMul);
  }

  /** ボス（§11 / §12）。時間係数は掛けず、ステージ係数 × 危険度係数を適用する */
  private spawnBoss(): void {
    let enemy = this.pool.acquire();
    if (enemy === null) {
      // プール枯渇（通常敵で満杯）時はボスを最優先し、最後尾の通常敵を1体回収する
      const victim = this.enemies[this.enemies.length - 1];
      if (victim === undefined) return;
      victim.deactivate();
      this.enemies.pop();
      this.pool.release(victim);
      enemy = this.pool.acquire();
      if (enemy === null) return;
    }
    this.spawnAt(
      enemy,
      'boss',
      this.stage.difficultyMul * this.dangerHpMul,
      this.stage.difficultyMul * this.dangerDamageMul,
    );
    enemy.isBoss = true;
  }

  /** リング上のランダム位置に配置して enemies へ登録する */
  private spawnAt(enemy: Enemy, id: string, hpMul: number, damageMul: number): void {
    const stats: EnemyStats = ENEMY_STATS[id];
    const halfW = this.camera.viewHalfWidth + SPAWN_MARGIN;
    const halfH = this.camera.viewHalfHeight + SPAWN_MARGIN;
    const w = halfW * 2;
    const h = halfH * 2;
    let t = this.random.range(0, (w + h) * 2);
    let sx: number;
    let sy: number;
    if (t < w) {
      sx = -halfW + t;
      sy = -halfH;
    } else if ((t -= w) < h) {
      sx = halfW;
      sy = -halfH + t;
    } else if ((t -= h) < w) {
      sx = halfW - t;
      sy = halfH;
    } else {
      t -= w;
      sx = -halfW;
      sy = halfH - t;
    }

    enemy.reset(id, stats, this.camera.x + sx, this.camera.y + sy, hpMul, damageMul);
    this.enemies.push(enemy);
  }

  private pickId(wave: PreparedWave): string {
    const r = this.random.range(0, wave.totalWeight);
    for (let i = 0; i < wave.cumWeights.length; i++) {
      if (r < wave.cumWeights[i]) return wave.ids[i];
    }
    return wave.ids[wave.ids.length - 1];
  }
}

function prepareWave(wave: WaveDef, eliteMul: number): PreparedWave {
  const ids = Object.keys(wave.mix);
  const cumWeights: number[] = [];
  let total = 0;
  for (const id of ids) {
    // 危険度はエリート敵（§12 Phase 9）の重みだけを引き上げる。
    // 登場する敵種そのものは変えないのでステージ個性は保たれる
    const mul = DANGER.eliteTypes.includes(id) ? eliteMul : 1;
    total += (wave.mix[id] ?? 0) * mul;
    cumWeights.push(total);
  }
  return { untilSec: wave.untilSec, perSec: wave.perSec, ids, cumWeights, totalWeight: total };
}
