import { Container, Graphics, NineSliceSprite, Sprite, Text } from 'pixi.js';
import metaUpgradesData from '../data/metaUpgrades.json';
import { createPanel, PROMPT_DIGITS, promptTexture, PromptKey } from '../ui/prompts';
import { COLORS, FONT_MONO } from '../ui/theme';
import type { MetaUpgradeDef, Scene } from '../types';

const META_DEFS: Record<string, MetaUpgradeDef> = metaUpgradesData;
export const META_IDS = Object.keys(metaUpgradesData);

// 行のキー割り当て。数字キーの画像素材が6までのため、7・8行目は Q / W を使う（Phase 7）
const ROW_KEYS: readonly PromptKey[] = [...PROMPT_DIGITS, 'Q', 'W'];
const ROW_KEY_CODES = [
  ['Digit1', 'Numpad1'],
  ['Digit2', 'Numpad2'],
  ['Digit3', 'Numpad3'],
  ['Digit4', 'Numpad4'],
  ['Digit5', 'Numpad5'],
  ['Digit6', 'Numpad6'],
  ['KeyQ'],
  ['KeyW'],
];

// 行幅は画面幅に追従させ、フォントは縮小しない（Phase 6。9スライスなので伸縮自在）
const ROW_MAX_W = 540;
const ROW_H = 52;
/** 8行 + 見出し + 戻るボタンを縦640に収めるための行間（Phase 7 で 8→6 に詰めた） */
const ROW_GAP = 6;

/** Game から渡される表示状態（セーブ由来。§14） */
export interface UpgradeView {
  coins: number;
  levels: Record<string, number>;
  /** 全メタ強化が最大Lvかつ sniper 解放済み（カンスト検知） */
  allMaxed: boolean;
}

interface Row {
  root: Container;
  bg: NineSliceSprite;
  levelText: Text;
  costText: Text;
  key: Sprite;
}

/**
 * 恒常強化の購入画面（§5 / §14）。行のタップまたは 1〜6 キーで購入、
 * ESC / 戻るボタンでステージ選択へ。状態は Game がセーブから供給する。
 */
export class UpgradeScene implements Scene {
  readonly container = new Container();

  private readonly bg: Graphics;
  private readonly heading: Text;
  private readonly coinText: Text;
  private readonly maxedText: Text;
  private readonly rows: Row[] = [];
  private readonly backBtn: Container;

  constructor(handlers: { onPurchase: (id: string) => void; onBack: () => void }) {
    this.bg = new Graphics().rect(0, 0, 1, 1).fill(COLORS.bgDeep);

    this.heading = new Text({
      text: '恒常強化',
      style: {
        fontFamily: 'sans-serif',
        fontWeight: 'bold',
        fontSize: 24,
        fill: COLORS.textMain,
        letterSpacing: 1.9,
        padding: 6,
      },
    });
    this.heading.anchor.set(0.5);

    this.coinText = new Text({
      text: '💰 0',
      style: { fontFamily: FONT_MONO, fontSize: 16, fill: COLORS.amber, padding: 4 },
    });
    this.coinText.anchor.set(0.5);

    // カンスト表示（全メタ最大 + sniper 解放済み）。コインは貯まり続けてよい
    this.maxedText = new Text({
      text: 'すべて強化済み',
      style: { fontFamily: 'sans-serif', fontSize: 14, fill: COLORS.toxic },
    });
    this.maxedText.anchor.set(0.5);
    this.maxedText.visible = false;

    const backLabel = new Text({
      text: '戻る',
      style: { fontFamily: 'sans-serif', fontSize: 14, fill: COLORS.textMain },
    });
    backLabel.anchor.set(0.5);
    backLabel.position.set(-14, 0);
    const backKey = new Sprite(promptTexture('ESC'));
    backKey.scale.set(2);
    backKey.anchor.set(0.5);
    backKey.position.set(28, 0);
    const backBg = createPanel(128, 36, COLORS.textDim);
    backBg.position.set(-64, -18);
    this.backBtn = new Container();
    this.backBtn.addChild(backBg, backLabel, backKey);
    this.backBtn.eventMode = 'static';
    this.backBtn.cursor = 'pointer';
    this.backBtn.on('pointerdown', () => handlers.onBack());

    this.container.addChild(this.bg, this.heading, this.coinText, this.maxedText, this.backBtn);

    for (let i = 0; i < META_IDS.length; i++) {
      const row = this.buildRow(i, () => handlers.onPurchase(META_IDS[i]));
      this.rows.push(row);
      this.container.addChild(row.root);
    }

    window.addEventListener('keydown', (e) => {
      if (this.container.parent === null) return;
      if (e.code === 'Escape') {
        handlers.onBack();
        return;
      }
      const index = ROW_KEY_CODES.findIndex((codes) => codes.includes(e.code));
      if (index >= 0 && index < META_IDS.length) handlers.onPurchase(META_IDS[index]);
    });
  }

