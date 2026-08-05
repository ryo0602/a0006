import { Container, Graphics, NineSliceSprite, Sprite, Text } from 'pixi.js';
import stagesData from '../data/stages.json';
import { isMobileWidth } from '../core/device';
import { createPanel, PROMPT_CHAR_KEYS, PROMPT_DIGITS, promptTexture } from '../ui/prompts';
import { COLORS, FONT_MONO } from '../ui/theme';
import type { Scene, StageDef } from '../types';

const CARD_W = 240;
const CARD_H = 130;
const GAP = 20;

const CHAR_W = 180;
const CHAR_H = 96;
const CHAR_GAP = 14;

// 縦画面（幅 < 768）はカードを縮小せず、フル幅の行リストに組み替える（Phase 6）。
// 縮小方式は 360px 幅で文字が 9px 相当になり読めないため
const ROW_MAX_W = 540;
const STAGE_ROW_H = 72;
/** キャラ行は特性が2行（特性 + 初期武器）のため、ステージ行と同等の高さを取る */
const CHAR_ROW_H = 74;
const ROW_GAP = 8;

interface StageCard {
  root: Container;
  bg: NineSliceSprite;
  name: Text;
  info: Text;
  lock: Text;
  key: Sprite;
}

interface CharCard {
  root: Container;
  bg: NineSliceSprite;
  name: Text;
  trait: Text;
  state: Text;
  key: Sprite;
  frame: Graphics;
}

/** Game から渡される表示状態（セーブ由来。§14） */
export interface StageSelectView {
  unlockedStages: number;
  coins: number;
  characters: {
    id: string;
    name: string;
    traitText: string;
    unlocked: boolean;
    selected: boolean;
    /** 未解放時の理由（「ステージ1クリアで解放」「コイン500で解放」） */
    lockText: string;
  }[];
}

export interface StageSelectHandlers {
  onSelectStage: (stage: StageDef, index: number) => void;
  /** 未解放キャラも通知する（sniper の購入判定は Game が行う） */
  onSelectCharacter: (id: string) => void;
  onOpenUpgrade: () => void;
}

/**
 * ステージ選択 + キャラ選択（§5 / §7 / §12）。状態はすべて Game がセーブから
 * 供給する（refresh）。ステージ = 1〜3 キー、キャラ = Q/W/E キー、強化 = U キー。
 */
export class StageSelectScene implements Scene {
  readonly container = new Container();

  private readonly bg: Graphics;
  private readonly heading: Text;
  private readonly cards: StageCard[] = [];
  private readonly charCards: CharCard[] = [];
  private readonly coinText: Text;
  private readonly upgradeBtn: Container;
  private view: StageSelectView | null = null;
  private screenWidth = 1280;
  private screenHeight = 720;

