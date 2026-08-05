import weaponsData from '../data/weapons.json';
import type { SpearLevel } from '../types';
import { WeaponBase, WeaponContext, WeaponTextures } from './WeaponBase';

const LEVELS: SpearLevel[] = weaponsData.spear.levels;

/** 複数弾のばらけ角（ラジアン）。演出値なので JSON には置かない */
const SPREAD_RAD = 0.12;

/**
 * スピア: プレイヤーの向いている方向へ高貫通の刺突弾（§8 Phase 8）。
 * 索敵をしない（= 狙いはプレイヤーの移動操作そのもの）点が手裏剣との違い。
 */
export class Spear extends WeaponBase {
  readonly id = 'spear';
  private cooldown = 0;

  constructor(private readonly textures: WeaponTextures) {
    super();
  }

  update(dtSec: number, ctx: WeaponContext): void {
    this.cooldown -= dtSec;
    if (this.cooldown > 0) return;

    const def = LEVELS[this.level - 1];
    this.cooldown = def.cooldownSec * ctx.cooldownMul;

    const baseAngle = Math.atan2(ctx.player.facingY, ctx.player.facingX);
    for (let k = 0; k < def.count; k++) {
      const p = ctx.spawnProjectile();
      if (p === null) return;
      const angle = baseAngle + (k - (def.count - 1) / 2) * SPREAD_RAD;
      p.reset(
        this.textures.spear,
        ctx.player.x,
        ctx.player.y,
        Math.cos(angle) * def.speed,
        Math.sin(angle) * def.speed,
      );
      p.sprite.rotation = angle;
      p.radius = def.radius;
      p.damage = def.damage * ctx.damageMul;
      p.pierceLeft = def.pierce;
      p.lifeSec = def.lifeSec;
    }
  }
}
