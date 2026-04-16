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

    CREATE TABLE IF NOT EXISTS watchlist (
      code       TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0
    );

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
  `);
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

function listWatchlist() {
  return db.prepare('SELECT code, name, sort_order FROM watchlist ORDER BY sort_order ASC, code ASC').all();
}
function addWatch(code, name) {
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM watchlist').get().m;
  db.prepare('INSERT OR IGNORE INTO watchlist (code, name, sort_order) VALUES (?, ?, ?)').run(code, name, max + 1);
  return listWatchlist();
}
function removeWatch(code) {
  db.prepare('DELETE FROM watchlist WHERE code = ?').run(code);
  return listWatchlist();
}
function reorderWatch(codes) {
  const stmt = db.prepare('UPDATE watchlist SET sort_order = ? WHERE code = ?');
  const tx = db.transaction((arr) => { arr.forEach((c, i) => stmt.run(i, c)); });
  tx(codes);
  return listWatchlist();
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

function seedWatchlistIfEmpty(defaults) {
  const c = db.prepare('SELECT COUNT(*) AS c FROM watchlist').get().c;
  if (c > 0) return;
  const stmt = db.prepare('INSERT INTO watchlist (code, name, sort_order) VALUES (?, ?, ?)');
  const tx = db.transaction((arr) => arr.forEach((x, i) => stmt.run(x.code, x.name, i)));
  tx(defaults);
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

// ── Workspaces (JSON blob) ─────────────────
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

module.exports = {
  openWarehouse, getDb, getLastSyncAt,
  upsertStocks, countStocks, listStocks, searchStocks,
  loadCandles, loadIndicators,
  listWatchlist, addWatch, removeWatch, reorderWatch, seedWatchlistIfEmpty, seedStocksIfEmpty,
  listNotes, addNote, removeNote,
  saveWorkspace, loadWorkspace, listWorkspaces, deleteWorkspace,
};
