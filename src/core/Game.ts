import type { Application } from 'pixi.js';
import charactersData from '../data/characters.json';
import metaUpgradesData from '../data/metaUpgrades.json';
import stagesData from '../data/stages.json';
import weaponsData from '../data/weapons.json';
import { AchievementScene, AchievementView } from '../scenes/AchievementScene';
import { PlayScene } from '../scenes/PlayScene';
import { ResultScene } from '../scenes/ResultScene';
import { StageSelectScene, StageSelectView } from '../scenes/StageSelectScene';
import { TitleScene } from '../scenes/TitleScene';
import { UpgradeScene, UpgradeView, META_IDS } from '../scenes/UpgradeScene';
import { AchievementSystem, ACHIEVEMENTS, CHALLENGES, CHALLENGE_IDS } from '../systems/AchievementSystem';
import { WEAPON_IDS } from '../systems/WeaponSystem';
import { SaveManager } from '../save/SaveManager';
import { GameLoop } from './GameLoop';
import { InputManager } from './Input';
import { initInputMode } from './inputMode';
import { SceneManager } from './SceneManager';
import type { CharacterDef, MetaUpgradeDef, Modifiers, PlayResult, RunSetup, StageDef } from '../types';

const CHARACTERS: Record<string, CharacterDef> = charactersData;
const CHARACTER_IDS = Object.keys(charactersData);
const META_DEFS: Record<string, MetaUpgradeDef> = metaUpgradesData;

/**
 * 全体の統括（§3）。シーンフローは §5:
 * Title → StageSelect（⇄ Upgrade）→ Play → Result → StageSelect。
 * 進行状態（コイン・解放・メタ強化）は SaveManager 経由で localStorage に永続化する（§14）。
 */
export class Game {
  private readonly loop: GameLoop;
  private readonly input = new InputManager();
  private readonly scenes = new SceneManager();
  private readonly save = new SaveManager();
  private readonly achievements = new AchievementSystem();

  private title!: TitleScene;
  private stageSelect!: StageSelectScene;
  private upgrade!: UpgradeScene;
  private play!: PlayScene;
  private result!: ResultScene;
  private achievementScene!: AchievementScene;

  private currentStageIndex = 0;
  private selectedCharacter = this.save.data.lastCharacter;
  /** 選択中の危険度（§12 Phase 9）。セーブの lastDanger から復元する */
  private selectedDanger = this.save.data.lastDanger;

  constructor(private readonly app: Application) {
    this.loop = new GameLoop(
      (dtSec) => this.scenes.update(dtSec),
      () => this.scenes.render(),
    );
    app.stage.addChild(this.scenes.root);
  }