  refresh(view: UpgradeView): void {
    this.coinText.text = `💰 ${view.coins}`;
    this.maxedText.visible = view.allMaxed;
    for (let i = 0; i < META_IDS.length; i++) {
      const id = META_IDS[i];
      const def = META_DEFS[id];
      const lv = view.levels[id] ?? 0;
      const row = this.rows[i];
      row.levelText.text = `Lv.${lv}/${def.maxLevel}`;
      if (lv >= def.maxLevel) {
        row.costText.text = 'MAX';
        row.costText.style.fill = COLORS.toxic;
        row.root.alpha = 0.6;
      } else {
        const cost = def.baseCost * (lv + 1);
        row.costText.text = `💰 ${cost}`;
        row.costText.style.fill = view.coins >= cost ? COLORS.amber : COLORS.textDim;
        row.root.alpha = 1;
      }
    }
  }

  private buildRow(index: number, onBuy: () => void): Row {
    const id = META_IDS[index];
    const def = META_DEFS[id];
    const root = new Container();
    const bg = createPanel(ROW_MAX_W, ROW_H, COLORS.line);

    const name = new Text({
      text: def.name,
      style: {
        fontFamily: 'sans-serif',
        fontWeight: 'bold',
        fontSize: 15,
        fill: COLORS.textMain,
        padding: 4,
      },
    });
    name.position.set(14, 8);

    const effect = new Text({
      text: effectText(def),
      style: { fontFamily: 'sans-serif', fontSize: 12, fill: COLORS.textDim },
    });
    effect.position.set(14, 30);

    const levelText = new Text({
      text: '',
      style: { fontFamily: FONT_MONO, fontSize: 13, fill: COLORS.textMain, padding: 8 },
    });
    levelText.anchor.set(1, 0.5);

    const costText = new Text({
      text: '',
      style: { fontFamily: FONT_MONO, fontSize: 13, fill: COLORS.amber, padding: 4 },
    });
    costText.anchor.set(1, 0.5);

    const key = new Sprite(promptTexture(ROW_KEYS[index]));
    key.scale.set(2);
    key.anchor.set(1, 0.5);

    // 右端基準の要素（Lv/コスト/キー）は resize で行幅に合わせて再配置される
    root.addChild(bg, name, effect, levelText, costText, key);
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.on('pointerdown', onBuy);
    return { root, bg, levelText, costText, key };
  }

  update(): void {}

  render(): void {}

  resize(width: number, height: number): void {
    this.bg.width = width;
    this.bg.height = height;
    // 縮小せず行幅を画面幅に合わせる（Phase 6）。右端基準の要素も追従させる
    const rowW = Math.min(ROW_MAX_W, width - 24);
    this.heading.position.set(width / 2, 40);
    this.coinText.position.set(width / 2, 72);
    this.maxedText.position.set(width / 2, 96);
    let y = 116;
    for (const row of this.rows) {
      row.bg.width = rowW;
      row.levelText.position.set(rowW - 136, ROW_H / 2);
      // 右端の 32px キーアイコンと重ならない位置に置く
      row.costText.position.set(rowW - 48, ROW_H / 2);
      row.key.position.set(rowW - 6, ROW_H / 2);
      row.root.position.set((width - rowW) / 2, y);
      y += ROW_H + ROW_GAP;
    }
    this.backBtn.position.set(width / 2, y + 30);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

/** 効果説明（§16: 数値必須）。stat 種別ごとに単位を変えて生成する */
function effectText(def: MetaUpgradeDef): string {
  switch (def.stat) {
    case 'regen':
      return `HP自動回復 +${def.addPerLevel}/s（レベルごと）`;
    case 'startLevel':
      return `開始レベル +${def.addPerLevel}（レベルごと）`;
    case 'reroll':
      return `リロール回数 +${def.addPerLevel}（レベルごと）`;
    case 'expGain':
      return `EXP獲得 +${Math.round(def.addPerLevel * 100)}%（レベルごと）`;
    case 'pickupRange':
      return `ジェム取得範囲 +${Math.round(def.addPerLevel * 100)}%（レベルごと）`;
    default:
      return `${def.name} +${Math.round(def.addPerLevel * 100)}%（レベルごと）`;
  }
}
