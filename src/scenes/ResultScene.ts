import { Container, Graphics, Text } from 'pixi.js';
import { onInputModeChange } from '../core/inputMode';
import { COLORS, FONT_MONO } from '../ui/theme';
import type { UnlockNotice } from '../systems/AchievementSystem';
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
  private readonly noticeText: Text;
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

    // 新規達成の通知（§14 Phase 10）。プレイ中には出さず、ここに集約する（§16）
    this.noticeText = new Text({
      text: '',
      style: {
        fontFamily: 'sans-serif',
        fontSize: 14,
        fill: COLORS.toxic,
        align: 'center',
        lineHeight: 22,
        padding: 4,
      },
    });
    this.noticeText.anchor.set(0.5, 0);

    this.hint = new Text({
      text: 'タップ / Enter でステージ選択へ',
      style: { fontFamily: 'sans-serif', fontSize: 15, fill: COLORS.textDim },
    });
    this.hint.anchor.set(0.5);
    // §17: タッチモードではキーボードの案内を出さない
    onInputModeChange((mode) => {
      this.hint.text =
        mode === 'touch' ? 'タップでステージ選択へ' : 'タップ / Enter でステージ選択へ';
    });

    this.container.addChild(this.bg, this.title, this.stats, this.coinText, this.noticeText, this.hint);

    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
      if (this.container.parent === null) return;
      onContinue();
    });
  }

  /** 遷移前に Game が呼ぶ。クリア時はタイトルを琥珀にして差別化する */
  show(result: PlayResult, notices: UnlockNotice[] = []): void {
    // 末尾の NBSP は letterSpacing・絵文字混在時に最終文字が見切れる Text 幅計測問題の回避
    // （通常スペースは trim されるため NBSP を使う）
    this.title.text = result.cleared ? 'STAGE CLEAR\u00a0' : 'GAME OVER\u00a0';
    this.title.style.fill = result.cleared ? COLORS.amber : COLORS.textMain;
    const m = Math.floor(result.timeSec / 60);
    const s = Math.floor(result.timeSec % 60);
    const dangerLine = result.dangerLevel > 0 ? `危険度 ${result.dangerLevel}\n` : '';
    this.stats.text =
      `${result.stageName}\n` +
      dangerLine +
      `生存時間 ${m}:${s < 10 ? '0' : ''}${s}\n` +
      `キル数 ${result.kills}\n` +
      `到達 Lv.${result.level}`;
    this.coinText.text = `💰 +${result.coins}\u00a0`;

    // 新規達成は最大3件 + 「他n件」。報酬コインも添える（§14 Phase 10）
    if (notices.length === 0) {
      this.noticeText.text = '';
    } else {
      const lines = notices.slice(0, 3).map((n) => `🏆 ${n.name}  +${n.reward}`);
      if (notices.length > 3) lines.push(`他 ${notices.length - 3} 件の達成`);
      this.noticeText.text = lines.join('\n');
    }
  }

  update(): void {}

  render(): void {}

  resize(width: number, height: number): void {
    this.bg.width = width;
    this.bg.height = height;
    this.title.position.set(width / 2, height * 0.26);
    this.stats.position.set(width / 2, height * 0.26 + 44);
    this.coinText.position.set(width / 2, height * 0.26 + 178);
    this.noticeText.position.set(width / 2, height * 0.26 + 210);
    this.hint.position.set(width / 2, height * 0.26 + 300);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
