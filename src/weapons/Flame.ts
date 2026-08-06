import { Sprite } from 'pixi.js';
import weaponsData from '../data/weapons.json';
import type { Enemy } from '../entities/Enemy';
import type { FlameLevel } from '../types';
import { WeaponBase, WeaponContext, WeaponTextures } from './WeaponBase';

const LEVELS: FlameLevel[] = weaponsData.flame.levels;

/**
 * 火炎: 前方扇形の持続ダメージ（§8）。前方 = プレイヤーの向き（停止中は最後の移動方向）。
 * 弾エンティティを使わず、tickSec ごとに扇形範囲へ直接ダメージを与える。
 * 描画はレベル別に事前生成した扇形テクスチャ1枚（毎フレームの Graphics 再構築をしない）。
 */
export class Flame extends WeaponBase {
  readonly id = 'flame';
  override readonly sprite: Sprite;

  private tickTimer = 0;
  private readonly queryBuf: Enemy[] = [];

  constructor(private readonly textures: WeaponTextures) {
    super();
    this.sprite = new Sprite(textures.flameSectors[0]);
    // 扇の頂点（プレイヤー位置）を原点に回転させる
    this.sprite.anchor.set(0, 0.5);
  }

  protected override onLevelChanged(): void {
    this.sprite.texture = this.textures.flameSectors[this.level - 1];
  }

  update(dtSec: number, ctx: WeaponContext): void {
    const def = LEVELS[this.level - 1];

    this.sprite.position.set(ctx.player.x, ctx.player.y);
    this.sprite.rotation = Math.atan2(ctx.player.facingY, ctx.player.facingX);
    // 射程はエリアパッシブ（§9）で拡大。テクスチャは再生成せずスケールで追従（§18-6）
    this.sprite.scale.set(ctx.areaMul);

    this.tickTimer -= dtSec;
    if (this.tickTimer > 0) return;
    this.tickTimer = def.tickSec;

    const fx = ctx.player.facingX;
    const fy = ctx.player.facingY;
    // atan2 を使わず、内積と cos(半角) の二乗比較で扇形内かを判定する
    const cosHalf = Math.cos(((def.arcDeg / 2) * Math.PI) / 180);
    const cosHalfSq = cosHalf * cosHalf;

    const range = def.range * ctx.areaMul;
    ctx.hash.queryCircle(ctx.player.x, ctx.player.y, range, this.queryBuf);
    for (let i = 0; i < this.queryBuf.length; i++) {
      const e = this.queryBuf[i];
      const dx = e.x - ctx.player.x;
      const dy = e.y - ctx.player.y;
      const distSq = dx * dx + dy * dy;
      const reach = range + e.radius;
      if (distSq > reach * reach) continue;
      const dot = dx * fx + dy * fy;
      if (dot <= 0) continue; // 背後
      if (dot * dot < cosHalfSq * distSq) continue; // 扇の外
      ctx.applyDamage(e, def.damagePerTick * ctx.damageMul);
    }
  }
}
