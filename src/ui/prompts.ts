import { Assets, NineSliceSprite, Rectangle, Texture } from 'pixi.js';
// URL import で content-hash 付きのファイル名にする（更新時のキャッシュ事故防止。Phase 6）
import promptsUrl from '../assets/prompts.png';
import panelUrl from '../assets/panel.png';

/**
 * キー入力プロンプトのアイコン（"Input Prompts Pixel" by Kenney / CC0。
 * public/assets/CREDITS.txt 参照）。
 * 必要な13キーだけを 16px タイルのストリップ（src/assets/prompts.png）に
 * 詰めてあり、並び順はこの ORDER と一致させてビルドしている。
 */
const ORDER = ['1', '2', '3', '4', '5', '6', 'Q', 'W', 'E', 'R', 'U', 'ESC', 'ENTER'] as const;

export type PromptKey = (typeof ORDER)[number];

/** 3択カード・ステージ/強化行で使う数字キー */
export const PROMPT_DIGITS: readonly PromptKey[] = ['1', '2', '3', '4', '5', '6'];
/** キャラ選択カードのキー */
export const PROMPT_CHAR_KEYS: readonly PromptKey[] = ['Q', 'W', 'E'];

const TILE = 16;
const textures = new Map<PromptKey, Texture>();

/** main.ts が Game 起動前に一度だけ呼ぶ（§18-4: アセットは Assets で読む） */
export async function loadPrompts(): Promise<void> {
  const base = await Assets.load<Texture>(promptsUrl);
  // ピクセルアートなので拡大してもぼかさない
  base.source.scaleMode = 'nearest';
  ORDER.forEach((key, i) => {
    textures.set(
      key,
      new Texture({ source: base.source, frame: new Rectangle(i * TILE, 0, TILE, TILE) }),
    );
  });
}

export function promptTexture(key: PromptKey): Texture {
  const texture = textures.get(key);
  if (texture === undefined) {
    throw new Error(`プロンプト画像が未ロード: ${key}（main.ts の loadPrompts を先に呼ぶ）`);
  }
  return texture;
}

/**
 * UIパネル（"Pixel UI Pack" by Kenney / CC0。48px の9スライス、縁16px）。
 * 素材は明るい灰色なので、テーマ色のティント（COLORS）で暗部に合わせて使う。
 */
let panelTex: Texture | null = null;
const PANEL_BORDER = 16;

export async function loadUiPanel(): Promise<void> {
  panelTex = await Assets.load<Texture>(panelUrl);
  panelTex.source.scaleMode = 'nearest';
}

/** カード・ボタンの背景パネルを作る。tint は COLORS から選ぶ（パネル階層の表現） */
export function createPanel(width: number, height: number, tint: number): NineSliceSprite {
  if (panelTex === null) {
    throw new Error('パネル画像が未ロード（main.ts の loadUiPanel を先に呼ぶ）');
  }
  const panel = new NineSliceSprite({
    texture: panelTex,
    leftWidth: PANEL_BORDER,
    rightWidth: PANEL_BORDER,
    topHeight: PANEL_BORDER,
    bottomHeight: PANEL_BORDER,
  });
  panel.width = width;
  panel.height = height;
  panel.tint = tint;
  return panel;
}
