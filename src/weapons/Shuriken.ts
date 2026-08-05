import weaponsData from '../data/weapons.json';
import type { ShurikenLevel } from '../types';
import { WeaponBase, WeaponContext, WeaponTextures } from './WeaponBase';

const LEVELS: ShurikenLevel[] = weaponsData.shuriken.levels;

const SPREAD_RAD = 0.18;

/** 手裏剣: 最も近い敵の方向へ直線に飛び、敵を貫通する（§8）。Lvで貫通数 2→5 */
export class Shuriken extends WeaponBase {
  readonly id = 'shuriken';
  private cooldown = 0;

  constructor(private readonly textures: WeaponTextures) {
    super();
  }

  update(dtSec: number, ctx: WeaponContext): void {
    this.cooldown -= dtSec;
    if (this.cooldown > 0) return;

    const def = LEVELS[this.level - 1];
    const target = ctx.hash.nearestEnemy(ctx.player.x, ctx.player.y, ctx.searchRadius);
    if (target === null) return;
    this.cooldown = def.cooldownSec * ctx.cooldownMul;

    const baseAngle = Math.atan2(target.y - ctx.player.y, target.x - ctx.player.x);
    for (let k = 0; k < def.count; k++) {
      const p = ctx.spawnProjectile();
      if (p === null) return;
      const angle = baseAngle + (k - (def.count - 1) / 2) * SPREAD_RAD;
      p.reset(
        this.textures.shuriken,
        ctx.player.x,
        ctx.player.y,
        Math.cos(angle) * def.speed,
        Math.sin(angle) * def.speed,
      );
      p.radius = def.radius;
      p.damage = def.damage * ctx.damageMul;
      p.pierceLeft = def.pierce;
      p.lifeSec = def.lifeSec;
    }
  }
}
