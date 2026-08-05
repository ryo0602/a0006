import { Sprite, Texture } from 'pixi.js';

/** 寿命（秒）。§16「敵の死亡時に小さなパーティクル4個」の暫定値（Phase 6 計画 6-2 で合意） */
export const PARTICLE_LIFE_SEC = 0.4;

/**
 * 死亡演出のパーティクル（§16）。オブジェクトプールで使い回す。
 * テクスチャは白い小円で、敵種のティントを乗せて出自を分からせる。
 */
export class Particle {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  lifeSec = 0;
  active = false;

  readonly sprite: Sprite;

  constructor(texture: Texture) {
    this.sprite = new Sprite(texture);
    this.sprite.anchor.set(0.5);
    this.sprite.visible = false;
  }

  reset(x: number, y: number, vx: number, vy: number, tint: number): void {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.lifeSec = PARTICLE_LIFE_SEC;
    this.active = true;
    this.sprite.tint = tint;
    this.sprite.alpha = 1;
    this.sprite.visible = true;
  }

  syncSprite(): void {
    this.sprite.position.set(this.x, this.y);
    // 残り寿命に比例してフェードアウト
    this.sprite.alpha = Math.max(0, this.lifeSec / PARTICLE_LIFE_SEC);
  }

  deactivate(): void {
    this.active = false;
    this.sprite.visible = false;
  }
}
