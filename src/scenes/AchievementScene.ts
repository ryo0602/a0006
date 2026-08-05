import { Container, Graphics, NineSliceSprite, Sprite, Text } from 'pixi.js';
import { createPanel, PROMPT_DIGITS, promptTexture } from '../ui/prompts';
import { COLORS, FONT_MONO } from '../ui/theme';
import type { AchievementDef, ChallengeDef, Scene } from '../types';

/** 1頁あたりの実績行数（スクロールを持ち込まないためのページング。§16 Phase 10） */
const ROWS_PER_PAGE = 8;
const ROW_H = 50;
const ROW_GAP = 6;
const ROW_MAX_W = 540;

/** Game から渡される表示状態（セーブ由来） */
export interface AchievementView {
  stats: {
    totalKills: number;
    totalClears: number;
    totalRuns: number;
    playtimeSec: number;
    bestBossKillSec: number;
  };
  rows: { def: AchievementDef; achieved: boolean; progress: number }[];
  challenges: { id: string; def: ChallengeDef; cleared: boolean }[];
  challengesUnlocked: boolean;
}

interface RowView {
  root: Container;
  bg: NineSliceSprite;
  check: Text;
  name: Text;
  desc: Text;
  right: Text;
  key: Sprite;
}

/**
 * 実績・チャレンジ画面（§14 / §13 Phase 10）。ステージ選択から R キーで開く。
 * 実績はページング表示（8行/頁）で、最終頁がチャレンジ。
 * 達成通知はリザルト画面に集約するため、この画面は閲覧と開始のみ。
 */
export class AchievementScene implements Scene {
  readonly container = new Container();

  private readonly bg: Graphics;
  private readonly heading: Text;
  private readonly statsText: Text;
  private readonly pageText: Text;
  private readonly pageLeft: Text;
  private readonly pageRight: Text;
  private readonly rows: RowView[] = [];
  private readonly backBtn: Container;

  private view: AchievementView | null = null;
  private page = 0;

