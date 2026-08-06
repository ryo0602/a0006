import type { Container, Texture } from 'pixi.js';
import type { Camera } from '../core/Camera';
import type { Random } from '../core/Random';
import type { SpatialHash } from '../core/SpatialHash';
import type { Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import type { Projectile } from '../entities/Projectile';

/** 爆発残光テクスチャの半径（PlayScene の createExplosionTexture と合わせる） */
export const EXPLOSION_TEX_RADIUS = 60;

/** 爆発残光の表示時間（演出値。§16: シェイクは付けない） */
const EXPLOSION_FLASH_SEC = 0.18;

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
  /** 攻撃範囲倍率（§9 エリア。Phase 8）。半径・射程を持つ武器が乗算する */
  areaMul: number;
  /** 闘志（§7 tank 固有）の倍率。オーブ系（オーブ/サテライト）だけが乗算する。他武器は触らない */
  rageMul: number;
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
  /** Phase 8 追加武器 */
  spear: Texture;
  axe: Texture;
  mine: Texture;
  droneBody: Texture;
  /** 爆発の残光（地雷・メテオ。スケールで爆発半径に合わせる） */
  explosion: Texture;
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

  /** 武器自身が持つ常設表示物（火炎の扇形、ドローンの機体など）。あれば WeaponSystem がワールドに載せる */
  readonly sprite: Container | null = null;

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

/**
 * 爆発の範囲ダメージ（地雷・メテオ・クラスター共通。Phase 8）。
 * damage は呼び出し側で damageMul 適用済みの値を渡す。
 */
export function applyBlast(
  ctx: WeaponContext,
  buf: Enemy[],
  x: number,
  y: number,
  radius: number,
  damage: number,
): void {
  ctx.hash.queryCircle(x, y, radius, buf);
  for (let i = 0; i < buf.length; i++) {
    const e = buf[i];
    if (!e.active) continue;
    const dx = e.x - x;
    const dy = e.y - y;
    const r = radius + e.radius;
    if (dx * dx + dy * dy < r * r) {
      ctx.applyDamage(e, damage);
    }
  }
}

/** 爆発の残光（演出のみ・当たり判定なし）。半径に合わせてスケールする */
export function spawnExplosionFlash(
  ctx: WeaponContext,
  texture: Texture,
  x: number,
  y: number,
  radius: number,
): void {
  const p = ctx.spawnProjectile();
  if (p === null) return;
  p.reset(texture, x, y, 0, 0);
  p.noCollide = true;
  p.radius = 0;
  p.damage = 0;
  p.pierceLeft = 1;
  p.lifeSec = EXPLOSION_FLASH_SEC;
  p.sprite.alpha = 0.55;
  p.sprite.scale.set(radius / EXPLOSION_TEX_RADIUS);
}
