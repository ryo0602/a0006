import { Container, Graphics, NineSliceSprite, Sprite, Text } from 'pixi.js';
import stagesData from '../data/stages.json';
import { isMobileWidth } from '../core/device';
import { createPanel, PROMPT_DIGITS, promptTexture } from '../ui/prompts';
import { COLORS, FONT_MONO } from '../ui/theme';
import type { Scene, StageDef } from '../types';

const CARD_W = 240;
const CARD_H = 130;
const GAP = 20;

// キャラ選択はカルーセル1枚（Phase 9: 6種に増え、横並び・キー直選択が破綻したため）
const CHAR_W = 340;
const CHAR_H = 104;

// 縦画面（幅 < 768）はカードを縮小せず、フル幅の行リストに組み替える（Phase 6）
const ROW_MAX_W = 540;
const STAGE_ROW_H = 72;
const ROW_GAP = 8;

interface StageCard {
  root: Container;
  bg: NineSliceSprite;
  name: Text;
  info: Text;
  lock: Text;
  key: Sprite;
}

/** Game から渡される表示状態（セーブ由来。§14） */
export interface StageSelectView {
  unlockedStages: number;
  coins: number;
  /** 危険度（§12 Phase 9） */
  danger: number;
  dangerUnlocked: number;
  dangerMax: number;
  characters: {
    id: string;
    name: string;
    traitText: string;
    unlocked: boolean;
    selected: boolean;
    /** 未解放時の理由（「ステージ2クリアで解放」「コイン800で解放」） */
    lockText: string;
  }[];
}

export interface StageSelectHandlers {
  onSelectStage: (stage: StageDef, index: number) => void;
  /** 未解放キャラも通知する（コイン解放キャラの購入判定は Game が行う） */
  onSelectCharacter: (id: string) => void;
  /** 危険度の増減（§12 Phase 9）。範囲クランプは Game が行う */
  onChangeDanger: (delta: number) => void;
  onOpenUpgrade: () => void;
  /** 実績・チャレンジ画面（§14 Phase 10） */
  onOpenAchievements: () => void;
}

/**
 * ステージ選択 + 危険度 + キャラ選択（§5 / §7 / §12）。状態はすべて Game がセーブから
 * 供給する（refresh）。ステージ = 1〜3、危険度 = ←/→、キャラ送り = Q/E、決定 = W、強化 = U。
 */
export class StageSelectScene implements Scene {
  readonly container = new Container();

  private readonly bg: Graphics;
  private readonly heading: Text;
  private readonly cards: StageCard[] = [];
  private readonly coinText: Text;
  private readonly upgradeBtn: Container;
  private readonly achieveBtn: Container;

  // 危険度セレクタ（§12 Phase 9）
  private readonly dangerRoot: Container;
  private readonly dangerText: Text;
  private readonly dangerLeft: Text;
  private readonly dangerRight: Text;

  // キャラカルーセル（§7 Phase 9）
  private readonly charRoot: Container;
  private readonly charBg: NineSliceSprite;
  private readonly charFrame: Graphics;
  private readonly charName: Text;
  private readonly charTrait: Text;
  private readonly charState: Text;
  private readonly charIndex: Text;
  private readonly charPrevKey: Sprite;
  private readonly charNextKey: Sprite;
  private readonly charPickHint: Container;
  private browseIndex = 0;

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

    // 危険度セレクタ: ◀ 危険度 n ▶（キーは ←/→。キー画像素材がないため記号表示）
    this.dangerText = new Text({
      text: '',
      style: { fontFamily: FONT_MONO, fontSize: 16, fill: COLORS.textMain, padding: 4 },
    });
    this.dangerText.anchor.set(0.5);
    this.dangerLeft = arrowText('◀');
    this.dangerRight = arrowText('▶');
    this.dangerLeft.on('pointerdown', () => this.handlers.onChangeDanger(-1));
    this.dangerRight.on('pointerdown', () => this.handlers.onChangeDanger(1));
    this.dangerRoot = new Container();
    this.dangerRoot.addChild(this.dangerLeft, this.dangerText, this.dangerRight);

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

