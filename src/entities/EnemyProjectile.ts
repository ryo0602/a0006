import { Sprite, Texture } from 'pixi.js';

/**
 * 敵弾（spitter。§11）。自弾（Projectile）とはプールも判定経路も完全に分ける。
 * 判定は「敵弾 ↔ プレイヤー」のみ（§4.2 の 9）。
 * 同一プールに混ぜると自弾が自分に当たる・敵弾が敵を倒すといった事故が起きるため。
 */
export class EnemyProjectile {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  radius = 0;
  damage = 0;
  lifeSec = 0;
  active = false;

  readonly sprite: Sprite;

  constructor(texture: Texture) {
    this.sprite = new Sprite(texture);
    this.sprite.anchor.set(0.5);
    this.sprite.visible = false;
  }

  reset(x: number, y: number, vx: number, vy: number, radius: number, damage: number): void {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.radius = radius;
    this.damage = damage;
    // 画面を横切って十分飛ぶ寿命。範囲外に消えた弾を確実に回収する保険
    this.lifeSec = 6;
    this.active = true;
    this.sprite.visible = true;
  }

  syncSprite(): void {
    this.sprite.position.set(this.x, this.y);
  }

  deactivate(): void {
    this.active = false;
    this.sprite.visible = false;
  }
}
