import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { createPanel, promptTexture } from './prompts';
import { COLORS } from './theme';

/**
 * ポーズUI（§17: ESC。§5: タブ非アクティブの自動ポーズもこれを表示する）。
 * 再開 = ESC / Enter / 再開ボタン。リタイア = リタイアボタンでステージ選択へ。
 */
export class PauseMenu {
  readonly container = new Container();

  onResume: (() => void) | null = null;
  onRetire: (() => void) | null = null;

  private readonly dim: Graphics;
  private readonly title: Text;
  private readonly resumeBtn: Container;
  private readonly retireBtn: Container;

  constructor() {
    this.dim = new Graphics().rect(0, 0, 1, 1).fill({ color: COLORS.bgDeep, alpha: 0.78 });
    this.dim.eventMode = 'static'; // 下のゲーム画面へのタッチを遮る

    this.title = new Text({
      text: 'PAUSE',
      style: {
        fontFamily: 'sans-serif',
        fontWeight: 'bold',
        fontSize: 32,
        fill: COLORS.textMain,
        letterSpacing: 2.6,
        padding: 8,
      },
    });
    this.title.anchor.set(0.5);

    this.resumeBtn = buildButton('再開', COLORS.textMain, () => this.onResume?.());
    // ESC で再開できることをアイコンで示す
    const escKey = new Sprite(promptTexture('ESC'));
    escKey.scale.set(2);
    escKey.anchor.set(0.5);
    escKey.position.set(56, 0);
    this.resumeBtn.addChild(escKey);
    this.retireBtn = buildButton('リタイア', COLORS.hpRed, () => this.onRetire?.());

    this.container.addChild(this.dim, this.title, this.resumeBtn, this.retireBtn);
    this.container.visible = false;

    // ESC トグルは PlayScene が一元管理する（同一キー押下で開閉が同時に走るのを防ぐ）。
    // ここでは Enter による再開のみ受ける
    window.addEventListener('keydown', (e) => {
      if (!this.container.visible || this.container.parent === null) return;
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        this.onResume?.();
      }
    });
  }

  get visible(): boolean {
    return this.container.visible;
  }

  show(): void {
    this.container.visible = true;
  }

  hide(): void {
    this.container.visible = false;
  }

  resize(width: number, height: number): void {
    this.dim.width = width;
    this.dim.height = height;
    this.title.position.set(width / 2, height * 0.38);
    this.resumeBtn.position.set(width / 2, height * 0.38 + 70);
    this.retireBtn.position.set(width / 2, height * 0.38 + 124);
  }
}

function buildButton(label: string, color: number, onTap: () => void): Container {
  const root = new Container();
  const bg = createPanel(160, 40, COLORS.textDim);
  bg.position.set(-80, -20);
  const text = new Text({
    text: label,
    style: { fontFamily: 'sans-serif', fontSize: 15, fill: color },
  });
  text.anchor.set(0.5);
  root.addChild(bg, text);
  root.eventMode = 'static';
  root.cursor = 'pointer';
  root.on('pointerdown', onTap);
  return root;
}
