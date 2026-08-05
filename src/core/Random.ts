/**
 * シード付き乱数（mulberry32）。Math.random と違いシードを固定すれば
 * 同じ系列を再現できるため、デバッグ時の性能検証やバグ再現に使う。
 */
export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** [0, 1) の一様乱数 */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min, max) の一様乱数 */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
}
