import type { InputState } from '../types';

/** 移動に使うキー。code で判定するためキーボード配列に依存しない */
const KEY_LEFT = ['KeyA', 'ArrowLeft'];
const KEY_RIGHT = ['KeyD', 'ArrowRight'];
const KEY_UP = ['KeyW', 'ArrowUp'];
const KEY_DOWN = ['KeyS', 'ArrowDown'];
const TRACKED_KEYS = new Set([...KEY_LEFT, ...KEY_RIGHT, ...KEY_UP, ...KEY_DOWN]);

/**
 * キーボードとバーチャルスティックを InputState に一本化する唯一の窓口（§17）。
 * ゲームロジックはこのクラスの state だけを見る。
 *
 * 競合時は「最後に有効な入力があったデバイスを優先」する仕様のため、
 * 両デバイスが同時に非ゼロ入力を出している間だけ lastDevice で勝敗を決め、
 * 片方しか入力がなければ入力がある方をそのまま使う。
 */
export class InputManager {
  /** 毎フレーム使い回す単一オブジェクト（毎フレームの new 禁止） */
  readonly state: InputState = { moveX: 0, moveY: 0 };

  /** タッチが一度でも検出されたか。UA判定を使わないための旗（§17） */
  touchDetected = false;

  private readonly pressed = new Set<string>();
  private lastDevice: 'keyboard' | 'touch' = 'keyboard';
  private joyX = 0;
  private joyY = 0;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!TRACKED_KEYS.has(e.code)) return;
    // 矢印キーによるページスクロールを抑止（overflow: hidden でも保険として）
    e.preventDefault();
    this.pressed.add(e.code);
    this.lastDevice = 'keyboard';
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.pressed.delete(e.code);
  };

  /** フォーカス喪失時に押しっぱなし状態が残らないようにする */
  private readonly onBlur = (): void => {
    this.pressed.clear();
  };

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  /** Joystick から毎回呼ばれる。正規化済み（長さ 1 以下）のベクトルを受け取る */
  setJoystickVector(x: number, y: number): void {
    this.joyX = x;
    this.joyY = y;
    if (x !== 0 || y !== 0) {
      this.lastDevice = 'touch';
    }
  }

  /** タッチ入力の存在を通知する（スティック有効化のトリガー） */
  notifyTouch(): void {
    this.touchDetected = true;
  }

  /** 毎ステップ先頭で呼び、state を最新化する（§4.2 の 1.） */
  update(): void {
    let kx = (this.isAnyPressed(KEY_RIGHT) ? 1 : 0) - (this.isAnyPressed(KEY_LEFT) ? 1 : 0);
    let ky = (this.isAnyPressed(KEY_DOWN) ? 1 : 0) - (this.isAnyPressed(KEY_UP) ? 1 : 0);
    if (kx !== 0 && ky !== 0) {
      // 斜め移動が速くならないよう正規化
      const inv = 1 / Math.SQRT2;
      kx *= inv;
      ky *= inv;
    }

    const kbActive = kx !== 0 || ky !== 0;
    const joyActive = this.joyX !== 0 || this.joyY !== 0;

    if (kbActive && (!joyActive || this.lastDevice === 'keyboard')) {
      this.state.moveX = kx;
      this.state.moveY = ky;
    } else if (joyActive) {
      this.state.moveX = this.joyX;
      this.state.moveY = this.joyY;
    } else {
      this.state.moveX = 0;
      this.state.moveY = 0;
    }
  }

  private isAnyPressed(codes: readonly string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }
}
