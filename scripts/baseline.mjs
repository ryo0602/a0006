/**
 * バランス基準線の自動計測（npm run baseline）。
 *
 * dev サーバーとヘッドレス Chrome を自前で起動し、決定的な自動プレイ
 * （シード付きゲームRNG + シード付きピック抽選）で
 * {runner, tank, sniper} × {メタなし, フルメタ} × 複数シードを実測する。
 * 結果は docs/baseline.json に保存し、前回値との差分を表示する。
 *
 * 事故防止の要: localStorage は毎回クリアして明示的にセーブを注入する
 * （Phase 7 で「フルメタセーブの暗黙引き継ぎ」により基準値が汚染された反省）。
 *
 * 依存: Node 22+（fetch / WebSocket 内蔵）と Chrome/Chromium のみ。npm パッケージは使わない。
 * ボットの腕は人間より劣る（特に接触武器のかすらせ）。絶対値ではなく
 * **前回との差分**を見るための計測である。
 */
import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PATH = join(ROOT, 'docs', 'baseline.json');
const VITE_PORT = 5199;
const CDP_PORT = 9223;
const SEEDS = (process.env.BASELINE_SEEDS ?? '101,202,303').split(',').map(Number);
const RATE = 0.75; // 回収率の仮定（ボットの回収は人間より低いため補正注入する）

const leveling = JSON.parse(readFileSync(join(ROOT, 'src/data/leveling.json'), 'utf8'));

// 平均ジェム価値/キル。2.4 は gem_small=2 時代の実測に基づく基準で、
// ジェム価値を一律スケールするバランス変更に計測が追随するよう gem_small 比で換算する
const GEM_AVG_PER_KILL = 2.4 * (leveling.gemExp.gem_small / 2);

const CHARS = [
  { id: 'runner', engage: 180 },
  { id: 'tank', engage: 100 }, // 接触武器（オーブ）は敵を引き付けるグレイズ動作
  { id: 'sniper', engage: 180 },
];
const METAS = {
  none: {},
  full: {
    meta_hp: 10,
    meta_power: 10,
    meta_speed: 5,
    meta_regen: 5,
    meta_start: 3,
    meta_reroll: 3,
    meta_exp: 5,
    meta_magnet: 5,
  },
};

function findChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  if (process.platform === 'win32') {
    for (const p of [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    ]) {
      if (existsSync(p)) return p;
    }
    throw new Error('Chrome が見つかりません（CHROME_BIN で指定可能）');
  }
  for (const bin of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']) {
    try {
      execSync(`command -v ${bin}`, { stdio: 'pipe' });
      return bin;
    } catch {
      /* 次の候補へ */
    }
  }
  throw new Error('Chrome が見つかりません（CHROME_BIN で指定可能）');
}

const children = [];
function cleanup() {
  for (const c of children) {
    try {
      process.kill(-c.pid);
    } catch {
      try {
        c.kill();
      } catch {
        /* 終了済み */
      }
    }
  }
}
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(130));

async function waitHttp(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status < 500) return;
    } catch {
      /* リトライ */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`起動待ちタイムアウト: ${url}`);
}

// ---- CDP の薄いクライアント ----
async function openTab(url) {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?` + encodeURIComponent(url), {
    method: 'PUT',
  });
  const target = await res.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id !== undefined && pending.has(m.id)) {
      pending.get(m.id).resolve(m);
      pending.delete(m.id);
    }
  };
  // タブがクラッシュすると応答が永久に来ず全体がハングする（実測で発生）。
  // close で全ペンディングを棄却し、タイムアウトと合わせて呼び出し側のリトライに委ねる
  ws.onclose = () => {
    for (const p of pending.values()) p.reject(new Error('CDP WebSocket closed'));
    pending.clear();
  };
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++msgId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP応答タイムアウト: ${method}`));
      }, 30000);
      pending.set(id, {
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evalp = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) {
      throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
    }
    return r.result?.result?.value;
  };
  // タブ死亡後の close 失敗で本来の例外を握り潰さないよう、close 自体は失敗を無視する
  const close = () => send('Target.closeTarget', { targetId: target.id }).catch(() => {});
  return { send, evalp, close };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildSave(charId, metaKey) {
  return JSON.stringify({
    version: 1,
    coins: 0,
    unlockedCharacters: ['runner', 'tank', 'sniper'],
    clearedStages: ['stage1'],
    metaUpgrades: METAS[metaKey],
    stats: { totalKills: 0, totalPlaytimeSec: 0, bestTimeSec: 0 },
    lastCharacter: charId,
    dangerUnlocked: 0,
    lastDanger: 0,
  });
}