  start(): void {
    this.input.attach();
    // 入力モードの自動判定（§17 Phase 10 改修）。シーン生成前に開始する
    initInputMode();

    // resizeTo: window の実際の反映は renderer の resize イベントで受ける
    this.app.renderer.on('resize', (width: number, height: number) => {
      this.scenes.resize(width, height);
    });
    this.scenes.resize(this.app.screen.width, this.app.screen.height);

    // 全シーンを一度だけ生成し、以降は使い回す（プールもリトライをまたいで再利用）
    this.play = new PlayScene(this.app, this.input, {
      onFinished: (result) => this.onFinished(result),
      onRetire: () => this.toStageSelect(),
      onResume: () => this.loop.reset(),
    });
    this.title = new TitleScene(() => this.toStageSelect());
    this.stageSelect = new StageSelectScene({
      onSelectStage: (stage, index) => {
        this.currentStageIndex = index;
        this.play.startStage(this.buildSetup(stage));
        this.scenes.change(this.play);
      },
      onSelectCharacter: (id) => this.onSelectCharacter(id),
      onChangeDanger: (delta) => this.onChangeDanger(delta),
      onOpenUpgrade: () => this.toUpgrade(),
      onOpenAchievements: () => this.toAchievements(),
    });
    this.upgrade = new UpgradeScene({
      onPurchase: (id) => this.onPurchase(id),
      onBack: () => this.toStageSelect(),
    });
    this.achievementScene = new AchievementScene({
      onBack: () => this.toStageSelect(),
      onStartChallenge: (id) => this.startChallenge(id),
    });
    this.result = new ResultScene(() => this.toStageSelect());

    this.scenes.change(this.title);

    // ticker のコールバック引数は Ticker インスタンス（§18-3）。
    // autoTick が false の間は手動 tick（デバッグAPI）だけがゲームを進める（計測の決定性担保）
    this.app.ticker.add((ticker) => {
      if (this.loop.autoTick) this.loop.tick(ticker.deltaMS);
    });

    if (import.meta.env.DEV) {
      // 検証用フック。動的 import ごと本番ビルドから除去される
      void import('./debug').then(({ attachDebug }) =>
        attachDebug(this.loop, this.play, this.app, this),
      );
    }

    // タブ非アクティブで自動ポーズ（§5）。ポーズUIを出してからループを止め、
    // 復帰時は溜まったデルタを持ち越さない
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.play.autoPause();
        this.app.ticker.stop();
      } else {
        this.loop.reset();
        this.app.ticker.start();
      }
    });
  }

  // ---- プレイ結果の確定（§14） ----

  private onFinished(result: PlayResult): void {
    const data = this.save.data;
    data.coins += result.coins;

    // クリアによる解放系。チャレンジはルールが違うため進行（ステージ・危険度・キャラ解放）に
    // 影響させない（§13 Phase 10）
    if (result.cleared && result.challengeId === null) {
      // 危険度の解放（§12 Phase 9）: 危険度 n でクリアすると n+1 が解放される
      data.dangerUnlocked = Math.max(
        data.dangerUnlocked,
        Math.min(stagesData.danger.maxLevel, this.selectedDanger + 1),
      );
      const stageId = stagesData.stages[this.currentStageIndex].id;
      if (!data.clearedStages.includes(stageId)) {
        data.clearedStages.push(stageId);
      }
      // ステージクリア条件のキャラ解放（§7）
      for (const id of CHARACTER_IDS) {
        const unlock = CHARACTERS[id].unlock;
        if (
          unlock.type === 'clearStage' &&
          unlock.stage !== undefined &&
          data.clearedStages.includes(unlock.stage) &&
          !data.unlockedCharacters.includes(id)
        ) {
          data.unlockedCharacters.push(id);
        }
      }
    }

    // §14 Phase 10: 累計更新と実績・チャレンジ判定（解放系を反映した後に1回だけ）
    const { notices, rewardCoins } = this.achievements.applyResult(data, result);
    data.coins += rewardCoins;

    this.save.save();

    this.result.show(result, notices);
    this.scenes.change(this.result);
  }

  // ---- キャラ選択・購入解放（§7） ----

  private onSelectCharacter(id: string): void {
    const def = CHARACTERS[id];
    if (def === undefined) return;
    const data = this.save.data;

    if (!data.unlockedCharacters.includes(id)) {
      // コイン解放（sniper）だけはここで購入できる。他の未解放は無視
      const unlock = def.unlock;
      if (unlock.type !== 'coins' || unlock.cost === undefined) return;
      if (data.coins < unlock.cost) return;
      data.coins -= unlock.cost;
      data.unlockedCharacters.push(id);
    }

    this.selectedCharacter = id;
    data.lastCharacter = id;
    this.save.save();
    this.stageSelect.refresh(this.buildStageSelectView());
  }

  // ---- 危険度選択（§12 Phase 9） ----

  private onChangeDanger(delta: number): void {
    const next = Math.min(
      this.save.data.dangerUnlocked,
      Math.max(0, this.selectedDanger + delta),
    );
    if (next === this.selectedDanger) return;
    this.selectedDanger = next;
    this.save.data.lastDanger = next;
    this.save.save();
    this.stageSelect.refresh(this.buildStageSelectView());
  }

  // ---- 恒常強化（§14） ----

  private onPurchase(id: string): void {
    const def = META_DEFS[id];
    if (def === undefined) return;
    const data = this.save.data;
    const level = data.metaUpgrades[id] ?? 0;
    if (level >= def.maxLevel) return;
    const cost = def.baseCost * (level + 1); // §14: Lv n の購入コスト = base × n
    if (data.coins < cost) return;
    data.coins -= cost;
    data.metaUpgrades[id] = level + 1;
    this.save.save();
    this.upgrade.refresh(this.buildUpgradeView());
  }

  // ---- 画面遷移とビュー構築 ----

  private toStageSelect(): void {
    this.stageSelect.refresh(this.buildStageSelectView());
    this.scenes.change(this.stageSelect);
  }

  private toUpgrade(): void {
    this.upgrade.refresh(this.buildUpgradeView());
    this.scenes.change(this.upgrade);
  }

  // ---- 実績・チャレンジ（§14 / §13 Phase 10） ----

  private toAchievements(): void {
    this.achievementScene.refresh(this.buildAchievementView());
    this.scenes.change(this.achievementScene);
  }

  private buildAchievementView(): AchievementView {
    const data = this.save.data;
    return {
      stats: {
        totalKills: data.stats.totalKills,
        totalClears: data.stats.totalClears,
        totalRuns: data.stats.totalRuns,
        playtimeSec: data.stats.totalPlaytimeSec,
        bestBossKillSec: data.stats.bestBossKillSec,
      },
      rows: ACHIEVEMENTS.map((def) => ({
        def,
        achieved: data.achievements.includes(def.id),
        progress: Math.min(def.min, this.achievements.factValue(data, def.fact)),
      })),
      challenges: CHALLENGE_IDS.map((id) => ({
        id,
        def: CHALLENGES[id],
        cleared: data.challengesCleared.includes(id),
      })),
      // チャレンジはステージ3クリアで解放（§13 Phase 10）
      challengesUnlocked: data.clearedStages.includes('stage3'),
    };
  }

  /** チャレンジ開始（§13 Phase 10）。危険度は 0 固定 */
  private startChallenge(id: string): void {
    const def = CHALLENGES[id];
    if (def === undefined || !this.save.data.clearedStages.includes('stage3')) return;
    const stageIndex = stagesData.stages.findIndex((s) => s.id === def.stage);
    if (stageIndex < 0) return;
    this.currentStageIndex = stageIndex;
    const setup = this.buildSetup(stagesData.stages[stageIndex]);
    setup.dangerLevel = 0;
    setup.challenge = { id, def };
    this.play.startStage(setup);
    this.scenes.change(this.play);
  }

  /** ステージ解放数はセーブの clearedStages から導出する（§12 / §14） */
  private unlockedStageCount(): number {
    let count = 1;
    for (let i = 1; i < stagesData.stages.length; i++) {
      if (this.save.data.clearedStages.includes(stagesData.stages[i - 1].id)) {
        count = i + 1;
      } else {
        break;
      }
    }
    return count;
  }

  private buildStageSelectView(): StageSelectView {
    const data = this.save.data;
    // 選択中キャラが未解放（壊れたセーブ等）なら runner に戻す
    if (!data.unlockedCharacters.includes(this.selectedCharacter)) {
      this.selectedCharacter = 'runner';
    }
    return {
      unlockedStages: this.unlockedStageCount(),
      coins: data.coins,
      danger: this.selectedDanger,
      dangerUnlocked: data.dangerUnlocked,
      dangerMax: stagesData.danger.maxLevel,
      characters: CHARACTER_IDS.map((id) => {
        const def = CHARACTERS[id];
        return {
          id,
          name: def.name,
          traitText: traitText(def),
          unlocked: data.unlockedCharacters.includes(id),
          selected: id === this.selectedCharacter,
          lockText: lockText(def),
        };
      }),
    };
  }

  private buildUpgradeView(): UpgradeView {
    const data = this.save.data;
    const allMetaMaxed = META_IDS.every(
      (id) => (data.metaUpgrades[id] ?? 0) >= META_DEFS[id].maxLevel,
    );
    return {
      coins: data.coins,
      levels: data.metaUpgrades,
      // カンスト検知: 全メタ強化が最大 かつ sniper 解放済み
      allMaxed: allMetaMaxed && data.unlockedCharacters.includes('sniper'),
    };
  }

  /**
   * プレイ開始時の構成。補正の適用順序は
   * 「基礎値 × (1+キャラ特性) × (1+Σメタ強化) × (1+Σパッシブ)」で、
   * ここではキャラ × メタまでを合成する（パッシブは PlayScene が乗せる）。
   */
  private buildSetup(stage: StageDef): RunSetup {
    const char = CHARACTERS[this.selectedCharacter];
    const meta = this.save.data.metaUpgrades;
    const metaAdd = (id: string): number => (meta[id] ?? 0) * META_DEFS[id].addPerLevel;

    const base: Modifiers = {
      damageMul: (1 + (char.damageAdd ?? 0)) * (1 + metaAdd('meta_power')),
      cooldownMul: 1,
      moveSpeedMul: (1 + (char.moveSpeedAdd ?? 0)) * (1 + metaAdd('meta_speed')),
      pickupRangeMul: (1 + (char.pickupRangeAdd ?? 0)) * (1 + metaAdd('meta_magnet')),
      maxHpMul: (1 + (char.maxHpAdd ?? 0)) * (1 + metaAdd('meta_hp')),
      // 回復は実数値/秒の加算（§14 meta_regen。キャラ特性にはない）
      regenPerSec: metaAdd('meta_regen'),
      // クリティカル・エリア・シールドはキャラ特性（§7 Phase 9）とパッシブの軸
      critChance: char.critChanceAdd ?? 0,
      areaMul: 1 + (char.areaAdd ?? 0),
      shieldIntervalSec: char.shieldIntervalSec ?? 0,
    };

    // §8 Phase 8: 新武器はステージクリアで解放。未解放はレベルアップ候補に出ない
    const unlockedWeapons = WEAPON_IDS.filter((id) => {
      const stageId = (weaponsData as Record<string, { unlockStage?: string }>)[id].unlockStage;
      return stageId === undefined || this.save.data.clearedStages.includes(stageId);
    });

    return {
      stage,
      characterId: this.selectedCharacter,
      initialWeapon: char.weapon,
      base,
      startLevel: 1 + (meta.meta_start ?? 0),
      extraRerolls: meta.meta_reroll ?? 0,
      expGainMul: 1 + metaAdd('meta_exp'),
      unlockedWeapons,
      dangerLevel: this.selectedDanger,
      shieldStart: char.shieldStart ?? false,
      challenge: null,
    };
  }
}

