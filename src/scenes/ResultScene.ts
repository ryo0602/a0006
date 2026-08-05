import { Container, Graphics, Text } from 'pixi.js';
import { COLORS, FONT_MONO } from '../ui/theme';
import type { PlayResult, Scene } from '../types';

/**
 * リザルト画面（§5）。クリア / ゲームオーバーの両方をここで表示する。
 * コイン獲得（§14）は Phase 5 で追加する。
 */
export class ResultScene implements Scene {
  readonly container = new Container();

  private readonly bg: Graphics;
  private readonly title: Text;
  private readonly stats: Text;
  private readonly coinText: Text;
  private readonly hint: Text;

  constructor(onContinue: () => void) {
    this.bg = new Graphics().rect(0, 0, 1, 1).fill({ color: COLORS.bgDeep, alpha: 0.92 });
    this.bg.eventMode = 'static';
    this.bg.on('pointerdown', onContinue);

    this.title = new Text({
      text: 'GAME OVER',
      style: {
        fontFamily: 'sans-serif',
        fontWeight: 'bold',
        fontSize: 40,
        fill: COLORS.textMain,
        letterSpacing: 3.2,
        padding: 8,
      },
    });
    this.title.anchor.set(0.5);

    this.stats = new Text({
      text: '',
      style: {
        fontFamily: FONT_MONO,
        fontSize: 15,
        fill: COLORS.textDim,
        align: 'center',
        lineHeight: 24,
        padding: 6,
      },
    });
    this.stats.anchor.set(0.5, 0);

    this.coinText = new Text({
      text: '',
      style: { fontFamily: FONT_MONO, fontSize: 17, fill: COLORS.amber, padding: 4 },
    });
    this.coinText.anchor.set(0.5, 0);

    this.hint = new Text({
      text: 'タップ / Enter でステージ選択へ',
      style: { fontFamily: 'sans-serif', fontSize: 15, fill: COLORS.textDim },
    });
    this.hint.anchor.set(0.5);

    this.container.addChild(this.bg, this.title, this.stats, this.coinText, this.hint);

    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
      if (this.container.parent === null) return;
      onContinue();
    });
  }

  /** 遷移前に Game が呼ぶ。クリア時はタイトルを琥珀にして差別化する */
  show(result: PlayResult): void {
    this.title.text = result.cleared ? 'STAGE CLEAR' : 'GAME OVER';
    this.title.style.fill = result.cleared ? COLORS.amber : COLORS.textMain;
    const m = Math.floor(result.timeSec / 60);
    const s = Math.floor(result.timeSec % 60);
    this.stats.text =
      `${result.stageName}\n` +
      `生存時間 ${m}:${s < 10 ? '0' : ''}${s}\n` +
      `キル数 ${result.kills}\n` +
      `到達 Lv.${result.level}`;
    this.coinText.text = `💰 +${result.coins}`;
  }

  update(): void {}

  render(): void {}

  resize(width: number, height: number): void {
    this.bg.width = width;
    this.bg.height = height;
    this.title.position.set(width / 2, height * 0.3);
    this.stats.position.set(width / 2, height * 0.3 + 44);
    this.coinText.position.set(width / 2, height * 0.3 + 156);
    this.hint.position.set(width / 2, height * 0.3 + 210);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