  constructor(private readonly handlers: { onBack: () => void; onStartChallenge: (id: string) => void }) {
    this.bg = new Graphics().rect(0, 0, 1, 1).fill(COLORS.bgDeep);

    this.heading = new Text({
      text: '実績',
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

    this.statsText = new Text({
      text: '',
      style: { fontFamily: FONT_MONO, fontSize: 13, fill: COLORS.textDim, align: 'center', padding: 4 },
    });
    this.statsText.anchor.set(0.5, 0);

    this.pageText = new Text({
      text: '',
      style: { fontFamily: FONT_MONO, fontSize: 14, fill: COLORS.textMain, padding: 4 },
    });
    this.pageText.anchor.set(0.5);
    this.pageLeft = pagerArrow('◀', () => this.turnPage(-1));
    this.pageRight = pagerArrow('▶', () => this.turnPage(1));

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

    this.container.addChild(
      this.bg,
      this.heading,
      this.statsText,
      this.pageLeft,
      this.pageText,
      this.pageRight,
      this.backBtn,
    );

    for (let i = 0; i < ROWS_PER_PAGE; i++) {
      const row = this.buildRow(i);
      this.rows.push(row);
      this.container.addChild(row.root);
    }

    window.addEventListener('keydown', (e) => {
      if (this.container.parent === null) return;
      if (e.code === 'Escape') {
        handlers.onBack();
        return;
      }
      if (e.code === 'KeyQ') this.turnPage(-1);
      else if (e.code === 'KeyE') this.turnPage(1);
      else if (this.onChallengePage()) {
        const digit = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(e.code);
        if (digit >= 0) this.tryStartChallenge(digit);
      }
    });
  }

  refresh(view: AchievementView): void {
    this.view = view;
    this.page = 0;
    this.renderPage();
  }

  private pageCount(): number {
    if (this.view === null) return 1;
    // 最終頁はチャレンジ
    return Math.ceil(this.view.rows.length / ROWS_PER_PAGE) + 1;
  }

  private onChallengePage(): boolean {
    return this.page === this.pageCount() - 1;
  }

  private turnPage(delta: number): void {
    const next = Math.max(0, Math.min(this.pageCount() - 1, this.page + delta));
    if (next === this.page) return;
    this.page = next;
    this.renderPage();
  }

  private tryStartChallenge(index: number): void {
    const v = this.view;
    if (v === null || !v.challengesUnlocked) return;
    const c = v.challenges[index];
    if (c !== undefined) this.handlers.onStartChallenge(c.id);
  }

  private renderPage(): void {
    const v = this.view;
    if (v === null) return;

    const achievedCount = v.rows.filter((r) => r.achieved).length;
    const h = Math.floor(v.stats.playtimeSec / 3600);
    const m = Math.floor((v.stats.playtimeSec % 3600) / 60);
    const boss =
      v.stats.bestBossKillSec > 0 ? `${v.stats.bestBossKillSec.toFixed(1)}s` : '-';
    // 末尾の空白は CJK 混在時の Text 幅計測誤差で最終文字が見切れる問題の回避
    this.statsText.text =
      `達成 ${achievedCount}/${v.rows.length} | 累計キル ${v.stats.totalKills} | クリア ${v.stats.totalClears}/${v.stats.totalRuns}周\u00a0\n` +
      `プレイ時間 ${h}:${m < 10 ? '0' : ''}${m} | 最短ボス討伐 ${boss}\u00a0`;

    if (this.onChallengePage()) {
      this.pageText.text = `チャレンジ (${this.page + 1}/${this.pageCount()})\u00a0`;
      this.renderChallengeRows();
    } else {
      this.pageText.text = `実績 (${this.page + 1}/${this.pageCount()})\u00a0`;
      this.renderAchievementRows();
    }
  }

  private renderAchievementRows(): void {
    const v = this.view;
    if (v === null) return;
    for (let i = 0; i < ROWS_PER_PAGE; i++) {
      const row = this.rows[i];
      const entry = v.rows[this.page * ROWS_PER_PAGE + i];
      row.root.visible = entry !== undefined;
      if (entry === undefined) continue;
      const { def, achieved, progress } = entry;
      row.check.text = achieved ? '✔' : '';
      row.name.text = def.name;
      row.desc.text = def.desc;
      row.right.text = achieved ? `+${def.reward}\u00a0` : `${progress}/${def.min}\u00a0`;
      row.right.style.fill = achieved ? COLORS.amber : COLORS.textDim;
      row.key.visible = false;
      row.root.alpha = achieved ? 1 : 0.75;
      row.root.eventMode = 'none';
      row.root.cursor = 'default';
    }
  }

  private renderChallengeRows(): void {
    const v = this.view;
    if (v === null) return;
    for (let i = 0; i < ROWS_PER_PAGE; i++) {
      const row = this.rows[i];
      const entry = v.challenges[i];
      row.root.visible = entry !== undefined;
      if (entry === undefined) continue;
      row.check.text = entry.cleared ? '✔' : '';
      row.name.text = entry.def.name;
      row.desc.text = v.challengesUnlocked
        ? entry.def.desc
        : 'ステージ3クリアで解放';
      row.right.text = entry.cleared ? 'クリア済' : `初回 +${entry.def.reward}`;
      row.right.style.fill = entry.cleared ? COLORS.toxic : COLORS.amber;
      row.key.visible = v.challengesUnlocked;
      row.root.alpha = v.challengesUnlocked ? 1 : 0.5;
      row.root.eventMode = v.challengesUnlocked ? 'static' : 'none';
      row.root.cursor = v.challengesUnlocked ? 'pointer' : 'default';
    }
  }

  private buildRow(index: number): RowView {
    const root = new Container();
    const bg = createPanel(ROW_MAX_W, ROW_H, COLORS.line);
    const check = new Text({
      text: '',
      style: { fontFamily: 'sans-serif', fontSize: 18, fill: COLORS.toxic, padding: 4 },
    });
    check.anchor.set(0.5);
    const name = new Text({
      text: '',
      style: {
        fontFamily: 'sans-serif',
        fontWeight: 'bold',
        fontSize: 14,
        fill: COLORS.textMain,
        padding: 4,
      },
    });
    const desc = new Text({
      text: '',
      style: { fontFamily: 'sans-serif', fontSize: 11, fill: COLORS.textDim },
    });
    const right = new Text({
      text: '',
      style: { fontFamily: FONT_MONO, fontSize: 12, fill: COLORS.textDim, padding: 4 },
    });
    right.anchor.set(1, 0.5);
    const key = new Sprite(promptTexture(PROMPT_DIGITS[Math.min(index, 5)]));
    key.scale.set(2);
    key.anchor.set(1, 0.5);
    key.visible = false;

    root.addChild(bg, check, name, desc, right, key);
    root.on('pointerdown', () => {
      if (this.onChallengePage()) this.tryStartChallenge(index);
    });
    return { root, bg, check, name, desc, right, key };
  }

  update(): void {}

  render(): void {}

  resize(width: number, height: number): void {
    this.bg.width = width;
    this.bg.height = height;

    const rowW = Math.min(ROW_MAX_W, width - 24);
    const x = (width - rowW) / 2;
    this.heading.position.set(width / 2, 32);
    this.statsText.position.set(width / 2, 52);
    this.pageLeft.position.set(width / 2 - 110, 106);
    this.pageText.position.set(width / 2, 106);
    this.pageRight.position.set(width / 2 + 110, 106);

    let y = 124;
    for (const row of this.rows) {
      row.bg.width = rowW;
      row.check.position.set(20, ROW_H / 2);
      row.name.position.set(38, 7);
      row.desc.position.set(38, 28);
      row.right.position.set(rowW - 44, ROW_H / 2);
      row.key.position.set(rowW - 8, ROW_H / 2);
      row.root.position.set(x, y);
      y += ROW_H + ROW_GAP;
    }
    this.backBtn.position.set(width / 2, Math.min(y + 26, height - 24));
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

function pagerArrow(label: string, onTap: () => void): Text {
  const t = new Text({
    text: label,
    style: { fontFamily: 'sans-serif', fontSize: 18, fill: COLORS.textMain, padding: 4 },
  });
  t.anchor.set(0.5);
  t.eventMode = 'static';
  t.cursor = 'pointer';
  t.on('pointerdown', onTap);
  return t;
}
