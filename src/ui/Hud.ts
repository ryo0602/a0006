import { Container, Graphics, Text } from 'pixi.js';
import { COLORS, FONT_MONO } from './theme';

/** FPS 表示の更新間隔。毎フレームの text 代入を避ける（§15） */
const FPS_INTERVAL_MS = 500;

const BAR_WIDTH = 220;
const BAR_HEIGHT = 10;
const EXP_HEIGHT = 4;

/** ボスHPバーの論理幅。実表示は画面幅の60%へ scale で合わせる（§16） */
const BOSS_BAR_WIDTH = 600;
const BOSS_BAR_HEIGHT = 12;

/** 残り時間の点滅間隔（§16: 1:00 を切ったら琥珀色で点滅） */
const TIMER_BLINK_MS = 500;

/** HP残像（§16）: 減少後この時間だけ白を残し、その後 GHOST_DECAY_PER_SEC で追いつく */
const GHOST_HOLD_MS = 120;
const GHOST_DECAY_PER_SEC = 2.5;

/**
 * HUD（§16）。HP バー（左上）、その下に細い EXP バー（琥珀）、右上にレベル。
 * すべてのバーは Graphics を作り直さず scale.x で伸縮させる。
 */
export class Hud {
  readonly container = new Container();

  private readonly hpFill: Graphics;
  private lastHpRatio = -1;

  // §16: 減少時に一瞬白を残して追いつく残像。純白はトークンにないため textMain を使う
  private readonly ghostFill: Graphics;
  private ghostRatio = 1;
  private ghostHoldUntil = 0;
  private lastGhostNow = 0;

  private readonly expFill: Graphics;
  private lastExpRatio = -1;

  private readonly levelText: Text;
  private lastLevel = -1;

  private readonly timerText: Text;
  private lastTimerSec = -1;
  private timerBlinking = false;

  private readonly bossBar: Container;
  private readonly bossFill: Graphics;
  private lastBossRatio = -1;

  private readonly coinText: Text;
  private lastCoins = -1;

  private readonly fpsText: Text;
  private frames = 0;
  private windowStart = performance.now();
  private lastFpsLine = '';
  private enemyCount = 0;

  constructor() {
    const hpBg = new Graphics()
      .rect(0, 0, BAR_WIDTH, BAR_HEIGHT)
      .fill(COLORS.bgSurface)
      .stroke({ width: 1, color: COLORS.line });
    // 残像は赤バーの下層に敷き、減少で露出した区間だけが白く見える
    this.ghostFill = new Graphics()
      .rect(1, 1, BAR_WIDTH - 2, BAR_HEIGHT - 2)
      .fill(COLORS.textMain);
    this.hpFill = new Graphics()
      .rect(1, 1, BAR_WIDTH - 2, BAR_HEIGHT - 2)
      .fill(COLORS.hpRed);
    hpBg.position.set(8, 8);
    this.ghostFill.position.set(8, 8);
    this.hpFill.position.set(8, 8);

    // HP のすぐ下に細い EXP バー（§16。琥珀）
    const expBg = new Graphics()
      .rect(0, 0, BAR_WIDTH, EXP_HEIGHT)
      .fill(COLORS.bgSurface)
      .stroke({ width: 1, color: COLORS.line });
    this.expFill = new Graphics()
      .rect(0, 0, BAR_WIDTH, EXP_HEIGHT)
      .fill(COLORS.amber);
    expBg.position.set(8, 8 + BAR_HEIGHT + 3);
    this.expFill.position.set(8, 8 + BAR_HEIGHT + 3);
    this.expFill.scale.x = 0;

    this.levelText = new Text({
      text: 'Lv.1',
      style: { fontFamily: FONT_MONO, fontSize: 14, fill: COLORS.textMain, padding: 4 },
    });
    this.levelText.anchor.set(1, 0);

    // 残り時間（上部中央・等幅。§16）
    this.timerText = new Text({
      text: '',
      style: { fontFamily: FONT_MONO, fontSize: 18, fill: COLORS.textMain, padding: 4 },
    });
    this.timerText.anchor.set(0.5, 0);

    // ボスHPバー（§16: hpRed / 背景 line / 画面幅60%中央）。scale で幅を合わせ、再構築しない
    const bossBg = new Graphics()
      .rect(0, 0, BOSS_BAR_WIDTH, BOSS_BAR_HEIGHT)
      .fill(COLORS.line);
    this.bossFill = new Graphics()
      .rect(1, 1, BOSS_BAR_WIDTH - 2, BOSS_BAR_HEIGHT - 2)
      .fill(COLORS.hpRed);
    this.bossBar = new Container();
    this.bossBar.addChild(bossBg, this.bossFill);
    this.bossBar.visible = false;

    this.fpsText = new Text({
      text: '',
      style: { fontFamily: FONT_MONO, fontSize: 12, fill: COLORS.textDim, padding: 4 },
    });
    this.fpsText.anchor.set(0, 1);

    // 右下: このプレイで獲得予定のコイン（§16 のHUD図。所持コインではない）
    this.coinText = new Text({
      text: '',
      style: { fontFamily: FONT_MONO, fontSize: 14, fill: COLORS.amber, padding: 4 },
    });
    this.coinText.anchor.set(1, 1);

    this.container.addChild(
      hpBg,
      this.ghostFill,
      this.hpFill,
      expBg,
      this.expFill,
      this.levelText,
      this.timerText,
      this.bossBar,
      this.coinText,
      this.fpsText,
    );
  }