    // 実績ボタン（§14 Phase 10。R キー）
    const achieveLabel = new Text({
      text: '実績',
      style: { fontFamily: 'sans-serif', fontSize: 14, fill: COLORS.textMain },
    });
    achieveLabel.anchor.set(0.5);
    achieveLabel.position.set(-12, 0);
    const achieveKey = new Sprite(promptTexture('R'));
    achieveKey.scale.set(2);
    achieveKey.anchor.set(0.5);
    achieveKey.position.set(30, 0);
    const achieveBg = createPanel(128, 36, COLORS.textDim);
    achieveBg.position.set(-64, -18);
    this.achieveBtn = new Container();
    this.achieveBtn.addChild(achieveBg, achieveLabel, achieveKey);
    this.achieveBtn.eventMode = 'static';
    this.achieveBtn.cursor = 'pointer';
    this.achieveBtn.on('pointerdown', () => this.handlers.onOpenAchievements());

    // キャラカルーセル本体
    this.charBg = createPanel(CHAR_W, CHAR_H, COLORS.line);
    this.charFrame = new Graphics();
    this.charName = new Text({
      text: '',
      style: {
        fontFamily: 'sans-serif',
        fontWeight: 'bold',
        fontSize: 16,
        fill: COLORS.textMain,
        letterSpacing: 1.2,
        padding: 6,
      },
    });
    this.charTrait = new Text({
      text: '',
      style: { fontFamily: 'sans-serif', fontSize: 12, fill: COLORS.textDim, lineHeight: 17 },
    });
    this.charState = new Text({
      text: '',
      style: { fontFamily: 'sans-serif', fontSize: 11, fill: COLORS.amber },
    });
    this.charIndex = new Text({
      text: '',
      style: { fontFamily: FONT_MONO, fontSize: 12, fill: COLORS.textDim, padding: 4 },
    });
    this.charIndex.anchor.set(1, 0);
    this.charPrevKey = new Sprite(promptTexture('Q'));
    this.charPrevKey.scale.set(2);
    this.charPrevKey.anchor.set(0.5);
    this.charNextKey = new Sprite(promptTexture('E'));
    this.charNextKey.scale.set(2);
    this.charNextKey.anchor.set(0.5);
    this.charPrevKey.eventMode = 'static';
    this.charPrevKey.cursor = 'pointer';
    this.charPrevKey.on('pointerdown', () => this.browse(-1));
    this.charNextKey.eventMode = 'static';
    this.charNextKey.cursor = 'pointer';
    this.charNextKey.on('pointerdown', () => this.browse(1));

    // 決定（W）。タップはカード本体タップでも決定になる
    const pickLabel = new Text({
      text: '決定',
      style: { fontFamily: 'sans-serif', fontSize: 12, fill: COLORS.textMain },
    });
    pickLabel.anchor.set(0, 0.5);
    pickLabel.position.set(20, 0);
    const pickKey = new Sprite(promptTexture('W'));
    pickKey.scale.set(2);
    pickKey.anchor.set(0.5);
    this.charPickHint = new Container();
    this.charPickHint.addChild(pickKey, pickLabel);

    this.charRoot = new Container();
    this.charRoot.addChild(
      this.charBg,
      this.charName,
      this.charTrait,
      this.charState,
      this.charIndex,
      this.charFrame,
    );
    this.charRoot.eventMode = 'static';
    this.charRoot.cursor = 'pointer';
    this.charRoot.on('pointerdown', () => this.pickBrowsed());

    this.container.addChild(
      this.bg,
      this.heading,
      this.dangerRoot,
      this.coinText,
      this.upgradeBtn,
      this.achieveBtn,
      this.charRoot,
      this.charPrevKey,
      this.charNextKey,
      this.charPickHint,
    );

    for (let i = 0; i < stagesData.stages.length; i++) {
      const card = this.buildStageCard(i);
      this.cards.push(card);
      this.container.addChild(card.root);
    }

