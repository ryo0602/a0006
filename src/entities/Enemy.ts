import { Sprite, Texture } from 'pixi.js';
import { CHARACTER_SPRITE_HEIGHT } from '../core/sprites';
import { COLORS, TINT_NONE } from '../ui/theme';
import type { EnemyStats } from '../types';

/** オーブの最大個数（進化サテライトの6。§10）。ヒット間隔をオーブ個別に持つための枠数 */
export const MAX_ORBS = 6;

/** 表示上の身長 = 当たり判定半径 × この係数（見た目は判定より大きく、足元中心の感覚に近づける） */
const SPRITE_HEIGHT_PER_RADIUS = 4;

/**
 * 敵種別ごとのティント（色は COLORS のみ。§16）。
 * 全種同じゾンビスプライトを使うため、色と大きさで種別を見分けさせる。
 * 被弾フラッシュはティントを外して最大輝度にする方式（TINT_NONE）。
 */
const ENEMY_TINTS: Record<string, number> = {
  walker: COLORS.textDim,
  runner_z: COLORS.toxic,
  tank_z: COLORS.hpRed,
  spitter: COLORS.amber,
  boss: COLORS.hpRed,
};

/**
 * 敵エンティティ（§11）。オブジェクトプールで使い回すため、
 * 生成は起動時のみで、reset() で再初期化して再利用する。
 * スプライトは生成時に一度だけワールドへ追加し、以降は visible の切替のみ。
 */
export class Enemy {
  x = 0;
  y = 0;
  hp = 0;
  speed = 0;
  contactDamage = 0;
  radius = 0;

  /** ドロップ情報（死亡時に PickupSystem が参照する） */
  drop = '';
  dropCount = 1;

  /** ボスフラグ。押し出しの対象外・撃破でステージクリア（§11 / §12） */
  isBoss = false;

  /** spitter の距離維持AIと発射（§11）。keepDistance = 0 なら通常の直線追尾 */
  keepDistance = 0;
  fireCooldownSec = 0;
  fireTimer = 0;
  projectileDamage = 0;
  projectileSpeed = 0;
  projectileRadius = 0;

  /**
   * プールから取り出されるたびに +1 される世代番号。
   * 貫通弾のヒット済み判定は (参照, 世代) の組で行い、
   * 再利用された個体を「前の敵」と誤認しないようにする。
   */
  generation = 0;

  /** プール返却済みの個体を索敵が拾わないためのフラグ */
  active = false;

  /** 被弾フラッシュの残りフレーム数（§16: 2フレーム白フラッシュ） */
  flashFrames = 0;

  /** オーブ個別のヒット間隔管理（§8）。インデックス = オーブ番号 */
  readonly orbLastHitAt = new Float64Array(MAX_ORBS);

  /** SpatialHash が毎フレーム書き込む実セル座標。
   *  固定長バケットのハッシュ衝突と実際の同一セルを区別するために持つ */
  cellX = 0;
  cellY = 0;

  /** 種別の通常時ティント（フラッシュ終了時に戻す色。死亡パーティクルも同色を使う） */
  tintNormal: number = COLORS.textDim;

  readonly sprite: Sprite;

  constructor(texture: Texture) {
    this.sprite = new Sprite(texture);
    this.sprite.anchor.set(0.5);
    this.sprite.visible = false;
    this.sprite.tint = this.tintNormal;
  }

  /** プールから取り出した直後に呼ぶ。倍率は §12 の難易度倍率 */
  reset(id: string, stats: EnemyStats, x: number, y: number, hpMul: number, damageMul: number): void {
    this.x = x;
    this.y = y;
    this.hp = stats.hp * hpMul;
    this.speed = stats.speed;
    this.contactDamage = stats.contactDamage * damageMul;
    this.radius = stats.radius;
    this.drop = stats.drop;
    this.dropCount = stats.dropCount ?? 1;
    this.isBoss = false;
    this.keepDistance = stats.keepDistance ?? 0;
    this.fireCooldownSec = stats.fireCooldownSec ?? 0;
    // 初弾が全個体同時にならないよう、発射タイマーはリセット時にフルで持たせる
    this.fireTimer = this.fireCooldownSec;
    this.projectileDamage = (stats.projectileDamage ?? 0) * damageMul;
    this.projectileSpeed = stats.projectileSpeed ?? 0;
    this.projectileRadius = stats.projectileRadius ?? 0;
    this.generation++;
    this.active = true;
    this.flashFrames = 0;
    this.orbLastHitAt.fill(-1e9);
    // 種別は色（テーマ色ティント）と大きさで見分けさせる
    this.tintNormal = ENEMY_TINTS[id] ?? COLORS.textDim;
    this.sprite.scale.set((stats.radius * SPRITE_HEIGHT_PER_RADIUS) / CHARACTER_SPRITE_HEIGHT);
    this.sprite.tint = this.tintNormal;
    this.sprite.visible = true;
  }

  /** 被ダメージ。死亡処理は §4.2 の 9 で DamageSystem がまとめて行う */
  takeDamage(amount: number): void {
    this.hp -= amount;
    this.flashFrames = 2;
  }

  /** render 側で毎フレーム呼ぶ。フラッシュの tint 切替もここで行う */
  syncSprite(): void {
    this.sprite.position.set(this.x, this.y);
    if (this.flashFrames > 0) {
      this.flashFrames--;
      this.sprite.tint = TINT_NONE;
    } else {
      this.sprite.tint = this.tintNormal;
    }
  }

  /** プールへ返す直前に呼ぶ。ステージからの remove はしない（使い回すため） */
  deactivate(): void {
    this.active = false;
    this.sprite.visible = false;
  }
}
