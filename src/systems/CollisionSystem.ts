import { SpatialHash } from '../core/SpatialHash';
import type { Random } from '../core/Random';
import type { Enemy } from '../entities/Enemy';
import type { EnemyProjectile } from '../entities/EnemyProjectile';
import type { Projectile } from '../entities/Projectile';
import { Player, PLAYER_STATS } from '../entities/Player';

/** §11: 押し出しは1フレームあたり最大 2px */
const MAX_PUSH = 2;

/** 最大の敵半径（boss = 48。§11） */
const MAX_ENEMY_RADIUS = 48;

/**
 * 周辺9セル判定の安全条件は「弾半径 + 最大敵半径 < セル64px」だが、
 * 境界（ブーメラン 14 + 48 = 62）の余裕が薄いため、閾値 57 以上で
 * queryCircle による広域判定へ自動分岐する。
 * 57 なのは手裏剣（8 + 48 = 56）を9セル判定側に残すため
 * （貫通で弾数が多い武器なので軽い経路を維持する）。
 */
const NEIGHBOR_QUERY_LIMIT = 57;

/**
 * 当たり判定（§15）。円 vs 円のみ、距離は二乗比較。
 * 空間ハッシュはこのシステムが所有し、毎フレーム §4.2 の 7 で再構築される。
 */
export class CollisionSystem {
  /** 武器の索敵（nearestEnemy / queryCircle）からも参照される */
  readonly hash = new SpatialHash();
  /** クエリ結果の使い回しバッファ */
  private readonly queryBuf: Enemy[] = [];

  constructor(private readonly random: Random) {}

  rebuild(enemies: Enemy[]): void {
    this.hash.clear();
    for (let i = 0; i < enemies.length; i++) {
      this.hash.insert(enemies[i]);
    }
  }

  /**
   * 敵→プレイヤーの接触判定（プレイヤー周辺9セル）。
   * 接触している敵のうち最大の接触ダメージを返す（非接触なら 0）。
   * 最大を取るのは、接触ダメージ 0 の敵（spitter）が他の敵の接触を
   * 覆い隠さないようにするため。無敵時間により適用は 0.5s に1回。
   */
  playerContactDamage(player: Player): number {
    this.hash.queryNeighbors(player.x, player.y, this.queryBuf);
    let maxDamage = 0;
    for (let i = 0; i < this.queryBuf.length; i++) {
      const e = this.queryBuf[i];
      if (!e.active) continue;
      const dx = e.x - player.x;
      const dy = e.y - player.y;
      const r = e.radius + PLAYER_STATS.hitRadius;
      // ハッシュ衝突で混入した遠方セルの敵もこの距離判定で弾かれる
      if (dx * dx + dy * dy < r * r && e.contactDamage > maxDamage) {
        maxDamage = e.contactDamage;
      }
    }
    return maxDamage;
  }

  /**
   * 弾→敵の判定（弾の周辺9セル。§15）。ヒットした敵にはコールバックで
   * ダメージを適用し、貫通数を消費する。ヒット済み判定は (参照, 世代) の組。
   */
  projectilesVsEnemies(
    projectiles: Projectile[],
    onHit: (enemy: Enemy, damage: number) => void,
  ): void {
    for (let i = 0; i < projectiles.length; i++) {
      const p = projectiles[i];
      if (!p.active || p.noCollide || p.pierceLeft <= 0) continue;
      if (p.radius + MAX_ENEMY_RADIUS >= NEIGHBOR_QUERY_LIMIT) {
        // 大きい弾は周辺9セルでは取りこぼし得るため広域クエリに切り替える
        this.hash.queryCircle(p.x, p.y, p.radius + MAX_ENEMY_RADIUS, this.queryBuf);
      } else {
        this.hash.queryNeighbors(p.x, p.y, this.queryBuf);
      }
      for (let j = 0; j < this.queryBuf.length; j++) {
        const e = this.queryBuf[j];
        if (!e.active) continue;
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        const r = e.radius + p.radius;
        if (dx * dx + dy * dy >= r * r) continue;
        if (p.hasHit(e)) continue;
        p.recordHit(e);
        onHit(e, p.damage);
        p.pierceLeft--;
        if (p.pierceLeft <= 0) break;
      }
    }
  }

  /**
   * 敵弾→プレイヤーの判定（§4.2 の 9）。命中した弾は消費し、最大ダメージを返す。
   * 敵弾は最大200発の線形走査で足りるため空間ハッシュには載せない。
   */
  enemyProjectilesVsPlayer(bullets: EnemyProjectile[], player: Player): number {
    let maxDamage = 0;
    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i];
      if (!b.active) continue;
      const dx = b.x - player.x;
      const dy = b.y - player.y;
      const r = b.radius + PLAYER_STATS.hitRadius;
      if (dx * dx + dy * dy >= r * r) continue;
      // 無敵中でも弾は消費する（すり抜けて裏から当たり直すのを防ぐ）
      b.deactivate();
      if (b.damage > maxDamage) maxDamage = b.damage;
    }
    return maxDamage;
  }

  /** 敵同士の軽い押し出し（§11）。同一セル内のみで判定する */
  pushApart(): void {
    this.hash.eachTouchedBucket(this.pushBucket);
  }

  /** コールバックは毎フレーム生成せず、束縛済みの1個を使い回す */
  private readonly pushBucket = (bucket: Enemy[]): void => {
    for (let i = 0; i < bucket.length; i++) {
      const a = bucket[i];
      for (let j = i + 1; j < bucket.length; j++) {
        const b = bucket[j];
        // 固定長バケットではハッシュ衝突した遠方セルが同居するため、
        // 実セル座標が一致するペアだけを押し出し対象にする
        if (a.cellX !== b.cellX || a.cellY !== b.cellY) continue;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distSq = dx * dx + dy * dy;
        const minDist = a.radius + b.radius;
        if (distSq >= minDist * minDist) continue;

        if (distSq === 0) {
          // 完全同座標は方向が定まらないため、乱数で散らす（ボスは動かさない）
          const angle = this.random.range(0, Math.PI * 2);
          const px = Math.cos(angle) * MAX_PUSH;
          const py = Math.sin(angle) * MAX_PUSH;
          if (!a.isBoss) {
            a.x -= px;
            a.y -= py;
          }
          if (!b.isBoss) {
            b.x += px;
            b.y += py;
          }
          continue;
        }

        // 重なりが確定したペアだけ sqrt を取る（方向ベクトルに必要）
        const dist = Math.sqrt(distSq);
        const push = Math.min((minDist - dist) / 2, MAX_PUSH);
        const nx = dx / dist;
        const ny = dy / dist;
        // ボスは押される側にならない（§11。小突かれて震えるのを防ぐ）
        if (!a.isBoss) {
          a.x -= nx * push;
          a.y -= ny * push;
        }
        if (!b.isBoss) {
          b.x += nx * push;
          b.y += ny * push;
        }
      }
    }
  };
}