    window.addEventListener('keydown', (e) => {
      if (this.container.parent === null) return;
      if (e.code === 'Digit1' || e.code === 'Numpad1') this.trySelectStage(0);
      else if (e.code === 'Digit2' || e.code === 'Numpad2') this.trySelectStage(1);
      else if (e.code === 'Digit3' || e.code === 'Numpad3') this.trySelectStage(2);
      else if (e.code === 'ArrowLeft') this.handlers.onChangeDanger(-1);
      else if (e.code === 'ArrowRight') this.handlers.onChangeDanger(1);
      else if (e.code === 'KeyQ') this.browse(-1);
      else if (e.code === 'KeyE') this.browse(1);
      else if (e.code === 'KeyW') this.pickBrowsed();
      else if (e.code === 'KeyU') this.handlers.onOpenUpgrade();
      else if (e.code === 'KeyR') this.handlers.onOpenAchievements();
    });
  }

  /** Game が遷移時に呼ぶ。セーブ由来の状態を反映する */
  refresh(view: StageSelectView): void {
    this.view = view;
    for (let i = 0; i < this.cards.length; i++) {
      const unlocked = i < view.unlockedStages;
      const card = this.cards[i];
      card.lock.visible = !unlocked;
      card.info.visible = unlocked;
      card.root.alpha = unlocked ? 1 : 0.45;
      card.root.cursor = unlocked ? 'pointer' : 'default';
    }

    // 危険度: 上限・下限で矢印を薄くする
    this.dangerText.text =
      view.danger === 0 ? '危険度 0 (標準)' : `危険度 ${view.danger}`;
    this.dangerLeft.alpha = view.danger > 0 ? 1 : 0.3;
    this.dangerRight.alpha = view.danger < view.dangerUnlocked ? 1 : 0.3;

    // 初期表示は選択中キャラに合わせる
    const selectedIdx = view.characters.findIndex((c) => c.selected);
    if (selectedIdx >= 0 && this.browseIndex >= view.characters.length) {
      this.browseIndex = selectedIdx;
    }
    this.renderCharCard();
    this.coinText.text = `💰 ${view.coins}`;
  }

  private browse(delta: number): void {
    if (this.view === null) return;
    const n = this.view.characters.length;
    this.browseIndex = (this.browseIndex + delta + n) % n;
    this.renderCharCard();
  }

  private pickBrowsed(): void {
    const c = this.view?.characters[this.browseIndex];
    if (c === undefined) return;
    this.handlers.onSelectCharacter(c.id);
  }

  private renderCharCard(): void {
    const c = this.view?.characters[this.browseIndex];
    if (c === undefined) return;
    this.charName.text = c.name;
    this.charTrait.text = c.traitText;
    this.charTrait.visible = c.unlocked;
    this.charState.text = c.unlocked ? '' : c.lockText;
    this.charIndex.text = `${this.browseIndex + 1}/${this.view?.characters.length ?? 0}`;
    this.charFrame.visible = c.selected;
    this.charRoot.alpha = c.unlocked ? 1 : 0.55;
  }

  private trySelectStage(index: number): void {
    if (this.view === null || index >= this.view.unlockedStages) return;
    const stage: StageDef = stagesData.stages[index];
    this.handlers.onSelectStage(stage, index);
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

    const info = new Text({
      text: `難易度 ×${stage.difficultyMul.toFixed(1)} / 💰 ×${stage.coinMultiplier.toFixed(1)}`,
      style: { fontFamily: FONT_MONO, fontSize: 13, fill: COLORS.textDim, padding: 4 },
    });

    const lock = new Text({
      text: '前のステージをクリアで解放',
      style: { fontFamily: 'sans-serif', fontSize: 12, fill: COLORS.textDim },
    });

    const key = new Sprite(promptTexture(PROMPT_DIGITS[index]));
    key.scale.set(2);

    root.addChild(bg, name, info, lock, key);
    root.eventMode = 'static';
    root.on('pointerdown', () => this.trySelectStage(index));
    return { root, bg, name, info, lock, key };
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

  /** カルーセル・危険度行のジオメトリを幅に合わせて組む */
  private layoutCharCard(cardW: number): void {
    this.charBg.width = cardW;
    this.charBg.height = CHAR_H;
    this.charName.position.set(14, 8);
    this.charTrait.position.set(14, 34);
    this.charState.position.set(14, 40);
    this.charIndex.position.set(cardW - 10, 8);
    this.charFrame
      .clear()
      .rect(0, 0, cardW, CHAR_H)
      .stroke({ width: 2, color: COLORS.amber });
  }

  /** PC はカードの横並び、縦画面はフル幅の行リスト（縮小しない。Phase 6 / 9） */
  private layout(): void {
    const w = this.screenWidth;
    const h = this.screenHeight;
    if (isMobileWidth(w)) {
      const rowW = Math.min(ROW_MAX_W, w - 24);
      const x = (w - rowW) / 2;
      this.heading.position.set(w / 2, 32);

      this.dangerLeft.position.set(-90, 0);
      this.dangerRight.position.set(90, 0);
      this.dangerText.position.set(0, 0);
      this.dangerRoot.position.set(w / 2, 66);

      let y = 88;
      for (const card of this.cards) {
        card.bg.width = rowW;
        card.bg.height = STAGE_ROW_H;
        card.name.position.set(14, 10);
        card.info.position.set(14, 42);
        card.lock.position.set(14, 42);
        card.key.anchor.set(1, 0.5);
        card.key.position.set(rowW - 8, STAGE_ROW_H / 2);
        card.root.scale.set(1);
        card.root.position.set(x, y);
        y += STAGE_ROW_H + ROW_GAP;
      }
      y += 8;
      // カルーセル: 行幅から矢印分を確保
      const cardW = rowW - 88;
      this.layoutCharCard(cardW);
      this.charRoot.position.set(x + 44, y);
      this.charPrevKey.position.set(x + 20, y + CHAR_H / 2);
      this.charNextKey.position.set(x + rowW - 20, y + CHAR_H / 2);
      this.charPickHint.position.set(x + 44 + 8, y + CHAR_H + 16);
      y += CHAR_H + 34;
      this.coinText.position.set(16, h - 28);
      this.upgradeBtn.position.set(w - 84, h - 28);
      this.achieveBtn.position.set(w - 84, h - 74);
    } else {
      const totalW = CARD_W * this.cards.length + GAP * (this.cards.length - 1);
      this.heading.position.set(w / 2, h * 0.13);

      this.dangerLeft.position.set(-100, 0);
      this.dangerRight.position.set(100, 0);
      this.dangerText.position.set(0, 0);
      this.dangerRoot.position.set(w / 2, h * 0.13 + 38);

      let x = (w - totalW) / 2;
      const y = h * 0.22;
      for (const card of this.cards) {
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
      const cy = y + CARD_H + 36;
      this.layoutCharCard(CHAR_W);
      this.charRoot.position.set((w - CHAR_W) / 2, cy);
      this.charPrevKey.position.set((w - CHAR_W) / 2 - 28, cy + CHAR_H / 2);
      this.charNextKey.position.set((w + CHAR_W) / 2 + 28, cy + CHAR_H / 2);
      this.charPickHint.position.set((w - CHAR_W) / 2 + 8, cy + CHAR_H + 18);
      this.coinText.position.set((w - CHAR_W) / 2, cy + CHAR_H + 52);
      this.upgradeBtn.position.set((w + CHAR_W) / 2 - 64, cy + CHAR_H + 52);
      this.achieveBtn.position.set((w + CHAR_W) / 2 - 220, cy + CHAR_H + 52);
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

/** 危険度セレクタの矢印（タップ可能な Text） */
function arrowText(label: string): Text {
  const t = new Text({
    text: label,
    style: { fontFamily: 'sans-serif', fontSize: 20, fill: COLORS.textMain, padding: 4 },
  });
  t.anchor.set(0.5);
  t.eventMode = 'static';
  t.cursor = 'pointer';
  return t;
}
