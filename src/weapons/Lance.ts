import evolutionsData from '../data/evolutions.json';
import { WeaponBase, WeaponContext, WeaponTextures } from './WeaponBase';

const STATS = evolutionsData.lance.stats;

/** 実質無制限の貫通数（§10: ランスは貫通無制限） */
const PIERCE_UNLIMITED = 1_000_000;

/** 複数弾のばらけ角（ラジアン） */
const SPREAD_RAD = 0.1;

/**
 * ランス: スピアの進化（§10 Phase 8）。向いている方向へ、飛びながら加速する
 * 貫通無制限の刺突を放つ。加速は Projectile.accel（進行方向に沿った加速度）。
 */
export class Lance extends WeaponBase {
  readonly id = 'lance';
  override readonly evolved = true;
  private cooldown = 0;

  constructor(private readonly textures: WeaponTextures) {
    super();
  }

  update(dtSec: number, ctx: WeaponContext): void {
    this.cooldown -= dtSec;
    if (this.cooldown > 0) return;
    this.cooldown = STATS.cooldownSec * ctx.cooldownMul;

    const baseAngle = Math.atan2(ctx.player.facingY, ctx.player.facingX);
    for (let k = 0; k < STATS.count; k++) {
      const p = ctx.spawnProjectile();
      if (p === null) return;
      const angle = baseAngle + (k - (STATS.count - 1) / 2) * SPREAD_RAD;
      p.reset(
        this.textures.spear,
        ctx.player.x,
        ctx.player.y,
        Math.cos(angle) * STATS.speed,
        Math.sin(angle) * STATS.speed,
      );
      p.sprite.rotation = angle;
      p.sprite.scale.set(1.4);
      p.accel = STATS.accelPerSec;
      p.radius = STATS.radius;
      p.damage = STATS.damage * ctx.damageMul;
      p.pierceLeft = PIERCE_UNLIMITED;
      p.lifeSec = STATS.lifeSec;
    }
  }
}
