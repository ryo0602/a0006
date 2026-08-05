import levelingData from '../data/leveling.json';

/**
 * 経験値とレベルアップ（§13）。
 * 必要EXP: expBase + (level - 1) * expPerLevel + floor(level / 5) * expStepEvery5
 * 大量EXPで複数レベル分溜まった場合は pendingLevels に積み、モーダルを連続表示する。
 */
export class LevelSystem {
  level = 1;
  exp = 0;
  /** モーダル未消化のレベルアップ数 */
  pendingLevels = 0;
  /** 残りリロール回数（§13: 1プレイにつき3回 + meta_reroll） */
  rerolls = levelingData.rerollsPerRun;
  /** EXP獲得倍率（§14 meta_exp。1 + 0.1×Lv） */
  expMul = 1;

  requiredExp(level: number): number {
    return (
      levelingData.expBase +
      (level - 1) * levelingData.expPerLevel +
      Math.floor(level / 5) * levelingData.expStepEvery5
    );
  }

  addExp(amount: number): void {
    this.exp += amount * this.expMul;
    while (this.exp >= this.requiredExp(this.level)) {
      this.exp -= this.requiredExp(this.level);
      this.level++;
      this.pendingLevels++;
    }
  }

  /** HUD の EXP バー用（0〜1） */
  expRatio(): number {
    return this.exp / this.requiredExp(this.level);
  }

  /**
   * startLevel: 1 + meta_start（§14）。開始分の選択はモーダルで行うため
   * pendingLevels に積む（プレイ開始直後に連続表示される）。
   * extraRerolls: meta_reroll の加算分。expMul: meta_exp の倍率。
   */
  reset(startLevel = 1, extraRerolls = 0, expMul = 1): void {
    this.level = startLevel;
    this.exp = 0;
    this.pendingLevels = Math.max(0, startLevel - 1);
    this.rerolls = levelingData.rerollsPerRun + extraRerolls;
    this.expMul = expMul;
  }
}
