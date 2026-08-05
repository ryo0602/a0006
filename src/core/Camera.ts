import type { Container } from 'pixi.js';
import { isMobileWidth } from './device';
import type { Random } from './Random';

/** §6: 縦の最低可視範囲（ワールドpx）とズームのクランプ域 */
const MIN_VISIBLE_HEIGHT = 640;
const ZOOM_MIN = 0.45;
const ZOOM_MAX = 1.0;

/**
 * プレイヤーを画面中央に固定するカメラ（§6。デッドゾーンなし、遅延なし）。
 * ワールドコンテナの scale / position を書き換えることで実現する。
 */
export class Camera {
  zoom = 1;

  private screenWidth = 0;
  private screenHeight = 0;

  /** カメラ中心のワールド座標。背景スクロールとスポーン位置もこの値を参照する */
  x = 0;
  y = 0;

  // 画面シェイク（§16: ボス出現・爆弾使用時のみ）。振幅は残り時間で線形減衰する
  private shakeAmp = 0;
  private shakeDuration = 0;
  private shakeTimer = 0;
  private shakeX = 0;
  private shakeY = 0;

  /**
   * シェイク込みのカメラ位置。ワールド変換と背景の tilePosition の両方が
   * この値を参照することで、背景だけ置いていかれず画面全体が一体で揺れる
   */
  get renderX(): number {
    return this.x + this.shakeX;
  }

  get renderY(): number {
    return this.y + this.shakeY;
  }

  /** 可視範囲の半分（ワールドpx）。スポーンリングと描画カリングが使う */
  get viewHalfWidth(): number {
    return this.screenWidth / 2 / this.zoom;
  }

  get viewHalfHeight(): number {
    return this.screenHeight / 2 / this.zoom;
  }

  resize(width: number, height: number): void {
    this.screenWidth = width;
    this.screenHeight = height;
    // 縦持ち・横持ちのどちらでも縦の可視範囲 640 ワールド px を確保する（§6）
    const base = isMobileWidth(width) ? 0.75 : 1.0;
    const fit = Math.min(base, height / MIN_VISIBLE_HEIGHT);
    this.zoom = Math.min(Math.max(fit, ZOOM_MIN), ZOOM_MAX);
  }

  follow(targetX: number, targetY: number): void {
    this.x = targetX;
    this.y = targetY;
  }

  shake(amplitude: number, durationSec: number): void {
    this.shakeAmp = amplitude;
    this.shakeDuration = durationSec;
    this.shakeTimer = durationSec;
  }

  /** 毎フレームの揺れ量を更新する。方向はシード付き乱数（再現性のため Math.random は使わない） */
  updateShake(dtSec: number, random: Random): void {
    if (this.shakeTimer <= 0) {
      this.shakeX = 0;
      this.shakeY = 0;
      return;
    }
    this.shakeTimer = Math.max(0, this.shakeTimer - dtSec);
    const amp = this.shakeAmp * (this.shakeTimer / this.shakeDuration);
    const angle = random.next() * Math.PI * 2;
    this.shakeX = Math.cos(angle) * amp;
    this.shakeY = Math.sin(angle) * amp;
  }

  /** ワールド→スクリーン変換をコンテナに適用する（render 側で毎フレーム1回） */
  apply(world: Container): void {
    world.scale.set(this.zoom);
    world.position.set(
      this.screenWidth / 2 - this.renderX * this.zoom,
      this.screenHeight / 2 - this.renderY * this.zoom,
    );
  }
}
