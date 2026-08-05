import weaponsData from '../data/weapons.json';
import type { Enemy } from '../entities/Enemy';
import type { ThunderLevel } from '../types';
import { WeaponBase, WeaponContext, WeaponTextures } from './WeaponBase';

const LEVELS: ThunderLevel[] = weaponsData.thunder.levels;

/** 落雷の演出ボルトの表示時間（演出値） */
const BOLT_LIFE_SEC = 0.15;

/**
 * 落雷: ランダムな敵の位置に範囲攻撃（§8）。Lvで落雷数 1→4。
 * 対象は画面内の敵から選ぶ（見えない落雷を防ぐ）。画面内に敵がいなければ全体から選ぶ。
 * ダメージは発射時に即時適用し、弾は演出のみ（noCollide）。
 */
export class Thunder extends WeaponBase {
  readonly id = 'thunder';
  private cooldown = 0;
  private readonly blastBuf: Enemy[] = [];

  constructor(private readonly textures: WeaponTextures) {
    super();
  }

  update(dtSec: number, ctx: WeaponContext): void {
    this.cooldown -= dtSec;
    if (this.cooldown > 0) return;

    const def = LEVELS[this.level - 1];
    this.cooldown = def.cooldownSec * ctx.cooldownMul;

    for (let s = 0; s < def.strikes; s++) {
      const target = this.pickTarget(ctx);
      if (target === null) return;

      // 着弾点の範囲ダメージ
      ctx.hash.queryCircle(target.x, target.y, def.blastRadius, this.blastBuf);
      for (let i = 0; i < this.blastBuf.length; i++) {
        const e = this.blastBuf[i];
        const dx = e.x - target.x;
        const dy = e.y - target.y;
        const r = def.blastRadius + e.radius;
        if (dx * dx + dy * dy < r * r) {
          ctx.applyDamage(e, def.damage * ctx.damageMul);
        }
      }

      // 演出ボルト（当たり判定なし）
      const bolt = ctx.spawnProjectile();
      if (bolt !== null) {
        bolt.reset(this.textures.bolt, target.x, target.y - 50, 0, 0);
        bolt.noCollide = true;
        bolt.radius = 0;
        bolt.damage = 0;
        bolt.pierceLeft = 1;
        bolt.lifeSec = BOLT_LIFE_SEC;
      }
    }
  }

  /**
   * 画面内の敵から一様ランダムに1体選ぶ（リザーバサンプリング。配列を作らない）。
   * 画面内に1体もいなければ全敵から選ぶ。
   */
  private pickTarget(ctx: WeaponContext): Enemy | null {
    const halfW = ctx.camera.viewHalfWidth;
    const halfH = ctx.camera.viewHalfHeight;
    let chosen: Enemy | null = null;
    let seen = 0;
    for (let i = 0; i < ctx.enemies.length; i++) {
      const e = ctx.enemies[i];
      if (!e.active) continue;
      if (Math.abs(e.x - ctx.camera.x) > halfW || Math.abs(e.y - ctx.camera.y) > halfH) continue;
      seen++;
      if (ctx.random.next() < 1 / seen) chosen = e;
    }
    if (chosen !== null) return chosen;

    seen = 0;
    for (let i = 0; i < ctx.enemies.length; i++) {
      const e = ctx.enemies[i];
      if (!e.active) continue;
      seen++;
      if (ctx.random.next() < 1 / seen) chosen = e;
    }
    return chosen;
  }
}
