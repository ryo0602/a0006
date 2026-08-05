import type { Container } from 'pixi.js';

/**
 * 入力の抽象化（§17）。ゲームロジックはこの形しか見ない。
 * moveX / moveY は正規化済みで、ベクトル長は常に 1 以下（アナログ入力対応）。
 */
export interface InputState {
  moveX: number;
  moveY: number;
}

/** プレイヤーのバランス数値（src/data/player.json の形。§7） */
export interface PlayerStats {
  maxHp: number;
  moveSpeed: number;
  hitRadius: number;
  pickupRadius: number;
  invincibleSec: number;
  flashSec: number;
  regenPerSec: number;
}

/** 敵1種のバランス数値（src/data/enemies.json の形。§11） */
export interface EnemyStats {
  name: string;
  hp: number;
  speed: number;
  contactDamage: number;
  radius: number;
  drop: string;
  /** boss のみ: ドロップ個数 */
  dropCount?: number;
  /** spitter のみ: 弾と距離維持AIのパラメータ */
  projectileDamage?: number;
  projectileSpeed?: number;
  projectileRadius?: number;
  fireCooldownSec?: number;
  keepDistance?: number;
}

/** 湧きテーブルの1ウェーブ（§12） */
export interface WaveDef {
  untilSec: number;
  perSec: number;
  /** 敵ID → 出現割合（合計 1.0）。JSON の推論（欠けたキーが undefined になる）を
   *  受けるため値は number | undefined とし、読む側で ?? 0 する */
  mix: Partial<Record<string, number>>;
}

/** ステージ定義（src/data/stages.json の形。§12） */
export interface StageDef {
  id: string;
  name: string;
  durationSec: number;
  bossAtSec: number;
  afterBossPerSec: number;
  difficultyMul: number;
  /** コイン専用のステージ係数（§14。難易度倍率とは独立） */
  coinMultiplier: number;
  waves: WaveDef[];
}

/** 経過時間による難易度倍率の伸び（§12） */
export interface DifficultyGrowth {
  hpPerMin: number;
  damagePerMin: number;
}

/** 武器レベルテーブルの型（src/data/weapons.json。§8 のベタ書きテーブル） */
export interface ShotLevel {
  damage: number;
  cooldownSec: number;
  count: number;
  speed: number;
  radius: number;
  lifeSec: number;
}

export interface OrbLevel {
  damage: number;
  count: number;
  orbitRadius: number;
  rotSpeedRad: number;
  hitIntervalSec: number;
  radius: number;
}

export interface ShurikenLevel extends ShotLevel {
  pierce: number;
}

export interface ThunderLevel {
  damage: number;
  cooldownSec: number;
  strikes: number;
  blastRadius: number;
}

export interface FlameLevel {
  damagePerTick: number;
  tickSec: number;
  range: number;
  arcDeg: number;
}

/** スピア（Phase 8）。向いている方向への刺突。ShurikenLevel と同形 */
export type SpearLevel = ShurikenLevel;

export interface AxeLevel {
  damage: number;
  cooldownSec: number;
  count: number;
  pierce: number;
  upSpeed: number;
  sideSpeed: number;
  gravity: number;
  radius: number;
  lifeSec: number;
}

export interface MineLevel {
  damage: number;
  cooldownSec: number;
  /** 同時設置数（§8: この武器の「弾数」に相当） */
  count: number;
  triggerRadius: number;
  blastRadius: number;
  armSec: number;
  lifeSec: number;
}

export type DroneLevel = ShotLevel;

/** パッシブ定義（src/data/passives.json。§9）。効果値は種類ごとに任意 */
export interface PassiveDef {
  name: string;
  maxLevel: number;
  damageAddPerLevel?: number;
  cooldownCutPerLevel?: number;
  cooldownCutCap?: number;
  moveSpeedAddPerLevel?: number;
  pickupRangeAddPerLevel?: number;
  maxHpAddPerLevel?: number;
  regenAddPerLevel?: number;
  critChancePerLevel?: number;
  areaAddPerLevel?: number;
  /** シールド（Phase 8）: チャージ間隔 = base - cut × Lv */
  shieldIntervalBase?: number;
  shieldIntervalCutPerLevel?: number;
}

