/**
 * 端末判定と性能上限の一元管理。
 * 「スマホ」の基準はカメラのズーム（§6）と敵の同時存在上限（§15）の
 * 両方で使うため、判定を1箇所に集約してずれを防ぐ。
 */
const MOBILE_WIDTH = 768;

export function isMobileWidth(width: number): boolean {
  return width < MOBILE_WIDTH;
}

/** 敵の同時存在上限（§15）。超過分はスポーンをスキップする */
export const ENEMY_LIMIT_MOBILE = 400;
export const ENEMY_LIMIT_PC = 800;

export function enemyLimit(width: number): number {
  return isMobileWidth(width) ? ENEMY_LIMIT_MOBILE : ENEMY_LIMIT_PC;
}

/** 弾の同時存在上限（§15） */
export const PROJECTILE_LIMIT = 600;

/** ジェムの同時存在上限（§15）。超えたら最も古いものを自動回収する */
export const GEM_LIMIT = 400;

/** 敵弾の同時存在上限。自弾（§15: 600）とはプールも判定経路も分ける */
export const ENEMY_PROJECTILE_LIMIT = 200;

/** ピックアップ（回復・マグネット・爆弾）の同時存在上限 */
export const PICKUP_LIMIT = 24;
