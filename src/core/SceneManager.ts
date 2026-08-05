import { Container } from 'pixi.js';
import type { Scene } from '../types';

/**
 * シーンの切り替えを担う（§3）。Phase 1 は PlayScene のみだが、
 * Phase 2 以降のゲームオーバー遷移を見越して骨格を用意しておく。
 */
export class SceneManager {
  readonly root = new Container();

  private current: Scene | null = null;
  private width = 0;
  private height = 0;

  change(next: Scene): void {
    if (this.current) {
      // シーンの寿命は所有者（Game）が管理する。リトライで PlayScene を
      // 使い回すため、切替時にはステージから外すだけで破棄しない
      this.root.removeChild(this.current.container);
    }
    this.current = next;
    this.root.addChild(next.container);
    next.resize(this.width, this.height);
  }

  update(dtSec: number): void {
    this.current?.update(dtSec);
  }

  render(): void {
    this.current?.render();
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.current?.resize(width, height);
  }
}
