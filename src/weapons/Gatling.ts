import evolutionsData from '../data/evolutions.json';
import type { GatlingStats } from '../types';
import { WeaponBase, WeaponContext, WeaponTextures } from './WeaponBase';

const STATS: GatlingStats = evolutionsData.gatling.stats;

/** ガトリング: ショットの進化（§10）。連射化。挙動はショットと同じで数値のみ異なる */
export class Gatling extends WeaponBase {
  readonly id = 'gatling';
  override readonly evolved = true;
  private cooldown = 0;

  constructor(private readonly textures: WeaponTextures) {
    super();
  }

  update(dtSec: number, ctx: WeaponContext): void {
    this.cooldown -= dtSec;
    if (this.cooldown > 0) return;

    const target = ctx.hash.nearestEnemy(ctx.player.x, ctx.player.y, ctx.searchRadius);
    if (target === null) return;
    this.cooldown = STATS.cooldownSec * ctx.cooldownMul;

    const angle = Math.atan2(target.y - ctx.player.y, target.x - ctx.player.x);
    const p = ctx.spawnProjectile();
    if (p === null) return;
    p.reset(
      this.textures.shot,
      ctx.player.x,
      ctx.player.y,
      Math.cos(angle) * STATS.speed,
      Math.sin(angle) * STATS.speed,
    );
    p.radius = STATS.radius;
    p.damage = STATS.damage * ctx.damageMul;
    p.pierceLeft = 1;
    p.lifeSec = STATS.lifeSec;
  }
}
