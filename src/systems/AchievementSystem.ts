import achievementsData from '../data/achievements.json';
import challengesData from '../data/challenges.json';
import metaUpgradesData from '../data/metaUpgrades.json';
import type { AchievementDef, ChallengeDef, MetaUpgradeDef, PlayResult, SaveData } from '../types';

export const ACHIEVEMENTS: AchievementDef[] = achievementsData;
export const CHALLENGES: Record<string, ChallengeDef> = challengesData;
export const CHALLENGE_IDS = Object.keys(challengesData);

const META_DEFS: Record<string, MetaUpgradeDef> = metaUpgradesData;

/** リザルト画面に出す通知（新規達成・チャレンジ初回クリア） */
export interface UnlockNotice {
  name: string;
  reward: number;
}

/**
 * 実績・チャレンジの判定（§14 Phase 10）。
 * すべて**リザルト確定時に1回だけ**評価する（プレイ中のポーリングはしない。§13）。
 * 条件は achievements.json の宣言（fact 名と閾値）で、判定用の事実は
 * ここでセーブ + リザルトから算出する。実績のためにゲームルールは変えない。
 */
export class AchievementSystem {
  /**
   * リザルトをセーブへ反映して実績を判定する。呼び出し順の前提:
   * クリアによる解放系（clearedStages / dangerUnlocked / キャラ解放）を
   * 先に反映してから呼ぶこと（stage3Cleared 等の事実が同じ周で成立するように）。
   * 戻り値の報酬コインは呼び出し側が加算する。
   */
  applyResult(save: SaveData, result: PlayResult): { notices: UnlockNotice[]; rewardCoins: number } {
    const rs = result.runStats;
    const st = save.stats;

    // --- 累計・記録の更新（§14） ---
    st.totalRuns++;
    st.totalKills += result.kills;
    st.totalPlaytimeSec += result.timeSec;
    st.bestTimeSec = Math.max(st.bestTimeSec, result.timeSec);
    st.killsElite += rs.killsElite;
    st.crits += rs.crits;
    st.shieldBlocks += rs.shieldBlocks;
    for (const evoId of rs.evolvedIds) {
      if (!save.records.evolutionsSeen.includes(evoId)) {
        save.records.evolutionsSeen.push(evoId);
      }
    }
    if (result.cleared) {
      st.totalClears++;
      if (rs.bossKillSec > 0) {
        st.bestBossKillSec =
          st.bestBossKillSec === 0 ? rs.bossKillSec : Math.min(st.bestBossKillSec, rs.bossKillSec);
      }
      // 危険度記録・キャラ別クリアは通常プレイのみ（チャレンジはルールが違うため）
      if (result.challengeId === null) {
        st.bestDangerCleared = Math.max(st.bestDangerCleared, result.dangerLevel);
        if (!save.records.clearedCharacters.includes(result.characterId)) {
          save.records.clearedCharacters.push(result.characterId);
        }
      }
    }

    const notices: UnlockNotice[] = [];
    let rewardCoins = 0;

    // --- チャレンジ初回クリア（§13） ---
    if (result.cleared && result.challengeId !== null) {
      const def = CHALLENGES[result.challengeId];
      if (def !== undefined && !save.challengesCleared.includes(result.challengeId)) {
        save.challengesCleared.push(result.challengeId);
        notices.push({ name: `チャレンジ: ${def.name}`, reward: def.reward });
        rewardCoins += def.reward;
      }
    }

    // --- 実績判定 ---
    const facts = this.computeFacts(save, result);
    for (const def of ACHIEVEMENTS) {
      if (save.achievements.includes(def.id)) continue;
      if ((facts[def.fact] ?? 0) < def.min) continue;
      save.achievements.push(def.id);
      notices.push({ name: def.name, reward: def.reward });
      rewardCoins += def.reward;
    }

    return { notices, rewardCoins };
  }

  /** 実績の進捗表示用（実績画面）。fact の現在値を返す */
  factValue(save: SaveData, fact: string): number {
    return this.computeFacts(save, null)[fact] ?? 0;
  }

  /**
   * 判定用の事実。result = null は実績画面の進捗表示用で、ラン限定の事実は 0 になる。
   * coinsHeld は報酬加算前の値で評価される（達成が1周遅れることは許容する）
   */
  private computeFacts(save: SaveData, result: PlayResult | null): Record<string, number> {
    const st = save.stats;
    const rs = result?.runStats ?? null;
    const cleared = result?.cleared === true;
    const metaMaxed = Object.keys(META_DEFS).every(
      (id) => (save.metaUpgrades[id] ?? 0) >= META_DEFS[id].maxLevel,
    );
    return {
      totalKills: st.totalKills,
      totalClears: st.totalClears,
      totalRuns: st.totalRuns,
      playtimeSec: st.totalPlaytimeSec,
      killsElite: st.killsElite,
      crits: st.crits,
      shieldBlocks: st.shieldBlocks,
      bestDanger: st.bestDangerCleared,
      stage3Cleared: save.clearedStages.includes('stage3') ? 1 : 0,
      charsUnlocked: save.unlockedCharacters.length,
      charsCleared: save.records.clearedCharacters.length,
      evosSeen: save.records.evolutionsSeen.length,
      metaMaxed: metaMaxed ? 1 : 0,
      coinsHeld: save.coins,
      // ラン限定の事実
      runKills: result?.kills ?? 0,
      runLevel: result?.level ?? 0,
      runGems: rs?.gemsCollected ?? 0,
      runWeaponsMaxed: rs?.weaponsMaxed ?? 0,
      runEvolved: rs?.evolvedIds.length ?? 0,
      bossFast: cleared && rs !== null && rs.bossKillSec > 0 && rs.bossKillSec <= 30 ? 1 : 0,
      ironGuard: cleared && rs !== null && rs.hitsTaken <= 5 ? 1 : 0,
      minimalist: cleared && rs !== null && rs.weaponsOwned === 1 ? 1 : 0,
      noReroll: cleared && rs !== null && rs.rerollsUsed === 0 && rs.healPicks === 0 ? 1 : 0,
    };
  }
}
