import { Assets, Rectangle, Texture } from 'pixi.js';
// URL import で content-hash 付きのファイル名にする（更新時のキャッシュ事故防止。Phase 6）
import charactersUrl from '../assets/characters.png';
import bgStage1Url from '../assets/bg_stage1.png';
import bgStage2Url from '../assets/bg_stage2.png';
import bgStage3Url from '../assets/bg_stage3.png';

/**
 * エンティティ用キャラクタースプライト（"Toon Characters" by Kenney / CC0。
 * public/assets/CREDITS.txt 参照）。
 * 必要な4体の walk ポーズ（96×128）を1枚のストリップ
 * （src/assets/characters.png）に詰めてあり、並び順は ORDER と一致させてビルドしている。
 * §15 の「スプライトは1枚にまとめる」方針に沿い、個別 PNG は同梱しない。
 */
const ORDER = [
  'maleAdventurer',
  'robot',
  'femaleAdventurer',
  'zombie',
  // Phase 9 追加キャラ。現状は既存フレームの色相シフト版のプレースホルダ
  // （本物の Kenney 素材に差し替える場合はこの3フレームを上書きするだけでよい）
  'gamblerToon',
  'paladinToon',
  'engineerToon',
] as const;

export type CharacterSprite = (typeof ORDER)[number];

/** キャラクターID（§7）→ スプライトの割り当て */
export const PLAYER_SPRITES: Record<string, CharacterSprite> = {
  runner: 'maleAdventurer',
  tank: 'robot',
  sniper: 'femaleAdventurer',
  gambler: 'gamblerToon',
  paladin: 'paladinToon',
  engineer: 'engineerToon',
};

const FRAME_W = 96;
/** 元スプライトの高さ。表示スケールはこの値との比で決める */
export const CHARACTER_SPRITE_HEIGHT = 128;

const textures = new Map<CharacterSprite, Texture>();

/** main.ts が Game 起動前に一度だけ呼ぶ（§18-4） */
export async function loadCharacterSprites(): Promise<void> {
  const base = await Assets.load<Texture>(charactersUrl);
  ORDER.forEach((key, i) => {
    textures.set(
      key,
      new Texture({
        source: base.source,
        frame: new Rectangle(i * FRAME_W, 0, FRAME_W, CHARACTER_SPRITE_HEIGHT),
      }),
    );
  });
}

export function characterTexture(key: CharacterSprite): Texture {
  const texture = textures.get(key);
  if (texture === undefined) {
    throw new Error(`キャラ画像が未ロード: ${key}（main.ts の loadCharacterSprites を先に呼ぶ）`);
  }
  return texture;
}

/**
 * ステージ背景タイル（§6 / §12: アスファルト・鉄板・汚泥）。
 * "RPG Urban Pack"（Kenney / CC0）のタイルから 256px にベイク済み
 * （夜間トーン・セルごとの明度ジッタ込み。生成手順は素材側で完結し、実行時は読むだけ）。
 */
const stageBackgrounds = new Map<string, Texture>();

/** ステージID → ビルド時に解決されたURL。動的パスはハッシュ付与が効かないため静的に列挙する */
const BG_URLS: Record<string, string> = {
  stage1: bgStage1Url,
  stage2: bgStage2Url,
  stage3: bgStage3Url,
};

export async function loadStageBackgrounds(stageIds: string[]): Promise<void> {
  for (const id of stageIds) {
    const url = BG_URLS[id];
    if (url === undefined) {
      throw new Error(`背景画像が未登録: ${id}（sprites.ts の BG_URLS に追加する）`);
    }
    stageBackgrounds.set(id, await Assets.load<Texture>(url));
  }
}

export function stageBackgroundTexture(stageId: string): Texture {
  const texture = stageBackgrounds.get(stageId);
  if (texture === undefined) {
    throw new Error(`背景が未ロード: ${stageId}（main.ts の loadStageBackgrounds を先に呼ぶ）`);
  }
  return texture;
}