  constructor(private readonly handlers: StageSelectHandlers) {
    this.bg = new Graphics().rect(0, 0, 1, 1).fill(COLORS.bgDeep);

    this.heading = new Text({
      text: 'ステージ選択',
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
    this.coinText.anchor.set(0, 0.5);

    const upgradeLabel = new Text({
      text: '強化',
      style: { fontFamily: 'sans-serif', fontSize: 14, fill: COLORS.textMain },
    });
    upgradeLabel.anchor.set(0.5);
    upgradeLabel.position.set(-12, 0);
    const upgradeKey = new Sprite(promptTexture('U'));
    upgradeKey.scale.set(2);
    upgradeKey.anchor.set(0.5);
    upgradeKey.position.set(30, 0);
    const upgradeBg = createPanel(128, 36, COLORS.textDim);
    upgradeBg.position.set(-64, -18);
    this.upgradeBtn = new Container();
    this.upgradeBtn.addChild(upgradeBg, upgradeLabel, upgradeKey);
    this.upgradeBtn.eventMode = 'static';
    this.upgradeBtn.cursor = 'pointer';
    this.upgradeBtn.on('pointerdown', () => this.handlers.onOpenUpgrade());

    this.container.addChild(this.bg, this.heading, this.coinText, this.upgradeBtn);

    for (let i = 0; i < stagesData.stages.length; i++) {
      const card = this.buildStageCard(i);
      this.cards.push(card);
      this.container.addChild(card.root);
    }
    for (let i = 0; i < 3; i++) {
      const card = this.buildCharCard(i);
      this.charCards.push(card);
      this.container.addChild(card.root);
    }

    window.addEventListener('keydown', (e) => {
      if (this.container.parent === null) return;
      if (e.code === 'Digit1' || e.code === 'Numpad1') this.trySelectStage(0);
      else if (e.code === 'Digit2' || e.code === 'Numpad2') this.trySelectStage(1);
      else if (e.code === 'Digit3' || e.code === 'Numpad3') this.trySelectStage(2);
      else if (e.code === 'KeyQ') this.selectCharacter(0);
      else if (e.code === 'KeyW') this.selectCharacter(1);
      else if (e.code === 'KeyE') this.selectCharacter(2);
      else if (e.code === 'KeyU') this.handlers.onOpenUpgrade();
    });
  }

  /** Game が遷移時に呼ぶ。セーブ由来の状態を反映する */
  refresh(view: StageSelectView): void {
    this.view = view;
    for (let i = 0; i < this.cards.length; i++) {
      const unlocked = i < view.unlockedStages;
      const card = this.cards[i];
      card.lock.visible = !unlocked;
      // 縦画面の行レイアウトでは解放条件と同じ位置に出すため、未解放時は難易度を隠す
      card.info.visible = unlocked;
      card.root.alpha = unlocked ? 1 : 0.45;
      card.root.cursor = unlocked ? 'pointer' : 'default';
    }
    for (let i = 0; i < this.charCards.length; i++) {
      const c = view.characters[i];
      const card = this.charCards[i];
      if (c === undefined) continue;
      card.name.text = c.name;
      card.trait.text = c.traitText;
      card.trait.visible = c.unlocked;
      card.state.text = c.unlocked ? '' : c.lockText;
      card.frame.visible = c.selected;
      card.root.alpha = c.unlocked ? 1 : 0.5;
    }
    this.coinText.text = `💰 ${view.coins}`;
  }

  private trySelectStage(index: number): void {
    if (this.view === null || index >= this.view.unlockedStages) return;
    const stage: StageDef = stagesData.stages[index];
    this.handlers.onSelectStage(stage, index);
  }

  private selectCharacter(index: number): void {
    const c = this.view?.characters[index];
    if (c === undefined) return;
    this.handlers.onSelectCharacter(c.id);
  }

  private buildStageCard(index: number): StageCard {
    const stage: StageDef = stagesData.stages[index];
    const root = new Container();
    const bg = createPanel(CARD_W, CARD_H, COLORS.line);

    const name = new Text({
      text: `${index + 1}. ${stage.name}`,
      style: {
        fontFamily: 'sans-serif',
        fontWeight: 'bold',
        fontSize: 18,
        fill: COLORS.textMain,
        letterSpacing: 1.4,
        padding: 6,
      },
    });
    name.position.set(14, 16);

    const info = new Text({
      text: `難易度 ×${stage.difficultyMul.toFixed(1)} / 💰 ×${stage.coinMultiplier.toFixed(1)}`,
      style: { fontFamily: FONT_MONO, fontSize: 13, fill: COLORS.textDim, padding: 4 },
    });
    info.position.set(14, 50);

    const lock = new Text({
      text: '前のステージをクリアで解放',
      style: { fontFamily: 'sans-serif', fontSize: 12, fill: COLORS.textDim },
    });
    lock.position.set(14, CARD_H - 28);

    const key = new Sprite(promptTexture(PROMPT_DIGITS[index]));
    key.scale.set(2);
    key.anchor.set(1, 0);
    key.position.set(CARD_W - 8, 8);

    root.addChild(bg, name, info, lock, key);
    root.eventMode = 'static';
    root.on('pointerdown', () => this.trySelectStage(index));
    return { root, bg, name, info, lock, key };
  }

  private buildCharCard(index: number): CharCard {
    const root = new Container();
    const bg = createPanel(CHAR_W, CHAR_H, COLORS.line);

    const name = new Text({
      text: '',
      style: {
        fontFamily: 'sans-serif',
        fontWeight: 'bold',
        fontSize: 15,
        fill: COLORS.textMain,
        letterSpacing: 1.2,
        padding: 6,
      },
    });
    name.position.set(12, 10);

    const trait = new Text({
      text: '',
      style: { fontFamily: 'sans-serif', fontSize: 12, fill: COLORS.textDim, lineHeight: 17 },
    });
    trait.position.set(12, 36);

    const state = new Text({
      text: '',
      style: { fontFamily: 'sans-serif', fontSize: 11, fill: COLORS.amber },
    });
    state.position.set(12, CHAR_H - 20);

    const key = new Sprite(promptTexture(PROMPT_CHAR_KEYS[index]));
    key.scale.set(2);
    key.anchor.set(1, 0);
    key.position.set(CHAR_W - 6, 6);

    // 選択中の琥珀枠（表示切替のみ）
    const frame = new Graphics()
      .rect(0, 0, CHAR_W, CHAR_H)
      .stroke({ width: 2, color: COLORS.amber });
    frame.visible = false;

    root.addChild(bg, name, trait, state, key, frame);
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.on('pointerdown', () => this.selectCharacter(index));
    return { root, bg, name, trait, state, key, frame };
  }

  update(): void {}

  render(): void {}

  resize(width: number, height: number): void {
    this.screenWidth = width;
    this.screenHeight = height;
    this.bg.width = width;
    this.bg.height = height;
    this.layout();
  }

  /** PC はカードの横並び、縦画面はフル幅の行リスト（縮小しない。Phase 6） */
  private layout(): void {
    const w = this.screenWidth;
    const h = this.screenHeight;
    if (isMobileWidth(w)) {
      const rowW = Math.min(ROW_MAX_W, w - 24);
      const x = (w - rowW) / 2;
      this.heading.position.set(w / 2, 36);
      let y = 64;
      for (const card of this.cards) {
        card.bg.width = rowW;
        card.bg.height = STAGE_ROW_H;
        card.name.position.set(14, 10);
        // 解放条件（lock）は難易度と同じ位置。refresh でどちらか片方だけ表示される
        card.info.position.set(14, 42);
        card.lock.position.set(14, 42);
        card.key.anchor.set(1, 0.5);
        card.key.position.set(rowW - 8, STAGE_ROW_H / 2);
        card.root.scale.set(1);
        card.root.position.set(x, y);
        y += STAGE_ROW_H + ROW_GAP;
      }
      y += 10;
      for (const card of this.charCards) {
        card.bg.width = rowW;
        card.bg.height = CHAR_ROW_H;
        card.name.position.set(12, 6);
        card.trait.position.set(12, 30);
        card.state.position.set(12, 30);
        card.key.anchor.set(1, 0.5);
        card.key.position.set(rowW - 8, CHAR_ROW_H / 2);
        // 選択枠は行サイズに合わせて引き直す（リサイズ時のみで毎フレームではない）
        card.frame
          .clear()
          .rect(0, 0, rowW, CHAR_ROW_H)
          .stroke({ width: 2, color: COLORS.amber });
        card.root.scale.set(1);
        card.root.position.set(x, y);
        y += CHAR_ROW_H + ROW_GAP;
      }
      this.coinText.position.set(16, h - 28);
      this.upgradeBtn.position.set(w - 84, h - 28);
    } else {
      const totalW = CARD_W * this.cards.length + GAP * (this.cards.length - 1);
      this.heading.position.set(w / 2, h * 0.18);
      let x = (w - totalW) / 2;
      const y = h * 0.26;
      for (const card of this.cards) {
        // 縦画面の行レイアウトから戻ることがあるため、カード寸法を毎回設定し直す
        card.bg.width = CARD_W;
        card.bg.height = CARD_H;
        card.name.position.set(14, 16);
        card.info.position.set(14, 50);
        card.lock.position.set(14, CARD_H - 28);
        card.key.anchor.set(1, 0);
        card.key.position.set(CARD_W - 8, 8);
        card.root.position.set(x, y);
        card.root.scale.set(1);
        x += CARD_W + GAP;
      }
      const charTotalW = CHAR_W * 3 + CHAR_GAP * 2;
      let cx = (w - charTotalW) / 2;
      const cy = y + CARD_H + 36;
      for (const card of this.charCards) {
        card.bg.width = CHAR_W;
        card.bg.height = CHAR_H;
        card.name.position.set(12, 10);
        card.trait.position.set(12, 36);
        card.state.position.set(12, CHAR_H - 20);
        card.key.anchor.set(1, 0);
        card.key.position.set(CHAR_W - 6, 6);
        card.frame
          .clear()
          .rect(0, 0, CHAR_W, CHAR_H)
          .stroke({ width: 2, color: COLORS.amber });
        card.root.position.set(cx, cy);
        card.root.scale.set(1);
        cx += CHAR_W + CHAR_GAP;
      }
      this.coinText.position.set((w - charTotalW) / 2, cy + CHAR_H + 40);
      this.upgradeBtn.position.set((w + charTotalW) / 2 - 64, cy + CHAR_H + 40);
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
