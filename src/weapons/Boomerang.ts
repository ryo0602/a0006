import evolutionsData from '../data/evolutions.json';
import type { Projectile } from '../entities/Projectile';
import type { BoomerangStats } from '../types';
import { WeaponBase, WeaponContext, WeaponTextures } from './WeaponBase';

const STATS: BoomerangStats = evolutionsData.boomerang.stats;

/** プレイヤーに戻ったとみなす距離 */
const RETURN_RADIUS = 28;

/** 飛行中のブーメランの状態。persistent 弾として武器側が移動を管理する */
interface Flight {
  proj: Projectile;
  /** 往路の残り秒数。0 以下で復路（プレイヤーへホーミング） */
  outTimer: number;
  returning: boolean;
}

/**
 * ブーメラン: 手裏剣の進化（§10）。貫通無制限で、往路の後プレイヤーへ戻ってくる。
 * 折り返し時にヒット記録をクリアし、往路・復路で同じ敵に各1回ヒットできる。
 */
export class Boomerang extends WeaponBase {
  readonly id = 'boomerang';
  override readonly evolved = true;

  private cooldown = 0;
  private readonly flights: Flight[] = [];

  constructor(private readonly textures: WeaponTextures) {
    super();
  }

  override dispose(): void {
    for (let i = 0; i < this.flights.length; i++) {
      this.flights[i].proj.deactivate();
    }
    this.flights.length = 0;
  }

  update(dtSec: number, ctx: WeaponContext): void {
    // 飛行中の弾の移動（persistent なので PlayScene の直線移動は適用されない）
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      if (!f.proj.active) {
        // 外部要因（リトライ等）で回収済みなら追跡をやめる
        this.flights[i] = this.flights[this.flights.length - 1];
        this.flights.pop();
        continue;
      }

      if (!f.returning) {
        f.outTimer -= dtSec;
        if (f.outTimer <= 0) {
          f.returning = true;
          // 復路では同じ敵にもう一度ヒットできる（§10 の往復仕様）
          f.proj.clearHits();
        }
      } else {
        // 復路はプレイヤーへのホーミング。プレイヤーが動いても必ず手元に戻る
        const dx = ctx.player.x - f.proj.x;
        const dy = ctx.player.y - f.proj.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < RETURN_RADIUS) {
          f.proj.deactivate();
          this.flights[i] = this.flights[this.flights.length - 1];
          this.flights.pop();
          continue;
        }
        f.proj.vx = (dx / dist) * STATS.speed;
        f.proj.vy = (dy / dist) * STATS.speed;
      }

      f.proj.x += f.proj.vx * dtSec;
      f.proj.y += f.proj.vy * dtSec;
      f.proj.sprite.rotation += 10 * dtSec; // 回転の見た目（演出値）
    }

    // 発射
    this.cooldown -= dtSec;
    if (this.cooldown > 0) return;
    const target = ctx.hash.nearestEnemy(ctx.player.x, ctx.player.y, ctx.searchRadius);
    if (target === null) return;
    this.cooldown = STATS.cooldownSec * ctx.cooldownMul;

    const baseAngle = Math.atan2(target.y - ctx.player.y, target.x - ctx.player.x);
    for (let k = 0; k < STATS.count; k++) {
      const p = ctx.spawnProjectile();
      if (p === null) return;
      const angle = baseAngle + (k - (STATS.count - 1) / 2) * 0.5;
      p.reset(
        this.textures.boomerang,
        ctx.player.x,
        ctx.player.y,
        Math.cos(angle) * STATS.speed,
        Math.sin(angle) * STATS.speed,
      );
      // 移動はこの武器が管理する。当たり判定は通常の弾↔敵経路に乗せる
      p.persistent = true;
      p.noCollide = false;
      p.radius = STATS.radius;
      p.damage = STATS.damage * ctx.damageMul;
      p.pierceLeft = Number.MAX_SAFE_INTEGER; // 貫通無制限（§10）
      p.lifeSec = Number.POSITIVE_INFINITY;
      this.flights.push({ proj: p, outTimer: STATS.outSec, returning: false });
    }
  }
}
