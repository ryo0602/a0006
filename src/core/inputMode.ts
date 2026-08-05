/**
 * 入力モードの自動判定（§17 Phase 10 改修）。
 * タッチ入力（pointerType === 'touch'）を検出したらタッチモード、
 * キーボード入力を検出したらキーボードモードに切り替え、
 * キーラベル表示の出し分けに使う。設定画面での手動切り替えは作らない（§17）。
 * スティック有効化（InputManager.touchDetected）と同じ検出基準を共有する。
 */
export type InputMode = 'keyboard' | 'touch';

// 初期値はタッチ可能デバイスならタッチ（スマホで起動直後からラベルが正しくなるように）。
// タッチ対応PCでも最初のキー入力でキーボード表示に戻る
let mode: InputMode =
  typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 ? 'touch' : 'keyboard';

const listeners = new Set<(mode: InputMode) => void>();

export function currentInputMode(): InputMode {
  return mode;
}

/** 登録時に現在のモードで1回即時に呼ぶ（各画面の初期表示を揃えるため） */
export function onInputModeChange(cb: (mode: InputMode) => void): void {
  listeners.add(cb);
  cb(mode);
}

function setMode(next: InputMode): void {
  if (next === mode) return;
  mode = next;
  for (const cb of listeners) cb(mode);
}

/** Game.start から一度だけ呼ぶ */
export function initInputMode(): void {
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'touch') setMode('touch');
    },
    true,
  );
  window.addEventListener('keydown', () => setMode('keyboard'), true);
}
