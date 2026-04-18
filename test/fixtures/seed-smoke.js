#!/usr/bin/env node
/**
 * 스모크/e2e 테스트용 고정 warehouse.sqlite 생성기.
 *
 * 결과: test/fixtures/smoke-warehouse.sqlite
 *   - stocks(2종목) with shares_outstanding
 *   - candles × 60일
 *   - indicators 선계산
 *   - sheet_columns 샘플 (qty, note)
 *
 * 호출: node test/fixtures/seed-smoke.js
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { computeAll, saveIndicators } = require('../../electron/indicators');

const OUT = path.join(__dirname, 'smoke-warehouse.sqlite');
const STOCKS = [
  { code: '005930', name: '삼성전자', market: 'KOSPI', seed: 70000, vol: 15_000_000, shares: 5_969_782_550 },
  { code: '000660', name: 'SK하이닉스', market: 'KOSPI', seed: 140000, vol: 3_500_000, shares: 728_002_365 },
];

function deterministicRng(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function genCandles({ code, seed, vol }, days = 60) {
  const rng = deterministicRng(code);
  const out = [];
  const start = new Date('2024-12-02T00:00:00Z').getTime();
  let price = seed;
  for (let i = 0; i < days; i++) {
    const ts = start + i * 86400000;
    const pct = (rng() - 0.48) * 0.05;
    const open = price;
    const close = Math.round(price * (1 + pct));
    const high = Math.round(Math.max(open, close) * (1 + rng() * 0.015));
    const low  = Math.round(Math.min(open, close) * (1 - rng() * 0.015));
    const volume = Math.round(vol * (0.5 + rng() * 1.2));
    out.push({ timestamp: ts, open, high, low, close, volume });
    price = close;
  }
  return out;
}

function main() {
  if (fs.existsSync(OUT)) fs.unlinkSync(OUT);
  const db = new Database(OUT);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE stocks (
      code TEXT PRIMARY KEY, name TEXT, market TEXT, sector TEXT,
      listing_date INTEGER, yahoo_symbol TEXT, updated_at INTEGER,
      shares_outstanding INTEGER, shares_updated_at INTEGER
    );
    CREATE TABLE candles (code TEXT, period TEXT, ts INTEGER, open REAL, high REAL,
      low REAL, close REAL, volume INTEGER, PRIMARY KEY (code, period, ts)) WITHOUT ROWID;
    CREATE TABLE indicators (code TEXT, period TEXT, ts INTEGER,
      ma5 REAL, ma20 REAL, ma60 REAL, ma120 REAL, ema12 REAL, ema26 REAL,
      rsi14 REAL, bb_upper REAL, bb_mid REAL, bb_lower REAL,
      macd REAL, macd_signal REAL, macd_hist REAL, vol_ma20 INTEGER,
      PRIMARY KEY (code, period, ts)) WITHOUT ROWID;
    CREATE TABLE sync_log (code TEXT, period TEXT, last_ts INTEGER, last_run_at INTEGER,
      status TEXT, error TEXT, PRIMARY KEY (code, period));
    CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, ts INTEGER,
      text TEXT, tags TEXT, created_at INTEGER);
    CREATE TABLE workspaces (name TEXT PRIMARY KEY, config TEXT, updated_at INTEGER);
    CREATE TABLE pattern_hits (pattern_id TEXT, code TEXT, period TEXT, ts INTEGER,
      score REAL, payload TEXT, PRIMARY KEY (pattern_id, code, period, ts)) WITHOUT ROWID;
    CREATE TABLE backtest_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, pattern_id TEXT,
      config TEXT, result TEXT, created_at INTEGER);
    CREATE TABLE sheet_columns (key TEXT PRIMARY KEY, label TEXT, type TEXT,
      sort_order INTEGER, created_at INTEGER);
    CREATE TABLE sheet_cells (code TEXT, column_key TEXT, value TEXT, updated_at INTEGER,
      PRIMARY KEY (code, column_key)) WITHOUT ROWID;
  `);

  const now = Date.now();
  const insertStock = db.prepare(
    'INSERT INTO stocks (code, name, market, yahoo_symbol, updated_at, shares_outstanding, shares_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const insertCandle = db.prepare(
    'INSERT INTO candles (code, period, ts, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertSync = db.prepare(
    'INSERT INTO sync_log (code, period, last_ts, last_run_at, status) VALUES (?, ?, ?, ?, ?)'
  );
  const insertCol = db.prepare(
    'INSERT INTO sheet_columns (key, label, type, sort_order, created_at) VALUES (?, ?, ?, ?, ?)'
  );

  STOCKS.forEach((s) => {
    insertStock.run(s.code, s.name, s.market, `${s.code}.KS`, now, s.shares, now);
    const candles = genCandles(s);
    const tx = db.transaction((arr) => {
      for (const c of arr) insertCandle.run(s.code, 'D', c.timestamp, c.open, c.high, c.low, c.close, c.volume);
    });
    tx(candles);
    const frames = computeAll(candles);
    saveIndicators(db, s.code, 'D', frames);
    insertSync.run(s.code, 'D', candles[candles.length - 1].timestamp, now, 'ok');
  });

  // 샘플 커스텀 컬럼 2개
  insertCol.run('qty', '보유수량', 'number', 0, now);
  insertCol.run('note', '메모', 'text', 1, now);

  db.close();
  console.log(`[seed-smoke] ${OUT} 생성 완료 (${STOCKS.length}종목 × 60일, sheet_columns=2)`);
}

main();
