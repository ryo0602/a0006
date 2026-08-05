import { Application } from 'pixi.js';
import stagesData from './data/stages.json';
import { Game } from './core/Game';
import { loadCharacterSprites, loadStageBackgrounds } from './core/sprites';
import { loadPrompts, loadUiPanel } from './ui/prompts';
import { COLORS } from './ui/theme';

// PixiJS v8 は初期化が非同期（§18-1）
const app = new Application();
await app.init({
  resizeTo: window,
  background: COLORS.bgDeep,
  antialias: false,
  resolution: Math.min(window.devicePixelRatio, 2),
  autoDensity: true,
});
document.body.appendChild(app.canvas); // app.view は v8 で非推奨（§18-2）

// キー表記アイコン・キャラ画像・ステージ背景はUI・シーン構築前に読み込んでおく（§18-4）
await loadPrompts();
await loadUiPanel();
await loadCharacterSprites();
await loadStageBackgrounds(stagesData.stages.map((s) => s.id));

new Game(app).start();
