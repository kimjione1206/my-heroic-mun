const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const { getUserDataPath } = require('./userdata');
const {
  openWarehouse, getDb, getLastSyncAt,
  countStocks, listStocks, searchStocks,
  loadCandles, loadIndicators,
  listWatchlist, addWatch, removeWatch, reorderWatch, seedWatchlistIfEmpty, seedStocksIfEmpty,
  listNotes, addNote, removeNote,
  saveWorkspace, loadWorkspace, listWorkspaces, deleteWorkspace,
} = require('./warehouse');
const { syncOne } = require('./sync');
const { Scheduler } = require('./scheduler');
const { PatternRuntime } = require('./pattern-runtime');
const { runBacktest } = require('./backtest');

const isDev = process.env.NODE_ENV === 'development';
const isSmoke = process.env.MYH_SMOKE === '1';

// CI/smoke 모드: GPU 비활성화 (windows-latest 하드웨어 가속 불안정)
if (isSmoke) app.disableHardwareAcceleration();
let mainWindow;
let scheduler;
let patterns;

const isCode = (v) => typeof v === 'string' && /^\d{6}$/.test(v);
const isPeriod = (v) => v === 'D' || v === 'W' || v === 'M';
const normalizeCodePeriod = ({ code, period = 'D' } = {}) => ({
  code: isCode(code) ? code : null,
  period: isPeriod(period) ? period : 'D',
});

const SEED = [
  { code: '005930', name: '삼성전자' },
  { code: '000660', name: 'SK하이닉스' },
  { code: '373220', name: 'LG에너지솔루션' },
  { code: '207940', name: '삼성바이오로직스' },
  { code: '005380', name: '현대차' },
];

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600, height: 1000, minWidth: 1280, minHeight: 800,
    title: '나만의 영웅문', backgroundColor: '#0f1115',
    show: true,
    center: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'out', 'index.html'));
  }
  mainWindow.webContents.once('did-finish-load', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.focus();
  });
}

app.whenReady().then(async () => {
  const userData = getUserDataPath();
  fs.mkdirSync(userData, { recursive: true });

  // smoke 모드: fixture sqlite를 userData로 복사 (네트워크 없이 고정 데이터)
  if (isSmoke) {
    try {
      const fixtureSrc = app.isPackaged
        ? path.join(process.resourcesPath, 'app.asar.unpacked', 'test', 'fixtures', 'smoke-warehouse.sqlite')
        : path.join(__dirname, '..', 'test', 'fixtures', 'smoke-warehouse.sqlite');
      const dest = path.join(userData, 'warehouse.sqlite');
      console.log(`[smoke] fixtureSrc=${fixtureSrc} exists=${fs.existsSync(fixtureSrc)}`);
      if (fs.existsSync(fixtureSrc)) {
        fs.copyFileSync(fixtureSrc, dest);
        console.log('[smoke] fixture warehouse copied');
      }
    } catch (e) {
      console.error('[smoke] fixture copy failed:', e.message);
    }
  }

  openWarehouse(userData);
  seedStocksIfEmpty(SEED);
  seedWatchlistIfEmpty(SEED);

  // dev: repo/patterns, prod: app.asar.unpacked/patterns (asarUnpack으로 풀림)
  const patternsPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'patterns')
    : path.join(__dirname, '..', 'patterns');
  patterns = new PatternRuntime(patternsPath, () => mainWindow);

  createWindow();

  const stocksForSync = listStocks();
  if (stocksForSync.length > 0) {
    scheduler = new Scheduler({
      db: getDb(),
      stocks: stocksForSync,
      targetHour: 16, targetMin: 0,
      onProgress: (p) => mainWindow?.webContents.send('sync:progress', p),
      onStart: (p) => mainWindow?.webContents.send('sync:start', p),
      onDone: (p) => mainWindow?.webContents.send('sync:done', p),
    });
    scheduler.start();
    if (!isSmoke) {
      // 부팅 시 자동 증분 sync (smoke 모드에선 race 방지 위해 생략)
      setTimeout(() => {
        scheduler.runNow({ trigger: 'boot' }).catch((e) => console.error('[boot-sync]', e));
      }, 5000);
    }
  }

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => {
  try { scheduler?.stop(); } catch {}
  try { patterns?.stop(); } catch {}
});

// ─── IPC ───
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('app:data-source', () => ({
  source: 'yahoo',
  label: `Yahoo Finance · ${countStocks()}개 종목`,
}));

ipcMain.handle('sync:status', () => ({
  ...(scheduler?.status() || { running: false, lastRunAt: null, total: 0 }),
  lastSyncAt: getLastSyncAt('D'),
}));
ipcMain.handle('sync:run-now', async () => {
  if (!scheduler) return { error: 'no-scheduler' };
  return await scheduler.runNow({ trigger: 'manual' });
});

