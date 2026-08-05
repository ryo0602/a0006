import enemiesData from '../data/enemies.json';
import type { Camera } from '../core/Camera';
import type { ObjectPool } from '../core/ObjectPool';
import type { Random } from '../core/Random';
import { ENEMY_LIMIT_PC } from '../core/device';
import type { Enemy } from '../entities/Enemy';
import type { DifficultyGrowth, EnemyStats, StageDef, WaveDef } from '../types';

const ENEMY_STATS: Record<string, EnemyStats> = enemiesData;

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

  /** ステージ選択（§12）。ウェーブテーブルを差し替えて初期化する */
  setStage(stage: StageDef): void {
    this.stage = stage;
    this.waves = stage.waves.map(prepareWave);
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
    const perSec = this.bossSpawned ? this.stage.afterBossPerSec : wave.perSec;
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

    // §12 の難易度倍率（経過時間）× ステージ倍率。ボス出現後は成長を凍結する
    const minutes = Math.min(this.elapsedSec, this.stage.bossAtSec) / 60;
    const hpMul = (1 + minutes * this.growth.hpPerMin) * this.stage.difficultyMul;
    const damageMul = (1 + minutes * this.growth.damagePerMin) * this.stage.difficultyMul;

    this.spawnAt(enemy, id, hpMul, damageMul);
  }

  /** ボス（§11 / §12）。時間経過の難易度倍率は掛けず、ステージ倍率のみ適用する */
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
    this.spawnAt(enemy, 'boss', this.stage.difficultyMul, this.stage.difficultyMul);
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

function prepareWave(wave: WaveDef): PreparedWave {
  const ids = Object.keys(wave.mix);
  const cumWeights: number[] = [];
  let total = 0;
  for (const id of ids) {
    total += wave.mix[id] ?? 0;
    cumWeights.push(total);
  }
  return { untilSec: wave.untilSec, perSec: wave.perSec, ids, cumWeights, totalWeight: total };
}
