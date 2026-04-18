const path = require('path');
const Database = require('better-sqlite3');

let db;

function openWarehouse(userDataPath, filename = 'warehouse.sqlite') {
  if (db) return db;
  db = new Database(path.join(userDataPath, filename));
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('mmap_size = 268435456');
  migrate();
  return db;
}

function hasColumn(table, column) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((r) => r.name === column);
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stocks (
      code         TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      market       TEXT NOT NULL,
      sector       TEXT,
      listing_date INTEGER,
      yahoo_symbol TEXT NOT NULL,
      updated_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stocks_market ON stocks(market);
    CREATE INDEX IF NOT EXISTS idx_stocks_name   ON stocks(name);

    CREATE TABLE IF NOT EXISTS candles (
      code   TEXT NOT NULL,
      period TEXT NOT NULL,
      ts     INTEGER NOT NULL,
      open   REAL, high REAL, low REAL, close REAL,
      volume INTEGER,
      PRIMARY KEY (code, period, ts)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS idx_candles_code ON candles(code, period);

    CREATE TABLE IF NOT EXISTS indicators (
      code   TEXT NOT NULL,
      period TEXT NOT NULL,
      ts     INTEGER NOT NULL,
      ma5 REAL, ma20 REAL, ma60 REAL, ma120 REAL,
      ema12 REAL, ema26 REAL,
      rsi14 REAL,
      bb_upper REAL, bb_mid REAL, bb_lower REAL,
      macd REAL, macd_signal REAL, macd_hist REAL,
      vol_ma20 INTEGER,
      PRIMARY KEY (code, period, ts)
    ) WITHOUT ROWID;

    CREATE TABLE IF NOT EXISTS sync_log (
      code        TEXT NOT NULL,
      period      TEXT NOT NULL,
      last_ts     INTEGER,
      last_run_at INTEGER,
      status      TEXT,
      error       TEXT,
      PRIMARY KEY (code, period)
    );

    CREATE TABLE IF NOT EXISTS pattern_hits (
      pattern_id TEXT NOT NULL,
      code       TEXT NOT NULL,
      period     TEXT NOT NULL,
      ts         INTEGER NOT NULL,
      score      REAL,
      payload    TEXT,
      PRIMARY KEY (pattern_id, code, period, ts)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS idx_hits_ts ON pattern_hits(ts);
    CREATE INDEX IF NOT EXISTS idx_hits_code ON pattern_hits(code, period);

    CREATE TABLE IF NOT EXISTS notes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      code       TEXT NOT NULL,
      ts         INTEGER NOT NULL,
      text       TEXT NOT NULL,
      tags       TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notes_code ON notes(code, ts);

    CREATE TABLE IF NOT EXISTS workspaces (
      name       TEXT PRIMARY KEY,
      config     TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backtest_runs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern_id TEXT NOT NULL,
      config     TEXT NOT NULL,
      result     TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sheet_columns (
      key         TEXT PRIMARY KEY,
      label       TEXT NOT NULL,
      type        TEXT NOT NULL,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sheet_cells (
      code        TEXT NOT NULL,
      column_key  TEXT NOT NULL,
      value       TEXT,
      updated_at  INTEGER NOT NULL,
      PRIMARY KEY (code, column_key)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS idx_cells_col ON sheet_cells(column_key);

    DROP TABLE IF EXISTS watchlist;
  `);

  // stocks 테이블에 발행주식수 컬럼 조건부 추가 (SQLite는 IF NOT EXISTS 미지원)
  if (!hasColumn('stocks', 'shares_outstanding')) {
    db.exec('ALTER TABLE stocks ADD COLUMN shares_outstanding INTEGER');
  }
  if (!hasColumn('stocks', 'shares_updated_at')) {
    db.exec('ALTER TABLE stocks ADD COLUMN shares_updated_at INTEGER');
  }
}

function upsertStocks(rows) {
  const stmt = db.prepare(`
    INSERT INTO stocks (code, name, market, sector, listing_date, yahoo_symbol, updated_at)
    VALUES (@code, @name, @market, @sector, @listing_date, @yahoo_symbol, @updated_at)
    ON CONFLICT(code) DO UPDATE SET
      name = excluded.name, market = excluded.market, sector = excluded.sector,
      listing_date = excluded.listing_date, yahoo_symbol = excluded.yahoo_symbol,
      updated_at = excluded.updated_at
  `);
  const tx = db.transaction((arr) => arr.forEach((r) => stmt.run(r)));
  tx(rows);
}

function countStocks() { return db.prepare('SELECT COUNT(*) AS c FROM stocks').get().c; }
function listStocks(market) {
  return market
    ? db.prepare('SELECT * FROM stocks WHERE market = ? ORDER BY code').all(market)
    : db.prepare('SELECT * FROM stocks ORDER BY code').all();
}

function loadCandles(code, period) {
  return db.prepare(
    'SELECT ts AS timestamp, open, high, low, close, volume FROM candles WHERE code=? AND period=? ORDER BY ts ASC'
  ).all(code, period);
}

function loadIndicators(code, period) {
  return db.prepare(
    'SELECT ts, ma5, ma20, ma60, ma120, ema12, ema26, rsi14, bb_upper, bb_mid, bb_lower, macd, macd_signal, macd_hist, vol_ma20 FROM indicators WHERE code=? AND period=? ORDER BY ts ASC'
  ).all(code, period);
}

function searchStocks(query, limit = 30) {
  const q = (query || '').trim();
  if (!q) return db.prepare('SELECT code, name, market FROM stocks ORDER BY code LIMIT ?').all(limit);
  const like = `%${q}%`;
  return db.prepare(
    'SELECT code, name, market FROM stocks WHERE code LIKE ? OR name LIKE ? ORDER BY CASE WHEN code=? THEN 0 WHEN name=? THEN 1 ELSE 2 END, name LIMIT ?'
  ).all(like, like, q, q, limit);
}

function seedStocksIfEmpty(defaults) {
  const c = db.prepare('SELECT COUNT(*) AS c FROM stocks').get().c;
  if (c > 0) return;
  const now = Date.now();
  const rows = defaults.map((s) => ({
    code: s.code,
    name: s.name,
    market: s.market || 'KOSPI',
    sector: null,
    listing_date: null,
    yahoo_symbol: `${s.code}${s.market === 'KOSDAQ' ? '.KQ' : '.KS'}`,
    updated_at: now,
  }));
  upsertStocks(rows);
}

function getDb() { return db; }

function getLastSyncAt(period = 'D') {
  const r = db.prepare('SELECT MAX(last_run_at) AS t FROM sync_log WHERE period = ?').get(period);
  return r?.t || null;
}

// ── Notes ─────────────────────────────────
function listNotes(code) {
  return db.prepare('SELECT id, code, ts, text, tags, created_at FROM notes WHERE code = ? ORDER BY ts ASC').all(code);
}
function addNote(code, ts, text, tags = '') {
  const r = db.prepare('INSERT INTO notes (code, ts, text, tags, created_at) VALUES (?, ?, ?, ?, ?)').run(code, ts, text, tags, Date.now());
  return { id: r.lastInsertRowid, code, ts, text, tags };
}
function removeNote(id) {
  db.prepare('DELETE FROM notes WHERE id = ?').run(id);
  return true;
}

// ── Workspaces ─────────────────
function saveWorkspace(name, config) {
  db.prepare('INSERT OR REPLACE INTO workspaces (name, config, updated_at) VALUES (?, ?, ?)')
    .run(name, JSON.stringify(config), Date.now());
  return listWorkspaces();
}
function loadWorkspace(name) {
  const r = db.prepare('SELECT config FROM workspaces WHERE name = ?').get(name);
  return r ? JSON.parse(r.config) : null;
}
function listWorkspaces() {
  return db.prepare('SELECT name, updated_at FROM workspaces ORDER BY updated_at DESC').all();
}
function deleteWorkspace(name) {
  db.prepare('DELETE FROM workspaces WHERE name = ?').run(name);
  return listWorkspaces();
}

// ── Shares outstanding ─────────────────
function upsertShares(rows) {
  const stmt = db.prepare('UPDATE stocks SET shares_outstanding = ?, shares_updated_at = ? WHERE code = ?');
  const now = Date.now();
  const tx = db.transaction((arr) => arr.forEach((r) => stmt.run(r.shares, now, r.code)));
  tx(rows);
}
function countStocksWithShares() {
  return db.prepare('SELECT COUNT(*) AS c FROM stocks WHERE shares_outstanding IS NOT NULL').get().c;
}
function getSharesBaselineDate() {
  return db.prepare('SELECT MAX(shares_updated_at) AS t FROM stocks').get()?.t || null;
}

// ── Market cap ranking ─────────────────
function listAvailableDates(limit = 500) {
  return db.prepare(
    'SELECT DISTINCT ts FROM candles WHERE period = ? ORDER BY ts DESC LIMIT ?'
  ).all('D', limit).map((r) => r.ts);
}

function listRanking(ts, { market, search, limit = 3000, offset = 0 } = {}) {
  const where = ['c.period = \'D\'', 'c.ts = ?', 's.shares_outstanding IS NOT NULL'];
  const params = [ts];
  if (market === 'KOSPI' || market === 'KOSDAQ') {
    where.push('s.market = ?');
    params.push(market);
  }
  if (search && search.trim()) {
    const like = `%${search.trim()}%`;
    where.push('(s.code LIKE ? OR s.name LIKE ?)');
    params.push(like, like);
  }
  const rows = db.prepare(`
    SELECT s.code, s.name, s.market, s.shares_outstanding, c.close,
           CAST(c.close * s.shares_outstanding AS INTEGER) AS market_cap
    FROM stocks s
    JOIN candles c ON c.code = s.code
    WHERE ${where.join(' AND ')}
    ORDER BY market_cap DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  return rows.map((r, i) => ({ ...r, rank: offset + i + 1 }));
}

// ── Sheet columns & cells ─────────────────
function listSheetColumns() {
  return db.prepare('SELECT key, label, type, sort_order FROM sheet_columns ORDER BY sort_order ASC, created_at ASC').all();
}

function addSheetColumn({ key, label, type = 'text' }) {
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM sheet_columns').get().m;
  db.prepare(
    'INSERT OR REPLACE INTO sheet_columns (key, label, type, sort_order, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(key, label, type, max + 1, Date.now());
  return listSheetColumns();
}

function removeSheetColumn(key) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM sheet_cells WHERE column_key = ?').run(key);
    db.prepare('DELETE FROM sheet_columns WHERE key = ?').run(key);
  });
  tx();
  return listSheetColumns();
}

function reorderSheetColumns(keys) {
  const stmt = db.prepare('UPDATE sheet_columns SET sort_order = ? WHERE key = ?');
  const tx = db.transaction((arr) => arr.forEach((k, i) => stmt.run(i, k)));
  tx(keys);
  return listSheetColumns();
}

function getCells(codes, columnKeys) {
  if (!Array.isArray(codes) || !Array.isArray(columnKeys) || codes.length === 0 || columnKeys.length === 0) {
    return {};
  }
  const codePlaceholders = codes.map(() => '?').join(',');
  const colPlaceholders = columnKeys.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT code, column_key, value FROM sheet_cells WHERE code IN (${codePlaceholders}) AND column_key IN (${colPlaceholders})`
  ).all(...codes, ...columnKeys);
  // { 'code': { 'colKey': 'value' } }
  const map = {};
  for (const r of rows) {
    if (!map[r.code]) map[r.code] = {};
    map[r.code][r.column_key] = r.value;
  }
  return map;
}

function setCell(code, columnKey, value) {
  if (value == null || value === '') {
    db.prepare('DELETE FROM sheet_cells WHERE code = ? AND column_key = ?').run(code, columnKey);
  } else {
    db.prepare(
      'INSERT OR REPLACE INTO sheet_cells (code, column_key, value, updated_at) VALUES (?, ?, ?, ?)'
    ).run(code, columnKey, String(value), Date.now());
  }
  return true;
}

module.exports = {
  openWarehouse, getDb, getLastSyncAt,
  upsertStocks, countStocks, listStocks, searchStocks, seedStocksIfEmpty,
  loadCandles, loadIndicators,
  listNotes, addNote, removeNote,
  saveWorkspace, loadWorkspace, listWorkspaces, deleteWorkspace,
  // shares + market cap
  upsertShares, countStocksWithShares, getSharesBaselineDate,
  listAvailableDates, listRanking,
  // sheet
  listSheetColumns, addSheetColumn, removeSheetColumn, reorderSheetColumns,
  getCells, setCell,
};
