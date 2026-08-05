import { Container, Graphics } from 'pixi.js';
import type { InputManager } from '../core/Input';
import { COLORS } from './theme';

/** §17: デッドゾーン 12px、最大入力距離 60px */
const DEAD_ZONE = 12;
const MAX_DIST = 60;
const KNOB_RADIUS = 22;

/**
 * スマホ用バーチャルスティック（§17）。
 * 画面左半分をタッチした位置に出現し、離すと消える（固定位置ではない）。
 * Graphics は初期化時に1回だけ構築し、以降は position の移動のみ。
 */
export class Joystick extends Container {
  private readonly knob: Graphics;

  /** 追跡中のポインタ。マルチタッチで別の指に乗っ取られないよう ID で固定する */
  private pointerId: number | null = null;
  private originX = 0;
  private originY = 0;
  private screenWidth = 0;

  constructor(private readonly input: InputManager) {
    super();

    const base = new Graphics()
      .circle(0, 0, MAX_DIST)
      .fill({ color: COLORS.bgSurface, alpha: 0.35 })
      .stroke({ width: 2, color: COLORS.line })
      .circle(0, 0, DEAD_ZONE)
      .stroke({ width: 1, color: COLORS.line });

    this.knob = new Graphics()
      .circle(0, 0, KNOB_RADIUS)
      .fill({ color: COLORS.textDim, alpha: 0.6 })
      .stroke({ width: 2, color: COLORS.textMain });

    this.addChild(base, this.knob);
    this.visible = false;
  }

  /**
   * DOM の pointer イベントを直接購読する。move / up を window で拾うのは、
   * 指がキャンバス外へ滑っても入力が途切れないようにするため。
   */
  attach(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerEnd);
    window.addEventListener('pointercancel', this.onPointerEnd);
  }

  resize(width: number): void {
    this.screenWidth = width;
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    // UA判定ではなくポインタ種別でタッチを検出する（§17）
    if (e.pointerType !== 'touch') return;
    this.input.notifyTouch();
    if (this.pointerId !== null) return;
    if (e.clientX >= this.screenWidth / 2) return;

    // autoDensity 有効時は clientX/Y と Pixi のスクリーン座標が一致する
    this.pointerId = e.pointerId;
    this.originX = e.clientX;
    this.originY = e.clientY;
    this.position.set(this.originX, this.originY);
    this.knob.position.set(0, 0);
    this.visible = true;
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;

    const dx = e.clientX - this.originX;
    const dy = e.clientY - this.originY;
    const len = Math.sqrt(dx * dx + dy * dy);

    if (len < DEAD_ZONE) {
      this.knob.position.set(dx, dy);
      this.input.setJoystickVector(0, 0);
      return;
    }

    // ノブは最大距離でクランプし、入力はアナログ値（0〜1）として渡す
    const clamped = Math.min(len, MAX_DIST);
    const nx = dx / len;
    const ny = dy / len;
    this.knob.position.set(nx * clamped, ny * clamped);
    const mag = clamped / MAX_DIST;
    this.input.setJoystickVector(nx * mag, ny * mag);
  };

  private readonly onPointerEnd = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.visible = false;
    this.input.setJoystickVector(0, 0);
  };
}
