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
}

/** パッシブ合算後の補正値。パッシブ取得時にのみ再計算する（毎フレーム計算しない） */
export interface Modifiers {
  damageMul: number;
  cooldownMul: number;
  moveSpeedMul: number;
  pickupRangeMul: number;
  maxHpMul: number;
  regenPerSec: number;
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

/** リザルト画面へ渡すプレイ結果 */
export interface PlayResult {
  cleared: boolean;
  timeSec: number;
  kills: number;
  level: number;
  stageName: string;
  /** クリア済みかを反映した獲得コイン（§14。PlayScene が確定計算する） */
  coins: number;
}

/** キャラクター定義（src/data/characters.json の形。§7）。特性は「+x」の加算値 */
export interface CharacterDef {
  name: string;
  weapon: string;
  moveSpeedAdd?: number;
  maxHpAdd?: number;
  damageAdd?: number;
  pickupRangeAdd?: number;
  /** 解放条件。type: 'start' | 'clearStage' | 'coins'
   *  （JSON import は文字列リテラルを widening するため union にしない） */
  unlock: { type: string; stage?: string; cost?: number };
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
  bestTimeSec: number;
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
