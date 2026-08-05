import type { Enemy } from '../entities/Enemy';

/** セルサイズ 64px（§15）。最大半径の boss(48) + プレイヤー(12) でも
 *  周辺9セルのクエリで取りこぼさないサイズ */
export const CELL_SIZE = 64;

/**
 * バケット数は固定長。無限ワールドではセルキーが移動履歴分だけ増え続けるため、
 * Map ではなく固定配列 + マスクで上限を切る。遠方セルとのハッシュ衝突は
 * 後段の距離判定（またはセル座標の一致チェック）で弾かれるので許容する。
 */
const BUCKET_COUNT = 4096;

function bucketIndex(cellX: number, cellY: number): number {
  // §15 のハッシュ関数。XOR で int32 に落ちた後、マスクで非負のインデックスになる
  return ((cellX * 73856093) ^ (cellY * 19349663)) & (BUCKET_COUNT - 1);
}

/**
 * 空間分割グリッド（§15）。毎フレーム clear → insert で再構築するが、
 * バケット配列は使い回し、前フレームで使ったバケットだけを length = 0 で
 * 空にするため、定常状態では new が一切発生しない。
 */
export class SpatialHash {
  private readonly buckets: Enemy[][] = [];
  /** このフレームで使用したバケットのインデックス（使い回し） */
  private readonly touched: number[] = [];
  /** クエリ中の重複バケット除去用（最大9要素、使い回し） */
  private readonly seen: number[] = [];

  constructor() {
    for (let i = 0; i < BUCKET_COUNT; i++) {
      this.buckets.push([]);
    }
  }

  clear(): void {
    for (let i = 0; i < this.touched.length; i++) {
      this.buckets[this.touched[i]].length = 0;
    }
    this.touched.length = 0;
  }

  insert(enemy: Enemy): void {
    const cx = Math.floor(enemy.x / CELL_SIZE);
    const cy = Math.floor(enemy.y / CELL_SIZE);
    // 押し出し判定でハッシュ衝突（遠方セルの同居）を弾くため実セル座標を持たせる
    enemy.cellX = cx;
    enemy.cellY = cy;
    const idx = bucketIndex(cx, cy);
    const bucket = this.buckets[idx];
    if (bucket.length === 0) {
      this.touched.push(idx);
    }
    bucket.push(enemy);
  }

  /**
   * (x, y) の周辺9セルにいる敵を out に集める。out は呼び出し側が使い回す。
   * 異なるセルが同一バケットに衝突すると同じ敵を二重に返し得るため、
   * 訪問済みバケットを除外する。遠方セルの混入は呼び出し側の距離判定で弾く。
   */
  queryNeighbors(x: number, y: number, out: Enemy[]): void {
    out.length = 0;
    this.seen.length = 0;
    const cx = Math.floor(x / CELL_SIZE);
    const cy = Math.floor(y / CELL_SIZE);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const idx = bucketIndex(cx + dx, cy + dy);
        if (this.seen.includes(idx)) continue;
        this.seen.push(idx);
        const bucket = this.buckets[idx];
        for (let i = 0; i < bucket.length; i++) {
          out.push(bucket[i]);
        }
      }
    }
  }

  /** 押し出し用: このフレームで使用中のバケットを順に渡す */
  eachTouchedBucket(callback: (bucket: Enemy[]) => void): void {
    for (let i = 0; i < this.touched.length; i++) {
      callback(this.buckets[this.touched[i]]);
    }
  }

  /**
   * (x, y) から最も近い敵を探す（§8 ショット等の索敵）。
   * 中心セルからリング状に外側へ広げ、「次のリングの最短可能距離が現在の最良より
   * 遠い」時点で打ち切るため、敵が近くにいる通常ケースでは全敵走査にならない。
   * プール返却済みの個体（active = false）は返さない。
   */
  nearestEnemy(x: number, y: number, maxRadius: number): Enemy | null {
    const cx = Math.floor(x / CELL_SIZE);
    const cy = Math.floor(y / CELL_SIZE);
    const maxRing = Math.ceil(maxRadius / CELL_SIZE) + 1;
    let best: Enemy | null = null;
    let bestSq = maxRadius * maxRadius;

    for (let ring = 0; ring <= maxRing; ring++) {
      // このリングに入る敵の最短可能距離。既に見つけた最良より遠ければ確定
      const ringMin = (ring - 1) * CELL_SIZE;
      if (best !== null && ringMin > 0 && ringMin * ringMin > bestSq) break;

      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          // リングの外周セルのみ（内側は前のリングで走査済み）
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const bucket = this.buckets[bucketIndex(cx + dx, cy + dy)];
          for (let i = 0; i < bucket.length; i++) {
            const e = bucket[i];
            if (!e.active) continue;
            const ex = e.x - x;
            const ey = e.y - y;
            const distSq = ex * ex + ey * ey;
            // ハッシュ衝突で混入した遠方セルの敵もこの距離比較で自然に落ちる
            if (distSq < bestSq) {
              bestSq = distSq;
              best = e;
            }
          }
        }
      }
    }
    return best;
  }

  /**
   * 円 (x, y, r) をカバーするセル範囲の敵を out に集める（火炎・落雷の範囲判定）。
   * ハッシュ衝突による遠方の敵・重複バケットは呼び出し側の距離判定と
   * ここでの訪問済み除外で処理する。out は呼び出し側が使い回す。
   */
  queryCircle(x: number, y: number, r: number, out: Enemy[]): void {
    out.length = 0;
    this.seen.length = 0;
    const minCx = Math.floor((x - r) / CELL_SIZE);
    const maxCx = Math.floor((x + r) / CELL_SIZE);
    const minCy = Math.floor((y - r) / CELL_SIZE);
    const maxCy = Math.floor((y + r) / CELL_SIZE);
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const idx = bucketIndex(cx, cy);
        if (this.seen.includes(idx)) continue;
        this.seen.push(idx);
        const bucket = this.buckets[idx];
        for (let i = 0; i < bucket.length; i++) {
          if (bucket[i].active) out.push(bucket[i]);
        }
      }
    }
  }
}