/** パッシブ合算後の補正値。パッシブ取得時にのみ再計算する（毎フレーム計算しない） */
export interface Modifiers {
  damageMul: number;
  cooldownMul: number;
  moveSpeedMul: number;
  pickupRangeMul: number;
  maxHpMul: number;
  regenPerSec: number;
  /** クリティカル率（Phase 8）。applyDamage の一元窓口で判定する */
  critChance: number;
  /** 攻撃範囲倍率（Phase 8）。各武器が半径・射程に乗算する */
  areaMul: number;
  /** シールドのチャージ間隔秒（Phase 8）。0 はシールドなし */
  shieldIntervalSec: number;
}

/** レベルアップ3択の1候補（§13 / §10） */
export type LevelChoice =
  | { kind: 'weaponNew'; weaponId: string }
  | { kind: 'weaponUp'; weaponId: string }
  | { kind: 'passive'; passiveId: string }
  | { kind: 'evolution'; evolutionId: string }
  | { kind: 'heal' };

/** モーダル表示用に整形した1カード分のテキスト */
export interface ChoiceView {
  title: string;
  levelText: string;
  effectText: string;
  /** 進化カードは枠を琥珀色にする（§16） */
  evolved?: boolean;
}

/** 進化定義の共通部（src/data/evolutions.json。§10）。stats は進化ごとに型が異なる */
export interface EvolutionMeta {
  name: string;
  base: string;
  requiredPassive: string;
  requiredPassiveLevel: number;
}

/** 進化武器の数値（レベルなし単一 stats。§8 のレベルテーブルとは形式を分ける） */
export type GatlingStats = ShotLevel;

export interface SatelliteStats {
  damage: number;
  count: number;
  orbitRadiusInner: number;
  orbitRadiusOuter: number;
  rotSpeedRad: number;
  hitIntervalSec: number;
  radius: number;
}

export interface BoomerangStats {
  damage: number;
  cooldownSec: number;
  count: number;
  speed: number;
  radius: number;
  /** 往路の秒数。経過後にプレイヤーへ戻り始める */
  outSec: number;
}

export type StormStats = ThunderLevel;

export interface InfernoStats {
  damagePerTick: number;
  tickSec: number;
  range: number;
  /** 与ダメージのHP吸収率（§10: 5%） */
  lifestealRatio: number;
}

/** 1周のイベント駆動カウンタ（§13 Phase 10）。毎フレームのポーリングはしない */
export interface RunStats {
  /** 実際にHPが減った被弾回数（シールドで防いだ分は数えない。§9） */
  hitsTaken: number;
  shieldBlocks: number;
  crits: number;
  gemsCollected: number;
  rerollsUsed: number;
  healPicks: number;
  killsElite: number;
  /** クリア時のボス討伐秒（未クリア・未出現は 0） */
  bossKillSec: number;
  weaponsOwned: number;
  /** Lv5 到達数（進化済みは Lv5 を経由しているので含む） */
  weaponsMaxed: number;
  /** このランで所持している進化武器ID */
  evolvedIds: string[];
}

/** リザルト画面へ渡すプレイ結果 */
export interface PlayResult {
  cleared: boolean;
  timeSec: number;
  kills: number;
  level: number;
  stageName: string;
  /** クリア済みかを反映した獲得コイン（§14。PlayScene が確定計算する） */
  coins: number;
  /** Phase 10: 実績判定に使う付帯情報 */
  dangerLevel: number;
  characterId: string;
  challengeId: string | null;
  runStats: RunStats;
}

/** キャラクター定義（src/data/characters.json の形。§7）。特性は「+x」の加算値 */
export interface CharacterDef {
  name: string;
  weapon: string;
  moveSpeedAdd?: number;
  maxHpAdd?: number;
  damageAdd?: number;
  pickupRangeAdd?: number;
  /** Phase 9: 特性軸の拡張（§7。Modifiers に既にある軸のみ使う方針） */
  critChanceAdd?: number;
  areaAdd?: number;
  shieldIntervalSec?: number;
  /** シールドを開始時にチャージ済みで持つ（paladin。§7 唯一の bool 特性） */
  shieldStart?: boolean;
  /** 解放条件。type: 'start' | 'clearStage' | 'coins'
   *  （JSON import は文字列リテラルを widening するため union にしない） */
  unlock: { type: string; stage?: string; cost?: number };
}

/** 危険度テーブル（stages.json の danger。§12 Phase 9）。危険度0 = 現行バランス */
export interface DangerDef {
  maxLevel: number;
  hpMulPerLevel: number;
  damageMulPerLevel: number;
  /** エリート敵（tank_z / spitter）の抽選重み倍率。レートは上げず質で上げる */
  eliteWeightPerLevel: number;
  coinMulPerLevel: number;
  eliteTypes: string[];
}

