import type { ObjectPool } from '../core/ObjectPool';
import type { Enemy } from '../entities/Enemy';
import { Player, PLAYER_STATS } from '../entities/Player';
import type { PickupSystem } from './PickupSystem';

/**
 * ダメージ適用・死亡処理（§4.2 の 10）。
 * 敵への与ダメージ自体は takeDamage で即時反映済みなので、
 * ここでは死亡した敵の回収（ドロップ生成 → プール返却）をまとめて行う。
 */
export class DamageSystem {
  /** このプレイでのキル数（リザルト表示用。§13 のコイン計算は Phase 5） */
  kills = 0;

  constructor(
    private readonly onPlayerDeath: () => void,
    private readonly onBossDeath: () => void,
  ) {}

  reset(): void {
    this.kills = 0;
  }

  update(dtSec: number, player: Player, contactDamage: number): void {
    if (player.invincibleTimer > 0) {
      player.invincibleTimer = Math.max(0, player.invincibleTimer - dtSec);
    }
    if (player.flashTimer > 0) {
      player.flashTimer = Math.max(0, player.flashTimer - dtSec);
    }

    // 無敵中はダメージのみ無効（判定自体は §4.2 どおり毎フレーム行われている）。
    // 複数の敵に同時接触しても無敵 0.5s あたり1回分しか食らわない
    if (contactDamage <= 0 || player.invincibleTimer > 0) return;

    player.hp -= contactDamage;
    player.invincibleTimer = PLAYER_STATS.invincibleSec;
    player.flashTimer = PLAYER_STATS.flashSec;

    if (player.hp <= 0) {
      player.hp = 0;
      this.onPlayerDeath();
    }
  }

  /** HP が尽きた敵をドロップ生成込みで回収する。逆順走査で swap-remove と両立させる */
  sweepDeaths(
    enemies: Enemy[],
    pool: ObjectPool<Enemy>,
    pickups: PickupSystem,
    onDeath: (e: Enemy) => void,
  ): void {
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (e.hp > 0) continue;
      onDeath(e);
      for (let d = 0; d < e.dropCount; d++) {
        // 複数ドロップ（ボス）は重ならないよう少しずらす
        pickups.spawnGem(e.drop, e.x + (d % 3) * 14 - 14, e.y + Math.floor(d / 3) * 14);
      }
      // 低確率で回復・マグネット・爆弾を落とす（§13）。ボスは対象外
      if (!e.isBoss) {
        pickups.maybeDropPickup(e.x, e.y);
      }
      this.kills++;
      const wasBoss = e.isBoss;
      e.deactivate();
      enemies[i] = enemies[enemies.length - 1];
      enemies.pop();
      pool.release(e);
      if (wasBoss) {
        // ボス撃破 = ステージクリア（§12）。通知は回収後に行う
        this.onBossDeath();
      }
    }
  }
}
