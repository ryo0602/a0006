import evolutionsData from '../data/evolutions.json';
import type { Enemy } from '../entities/Enemy';
import type { StormStats } from '../types';
import { WeaponBase, WeaponContext, WeaponTextures } from './WeaponBase';

const STATS: StormStats = evolutionsData.storm.stats;

const BOLT_LIFE_SEC = 0.15;

/**
 * ストーム: 落雷の進化（§10）。画面全体に連続落雷。
 * 対象選択・範囲ダメージのロジックは落雷と同じで、レートと威力のみ強化。
 */
export class Storm extends WeaponBase {
  readonly id = 'storm';
  override readonly evolved = true;

  private cooldown = 0;
  private readonly blastBuf: Enemy[] = [];

  constructor(private readonly textures: WeaponTextures) {
    super();
  }

  update(dtSec: number, ctx: WeaponContext): void {
    this.cooldown -= dtSec;
    if (this.cooldown > 0) return;
    this.cooldown = STATS.cooldownSec * ctx.cooldownMul;

    for (let s = 0; s < STATS.strikes; s++) {
      const target = pickVisibleEnemy(ctx);
      if (target === null) return;

      ctx.hash.queryCircle(target.x, target.y, STATS.blastRadius, this.blastBuf);
      for (let i = 0; i < this.blastBuf.length; i++) {
        const e = this.blastBuf[i];
        const dx = e.x - target.x;
        const dy = e.y - target.y;
        const r = STATS.blastRadius + e.radius;
        if (dx * dx + dy * dy < r * r) {
          ctx.applyDamage(e, STATS.damage * ctx.damageMul);
        }
      }

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
}

/** 画面内の敵から一様ランダムに1体（リザーバサンプリング）。いなければ全体から */
function pickVisibleEnemy(ctx: WeaponContext): Enemy | null {
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
