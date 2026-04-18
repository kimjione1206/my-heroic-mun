const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const fs = require('fs');
const path = require('path');

const { getUserDataPath } = require('./userdata');
const { loadState, saveState } = require('./window-state');
const {
  openWarehouse, getDb, getLastSyncAt,
  countStocks, listStocks, searchStocks, seedStocksIfEmpty,
  loadCandles, loadIndicators,
  listNotes, addNote, removeNote,
  saveWorkspace, loadWorkspace, listWorkspaces, deleteWorkspace,
  countStocksWithShares, getSharesBaselineDate, upsertShares,
  listAvailableDates, listRanking,
  listSheetColumns, addSheetColumn, removeSheetColumn, reorderSheetColumns,
  getCells, setCell,
} = require('./warehouse');
const { syncOne } = require('./sync');
const { toWeekly, toMonthly } = require('./aggregate');
const { Scheduler } = require('./scheduler');
const { PatternRuntime } = require('./pattern-runtime');
const { runBacktest } = require('./backtest');
const { fetchSharesOutstanding } = require('./history-client');

const isDev = process.env.NODE_ENV === 'development';
const isSmoke = process.env.MYH_SMOKE === '1';

// CI/smoke 모드: GPU 비활성화 (windows-latest 하드웨어 가속 불안정)
if (isSmoke) app.disableHardwareAcceleration();
let mainWindow;
let sheetWindow;
let scheduler;
let patterns;
let sharesSyncRunning = false;

const RENDERER_OUT = path.join(__dirname, '..', 'renderer', 'out');
const PRELOAD = path.join(__dirname, 'preload.js');

// KST (UTC+9) 기준 같은 날인지 비교
function isSameKstDay(tsA, tsB) {
  const toKst = (ts) => new Date(ts + 9 * 3600000);
  const a = toKst(tsA), b = toKst(tsB);
  return a.getUTCFullYear() === b.getUTCFullYear()
    && a.getUTCMonth() === b.getUTCMonth()
    && a.getUTCDate() === b.getUTCDate();
}

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

function createMainWindow() {
  const bounds = loadState('main', { width: 1400, height: 900 });
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 1024, minHeight: 720,
    title: '나만의 영웅문', backgroundColor: '#0f1115',
    show: true, center: !bounds.x,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  });
  if (isDev) mainWindow.loadURL('http://localhost:3000');
  else mainWindow.loadFile(path.join(RENDERER_OUT, 'index.html'));

  mainWindow.webContents.once('did-finish-load', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.focus();
  });
  mainWindow.on('close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) saveState('main', mainWindow.getBounds());
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    // 차트 창 종료 → 앱 전체 종료 (시총 창도 같이 닫힘)
    app.quit();
  });
}

