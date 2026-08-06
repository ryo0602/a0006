import evolutionsData from '../data/evolutions.json';
import type { Enemy } from '../entities/Enemy';
import type { Projectile } from '../entities/Projectile';
import type { SatelliteStats } from '../types';
import { WeaponBase, WeaponContext, WeaponTextures } from './WeaponBase';

const STATS: SatelliteStats = evolutionsData.satellite.stats;

/**
 * サテライト: オーブの進化（§10）。個数6・二重回転。
 * 内輪3個と外輪3個が逆方向に回る。ヒット間隔はオーブ番号ごと
 * （Enemy.orbLastHitAt は MAX_ORBS = 6 で確保済み）。
 */
export class Satellite extends WeaponBase {
  readonly id = 'satellite';
  override readonly evolved = true;

  private angle = 0;
  private readonly orbs: Projectile[] = [];
  private readonly queryBuf: Enemy[] = [];

  constructor(private readonly textures: WeaponTextures) {
    super();
  }

  override dispose(): void {
    for (let i = 0; i < this.orbs.length; i++) {
      this.orbs[i].deactivate();
    }
    this.orbs.length = 0;
  }

  update(dtSec: number, ctx: WeaponContext): void {
    while (this.orbs.length < STATS.count) {
      const p = ctx.spawnProjectile();
      if (p === null) break;
      p.reset(this.textures.orb, ctx.player.x, ctx.player.y, 0, 0);
      p.persistent = true;
      p.noCollide = true;
      p.radius = STATS.radius;
      p.pierceLeft = 1;
      p.lifeSec = Number.POSITIVE_INFINITY;
      p.sprite.scale.set(STATS.radius / 10); // オーブのテクスチャ基準半径 10px
      this.orbs.push(p);
    }

    this.angle += STATS.rotSpeedRad * dtSec;

    for (let i = 0; i < this.orbs.length; i++) {
      const orb = this.orbs[i];
      // 前半3個は内輪を正回転、後半3個は外輪を逆回転（二重回転）
      const inner = i < 3;
      const ringIndex = inner ? i : i - 3;
      const a = inner
        ? this.angle + (ringIndex * Math.PI * 2) / 3
        : -this.angle + (ringIndex * Math.PI * 2) / 3;
      // 軌道半径はエリアパッシブ（§9）で拡大
      const radius = (inner ? STATS.orbitRadiusInner : STATS.orbitRadiusOuter) * ctx.areaMul;
      orb.x = ctx.player.x + Math.cos(a) * radius;
      orb.y = ctx.player.y + Math.sin(a) * radius;

      ctx.hash.queryNeighbors(orb.x, orb.y, this.queryBuf);
      for (let j = 0; j < this.queryBuf.length; j++) {
        const e = this.queryBuf[j];
        if (!e.active) continue;
        const dx = e.x - orb.x;
        const dy = e.y - orb.y;
        const r = STATS.radius + e.radius;
        if (dx * dx + dy * dy >= r * r) continue;
        if (ctx.elapsedSec - e.orbLastHitAt[i] < STATS.hitIntervalSec) continue;
        e.orbLastHitAt[i] = ctx.elapsedSec;
        ctx.applyDamage(e, STATS.damage * ctx.damageMul * ctx.rageMul);
      }
    }
  }
}
