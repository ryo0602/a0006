import levelingData from '../data/leveling.json';
import pickupsData from '../data/pickups.json';
import type { ObjectPool } from '../core/ObjectPool';
import type { Random } from '../core/Random';
import type { Gem } from '../entities/Gem';
import { Pickup, PickupKind } from '../entities/Pickup';
import { Player, PLAYER_STATS } from '../entities/Player';
import type { LevelSystem } from './LevelSystem';

const GEM_EXP: Record<string, number> = levelingData.gemExp;

/** ドロップ種別ごとの見た目スケール（テクスチャは共通で大きさだけ変える） */
const GEM_SCALE: Record<string, number> = {
  gem_small: 1,
  gem_medium: 1.4,
  gem_large: 1.9,
};

/** 3種のピックアップを等確率で選ぶ（§13 に配分の指定はない） */
const PICKUP_KINDS: PickupKind[] = ['heal', 'magnet', 'bomb'];

/**
 * ジェムの生成・吸引・取得（§13）と、回復・マグネット・爆弾ドロップの管理。
 * ジェムは取得範囲に入ると加速しながら吸い寄せられる。
 * ジェム上限（§15: 400）超過時は最も古いジェムを自動回収（EXPは加算）してから生成する。
 * ピックアップは吸引されず、プレイヤーの直接接触で取得する。
 */
export class PickupSystem {
  /** マグネットパッシブの補正。取得時に PlayScene が更新する */
  pickupRangeMul = 1;

  private seqCounter = 0;

  constructor(
    private readonly pool: ObjectPool<Gem>,
    private readonly gems: Gem[],
    private readonly pickupPool: ObjectPool<Pickup>,
    private readonly pickups: Pickup[],
    private readonly player: Player,
    private readonly levelSystem: LevelSystem,
    private readonly random: Random,
    /** 取得時の効果適用は PlayScene に委譲する（敵・カメラ・ジェム全体に触るため） */
    private readonly applyPickup: (kind: PickupKind) => void,
  ) {}

  spawnGem(drop: string, x: number, y: number): void {
    let gem = this.pool.acquire();
    if (gem === null) {
      // 上限到達: 最も古い（seq 最小の）ジェムを自動回収してから使い回す
      let oldestIdx = -1;
      let oldestSeq = Number.POSITIVE_INFINITY;
      for (let i = 0; i < this.gems.length; i++) {
        if (this.gems[i].seq < oldestSeq) {
          oldestSeq = this.gems[i].seq;
          oldestIdx = i;
        }
      }
      if (oldestIdx < 0) return;
      const oldest = this.gems[oldestIdx];
      this.levelSystem.addExp(oldest.exp);
      oldest.deactivate();
      this.gems[oldestIdx] = this.gems[this.gems.length - 1];
      this.gems.pop();
      this.pool.release(oldest);
      gem = this.pool.acquire();
      if (gem === null) return;
    }
    gem.reset(x, y, GEM_EXP[drop] ?? 1, GEM_SCALE[drop] ?? 1, this.seqCounter++);
    this.gems.push(gem);
  }

  /** 敵死亡時に低確率で呼ばれる（§13）。上限到達時はドロップを見送る */
  maybeDropPickup(x: number, y: number): void {
    if (this.random.next() >= pickupsData.dropChance) return;
    const p = this.pickupPool.acquire();
    if (p === null) return;
    const kind = PICKUP_KINDS[Math.floor(this.random.next() * PICKUP_KINDS.length)];
    p.reset(x, y, kind);
    this.pickups.push(p);
  }

  update(dtSec: number): void {
    this.updateGems(dtSec);
    this.updatePickups();
  }

  private updateGems(dtSec: number): void {
    const range = PLAYER_STATS.pickupRadius * this.pickupRangeMul;
    const rangeSq = range * range;
    const collectSq = levelingData.gemCollectRadius * levelingData.gemCollectRadius;

    for (let i = this.gems.length - 1; i >= 0; i--) {
      const g = this.gems[i];
      const dx = this.player.x - g.x;
      const dy = this.player.y - g.y;
      const distSq = dx * dx + dy * dy;

      if (!g.magnetized) {
        if (distSq < rangeSq) {
          g.magnetized = true;
          g.speed = levelingData.gemBaseSpeed;
        }
        continue;
      }

      // §13: 加速しながら吸い寄せる
      g.speed += levelingData.gemAttractAccel * dtSec;
      const dist = Math.sqrt(distSq);
      if (dist > 1e-6) {
        const step = Math.min(g.speed * dtSec, dist);
        g.x += (dx / dist) * step;
        g.y += (dy / dist) * step;
      }

      if (distSq < collectSq) {
        this.levelSystem.addExp(g.exp);
        g.deactivate();
        this.gems[i] = this.gems[this.gems.length - 1];
        this.gems.pop();
        this.pool.release(g);
      }
    }
  }

  private updatePickups(): void {
    const r = PLAYER_STATS.hitRadius + pickupsData.collectRadius;
    const collectSq = r * r;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      const dx = this.player.x - p.x;
      const dy = this.player.y - p.y;
      if (dx * dx + dy * dy >= collectSq) continue;
      this.applyPickup(p.kind);
      p.deactivate();
      this.pickups[i] = this.pickups[this.pickups.length - 1];
      this.pickups.pop();
      this.pickupPool.release(p);
    }
  }

  reset(): void {
    this.pickupRangeMul = 1;
    this.seqCounter = 0;
  }
}