  /** このプレイで獲得予定のコイン（クリア補正なしの現在値） */
  setCoins(coins: number): void {
    if (coins === this.lastCoins) return;
    this.lastCoins = coins;
    this.coinText.text = `💰 ${coins}`;
  }

  setHp(hp: number, maxHp: number): void {
    const ratio = Math.max(0, hp / maxHp);
    if (ratio === this.lastHpRatio) return;
    if (ratio < this.lastHpRatio) {
      // 減少時のみ残像を保持する。回復時は露出させない（即座に追従）
      this.ghostHoldUntil = performance.now() + GHOST_HOLD_MS;
    } else {
      this.ghostRatio = ratio;
      this.ghostFill.scale.x = ratio;
    }
    this.lastHpRatio = ratio;
    this.hpFill.scale.x = ratio;
  }

  setExp(ratio: number): void {
    const clamped = Math.min(1, Math.max(0, ratio));
    if (clamped === this.lastExpRatio) return;
    this.lastExpRatio = clamped;
    this.expFill.scale.x = clamped;
  }

  setLevel(level: number): void {
    if (level === this.lastLevel) return;
    this.lastLevel = level;
    this.levelText.text = `Lv.${level}`;
  }

  /** 残り時間（秒）。text の代入は秒の値が変わった時のみ */
  setTime(remainSec: number): void {
    const sec = Math.max(0, Math.ceil(remainSec));
    if (sec !== this.lastTimerSec) {
      this.lastTimerSec = sec;
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      this.timerText.text = `${m}:${s < 10 ? '0' : ''}${s}`;
      // §16: 1:00 を切ったら琥珀色（点滅は render 側で alpha 切替）
      const blink = sec <= 60;
      if (blink !== this.timerBlinking) {
        this.timerBlinking = blink;
        this.timerText.style.fill = blink ? COLORS.amber : COLORS.textMain;
        this.timerText.alpha = 1;
      }
    }
  }

  /** ボスHPバー（§16）。ratio = null で非表示（撃破・未出現） */
  setBossHp(ratio: number | null): void {
    if (ratio === null) {
      this.bossBar.visible = false;
      this.lastBossRatio = -1;
      return;
    }
    this.bossBar.visible = true;
    const clamped = Math.max(0, Math.min(1, ratio));
    if (clamped === this.lastBossRatio) return;
    this.lastBossRatio = clamped;
    this.bossFill.scale.x = clamped;
  }

  /** DEV ビルドの性能検証用。表示は FPS と同じ 0.5s 間隔でまとめて更新する */
  setEnemyCount(count: number): void {
    this.enemyCount = count;
  }

  /** 毎フレーム呼ばれる。text の代入は値が変わった時だけ行う */
  render(): void {
    // HP残像: 保持時間を過ぎたら現在値へ滑らかに追いつく（§16）
    const ghostNow = performance.now();
    const ghostDt = Math.min((ghostNow - this.lastGhostNow) / 1000, 0.1);
    this.lastGhostNow = ghostNow;
    if (this.ghostRatio > this.lastHpRatio && ghostNow >= this.ghostHoldUntil) {
      this.ghostRatio = Math.max(
        this.lastHpRatio,
        this.ghostRatio - GHOST_DECAY_PER_SEC * ghostDt,
      );
      this.ghostFill.scale.x = this.ghostRatio;
    }

    // 残り1分の点滅は alpha の切替のみ（text 再代入なし）
    if (this.timerBlinking) {
      this.timerText.alpha = Math.floor(performance.now() / TIMER_BLINK_MS) % 2 === 0 ? 1 : 0.35;
    }

    this.frames++;
    const now = performance.now();
    const elapsed = now - this.windowStart;
    if (elapsed < FPS_INTERVAL_MS) return;

    const fps = Math.round((this.frames * 1000) / elapsed);
    const line = import.meta.env.DEV ? `FPS ${fps} | E ${this.enemyCount}` : `FPS ${fps}`;
    if (line !== this.lastFpsLine) {
      this.lastFpsLine = line;
      this.fpsText.text = line;
    }
    this.frames = 0;
    this.windowStart = now;
  }

  resize(width: number, height: number): void {
    this.levelText.position.set(width - 8, 8);
    this.timerText.position.set(width / 2, 8);
    this.coinText.position.set(width - 8, height - 8);
    this.fpsText.position.set(8, height - 8);
    // ボスHPバーは画面幅の60%・中央揃え（§16）
    this.bossBar.scale.x = (width * 0.6) / BOSS_BAR_WIDTH;
    this.bossBar.position.set(width * 0.2, 34);
  }
}
