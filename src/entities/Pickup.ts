import { Sprite, Texture } from 'pixi.js';

export type PickupKind = 'heal' | 'magnet' | 'bomb';

/**
 * 回復・マグネット・爆弾のドロップ（§13）。プールで使い回す。
 * ジェムと違い吸引されず、プレイヤーの直接接触で取得する。
 */
export class Pickup {
  x = 0;
  y = 0;
  kind: PickupKind = 'heal';
  active = false;

  readonly sprite: Sprite;

  constructor(private readonly textures: Record<PickupKind, Texture>) {
    this.sprite = new Sprite(textures.heal);
    this.sprite.anchor.set(0.5);
    this.sprite.visible = false;
  }

  reset(x: number, y: number, kind: PickupKind): void {
    this.x = x;
    this.y = y;
    this.kind = kind;
    this.active = true;
    this.sprite.texture = this.textures[kind];
    this.sprite.position.set(x, y);
    this.sprite.visible = true;
  }

  deactivate(): void {
    this.active = false;
    this.sprite.visible = false;
  }
}
