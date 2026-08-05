import { Sprite, Texture } from 'pixi.js';
import type { Enemy } from './Enemy';

/** ヒット記録配列の上限（メモリの保険）。手裏剣の貫通は最大5（§8）だが、
 *  ブーメランは貫通無制限（§10）のため1フライトで通過し得る数を十分カバーする */
const MAX_HIT_RECORDS = 64;

/**
 * 弾エンティティ（§8）。プールで使い回す。
 * - 通常弾（shot / shuriken）: 寿命切れ or 貫通数消費で返却
 * - persistent（オーブ）: 武器が位置を管理し、レベル変更まで借りっぱなし
 * - noCollide（オーブ / 落雷の演出）: CollisionSystem の弾↔敵判定から除外
 */
export class Projectile {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  /** 縦方向の加速度（投斧の重力。Phase 8）。通常弾は 0 */
  ay = 0;
  /** 進行方向に沿った加速度（ランス。Phase 8）。通常弾は 0 */
  accel = 0;
  radius = 0;
  damage = 0;
  pierceLeft = 0;
  lifeSec = 0;
  persistent = false;
  noCollide = false;
  active = false;

  /**
   * 貫通中のヒット済み記録。敵はプールで再利用されるため参照だけでは誤爆する。
   * (参照, 世代) の組で照合し、世代が違えば別個体として扱う。
   */
  private readonly hitRefs: Enemy[] = [];
  private readonly hitGens: number[] = [];

  readonly sprite: Sprite;

  constructor(texture: Texture) {
    this.sprite = new Sprite(texture);
    this.sprite.anchor.set(0.5);
    this.sprite.visible = false;
  }

  reset(texture: Texture, x: number, y: number, vx: number, vy: number): void {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.ay = 0;
    this.accel = 0;
    this.persistent = false;
    this.noCollide = false;
    this.active = true;
    this.hitRefs.length = 0;
    this.hitGens.length = 0;
    this.sprite.texture = texture;
    this.sprite.visible = true;
    this.sprite.rotation = 0;
    this.sprite.alpha = 1;
    this.sprite.scale.set(1);
  }

  hasHit(enemy: Enemy): boolean {
    for (let i = 0; i < this.hitRefs.length; i++) {
      if (this.hitRefs[i] === enemy && this.hitGens[i] === enemy.generation) return true;
    }
    return false;
  }

  recordHit(enemy: Enemy): void {
    if (this.hitRefs.length >= MAX_HIT_RECORDS) return;
    this.hitRefs.push(enemy);
    this.hitGens.push(enemy.generation);
  }

  /** ブーメランの折り返し用。往路と復路で同じ敵に各1回ヒットできるようにする（§10） */
  clearHits(): void {
    this.hitRefs.length = 0;
    this.hitGens.length = 0;
  }

  syncSprite(): void {
    this.sprite.position.set(this.x, this.y);
  }

  deactivate(): void {
    this.active = false;
    this.sprite.visible = false;
  }
}