/** メタ強化定義（src/data/metaUpgrades.json の形。§14）。
 *  stat: 'maxHp' | 'damage' | 'moveSpeed' | 'regen' | 'startLevel' | 'reroll'
 *  （JSON import は文字列リテラルを widening するため union にしない） */
export interface MetaUpgradeDef {
  name: string;
  stat: string;
  addPerLevel: number;
  maxLevel: number;
  baseCost: number;
}

/** セーブデータ（§14。localStorage キー a0006_save_v1） */
export interface SaveStats {
  totalKills: number;
  totalPlaytimeSec: number;
  /** 形骸化フィールド（5分固定制では常に270）。互換のため残置し、表示には使わない（Phase 10） */
  bestTimeSec: number;
  totalClears: number;
  totalRuns: number;
  killsElite: number;
  crits: number;
  shieldBlocks: number;
  /** 最短ボス討伐秒（0 = 未記録。bestTimeSec の置き換え。Phase 10） */
  bestBossKillSec: number;
  /** クリアした最高危険度（-1 = 未クリア） */
  bestDangerCleared: number;
}

/** 図鑑系の記録（§14 Phase 10） */
export interface SaveRecords {
  clearedCharacters: string[];
  evolutionsSeen: string[];
}

export interface SaveData {
  version: 1;
  coins: number;
  unlockedCharacters: string[];
  clearedStages: string[];
  metaUpgrades: Record<string, number>;
  stats: SaveStats;
  /** 前回選択キャラ（§14 承認済みの追加フィールド） */
  lastCharacter: string;
  /** 解放済みの最大危険度（§12 Phase 9。0〜maxLevel） */
  dangerUnlocked: number;
  /** 前回選択した危険度 */
  lastDanger: number;
  /** 達成済み実績ID（§14 Phase 10。報酬は達成時に1回だけ付与） */
  achievements: string[];
  /** クリア済みチャレンジID（§14 Phase 10） */
  challengesCleared: string[];
  records: SaveRecords;
}

/** 実績定義（src/data/achievements.json。§14 Phase 10）。
 *  fact: AchievementSystem が算出する事実の名前。value >= min で達成 */
export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  category: string;
  fact: string;
  min: number;
  reward: number;
}

/** チャレンジ定義（src/data/challenges.json。§13 Phase 10）。修飾子は実行時オーバーレイで、
 *  基準バランスの数値には触れない。危険度は 0 固定 */
export interface ChallengeDef {
  name: string;
  desc: string;
  stage: string;
  reward: number;
  /** 湧きテーブルの内訳を全ウェーブで差し替える */
  mixOverride?: Record<string, number>;
  rateMul?: number;
  enemyHpMul?: number;
  /** メタ強化適用後に上書きする開始HP（ガラスの体） */
  playerHp?: number;
  /** 新規武器の取得候補を出さない（一本槍） */
  weaponNewDisabled?: boolean;
}

/** プレイ開始時の構成（キャラ特性 × メタ強化を合成済み。パッシブは含まない） */
export interface RunSetup {
  stage: StageDef;
  characterId: string;
  initialWeapon: string;
  /** キャラ × メタの基底補正。パッシブはこの上に乗算される（適用順序の定義） */
  base: Modifiers;
  startLevel: number;
  extraRerolls: number;
  /** EXP獲得倍率（§14 meta_exp）。パッシブに対応枠がないためここに持つ */
  expGainMul: number;
  /** 解放済み武器ID（§8 Phase 8: 新武器はステージクリアで解放されるまで候補に出ない） */
  unlockedWeapons: string[];
  /** 選択中の危険度（§12 Phase 9）。係数の算出は stages.json の danger テーブルから行う */
  dangerLevel: number;
  /** シールドを開始時にチャージ済みで持つ（paladin。§7 Phase 9） */
  shieldStart: boolean;
  /** チャレンジ実行時の修飾子（§13 Phase 10）。null = 通常プレイ。危険度は 0 固定 */
  challenge: { id: string; def: ChallengeDef } | null;
}

/**
 * シーンの共通インターフェース。update は固定タイムステップ（秒）で呼ばれ、
 * render は毎フレーム1回呼ばれる（§4.1）。補間はしない方針のため
 * render 側では見た目の同期のみを行う。
 */
export interface Scene {
  readonly container: Container;
  update(dtSec: number): void;
  render(): void;
  resize(width: number, height: number): void;
  destroy(): void;
}
