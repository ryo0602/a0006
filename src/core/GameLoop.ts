/** 固定タイムステップ 60Hz（§4.1） */
const FIXED_DT_MS = 1000 / 60;

/** update に渡す刻み（秒）。速度系の数値が px/s なので秒に統一する */
const FIXED_DT_SEC = FIXED_DT_MS / 1000;

/**
 * アキュムレータ方式の固定タイムステップループ（§4.1）。
 * 駆動は PixiJS の ticker に任せ、ここでは時間の積算と分配だけを行う。
 */
export class GameLoop {
  private accumulator = 0;

  constructor(
    private readonly update: (dtSec: number) => void,
    private readonly render: () => void,
  ) {}

  tick(deltaMS: number): void {
    // タブ復帰などの巨大デルタで一気に進まないよう 50ms でクランプ
    this.accumulator += Math.min(deltaMS, 50);

    let steps = 0;
    while (this.accumulator >= FIXED_DT_MS && steps < 3) {
      this.update(FIXED_DT_SEC);
      this.accumulator -= FIXED_DT_MS;
      steps++;
    }
    // 上限に達したら残余を捨てる。処理落ち時に遅延が蓄積してスパイラルするのを防ぐ
    if (steps === 3) {
      this.accumulator %= FIXED_DT_MS;
    }

    this.render();
  }

  /** ポーズ復帰時に呼ぶ。溜まった時間を持ち越さない */
  reset(): void {
    this.accumulator = 0;
  }
}
