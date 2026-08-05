import evolutionsData from '../data/evolutions.json';
import type { Enemy } from '../entities/Enemy';
import { applyBlast, spawnExplosionFlash, WeaponBase, WeaponContext, WeaponTextures } from './WeaponBase';

const STATS = evolutionsData.meteor.stats;

/** 落下開始の高さ（画面上から降ってくる見た目のための演出値） */
const FALL_HEIGHT = 380;

/** 着弾待ちの最大数（count 2 × CD中の重なりを十分カバー） */
const MAX_PENDING = 8;

/**
 * メテオ: 投斧の進化（§10 Phase 8）。ランダムな敵の近くへ隕石を降らせ、
 * 着弾時に範囲爆発する。落下体は演出のみ（noCollide）で、着弾は
 * 「座標と着弾時刻」の記録から処理する（クラスターの子爆発と同じ方式）。
 */
export class Meteor extends WeaponBase {
  readonly id = 'meteor';
  override readonly evolved = true;

  private cooldown = 0;
  private readonly impactX = new Float64Array(MAX_PENDING);
  private readonly impactY = new Float64Array(MAX_PENDING);
  private readonly impactAt = new Float64Array(MAX_PENDING);
  private pending = 0;
  private readonly queryBuf: Enemy[] = [];

  constructor(private readonly textures: WeaponTextures) {
    super();
  }

  override dispose(): void {
    this.pending = 0;
  }

  update(dtSec: number, ctx: WeaponContext): void {
    this.cooldown -= dtSec;
    if (this.cooldown <= 0) {
      this.cooldown = STATS.cooldownSec * ctx.cooldownMul;
      for (let k = 0; k < STATS.count && this.pending < MAX_PENDING; k++) {
        const target = ctx.hash.nearestEnemy(
          ctx.player.x + ctx.random.range(-STATS.spawnRange, STATS.spawnRange),
          ctx.player.y + ctx.random.range(-STATS.spawnRange, STATS.spawnRange),
          ctx.searchRadius,
        );
        if (target === null) break;
        const x = target.x + ctx.random.range(-30, 30);
        const y = target.y + ctx.random.range(-30, 30);
        this.impactX[this.pending] = x;
        this.impactY[this.pending] = y;
        this.impactAt[this.pending] = ctx.elapsedSec + STATS.fallSec;
        this.pending++;

        // 落下体（演出のみ）。lifeSec 経過で自動回収される
        const rock = ctx.spawnProjectile();
        if (rock !== null) {
          rock.reset(this.textures.axe, x, y - FALL_HEIGHT, 0, FALL_HEIGHT / STATS.fallSec);
          rock.noCollide = true;
          rock.radius = 0;
          rock.damage = 0;
          rock.pierceLeft = 1;
          rock.lifeSec = STATS.fallSec;
          rock.sprite.scale.set(1.7);
        }
      }
    }

    // 着弾処理（逆順の swap-remove）
    for (let i = this.pending - 1; i >= 0; i--) {
      if (ctx.elapsedSec < this.impactAt[i]) continue;
      const blast = STATS.blastRadius * ctx.areaMul;
      applyBlast(ctx, this.queryBuf, this.impactX[i], this.impactY[i], blast, STATS.damage * ctx.damageMul);
      spawnExplosionFlash(ctx, this.textures.explosion, this.impactX[i], this.impactY[i], blast);
      this.pending--;
      this.impactX[i] = this.impactX[this.pending];
      this.impactY[i] = this.impactY[this.pending];
      this.impactAt[i] = this.impactAt[this.pending];
    }
  }
}
