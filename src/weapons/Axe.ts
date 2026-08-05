import weaponsData from '../data/weapons.json';
import type { AxeLevel } from '../types';
import { WeaponBase, WeaponContext, WeaponTextures } from './WeaponBase';

const LEVELS: AxeLevel[] = weaponsData.axe.levels;

/**
 * 投斧: 斜め上に投げ、重力で放物線を描いて落ちる高ダメージ弾（§8 Phase 8）。
 * 重力は Projectile.ay（PlayScene の弾移動が毎フレーム加算する）。
 */
export class Axe extends WeaponBase {
  readonly id = 'axe';
  private cooldown = 0;

  constructor(private readonly textures: WeaponTextures) {
    super();
  }

  update(dtSec: number, ctx: WeaponContext): void {
    this.cooldown -= dtSec;
    if (this.cooldown > 0) return;

    const def = LEVELS[this.level - 1];
    this.cooldown = def.cooldownSec * ctx.cooldownMul;

    // 向いている側へ投げる。複数本は横速度を散らして落下点をばらけさせる
    const side = ctx.player.facingX < 0 ? -1 : 1;
    for (let k = 0; k < def.count; k++) {
      const p = ctx.spawnProjectile();
      if (p === null) return;
      const spread = 1 + (k - (def.count - 1) / 2) * 0.45;
      p.reset(
        this.textures.axe,
        ctx.player.x,
        ctx.player.y,
        side * def.sideSpeed * spread,
        -def.upSpeed,
      );
      p.ay = def.gravity;
      p.radius = def.radius;
      p.damage = def.damage * ctx.damageMul;
      p.pierceLeft = def.pierce;
      p.lifeSec = def.lifeSec;
    }
  }
}
