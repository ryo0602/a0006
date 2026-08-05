import weaponsData from '../data/weapons.json';
import type { Enemy } from '../entities/Enemy';
import type { Projectile } from '../entities/Projectile';
import type { OrbLevel } from '../types';
import { WeaponBase, WeaponContext, WeaponTextures } from './WeaponBase';

const LEVELS: OrbLevel[] = weaponsData.orb.levels;

/**
 * オーブ: 自機の周囲を回転する常時武器（§8）。Lvで個数 1→4、半径拡大。
 * 周回弾はプールから借りっぱなし（persistent）にし、位置はこの武器が毎フレーム管理する。
 * ヒット間隔はオーブ個別に敵側の orbLastHitAt[オーブ番号] で管理する
 * （敵ごと1値にすると個数を増やしても単体DPSが変わらないため）。
 */
export class Orb extends WeaponBase {
  readonly id = 'orb';
  private angle = 0;
  private readonly orbs: Projectile[] = [];
  private readonly queryBuf: Enemy[] = [];

  constructor(private readonly textures: WeaponTextures) {
    super();
  }

  /** 進化での置き換え時に周回弾を返す。返却自体は PlayScene の弾回収スイープが行う */
  override dispose(): void {
    for (let i = 0; i < this.orbs.length; i++) {
      this.orbs[i].deactivate();
    }
    this.orbs.length = 0;
  }

  update(dtSec: number, ctx: WeaponContext): void {
    const def = LEVELS[this.level - 1];

    // 個数をレベル定義に合わせる（不足分は取得、余剰分は返却待ちにする）。
    // レベル変更フックではなく毎フレームの突き合わせにしているのは、
    // プール枯渇で取得に失敗しても次フレームに自然回復させるため
    while (this.orbs.length > def.count) {
      const excess = this.orbs.pop();
      if (excess !== undefined) excess.deactivate();
    }
    while (this.orbs.length < def.count) {
      const p = ctx.spawnProjectile();
      if (p === null) break;
      p.reset(this.textures.orb, ctx.player.x, ctx.player.y, 0, 0);
      p.persistent = true;
      p.noCollide = true; // ダメージはこの武器がヒット間隔付きで適用する
      p.radius = def.radius;
      p.pierceLeft = 1;
      p.lifeSec = Number.POSITIVE_INFINITY;
      this.orbs.push(p);
    }

    this.angle += def.rotSpeedRad * dtSec;

    for (let i = 0; i < this.orbs.length; i++) {
      const orb = this.orbs[i];
      orb.radius = def.radius; // レベルアップ直後の取得済みオーブにも新定義を反映する
      const a = this.angle + (i * Math.PI * 2) / this.orbs.length;
      orb.x = ctx.player.x + Math.cos(a) * def.orbitRadius;
      orb.y = ctx.player.y + Math.sin(a) * def.orbitRadius;

      ctx.hash.queryNeighbors(orb.x, orb.y, this.queryBuf);
      for (let j = 0; j < this.queryBuf.length; j++) {
        const e = this.queryBuf[j];
        if (!e.active) continue;
        const dx = e.x - orb.x;
        const dy = e.y - orb.y;
        const r = def.radius + e.radius;
        if (dx * dx + dy * dy >= r * r) continue;
        // オーブ番号 i ごとの前回ヒット時刻と比較する
        if (ctx.elapsedSec - e.orbLastHitAt[i] < def.hitIntervalSec) continue;
        e.orbLastHitAt[i] = ctx.elapsedSec;
        ctx.applyDamage(e, def.damage * ctx.damageMul);
      }
    }
  }
}
