import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { isMobileWidth } from '../core/device';
import { createPanel, PROMPT_DIGITS, promptTexture } from './prompts';
import { COLORS, FONT_MONO } from './theme';
import type { ChoiceView } from '../types';

const CARD_W = 220;
const CARD_H = 150;
const GAP = 16;

interface Card {
  root: Container;
  title: Text;
  level: Text;
  effect: Text;
  /** 進化カードの琥珀枠（§16）。表示切替のみで再構築しない */
  evoFrame: Graphics;
}

/**
 * レベルアップ時の3択モーダル（§13 / §16）。ポーズ中に表示される。
 * 選択はカードのタップ / クリック、または 1・2・3 キー。リロールは R キーかボタン。
 * カード・ボタンの Graphics は一度だけ構築し、テキストのみ差し替える。
 */
export class LevelUpModal {
  readonly container = new Container();

  /** PlayScene が設定するコールバック */
  onPick: ((index: number) => void) | null = null;
  onReroll: (() => void) | null = null;

  private readonly dim: Graphics;
  private readonly cards: Card[] = [];
  private readonly rerollBtn: Container;
  private readonly rerollText: Text;
  private screenWidth = 1280;
  private screenHeight = 720;

  constructor() {
    // 背景を暗くする幕。1x1 を伸ばす方式で再構築を避ける
    this.dim = new Graphics().rect(0, 0, 1, 1).fill({ color: COLORS.bgDeep, alpha: 0.78 });
    this.dim.eventMode = 'static'; // モーダル下のゲーム画面へのタッチを遮る
    this.container.addChild(this.dim);

    for (let i = 0; i < 3; i++) {
      const card = this.buildCard(i);
      this.cards.push(card);
      this.container.addChild(card.root);
    }

    this.rerollText = new Text({
      text: 'リロール ×0',
      style: { fontFamily: FONT_MONO, fontSize: 14, fill: COLORS.textMain },
    });
    this.rerollText.anchor.set(0.5);
    this.rerollText.position.set(9, 0);
    const rerollKey = new Sprite(promptTexture('R'));
    rerollKey.scale.set(2);
    rerollKey.anchor.set(0.5);
    rerollKey.position.set(-54, 0);
    const btnBg = createPanel(156, 36, COLORS.textDim);
    btnBg.position.set(-78, -18);
    this.rerollBtn = new Container();
    this.rerollBtn.addChild(btnBg, rerollKey, this.rerollText);
    this.rerollBtn.eventMode = 'static';
    this.rerollBtn.cursor = 'pointer';
    this.rerollBtn.on('pointerdown', () => this.onReroll?.());
    this.container.addChild(this.rerollBtn);

    this.container.visible = false;

    // §17: 選択は 1・2・3、リロールは R。表示中のみ反応させる
    window.addEventListener('keydown', (e) => {
      if (!this.container.visible || this.container.parent === null) return;
      if (e.code === 'Digit1' || e.code === 'Numpad1') this.onPick?.(0);
      else if (e.code === 'Digit2' || e.code === 'Numpad2') this.onPick?.(1);
      else if (e.code === 'Digit3' || e.code === 'Numpad3') this.onPick?.(2);
      else if (e.code === 'KeyR') this.onReroll?.();
    });
  }

  private buildCard(index: number): Card {
    const root = new Container();
    const bg = createPanel(CARD_W, CARD_H, COLORS.line);
    // §16: 見出しは太字サンセリフ + 字間
    const title = new Text({
      text: '',
      style: {
        fontFamily: 'sans-serif',
        fontWeight: 'bold',
        fontSize: 18,
        fill: COLORS.textMain,
        letterSpacing: 1.4,
        padding: 6,
      },
    });
    title.position.set(14, 14);
    const level = new Text({
      text: '',
      style: { fontFamily: FONT_MONO, fontSize: 13, fill: COLORS.amber, padding: 8 },
    });
    level.position.set(14, 44);
    const effect = new Text({
      text: '',
      style: { fontFamily: 'sans-serif', fontSize: 13, fill: COLORS.textDim },
    });
    effect.position.set(14, 70);

    const key = new Sprite(promptTexture(PROMPT_DIGITS[index]));
    key.scale.set(2); // 16px のピクセルアイコンは等倍だと潰れるので整数倍で拡大
    key.anchor.set(1, 0);
    key.position.set(CARD_W - 8, 8);

    const evoFrame = new Graphics()
      .rect(0, 0, CARD_W, CARD_H)
      .stroke({ width: 2, color: COLORS.amber });
    evoFrame.visible = false;

    root.addChild(bg, title, level, effect, key, evoFrame);
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.on('pointerdown', () => this.onPick?.(index));
    return { root, title, level, effect, evoFrame };
  }

  show(views: ChoiceView[], rerollsLeft: number): void {
    for (let i = 0; i < this.cards.length; i++) {
      const view = views[i];
      const card = this.cards[i];
      card.title.text = view.title;
      card.level.text = view.levelText;
      card.effect.text = view.effectText;
      card.evoFrame.visible = view.evolved === true;
    }
    this.setRerolls(rerollsLeft);
    this.container.visible = true;
    this.layout();
  }

  setRerolls(rerollsLeft: number): void {
    this.rerollText.text = `リロール ×${rerollsLeft}`;
    this.rerollBtn.alpha = rerollsLeft > 0 ? 1 : 0.4;
  }

  hide(): void {
    this.container.visible = false;
  }

  resize(width: number, height: number): void {
    this.screenWidth = width;
    this.screenHeight = height;
    this.dim.width = width;
    this.dim.height = height;
    if (this.container.visible) this.layout();
  }

  /** §16: PC は横並び、スマホは縦並び */
  private layout(): void {
    const w = this.screenWidth;
    const h = this.screenHeight;
    if (isMobileWidth(w)) {
      // 縦並び。画面が低い端末では全体を縮小して収める（カードを潰さない）
      const gap = 12;
      const totalH = CARD_H * 3 + gap * 2 + 60;
      const fit = Math.min(1, (h - 40) / totalH);
      const x = (w - CARD_W * fit) / 2;
      let y = (h - totalH * fit) / 2;
      for (const card of this.cards) {
        card.root.position.set(x, y);
        card.root.scale.set(fit);
        y += (CARD_H + gap) * fit;
      }
      this.rerollBtn.position.set(w / 2, y + 24);
      this.rerollBtn.scale.set(fit);
    } else {
      const totalW = CARD_W * 3 + GAP * 2;
      let x = (w - totalW) / 2;
      const y = (h - CARD_H) / 2 - 20;
      for (const card of this.cards) {
        card.root.position.set(x, y);
        card.root.scale.set(1);
        x += CARD_W + GAP;
      }
      this.rerollBtn.position.set(w / 2, y + CARD_H + 44);
      this.rerollBtn.scale.set(1);
    }
  }
}
