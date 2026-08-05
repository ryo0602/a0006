import charactersData from '../data/characters.json';
import metaUpgradesData from '../data/metaUpgrades.json';
import stagesData from '../data/stages.json';
import type { MetaUpgradeDef, SaveData } from '../types';

const KEY = 'a0006_save_v1';

const META_DEFS: Record<string, MetaUpgradeDef> = metaUpgradesData;
const CHARACTER_IDS = Object.keys(charactersData);
const STAGE_IDS = stagesData.stages.map((s) => s.id);

/**
 * セーブの読み書き（§14）。読み込みは「何があっても初期値にフォールバック」を
 * 最優先にする（クラッシュさせない）。書き込みは変化があった時だけ呼ぶ
 * （リザルト確定・購入・解放時。毎フレーム書かない）。
 */
export class SaveManager {
  data: SaveData;

  constructor() {
    this.data = load();
  }

  save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // 容量超過・プライベートモード等の書き込み失敗はゲーム続行を優先して無視する
    }
  }
}

function defaultSave(): SaveData {
  return {
    version: 1,
    coins: 0,
    unlockedCharacters: ['runner'],
    clearedStages: [],
    metaUpgrades: {},
    stats: { totalKills: 0, totalPlaytimeSec: 0, bestTimeSec: 0 },
    lastCharacter: 'runner',
    dangerUnlocked: 0,
    lastDanger: 0,
  };
}

function load(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return defaultSave();
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return defaultSave();
    // バージョン不一致（将来の v2 等も含む）は仕様どおり初期値へ。
    // マイグレーションが必要になったらここで version ごとに分岐する
    if (parsed.version !== 1) return defaultSave();
    return normalize(parsed);
  } catch {
    // JSON 破損・localStorage 無効環境（プライベートモード等）も初期値で起動する
    return defaultSave();
  }
}

/**
 * 既知のフィールドだけを取り出して範囲をクランプする。
 * 部分的に壊れたセーブでも、読める部分は活かしてクラッシュを防ぐ。
 */
function normalize(raw: Record<string, unknown>): SaveData {
  const out = defaultSave();

  if (typeof raw.coins === 'number' && Number.isFinite(raw.coins)) {
    out.coins = Math.max(0, Math.floor(raw.coins));
  }

  if (Array.isArray(raw.unlockedCharacters)) {
    for (const id of raw.unlockedCharacters) {
      if (typeof id === 'string' && CHARACTER_IDS.includes(id) && !out.unlockedCharacters.includes(id)) {
        out.unlockedCharacters.push(id);
      }
    }
  }

  if (Array.isArray(raw.clearedStages)) {
    for (const id of raw.clearedStages) {
      if (typeof id === 'string' && STAGE_IDS.includes(id) && !out.clearedStages.includes(id)) {
        out.clearedStages.push(id);
      }
    }
  }

  if (isRecord(raw.metaUpgrades)) {
    for (const id of Object.keys(META_DEFS)) {
      const lv = raw.metaUpgrades[id];
      if (typeof lv === 'number' && Number.isFinite(lv)) {
        out.metaUpgrades[id] = Math.min(META_DEFS[id].maxLevel, Math.max(0, Math.floor(lv)));
      }
    }
  }

  if (isRecord(raw.stats)) {
    const s = raw.stats;
    if (typeof s.totalKills === 'number' && Number.isFinite(s.totalKills)) {
      out.stats.totalKills = Math.max(0, Math.floor(s.totalKills));
    }
    if (typeof s.totalPlaytimeSec === 'number' && Number.isFinite(s.totalPlaytimeSec)) {
      out.stats.totalPlaytimeSec = Math.max(0, s.totalPlaytimeSec);
    }
    if (typeof s.bestTimeSec === 'number' && Number.isFinite(s.bestTimeSec)) {
      out.stats.bestTimeSec = Math.max(0, s.bestTimeSec);
    }
  }

  if (typeof raw.lastCharacter === 'string' && out.unlockedCharacters.includes(raw.lastCharacter)) {
    out.lastCharacter = raw.lastCharacter;
  }

  // 危険度（§12 Phase 9）。0〜maxLevel にクランプし、選択値は解放範囲に収める
  const maxDanger = stagesData.danger.maxLevel;
  if (typeof raw.dangerUnlocked === 'number' && Number.isFinite(raw.dangerUnlocked)) {
    out.dangerUnlocked = Math.min(maxDanger, Math.max(0, Math.floor(raw.dangerUnlocked)));
  }
  if (typeof raw.lastDanger === 'number' && Number.isFinite(raw.lastDanger)) {
    out.lastDanger = Math.min(out.dangerUnlocked, Math.max(0, Math.floor(raw.lastDanger)));
  }

  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
