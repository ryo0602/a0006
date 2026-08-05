/**
 * 固定容量の汎用オブジェクトプール（§4.3）。
 * 起動時に全量をプリウォームし、プレイ中の new を完全に排除する。
 * 容量を超えた acquire は null を返し、呼び出し側がスキップする
 * （§15「超過分はスポーンをスキップ」がこの容量制限で自然に実現される）。
 */
export class ObjectPool<T> {
  private readonly items: T[] = [];

  constructor(factory: () => T, capacity: number) {
    for (let i = 0; i < capacity; i++) {
      this.items.push(factory());
    }
  }

  acquire(): T | null {
    return this.items.pop() ?? null;
  }

  release(item: T): void {
    this.items.push(item);
  }
}