function createSheetWindow() {
  if (sheetWindow && !sheetWindow.isDestroyed()) {
    if (sheetWindow.isMinimized()) sheetWindow.restore();
    sheetWindow.show();
    sheetWindow.focus();
    return sheetWindow;
  }
  const bounds = loadState('sheet', { width: 720, height: 900 });
  sheetWindow = new BrowserWindow({
    ...bounds,
    minWidth: 520, minHeight: 500,
    title: '시총 순위', backgroundColor: '#0f1115',
    show: true, center: !bounds.x,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  });
  if (isDev) sheetWindow.loadURL('http://localhost:3000/sheet');
  else sheetWindow.loadFile(path.join(RENDERER_OUT, 'sheet.html'));

  sheetWindow.on('close', () => {
    if (sheetWindow && !sheetWindow.isDestroyed()) saveState('sheet', sheetWindow.getBounds());
  });
  sheetWindow.on('closed', () => { sheetWindow = null; });
  return sheetWindow;
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    {
      label: '윈도우',
      submenu: [
        {
          label: '시총 창 열기',
          accelerator: 'CommandOrControl+L',
          click: () => {
            if (!isSmoke) {
              if (sharesSyncRunning || countStocksWithShares() === 0) {
                mainWindow?.webContents.send('sheet:blocked', {
                  reason: sharesSyncRunning ? 'running' : 'no-shares',
                  withShares: countStocksWithShares(),
                  total: countStocks(),
                });
                return;
              }
            }
            createSheetWindow();
          },
        },
        { type: 'separator' },
        { role: 'minimize' },
        { role: 'close' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  const userData = getUserDataPath();
  fs.mkdirSync(userData, { recursive: true });

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

  const patternsPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'patterns')
    : path.join(__dirname, '..', 'patterns');
  patterns = new PatternRuntime(patternsPath, () => mainWindow);

  buildMenu();
  createMainWindow();

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
      // 오늘(KST 기준) 이미 동기화됐으면 네트워크 호출 스킵
      setTimeout(() => {
        const lastSync = getLastSyncAt('D');
        if (lastSync && isSameKstDay(lastSync, Date.now())) {
          console.log(`[boot-sync] skipped — 이미 오늘 (${new Date(lastSync).toLocaleString('ko-KR')}) 동기화됨`);
          mainWindow?.webContents.send('sync:skipped', { lastSyncAt: lastSync, reason: 'already-today' });
          return;
        }
        scheduler.runNow({ trigger: 'boot' }).catch((e) => console.error('[boot-sync]', e));
      }, 5000);
    }
  }

  // shares_outstanding 이 없으면 앱 유휴 시간에 백그라운드 수집 (smoke 모드 제외)
  if (!isSmoke) {
    setTimeout(() => {
      ensureSharesInBackground().catch((e) => console.error('[shares:auto]', e));
    }, 15000);
  }

  app.on('activate', () => { if (!mainWindow) createMainWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

function broadcast(channel, payload) {
  [mainWindow, sheetWindow].forEach((w) => {
    if (!w || w.isDestroyed()) return;
    w.webContents.send(channel, payload);
  });
}
app.on('before-quit', () => {
  try { scheduler?.stop(); } catch {}
  try { patterns?.stop(); } catch {}
});

async function ensureSharesInBackground() {
  if (sharesSyncRunning) return;
  const stocks = listStocks();
  const withShares = countStocksWithShares();
  if (withShares >= stocks.length * 0.8) return;  // 80% 이상이면 skip
  sharesSyncRunning = true;
  mainWindow?.webContents.send('shares:start', { total: stocks.length });
  const pLimit = (await import('p-limit')).default;
  const limit = pLimit(5);
  let done = 0, ok = 0, fail = 0;
  const batch = [];
  const flush = () => { if (batch.length > 0) upsertShares(batch.splice(0)); };
  const tasks = stocks.map((s) =>
    limit(async () => {
      try {
        const n = await fetchSharesOutstanding(s.code, { market: s.market });
        if (n) { batch.push({ code: s.code, shares: n }); ok++; } else fail++;
      } catch { fail++; }
      done++;
      if (batch.length >= 50) flush();
      if (done % 50 === 0) mainWindow?.webContents.send('shares:progress', { done, total: stocks.length, ok, fail });
    })
  );
  await Promise.all(tasks);
  flush();
  sharesSyncRunning = false;
  mainWindow?.webContents.send('shares:done', { done, total: stocks.length, ok, fail });
}

// ─── IPC: 창 간 선택 동기화 ───
ipcMain.handle('window:select-stock', (e, stock) => {
  if (!stock || typeof stock.code !== 'string') return;
  [mainWindow, sheetWindow].forEach((w) => {
    if (!w || w.isDestroyed()) return;
    if (w.webContents === e.sender) return;  // 에코 방지
    w.webContents.send('external:select-stock', stock);
  });
});
ipcMain.handle('window:open-sheet', () => {
  if (!isSmoke) {
    // 진행 중이거나 전혀 수집 안 됐으면 막음
    if (sharesSyncRunning || countStocksWithShares() === 0) {
      mainWindow?.webContents.send('sheet:blocked', {
        reason: sharesSyncRunning ? 'running' : 'no-shares',
        withShares: countStocksWithShares(),
        total: countStocks(),
      });
      return false;
    }
  }
  createSheetWindow();
  return true;
});
ipcMain.handle('window:is-sheet-open', () =>
  !!sheetWindow && !sheetWindow.isDestroyed()
);

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

  if (period === 'W' || period === 'M') {
    let daily = loadCandles(code, 'D');
    if (daily.length === 0) {
      const stock = listStocks().find((s) => s.code === code);
      if (stock && !isSmoke) {
        await syncOne(getDb(), stock, { mode: 'full', period: 'D', years: 10 });
        daily = loadCandles(code, 'D');
      }
    } else if (!isSmoke) {
      const stock = listStocks().find((s) => s.code === code);
      if (stock) refreshOne(stock, 'D').catch(() => {});
    }
    return period === 'W' ? toWeekly(daily) : toMonthly(daily);
  }

  const cached = loadCandles(code, period);
  if (cached.length > 0) {
    if (!isSmoke) {
      const stock = listStocks().find((s) => s.code === code);
      if (stock) refreshOne(stock, period).catch(() => {});
    }
    return cached;
  }
  if (isSmoke) return [];
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

ipcMain.handle('stocks:search', (_e, q) => searchStocks(typeof q === 'string' ? q : ''));

// ── Market cap ranking / sheet ─────────────────
ipcMain.handle('marketcap:status', () => {
  const total = countStocks();
  const withShares = countStocksWithShares();
  return {
    total,
    withShares,
    ready: withShares > 0,
    running: sharesSyncRunning,
    baselineAt: getSharesBaselineDate(),
  };
});

ipcMain.handle('marketcap:dates', (_e, { limit = 500 } = {}) => {
  return listAvailableDates(limit);
});

ipcMain.handle('marketcap:ranking', (_e, arg = {}) => {
  const { ts, market, search, limit = 3000, offset = 0 } = arg;
  if (!Number.isInteger(ts)) return [];
  const m = (market === 'KOSPI' || market === 'KOSDAQ') ? market : null;
  const ranking = listRanking(ts, { market: m, search, limit, offset });
  const columns = listSheetColumns();
  if (columns.length === 0 || ranking.length === 0) return { rows: ranking, columns };
  const codes = ranking.map((r) => r.code);
  const keys = columns.map((c) => c.key);
  const cells = getCells(codes, keys);
  const rows = ranking.map((r) => ({ ...r, cells: cells[r.code] || {} }));
  return { rows, columns };
});

ipcMain.handle('sheet:columns:list', () => listSheetColumns());
ipcMain.handle('sheet:columns:add', (_e, arg = {}) => {
  const { key, label, type } = arg;
  if (typeof key !== 'string' || !/^[a-z0-9_]{1,32}$/i.test(key)) return listSheetColumns();
  if (typeof label !== 'string' || label.trim().length === 0) return listSheetColumns();
  const t = ['text', 'number', 'bool'].includes(type) ? type : 'text';
  return addSheetColumn({ key, label: label.trim(), type: t });
});
ipcMain.handle('sheet:columns:remove', (_e, key) => {
  if (typeof key !== 'string') return listSheetColumns();
  return removeSheetColumn(key);
});
ipcMain.handle('sheet:columns:reorder', (_e, keys) => {
  if (!Array.isArray(keys)) return listSheetColumns();
  return reorderSheetColumns(keys);
});
ipcMain.handle('sheet:cell:set', (_e, arg = {}) => {
  const { code, columnKey, value } = arg;
  if (!isCode(code) || typeof columnKey !== 'string') return false;
  return setCell(code, columnKey, value);
});

ipcMain.handle('shares:ensure', async () => {
  ensureSharesInBackground().catch(() => {});
  return { started: true };
});

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
