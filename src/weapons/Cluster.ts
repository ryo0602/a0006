import evolutionsData from '../data/evolutions.json';
import type { MineLevel } from '../types';
import { Mine } from './Mine';
import { applyBlast, spawnExplosionFlash, WeaponContext, WeaponTextures } from './WeaponBase';

const STATS = evolutionsData.cluster.stats;

/** 遅延中の子爆発の最大数（同時起爆 count 4 × childCount 3） */
const MAX_PENDING = 16;

/**
 * クラスターマイン: 地雷の進化（§10 Phase 8）。起爆時に子爆発3つを周囲へ散布する。
 * 子爆発は「座標と発火時刻」の記録だけで表現し、エンティティを増やさない。
 */
export class Cluster extends Mine {
  override readonly id = 'cluster';
  override readonly evolved = true;

  private readonly childX = new Float64Array(MAX_PENDING);
  private readonly childY = new Float64Array(MAX_PENDING);
  private readonly childAt = new Float64Array(MAX_PENDING);
  private childCount = 0;

  constructor(textures: WeaponTextures) {
    super(textures);
  }

  protected override def(): MineLevel {
    return STATS;
  }

  protected override onDetonate(ctx: WeaponContext, x: number, y: number): void {
    for (let i = 0; i < STATS.childCount && this.childCount < MAX_PENDING; i++) {
      const angle = ctx.random.range(0, Math.PI * 2);
      const dist = ctx.random.range(STATS.childScatter * 0.4, STATS.childScatter);
      this.childX[this.childCount] = x + Math.cos(angle) * dist;
      this.childY[this.childCount] = y + Math.sin(angle) * dist;
      this.childAt[this.childCount] = ctx.elapsedSec + STATS.childDelaySec;
      this.childCount++;
    }
  }

  override update(dtSec: number, ctx: WeaponContext): void {
    super.update(dtSec, ctx);

    // 発火時刻に達した子爆発を処理する（逆順の swap-remove）
    for (let i = this.childCount - 1; i >= 0; i--) {
      if (ctx.elapsedSec < this.childAt[i]) continue;
      const blast = STATS.childBlastRadius * ctx.areaMul;
      applyBlast(ctx, this.queryBuf, this.childX[i], this.childY[i], blast, STATS.childDamage * ctx.damageMul);
      spawnExplosionFlash(ctx, this.textures.explosion, this.childX[i], this.childY[i], blast);
      this.childCount--;
      this.childX[i] = this.childX[this.childCount];
      this.childY[i] = this.childY[this.childCount];
      this.childAt[i] = this.childAt[this.childCount];
    }
  }

  override dispose(): void {
    super.dispose();
    this.childCount = 0;
  }
}