/** 1周ぶんの自動プレイ。ページ内オートパイロットを注入して手動tickで駆動する */
async function runOne(charId, metaKey, seed, engage) {
  const tab = await openTab(`http://localhost:${VITE_PORT}/?seed=${seed}`);
  try {
    await tab.send('Page.enable');
    await tab.send('Page.navigate', { url: `http://localhost:${VITE_PORT}/?seed=${seed}` });
    await sleep(2200);
    // 事故防止の要: 毎回クリアして明示注入（暗黙の引き継ぎを構造的に排除する）。
    // ナビゲーション直後は評価コンテキストが未確定のことがあるためリトライする
    const inject = `localStorage.clear(); localStorage.setItem('a0006_save_v1', ${JSON.stringify(buildSave(charId, metaKey))}); 'ok'`;
    let injected = false;
    for (let i = 0; i < 10 && !injected; i++) {
      try {
        await tab.evalp(inject);
        injected = true;
      } catch {
        await sleep(500);
      }
    }
    if (!injected) throw new Error('セーブ注入に失敗');
    await tab.send('Page.navigate', { url: `http://localhost:${VITE_PORT}/?seed=${seed}` });
    await sleep(2200);
    for (let i = 0; i < 20 && !(await tab.evalp('!!window.__debug')); i++) await sleep(500);

    // 決定性の要: rAF の自動駆動を止め、以降のゲーム進行を手動 tick（固定50ms刻み）のみにする。
    // これがないと eval の往復や sleep の間にゲームが実時間で進み、
    // 同一シードでも結果がマシン負荷に依存して揺れる（シード付きRNGだけでは決定性が保てない）
    await tab.evalp(`window.__debug.setAutoTick(false); 'off'`);

    const key = (c) => tab.evalp(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'${c}'})); 'k'`);
    await key('Enter');
    await sleep(300);
    await key('Digit1');
    await sleep(300);

    await tab.evalp(autopilotSource(engage, seed));

    let last = null;
    for (let t = 30; t <= 420 && (last === null || !last.finished); t += 30) {
      last = await tab.evalp(`window.__auto.step(${t})`);
    }
    for (let extra = 0; extra < 6 && last && !last.finished; extra++) {
      last = await tab.evalp(`window.__auto.step(${last.elapsedSec + 30})`);
    }
    const coins = await tab.evalp('window.__debug.saveState().coins');
    return {
      char: charId,
      meta: metaKey,
      seed,
      cleared: last ? last.finished && last.playerHp > 0 : false,
      level: last?.level ?? 0,
      kills: last?.kills ?? 0,
      coins,
      diedAtSec: last ? Math.round(last.elapsedSec) : 0,
    };
  } finally {
    await tab.close();
  }
}

/** ページ内オートパイロット（決定的）。逃走/回収/接触グレイズ/ボス旋回 + カジュアルなシード付きピック */
function autopilotSource(engage, pickSeed) {
  return `
