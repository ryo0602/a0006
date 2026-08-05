import { Sprite, Texture } from 'pixi.js';

/**
 * 経験値ジェム（§13）。プールで使い回す。
 * 取得範囲に入ると magnetized になり、加速しながらプレイヤーへ吸い寄せられる。
 */
export class Gem {
  x = 0;
  y = 0;
  exp = 0;
  magnetized = false;
  /** 吸引中の現在速度（加速する） */
  speed = 0;
  /** 「最も古いジェム」判定用の連番（§15: 上限超過時に最古を自動回収） */
  seq = 0;

  readonly sprite: Sprite;

  constructor(texture: Texture) {
    this.sprite = new Sprite(texture);
    this.sprite.anchor.set(0.5);
    this.sprite.visible = false;
  }

  reset(x: number, y: number, exp: number, scale: number, seq: number): void {
    this.x = x;
    this.y = y;
    this.exp = exp;
    this.magnetized = false;
    this.speed = 0;
    this.seq = seq;
    this.sprite.scale.set(scale);
    this.sprite.visible = true;
  }

  syncSprite(): void {
    this.sprite.position.set(this.x, this.y);
  }

  deactivate(): void {
    this.sprite.visible = false;
  }
}
