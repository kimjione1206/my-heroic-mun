#!/usr/bin/env node
/**
 * 스모크/e2e 테스트용 고정 warehouse.sqlite 생성기.
 *
 * 결과: test/fixtures/smoke-warehouse.sqlite
 *   - stocks 10종목 (KOSPI 8 + KOSDAQ 2) with shares_outstanding
 *   - candles × ≈10년 (2016-01-04 ~ 2025-12-31, 영업일만)
 *   - indicators 선계산
 *   - sheet_columns 샘플 (qty, note)
 *   - 1개 workspace · 2개 notes · 1개 pattern_hit 로 IPC round-trip 테스트 지원
 *
 * 호출: node test/fixtures/seed-smoke.js
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { computeAll, saveIndicators } = require('../../electron/indicators');

const OUT = path.join(__dirname, 'smoke-warehouse.sqlite');

// 프로덕션과 동일하게 시총 상위 10종목 (KOSPI 8 + KOSDAQ 2). shares 값은 실제 근사치.
const STOCKS = [
  { code: '005930', name: '삼성전자',          market: 'KOSPI',  seed: 70000,  vol: 15_000_000, shares: 5_969_782_550 },
  { code: '000660', name: 'SK하이닉스',         market: 'KOSPI',  seed: 140000, vol: 3_500_000,  shares: 728_002_365 },
  { code: '373220', name: 'LG에너지솔루션',      market: 'KOSPI',  seed: 400000, vol: 500_000,    shares: 234_000_000 },
  { code: '207940', name: '삼성바이오로직스',    market: 'KOSPI',  seed: 850000, vol: 120_000,    shares: 71_174_000 },
  { code: '005380', name: '현대차',            market: 'KOSPI',  seed: 190000, vol: 1_500_000,  shares: 213_668_187 },
  { code: '000270', name: '기아',              market: 'KOSPI',  seed: 95000,  vol: 1_800_000,  shares: 405_363_347 },
  { code: '035420', name: 'NAVER',             market: 'KOSPI',  seed: 220000, vol: 700_000,    shares: 163_876_734 },
  { code: '035720', name: '카카오',            market: 'KOSPI',  seed: 55000,  vol: 2_500_000,  shares: 443_618_178 },
  { code: '247540', name: '에코프로비엠',       market: 'KOSDAQ', seed: 280000, vol: 900_000,    shares: 97_801_344 },
  { code: '086520', name: '에코프로',           market: 'KOSDAQ', seed: 620000, vol: 400_000,    shares: 26_631_912 },
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

function isWeekday(date) {
  const d = date.getUTCDay();
  return d >= 1 && d <= 5;
}

// 2016-01-04 ~ 2025-12-31 영업일만 (주말 제외). 실제 공휴일은 생략 — e2e 에선 범위만 중요.
function tradingDays() {
  const out = [];
  const start = new Date('2016-01-04T00:00:00Z');
  const end = new Date('2025-12-31T00:00:00Z');
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    const d = new Date(t);
    if (isWeekday(d)) out.push(t);
  }
  return out;
}

function genCandles({ code, seed, vol }, days) {
  const rng = deterministicRng(code);
  const out = [];
  let price = seed;
  for (const ts of days) {
    const pct = (rng() - 0.485) * 0.06;
    const open = price;
    const close = Math.max(100, Math.round(price * (1 + pct)));
    const high = Math.round(Math.max(open, close) * (1 + rng() * 0.02));
    const low  = Math.round(Math.min(open, close) * (1 - rng() * 0.02));
    const volume = Math.round(vol * (0.4 + rng() * 1.4));
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
  const insertNote = db.prepare(
    'INSERT INTO notes (code, ts, text, tags, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  const insertWs = db.prepare(
    'INSERT INTO workspaces (name, config, updated_at) VALUES (?, ?, ?)'
  );

  const days = tradingDays();
  console.log(`[seed-smoke] trading days: ${days.length} (${new Date(days[0]).toISOString().slice(0, 10)} ~ ${new Date(days[days.length - 1]).toISOString().slice(0, 10)})`);

  STOCKS.forEach((s) => {
    insertStock.run(s.code, s.name, s.market, `${s.code}.${s.market === 'KOSPI' ? 'KS' : 'KQ'}`, now, s.shares, now);
    const candles = genCandles(s, days);
    const tx = db.transaction((arr) => {
      for (const c of arr) insertCandle.run(s.code, 'D', c.timestamp, c.open, c.high, c.low, c.close, c.volume);
    });
    tx(candles);
    const frames = computeAll(candles);
    saveIndicators(db, s.code, 'D', frames);
    insertSync.run(s.code, 'D', candles[candles.length - 1].timestamp, now, 'ok');
  });

  // 샘플 sheet columns (text / number / bool)
  insertCol.run('qty', '보유수량', 'number', 0, now);
  insertCol.run('note', '메모', 'text', 1, now);
  insertCol.run('watch', '관심', 'bool', 2, now);

  // 샘플 notes · workspace (IPC round-trip 기본 기대 데이터)
  insertNote.run('005930', days[days.length - 10], '삼성 메모 1', 'sample', now);
  insertNote.run('000660', days[days.length - 5], 'SK 메모 1', 'sample', now);
  insertWs.run('default', JSON.stringify({ period: 'D', indicators: ['ma5', 'ma20'] }), now);

  db.close();
  console.log(`[seed-smoke] ${OUT} 생성 완료 (${STOCKS.length}종목 × ${days.length}일, 2016~2025)`);
}

main();
