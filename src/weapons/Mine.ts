import weaponsData from '../data/weapons.json';
import type { Enemy } from '../entities/Enemy';
import type { Projectile } from '../entities/Projectile';
import type { MineLevel } from '../types';
import { applyBlast, spawnExplosionFlash, WeaponBase, WeaponContext, WeaponTextures } from './WeaponBase';

const LEVELS: MineLevel[] = weaponsData.mine.levels;

/**
 * 地雷: CDごとに足元へ設置し、敵が触れると範囲爆発する設置型（§8 Phase 8）。
 * 設置物は弾プールから persistent + noCollide で借り（オーブと同じ借用パターン）、
 * 起爆判定はこの武器が空間ハッシュを直接クエリして行う（落雷と同じ自己判定パターン）。
 */
export class Mine extends WeaponBase {
  readonly id: string = 'mine';
  private cooldown = 0;
  /** 設置中の地雷と設置時刻（armSec 経過で武装、lifeSec 経過で不発撤去） */
  protected readonly mines: Projectile[] = [];
  protected readonly placedAt: number[] = [];
  protected readonly queryBuf: Enemy[] = [];

  constructor(protected readonly textures: WeaponTextures) {
    super();
  }

  override dispose(): void {
    for (let i = 0; i < this.mines.length; i++) {
      this.mines[i].deactivate();
    }
    this.mines.length = 0;
    this.placedAt.length = 0;
  }

  /** レベル定義（進化側でオーバーライドする） */
  protected def(): MineLevel {
    return LEVELS[this.level - 1];
  }

  /** 起爆時の追加挙動（クラスターの子爆発用フック） */
  protected onDetonate(_ctx: WeaponContext, _x: number, _y: number): void {}

  update(dtSec: number, ctx: WeaponContext): void {
    const def = this.def();

    // 設置（同時数上限まで）。上限は §8 のこの武器の「弾数」に相当する
    this.cooldown -= dtSec;
    if (this.cooldown <= 0 && this.mines.length < def.count) {
      this.cooldown = def.cooldownSec * ctx.cooldownMul;
      const p = ctx.spawnProjectile();
      if (p !== null) {
        p.reset(this.textures.mine, ctx.player.x, ctx.player.y, 0, 0);
        p.persistent = true;
        p.noCollide = true;
        p.radius = def.triggerRadius;
        p.pierceLeft = 1;
        p.lifeSec = Number.POSITIVE_INFINITY;
        this.mines.push(p);
        this.placedAt.push(ctx.elapsedSec);
      }
    }

    // 起爆・期限切れの判定（逆順走査で swap-remove と両立させる）
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const mine = this.mines[i];
      const age = ctx.elapsedSec - this.placedAt[i];
      let detonate = false;

      if (age >= def.lifeSec) {
        // 不発撤去（爆発なし）
        this.removeAt(i);
        continue;
      }
      if (age >= def.armSec) {
        const trigger = def.triggerRadius;
        ctx.hash.queryNeighbors(mine.x, mine.y, this.queryBuf);
        for (let j = 0; j < this.queryBuf.length; j++) {
          const e = this.queryBuf[j];
          if (!e.active) continue;
          const dx = e.x - mine.x;
          const dy = e.y - mine.y;
          const r = trigger + e.radius;
          if (dx * dx + dy * dy < r * r) {
            detonate = true;
            break;
          }
        }
      }
      if (!detonate) continue;

      const blast = def.blastRadius * ctx.areaMul;
      applyBlast(ctx, this.queryBuf, mine.x, mine.y, blast, def.damage * ctx.damageMul);
      spawnExplosionFlash(ctx, this.textures.explosion, mine.x, mine.y, blast);
      this.onDetonate(ctx, mine.x, mine.y);
      this.removeAt(i);
    }
  }

  private removeAt(i: number): void {
    this.mines[i].deactivate();
    this.mines[i] = this.mines[this.mines.length - 1];
    this.mines.pop();
    this.placedAt[i] = this.placedAt[this.placedAt.length - 1];
    this.placedAt.pop();
  }
}
