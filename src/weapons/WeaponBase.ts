import type { Sprite, Texture } from 'pixi.js';
import type { Camera } from '../core/Camera';
import type { Random } from '../core/Random';
import type { SpatialHash } from '../core/SpatialHash';
import type { Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import type { Projectile } from '../entities/Projectile';

export const MAX_WEAPON_LEVEL = 5;

/**
 * 武器が世界へ働きかけるための窓口。WeaponSystem が毎フレーム値を更新して渡す。
 * damageMul / cooldownMul はパッシブ合算済み（§9）。
 */
export interface WeaponContext {
  player: Player;
  enemies: Enemy[];
  hash: SpatialHash;
  random: Random;
  camera: Camera;
  /** プレイ開始からの経過秒。ヒット間隔の管理に使う */
  elapsedSec: number;
  damageMul: number;
  cooldownMul: number;
  /** 索敵の上限半径（カメラ可視半径 + マージン）。圏内に敵がいなければ撃たない */
  searchRadius: number;
  /** 弾をプールから取得する。上限（§15: 600）到達時は null */
  spawnProjectile(): Projectile | null;
  /** 敵へのダメージ適用の一元窓口（被弾フラッシュ含む） */
  applyDamage(enemy: Enemy, damage: number): void;
}

/** 各武器が発射時に使うテクスチャ集。PlayScene が初期化時に1回だけ生成する */
export interface WeaponTextures {
  shot: Texture;
  shuriken: Texture;
  orb: Texture;
  bolt: Texture;
  /** レベル別の扇形（角度・射程がレベルで変わるため5枚。§8） */
  flameSectors: Texture[];
  /** 進化武器用（§10） */
  boomerang: Texture;
  infernoCircle: Texture;
}

/**
 * 武器共通の抽象（§8）。統一点は「WeaponSystem が毎フレーム update を呼ぶ」ことだけで、
 * CD駆動（shot / shuriken / thunder）・常時（orb）・持続（flame）の違いは
 * 各実装の内部に閉じ込める。
 */
export abstract class WeaponBase {
  abstract readonly id: string;
  level = 1;

  /** 進化武器は true。レベル概念がなく、強化候補・進化候補から除外される（§10） */
  readonly evolved: boolean = false;

  /** 武器自身が持つ常設スプライト（火炎の扇形など）。あれば WeaponSystem がワールドに載せる */
  readonly sprite: Sprite | null = null;

  levelUp(): void {
    if (this.level < MAX_WEAPON_LEVEL) {
      this.level++;
      this.onLevelChanged();
    }
  }

  /** レベル変化時のフック（オーブの個数合わせ、火炎のテクスチャ差し替え等） */
  protected onLevelChanged(): void {}

  /** 武器の撤去時（進化での置き換え・リトライ）に借りているリソースを返す */
  dispose(): void {}

  abstract update(dtSec: number, ctx: WeaponContext): void;
}