ipcMain.handle('candles:get', async (_e, arg) => {
  const { code, period } = normalizeCodePeriod(arg);
  if (!code) return [];
  const cached = loadCandles(code, period);
  if (cached.length > 0) {
    const stock = listStocks().find((s) => s.code === code);
    if (stock) refreshOne(stock, period).catch(() => {});
    return cached;
  }
  const stock = listStocks().find((s) => s.code === code);
  if (!stock) return [];
  await syncOne(getDb(), stock, { mode: 'full', period, years: 5 });
  return loadCandles(code, period);
});

ipcMain.handle('indicators:get', (_e, arg) => {
  const { code, period } = normalizeCodePeriod(arg);
  if (!code) return [];
  return loadIndicators(code, period);
});

async function refreshOne(stock, period) {
  await syncOne(getDb(), stock, { mode: 'incremental', period });
  const fresh = loadCandles(stock.code, period);
  mainWindow?.webContents.send('candles:updated', { code: stock.code, period, candles: fresh });
}

ipcMain.handle('watchlist:list', () => listWatchlist());
ipcMain.handle('watchlist:add', (_e, { code, name } = {}) => {
  if (!isCode(code) || typeof name !== 'string') return listWatchlist();
  return addWatch(code, name);
});
ipcMain.handle('watchlist:remove', (_e, code) => isCode(code) ? removeWatch(code) : listWatchlist());
ipcMain.handle('watchlist:reorder', (_e, codes) =>
  Array.isArray(codes) && codes.every(isCode) ? reorderWatch(codes) : listWatchlist()
);

ipcMain.handle('stocks:search', (_e, q) => searchStocks(typeof q === 'string' ? q : ''));

// 패턴
ipcMain.handle('patterns:list', () => patterns?.list() || []);
ipcMain.handle('patterns:run', (_e, arg = {}) => {
  const { code, period } = normalizeCodePeriod(arg);
  const { id } = arg;
  if (!code || typeof id !== 'string') return [];
  const candles = loadCandles(code, period);
  const ind = loadIndicators(code, period);
  const indByTs = new Map(ind.map((i) => [i.ts, i]));
  const aligned = candles.map((c) => indByTs.get(c.timestamp) || {});
  const stock = listStocks().find((s) => s.code === code);
  return patterns?.runOne(id, candles, aligned, { ...stock, period }) || [];
});
ipcMain.handle('patterns:run-enabled', (_e, arg = {}) => {
  const { code, period } = normalizeCodePeriod(arg);
  const { enabledIds } = arg;
  if (!code || !Array.isArray(enabledIds)) return [];
  const candles = loadCandles(code, period);
  const ind = loadIndicators(code, period);
  const indByTs = new Map(ind.map((i) => [i.ts, i]));
  const aligned = candles.map((c) => indByTs.get(c.timestamp) || {});
  const stock = listStocks().find((s) => s.code === code);
  return patterns?.runAll(enabledIds, candles, aligned, { ...stock, period }) || [];
});

// ── Backtest ─────────────────────────────
ipcMain.handle('backtest:run', (_e, arg = {}) => {
  const { code, period } = normalizeCodePeriod(arg);
  const { patternId, holdDays = 5, entryAt = 'nextOpen', exitAt = 'close' } = arg;
  if (!code || typeof patternId !== 'string') {
    return { result: null, hits: 0, error: 'invalid-args' };
  }
  const holdDaysNum = Math.min(60, Math.max(1, Number(holdDays) || 5));
  const candles = loadCandles(code, period);
  const ind = loadIndicators(code, period);
  const indByTs = new Map(ind.map((i) => [i.ts, i]));
  const aligned = candles.map((c) => indByTs.get(c.timestamp) || {});
  const stock = listStocks().find((s) => s.code === code);
  const hits = patterns?.runOne(patternId, candles, aligned, { ...stock, period }) || [];
  return { result: runBacktest(hits, candles, { holdDays: holdDaysNum, entryAt, exitAt }), hits: hits.length };
});

// ── Notes ────────────────────────────────
ipcMain.handle('notes:list', (_e, code) => isCode(code) ? listNotes(code) : []);
ipcMain.handle('notes:add', (_e, { code, ts, text, tags } = {}) => {
  if (!isCode(code) || typeof text !== 'string') return null;
  return addNote(code, Number(ts) || Date.now(), text, typeof tags === 'string' ? tags : '');
});
ipcMain.handle('notes:remove', (_e, id) => {
  if (!Number.isInteger(id)) return false;
  return removeNote(id);
});

// ── Workspaces ───────────────────────────
ipcMain.handle('workspace:save', (_e, { name, config }) => saveWorkspace(name, config));
ipcMain.handle('workspace:load', (_e, name) => loadWorkspace(name));
ipcMain.handle('workspace:list', () => listWorkspaces());
ipcMain.handle('workspace:delete', (_e, name) => deleteWorkspace(name));