window.__auto = ((ENGAGE, PICKSEED) => {
  const d = window.__debug;
  let pickState = PICKSEED >>> 0;
  const pickRand = () => {
    pickState = (pickState + 0x6d2b79f5) >>> 0;
    let t = pickState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const BY_ANGLE = [['KeyD'],['KeyS','KeyD'],['KeyS'],['KeyS','KeyA'],['KeyA'],['KeyW','KeyA'],['KeyW'],['KeyW','KeyD']];
  let held = [];
  const kd = (c) => window.dispatchEvent(new KeyboardEvent('keydown',{code:c}));
  const ku = (c) => window.dispatchEvent(new KeyboardEvent('keyup',{code:c}));
  const hold = (want) => { for (const c of held) ku(c); held = want; for (const c of held) kd(c); };
  const steer = (vx, vy) => {
    const a = Math.atan2(vy, vx);
    hold(BY_ANGLE[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8]);
  };
  const CIRCLE_R = 1600;
  const setDir = (s) => {
    const foes = d.enemySnapshot(Math.max(400, ENGAGE * 2));
    let fx = 0, fy = 0, nearestSq = 1e12, nearestFoe = null;
    for (const e of foes) {
      const dx = s.playerX - e.x, dy = s.playerY - e.y;
      const dsq = Math.max(dx * dx + dy * dy, 100);
      if (dsq < nearestSq) { nearestSq = dsq; nearestFoe = e; }
      if (dsq < (ENGAGE + 40) * (ENGAGE + 40)) { fx += dx / dsq; fy += dy / dsq; }
    }
    const nearest = Math.sqrt(nearestSq);
    // 接触武器モード: 射程ゼロ武器のため敵を引き付けてかすらせる
    if (ENGAGE < 150 && !s.bossActive && nearestFoe !== null) {
      const dxn = nearestFoe.x - s.playerX, dyn = nearestFoe.y - s.playerY;
      const dn = Math.hypot(dxn, dyn) + 1e-6;
      const fm = Math.hypot(fx, fy);
      if (nearest > ENGAGE) steer(dxn / dn, dyn / dn);
      else if (nearest < ENGAGE * 0.75 && fm > 0) steer(fx / fm, fy / fm);
      else steer(-dyn / dn + (fm > 0 ? (fx / fm) * 0.5 : 0), dxn / dn + (fm > 0 ? (fy / fm) * 0.5 : 0));
      return;
    }
    const boss = s.bossActive ? d.bossPos() : null;
    let vx, vy;
    if (boss) {
      const dxb = boss.x - s.playerX, dyb = boss.y - s.playerY;
      const db = Math.hypot(dxb, dyb) + 1e-6;
      const toward = (db - 130) / 120;
      vx = (dxb / db) * toward + (-dyb / db) * 0.7;
      vy = (dyb / db) * toward + (dxb / db) * 0.7;
    } else if (nearest > ENGAGE) {
      const gems = d.gemSnapshot(500);
      let best = null, bestD = 1e12;
      for (const g of gems) {
        const dd = (g.x - s.playerX) ** 2 + (g.y - s.playerY) ** 2;
        if (dd < bestD) { bestD = dd; best = g; }
      }
      if (best) { const dg = Math.sqrt(bestD) + 1; vx = (best.x - s.playerX) / dg; vy = (best.y - s.playerY) / dg; }
      else { const r = Math.hypot(s.playerX, s.playerY) + 1e-6; vx = -s.playerY / r; vy = s.playerX / r; }
    } else {
      const r = Math.hypot(s.playerX, s.playerY) + 1e-6;
      const rx = s.playerX / r, ry = s.playerY / r;
      vx = -ry; vy = rx;
      const corr = Math.max(-0.5, Math.min(0.5, (CIRCLE_R - r) / 600));
      vx += rx * corr; vy += ry * corr;
      const vm = Math.hypot(vx, vy) + 1e-6;
      vx /= vm; vy /= vm;
    }
    const fmag = Math.hypot(fx, fy);
    if (fmag > 0) {
      const fw = Math.min(1.4, 0.5 + foes.length * 0.05);
      vx += (fx / fmag) * fw; vy += (fy / fmag) * fw;
    }
    steer(vx, vy);
  };
  const pick = () => {
    const cs = d.choices();
    let i = cs.findIndex((c) => c.startsWith('evolution:'));
    if (i < 0) i = Math.floor(pickRand() * 3);
    kd('Digit' + (i + 1));
  };
  // 回収率補正: 累計獲得EXP = キル×平均ジェム価値×回収率×expMul に不足分を注入
  const EXP_BASE = ${leveling.expBase}, EXP_PER = ${leveling.expPerLevel};
  const totalExpTo = (lv) => { let t = 0; for (let l = 1; l < lv; l++) t += EXP_BASE + (l - 1) * EXP_PER; return t; };
  let startLevel = null;
  const correct = (s) => {
    if (startLevel === null) startLevel = s.level;
    const collected = totalExpTo(s.level) - totalExpTo(startLevel) + s.exp;
    const target = s.kills * ${GEM_AVG_PER_KILL} * ${RATE} * (s.expMul ?? 1);
    if (target > collected + 5) d.giveExp((target - collected) / (s.expMul ?? 1));
  };
  return {
    step(gameSec) {
      const deadline = performance.now() + 3000;
      let s = d.state();
      while (!s.finished && s.elapsedSec < gameSec && performance.now() < deadline) {
        if (s.paused && s.pendingLevels > 0) pick();
        else if (!s.pauseMenuOpen) { setDir(s); correct(s); d.tickNoDraw(50); }
        s = d.state();
      }
      return s;
    },
  };
})(${engage}, ${Number(pickSeed)}); 'injected'`;
}

// ---- メイン ----
console.log('baseline: dev サーバーと Chrome を起動中...');
// Windows では 'npx' を直接 spawn できない（ENOENT）ため、vite の JS バイナリを node で起動する
const vite = spawn(
  process.execPath,
  [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(VITE_PORT), '--strictPort'],
  {
    cwd: ROOT,
    stdio: 'ignore',
    detached: process.platform !== 'win32',
  },
);
children.push(vite);
const chrome = spawn(
  findChrome(),
  ['--headless=new', '--no-sandbox', `--remote-debugging-port=${CDP_PORT}`, '--window-size=1280,720', 'about:blank'],
  { stdio: 'ignore', detached: true },
);
children.push(chrome);
await waitHttp(`http://localhost:${VITE_PORT}/`);
await waitHttp(`http://127.0.0.1:${CDP_PORT}/json/version`);

const runs = [];
for (const { id: charId, engage } of CHARS) {
  for (const metaKey of Object.keys(METAS)) {
    for (const seed of SEEDS) {
      // タブクラッシュ由来の失敗は1回だけ再試行する（ゲーム進行は決定的なので再現条件は同じ。
      // 2回連続で落ちる場合は環境要因ではないため、隠さず全体を失敗させる）
      let r = null;
      for (let attempt = 0; r === null; attempt++) {
        try {
          r = await runOne(charId, metaKey, seed, engage);
        } catch (e) {
          console.log(`  ${charId}/${metaKey} seed=${seed}: 試行${attempt + 1}失敗: ${String(e).slice(0, 140)}`);
          if (attempt >= 1) throw e;
        }
      }
      runs.push(r);
      console.log(
        `  ${charId}/${metaKey} seed=${seed}: Lv${r.level} kills=${r.kills} ` +
          `${r.cleared ? 'クリア' : `死亡@${r.diedAtSec}s`} coins=${r.coins}`,
      );
    }
  }
}

// 集計と差分
const summary = {};
for (const { id: charId } of CHARS) {
  for (const metaKey of Object.keys(METAS)) {
    const rs = runs.filter((r) => r.char === charId && r.meta === metaKey);
    const avg = (f) => +(rs.reduce((a, r) => a + f(r), 0) / rs.length).toFixed(1);
    summary[`${charId}_${metaKey}`] = {
      avgLevel: avg((r) => r.level),
      avgKills: avg((r) => r.kills),
      clearRate: avg((r) => (r.cleared ? 1 : 0)),
      avgCoins: avg((r) => r.coins),
    };
  }
}

let commit = 'unknown';
try {
  commit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
} catch {
  /* git なしでも動かす */
}

const prev = existsSync(OUT_PATH) ? JSON.parse(readFileSync(OUT_PATH, 'utf8')) : null;
mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(
  OUT_PATH,
  JSON.stringify({ generatedAt: new Date().toISOString(), commit, seeds: SEEDS, summary, runs }, null, 2),
);

console.log('\n=== 基準線サマリ ===');
for (const [key, s] of Object.entries(summary)) {
  const p = prev?.summary?.[key];
  const diff = (cur, old) =>
    old === undefined ? '' : ` (前回${old >= 0 && cur - old >= 0 ? '+' : ''}${+(cur - old).toFixed(1)})`;
  console.log(
    `${key}: Lv${s.avgLevel}${diff(s.avgLevel, p?.avgLevel)} | キル${s.avgKills}${diff(s.avgKills, p?.avgKills)} | ` +
      `クリア率${s.clearRate}${diff(s.clearRate, p?.clearRate)} | コイン${s.avgCoins}${diff(s.avgCoins, p?.avgCoins)}`,
  );
}
if (prev) console.log(`前回: ${prev.generatedAt} (${prev.commit})`);
console.log(`保存: ${OUT_PATH}`);
process.exit(0);
