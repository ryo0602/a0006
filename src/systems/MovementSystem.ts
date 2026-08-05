import type { Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';

/** 距離維持のヒステリシス幅。境界での前進/後退の振動を防ぐ */
const KEEP_BAND = 20;

/** 発射を許可する距離の余裕。維持距離から大きく外れている間は撃たない */
const FIRE_RANGE_MARGIN = 120;

/**
 * 敵の移動とAI（§11）。基本は全種プレイヤーへの直線追尾。
 * spitter（keepDistance > 0）のみ距離を保ち、射程内で弾を撃つ。
 * 発射自体はコールバック経由で PlayScene に委譲する（弾プールを知らないため）。
 */
export class MovementSystem {
  update(
    dtSec: number,
    enemies: Enemy[],
    player: Player,
    fireProjectile: (enemy: Enemy) => void,
  ): void {
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const dx = player.x - e.x;
      const dy = player.y - e.y;
      const distSq = dx * dx + dy * dy;
      // ほぼ重なっている時は方向が定まらないので動かさない（押し出しに任せる）
      if (distSq < 1) continue;
      const dist = Math.sqrt(distSq);
      const nx = dx / dist;
      const ny = dy / dist;

      if (e.keepDistance > 0) {
        // 距離維持（§11: 250px を保つ）。近すぎたら後退、遠ければ接近、帯内は停止
        if (dist > e.keepDistance + KEEP_BAND) {
          e.x += nx * e.speed * dtSec;
          e.y += ny * e.speed * dtSec;
        } else if (dist < e.keepDistance - KEEP_BAND) {
          e.x -= nx * e.speed * dtSec;
          e.y -= ny * e.speed * dtSec;
        }

        // 発射（維持距離の周辺にいる時のみ）
        e.fireTimer -= dtSec;
        if (e.fireTimer <= 0 && dist < e.keepDistance + FIRE_RANGE_MARGIN) {
          e.fireTimer = e.fireCooldownSec;
          fireProjectile(e);
        }
      } else {
        e.x += nx * e.speed * dtSec;
        e.y += ny * e.speed * dtSec;
      }
    }
  }
}
