import { Sprite } from 'pixi.js';
import evolutionsData from '../data/evolutions.json';
import type { Enemy } from '../entities/Enemy';
import type { InfernoStats } from '../types';
import { WeaponBase, WeaponContext, WeaponTextures } from './WeaponBase';

const STATS: InfernoStats = evolutionsData.inferno.stats;

/**
 * インフェルノ: 火炎の進化（§10）。全方位の持続ダメージ + 与ダメージの5%をHP吸収。
 * 扇形判定が円判定になるだけで、tick 方式は火炎と同じ。
 */
export class Inferno extends WeaponBase {
  readonly id = 'inferno';
  override readonly evolved = true;
  override readonly sprite: Sprite;

  private tickTimer = 0;
  private readonly queryBuf: Enemy[] = [];

  constructor(textures: WeaponTextures) {
    super();
    this.sprite = new Sprite(textures.infernoCircle);
    this.sprite.anchor.set(0.5);
  }

  update(dtSec: number, ctx: WeaponContext): void {
    this.sprite.position.set(ctx.player.x, ctx.player.y);
    // 射程はエリアパッシブ（§9）で拡大。テクスチャは再生成せずスケールで追従（§18-6）
    this.sprite.scale.set(ctx.areaMul);

    this.tickTimer -= dtSec;
    if (this.tickTimer > 0) return;
    this.tickTimer = STATS.tickSec;

    let dealt = 0;
    const range = STATS.range * ctx.areaMul;
    ctx.hash.queryCircle(ctx.player.x, ctx.player.y, range, this.queryBuf);
    for (let i = 0; i < this.queryBuf.length; i++) {
      const e = this.queryBuf[i];
      const dx = e.x - ctx.player.x;
      const dy = e.y - ctx.player.y;
      const reach = range + e.radius;
      if (dx * dx + dy * dy > reach * reach) continue;
      const damage = STATS.damagePerTick * ctx.damageMul;
      ctx.applyDamage(e, damage);
      dealt += damage;
    }

    // §10: 与ダメージの5%をHP吸収
    if (dealt > 0) {
      const player = ctx.player;
      player.hp = Math.min(player.maxHp, player.hp + dealt * STATS.lifestealRatio);
    }
  }
}
