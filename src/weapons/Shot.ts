import weaponsData from '../data/weapons.json';
import type { ShotLevel } from '../types';
import { WeaponBase, WeaponContext, WeaponTextures } from './WeaponBase';

const LEVELS: ShotLevel[] = weaponsData.shot.levels;

/** 複数弾のばらけ角（ラジアン）。演出値なので JSON には置かない */
const SPREAD_RAD = 0.14;

/** ショット: 最も近い敵へ弾を発射（§8）。Lvで弾数 1→3 */
export class Shot extends WeaponBase {
  readonly id = 'shot';
  private cooldown = 0;

  constructor(private readonly textures: WeaponTextures) {
    super();
  }

  update(dtSec: number, ctx: WeaponContext): void {
    this.cooldown -= dtSec;
    if (this.cooldown > 0) return;

    const def = LEVELS[this.level - 1];
    const target = ctx.hash.nearestEnemy(ctx.player.x, ctx.player.y, ctx.searchRadius);
    // 索敵圏内に敵がいない間は CD を消費せず、見つけ次第すぐ撃てるようにする
    if (target === null) return;
    this.cooldown = def.cooldownSec * ctx.cooldownMul;

    const baseAngle = Math.atan2(target.y - ctx.player.y, target.x - ctx.player.x);
    for (let k = 0; k < def.count; k++) {
      const p = ctx.spawnProjectile();
      if (p === null) return;
      const angle = baseAngle + (k - (def.count - 1) / 2) * SPREAD_RAD;
      p.reset(
        this.textures.shot,
        ctx.player.x,
        ctx.player.y,
        Math.cos(angle) * def.speed,
        Math.sin(angle) * def.speed,
      );
      p.radius = def.radius;
      p.damage = def.damage * ctx.damageMul;
      p.pierceLeft = 1;
      p.lifeSec = def.lifeSec;
    }
  }
}
