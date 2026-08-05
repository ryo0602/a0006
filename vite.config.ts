import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // 全画像を content-hash 付きの実ファイルとして出す（Phase 6）。
    // データURIインライン化を許すと Pixi の Assets.load に data: が渡り、
    // ローダーの拡張子判定に依存してしまうため無効にする
    assetsInlineLimit: 0,
  },
});
