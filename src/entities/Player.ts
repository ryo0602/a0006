import { Sprite, Texture } from 'pixi.js';
import playerData from '../data/player.json';
import type { InputState, Modifiers, PlayerStats } from '../types';

/** バランス数値は JSON に置く（CLAUDE.md / §7）。コードに埋め込まない */
export const PLAYER_STATS: PlayerStats = playerData;

export class Player {
  /** ワールド座標。描画とは分離し、update で座標だけ進める */
  x = 0;
  y = 0;

  hp = PLAYER_STATS.maxHp;
  /** 残り無敵時間（§7: 被弾後 0.5s）。DamageSystem が設定・減算する */
  invincibleTimer = 0;
  /** 残り点滅時間（§7: 被弾時 0.1s） */
  flashTimer = 0;

  /** 向き（正規化済み）。火炎の「前方」に使う。停止中は最後に動いた方向を保持 */
  facingX = 1;
  facingY = 0;

  /** パッシブ補正。取得時に PlayScene が更新する（毎フレーム再計算しない） */
  moveSpeedMul = 1;
  maxHpMul = 1;
  regenPerSec = PLAYER_STATS.regenPerSec;

  readonly sprite: Sprite;
  /** 表示スケール（キャラ見た目の切替時に更新）。向き反転で符号を掛けるため保持する */
  private spriteScale = 1;

  constructor(texture: Texture) {
    this.sprite = new Sprite(texture);
    this.sprite.anchor.set(0.5);
  }

  /** キャラクター選択（§7）に応じた見た目。startStage 時に PlayScene が呼ぶ */
  setAppearance(texture: Texture, displayHeight: number): void {
    this.sprite.texture = texture;
    this.spriteScale = displayHeight / texture.height;
    this.sprite.scale.set(this.spriteScale);
  }

  get maxHp(): number {
    return PLAYER_STATS.maxHp * this.maxHpMul;
  }

  /** リトライ時にシーンごと作り直さず状態だけ初期化する */
  reset(): void {
    this.x = 0;
    this.y = 0;
    this.moveSpeedMul = 1;
    this.maxHpMul = 1;
    this.regenPerSec = PLAYER_STATS.regenPerSec;
    this.hp = this.maxHp;
    this.invincibleTimer = 0;
    this.flashTimer = 0;
    this.facingX = 1;
    this.facingY = 0;
  }

  applyModifiers(mods: Modifiers): void {
    this.moveSpeedMul = mods.moveSpeedMul;
    // 最大HPが増えた分はそのまま回復させず、上限だけ広げる
    this.maxHpMul = mods.maxHpMul;
    this.regenPerSec = PLAYER_STATS.regenPerSec + mods.regenPerSec;
  }

  /** 移動は8方向ではなくアナログ（§7）。input は正規化済みなのでそのまま掛ける */
  update(dtSec: number, input: InputState): void {
    const speed = PLAYER_STATS.moveSpeed * this.moveSpeedMul;
    this.x += input.moveX * speed * dtSec;
    this.y += input.moveY * speed * dtSec;

    if (input.moveX !== 0 || input.moveY !== 0) {
      // input は長さ1以下の正規化済みだが、向きは長さ1にして保持する
      const len = Math.sqrt(input.moveX * input.moveX + input.moveY * input.moveY);
      this.facingX = input.moveX / len;
      this.facingY = input.moveY / len;
    }

    // 自動回復（バイタリティ。§9）
    if (this.regenPerSec > 0 && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + this.regenPerSec * dtSec);
    }
  }

  /** render 側で呼ぶ。補間なし方針のため座標をそのまま反映する（§4.1） */
  syncSprite(): void {
    this.sprite.position.set(this.x, this.y);
    // 移動方向を向く（スプライトは右向き基準ではないが、左右反転で進行方向を示す）
    this.sprite.scale.set(this.facingX < 0 ? -this.spriteScale : this.spriteScale, this.spriteScale);
    // §7 の「白く点滅」の恒久代替（Phase 6 で合意）: tint は乗算で白くできないため、
    // 被弾直後 0.1s は不透明を維持し、残りの無敵時間は半透明にして被弾と無敵を示す
    this.sprite.alpha = this.flashTimer > 0 ? 1 : this.invincibleTimer > 0 ? 0.5 : 1;
  }
}
