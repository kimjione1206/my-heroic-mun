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
// 네트워크 호출 전부 차단 (테스트·오프라인 모드)
const noNet = isSmoke || process.env.MYH_NO_NET === '1';

// CI/smoke 모드: GPU 비활성화 (windows-latest 하드웨어 가속 불안정)
if (isSmoke) app.disableHardwareAcceleration();

// userData 경로를 "my-heroic-mun" 으로 고정
// (기본값은 productName 인 "나만의 영웅문" — 한글 폴더명이 생겨 OS 별 경로 꼬임·uninstall 정리 문제)
// Electron app.name 자체도 바꿔서 Dock/TaskBar, 캐시 경로 전부 통일.
if (!process.env.MYH_USERDATA) {
  try {
    app.setName('my-heroic-mun');
    app.setPath('userData', path.join(app.getPath('appData'), 'my-heroic-mun'));
  } catch {}
}
// 테스트 격리: MYH_USERDATA 환경변수가 지정되면 Electron 기본 userData 경로도 재설정
if (process.env.MYH_USERDATA) {
  try { app.setPath('userData', process.env.MYH_USERDATA); } catch {}
}
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
  // dev: query string으로 trailingSlash 리다이렉트 루프 회피
  if (isDev) sheetWindow.loadURL('http://localhost:3000/sheet?w=1');
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
            if (!noNet) {
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

  const userDb = path.join(userData, 'warehouse.sqlite');
  // 구 세션의 WAL/SHM 파일을 정리하는 헬퍼 (.sqlite 를 교체했는데 stale WAL 이 남으면 malformed 에러)
  const clearWalShm = () => {
    for (const suffix of ['-wal', '-shm']) {
      const p = userDb + suffix;
      if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch {} }
    }
  };

  if (isSmoke) {
    try {
      const fixtureSrc = app.isPackaged
        ? path.join(process.resourcesPath, 'app.asar.unpacked', 'test', 'fixtures', 'smoke-warehouse.sqlite')
        : path.join(__dirname, '..', 'test', 'fixtures', 'smoke-warehouse.sqlite');
      console.log(`[smoke] fixtureSrc=${fixtureSrc} exists=${fs.existsSync(fixtureSrc)}`);
      if (fs.existsSync(fixtureSrc)) {
        clearWalShm();
        fs.copyFileSync(fixtureSrc, userDb);
        console.log('[smoke] fixture warehouse copied');
      }
    } catch (e) {
      console.error('[smoke] fixture copy failed:', e.message);
    }
  } else if (!fs.existsSync(userDb)) {
    // 최초 설치: 번들 release seed DB 를 userData 로 복사 (전체 종목 · 10년 데이터 즉시 사용)
    try {
      const releaseSrc = app.isPackaged
        ? path.join(process.resourcesPath, 'app.asar.unpacked', 'test', 'fixtures', 'release-warehouse.sqlite')
        : path.join(__dirname, '..', 'test', 'fixtures', 'release-warehouse.sqlite');
      if (fs.existsSync(releaseSrc)) {
        clearWalShm();
        fs.copyFileSync(releaseSrc, userDb);
        console.log(`[bootstrap] release DB copied from ${releaseSrc}`);
      } else {
        console.log('[bootstrap] release DB 없음 — SEED 로 최소 시작');
      }
    } catch (e) {
      console.error('[bootstrap] release DB copy failed:', e.message);
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
    if (!noNet) {
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

  // shares_outstanding 이 없으면 앱 유휴 시간에 백그라운드 수집 (네트워크 모드만)
  if (!noNet) {
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
  let done = 0, ok = 0, fail = 0;
  const batch = [];
  const flush = () => { if (batch.length > 0) upsertShares(batch.splice(0)); };
  try {
    mainWindow?.webContents.send('shares:start', { total: stocks.length });
    const pLimit = (await import('p-limit')).default;
    const limit = pLimit(5);
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
    mainWindow?.webContents.send('shares:done', { done, total: stocks.length, ok, fail });
  } catch (e) {
    console.error('[shares:bg]', e);
    try { flush(); } catch {}
    mainWindow?.webContents.send('shares:done', { done, total: stocks.length, ok, fail, error: e.message });
  } finally {
    sharesSyncRunning = false;
  }
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
  if (!noNet) {
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
      if (stock && !noNet) {
        await syncOne(getDb(), stock, { mode: 'full', period: 'D', years: 10 });
        daily = loadCandles(code, 'D');
      }
    } else if (!noNet) {
      const stock = listStocks().find((s) => s.code === code);
      if (stock) refreshOne(stock, 'D').catch(() => {});
    }
    return period === 'W' ? toWeekly(daily) : toMonthly(daily);
  }

  const cached = loadCandles(code, period);
  if (cached.length > 0) {
    if (!noNet) {
      const stock = listStocks().find((s) => s.code === code);
      if (stock) refreshOne(stock, period).catch(() => {});
    }
    return cached;
  }
  if (noNet) return [];
  const stock = listStocks().find((s) => s.code === code);
  if (!stock) return [];
  await syncOne(getDb(), stock, { mode: 'full', period, years: 10 });
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

const isColumnKey = (v) => typeof v === 'string' && /^[a-z0-9_]{1,32}$/i.test(v);

ipcMain.handle('sheet:columns:list', () => listSheetColumns());
ipcMain.handle('sheet:columns:add', (_e, arg = {}) => {
  const { key, label, type } = arg;
  if (!isColumnKey(key)) return listSheetColumns();
  if (typeof label !== 'string' || label.trim().length === 0 || label.length > 40) return listSheetColumns();
  const t = ['text', 'number', 'bool'].includes(type) ? type : 'text';
  return addSheetColumn({ key, label: label.trim(), type: t });
});
ipcMain.handle('sheet:columns:remove', (_e, key) => {
  if (!isColumnKey(key)) return listSheetColumns();
  return removeSheetColumn(key);
});
ipcMain.handle('sheet:columns:reorder', (_e, keys) => {
  if (!Array.isArray(keys) || !keys.every(isColumnKey)) return listSheetColumns();
  return reorderSheetColumns(keys);
});
ipcMain.handle('sheet:cell:set', (_e, arg = {}) => {
  const { code, columnKey, value } = arg;
  if (!isCode(code) || !isColumnKey(columnKey)) return false;
  // value 길이 제한 (XSS/DoS 방지)
  const v = value == null ? null : String(value).slice(0, 500);
  return setCell(code, columnKey, v);
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
  const safeEntryAt = ['close', 'nextOpen'].includes(entryAt) ? entryAt : 'nextOpen';
  const safeExitAt = ['close', 'nextOpen'].includes(exitAt) ? exitAt : 'close';
  const candles = loadCandles(code, period);
  const ind = loadIndicators(code, period);
  const indByTs = new Map(ind.map((i) => [i.ts, i]));
  const aligned = candles.map((c) => indByTs.get(c.timestamp) || {});
  const stock = listStocks().find((s) => s.code === code);
  const hits = patterns?.runOne(patternId, candles, aligned, { ...stock, period }) || [];
  return { result: runBacktest(hits, candles, { holdDays: holdDaysNum, entryAt: safeEntryAt, exitAt: safeExitAt }), hits: hits.length };
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
