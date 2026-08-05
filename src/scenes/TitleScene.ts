import { Container, Graphics, Text } from 'pixi.js';
import { COLORS } from '../ui/theme';
import type { Scene } from '../types';

/**
 * タイトル画面（Phase 1 からの持ち越し分。§5）。タップ / Enter でステージ選択へ。
 */
export class TitleScene implements Scene {
  readonly container = new Container();

  private readonly bg: Graphics;
  private readonly title: Text;
  private readonly hint: Text;

  constructor(onStart: () => void) {
    this.bg = new Graphics().rect(0, 0, 1, 1).fill(COLORS.bgDeep);
    this.bg.eventMode = 'static';
    this.bg.on('pointerdown', onStart);

    this.title = new Text({
      text: 'A0006 SURVIVOR',
      style: {
        fontFamily: 'sans-serif',
        fontWeight: 'bold',
        fontSize: 48,
        fill: COLORS.textMain,
        letterSpacing: 3.8, // §16: 見出しは字間 +0.08em
        padding: 8,
      },
    });
    this.title.anchor.set(0.5);

    this.hint = new Text({
      text: 'タップ / Enter で開始',
      style: { fontFamily: 'sans-serif', fontSize: 16, fill: COLORS.amber },
    });
    this.hint.anchor.set(0.5);

    this.container.addChild(this.bg, this.title, this.hint);

    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
      if (this.container.parent === null) return;
      onStart();
    });
  }

  update(): void {}

  render(): void {}

  resize(width: number, height: number): void {
    this.bg.width = width;
    this.bg.height = height;
    this.title.position.set(width / 2, height * 0.4);
    this.hint.position.set(width / 2, height * 0.4 + 64);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
