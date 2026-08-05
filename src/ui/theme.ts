/**
 * カラートークン（§16）。プロジェクト内の色は必ずここから参照し、
 * 色コードのハードコードを禁止する。
 */
export const COLORS = {
  bgDeep: 0x0d0f14, // 背景の最暗部
  bgSurface: 0x1a1e26, // パネル・モーダル背景
  line: 0x2f3742, // 罫線・枠
  textMain: 0xe8e6e1, // 主要テキスト
  textDim: 0x7d8595, // 補助テキスト
  amber: 0xffb02e, // アクセント（EXP、レア、警告灯）
  hpRed: 0xd94141, // HP
  toxic: 0x6ee085, // 回復・良い変化
} as const;

/** 数値・タイマー用の等幅フォント（§16。桁が揺れないこと） */
export const FONT_MONO = 'ui-monospace, "SF Mono", "Roboto Mono", monospace';

/**
 * tint 無効化の定数。色トークンではなく「テクスチャの色をそのまま出す」ための
 * リセット値（敵の被弾フラッシュは白テクスチャ + 通常時 textDim tint で表現する）。
 */
export const TINT_NONE = 0xffffff;