/** キャラ特性の表示テキスト（§16: 数値必須） */
function traitText(def: CharacterDef): string {
  const parts: string[] = [];
  if (def.moveSpeedAdd !== undefined) parts.push(`速度${pct(def.moveSpeedAdd)}`);
  if (def.maxHpAdd !== undefined) parts.push(`HP${pct(def.maxHpAdd)}`);
  if (def.damageAdd !== undefined) parts.push(`攻撃${pct(def.damageAdd)}`);
  if (def.pickupRangeAdd !== undefined) parts.push(`取得${pct(def.pickupRangeAdd)}`);
  if (def.critChanceAdd !== undefined) parts.push(`クリ率${pct(def.critChanceAdd)}`);
  if (def.areaAdd !== undefined) parts.push(`範囲${pct(def.areaAdd)}`);
  if (def.shieldIntervalSec !== undefined) parts.push(`シールド持ち`);
  const weaponName = (weaponsData as Record<string, { name: string }>)[def.weapon]?.name ?? def.weapon;
  return `${parts.join(' / ')}\n初期武器: ${weaponName}`;
}

function pct(v: number): string {
  return `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
}

function lockText(def: CharacterDef): string {
  if (def.unlock.type === 'clearStage') {
    const num = def.unlock.stage?.replace('stage', '') ?? '?';
    return `ステージ${num}クリアで解放`;
  }
  if (def.unlock.type === 'coins') return `コイン${def.unlock.cost}で解放 (決定キーで購入)`;
  return '';
}
