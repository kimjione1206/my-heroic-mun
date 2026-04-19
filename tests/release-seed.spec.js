// Release seed DB 검증 — CI 가 release-warehouse.sqlite 를 다운로드해놓은 경우에만 실행.
// installer 에 번들되는 실제 데이터가 "전 종목 2600+ × 10년" 을 만족하는지 e2e 레벨에서 확인.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { test, expect, _electron } = require('@playwright/test');
const { findUnpackedExe } = require('./helpers');

const PROJECT_ROOT = path.join(__dirname, '..');
const SEED = path.join(PROJECT_ROOT, 'test', 'fixtures', 'release-warehouse.sqlite');
const SEED_EXISTS = fs.existsSync(SEED);

test.describe('release seed (전 종목 번들 검증)', () => {
  test.skip(!SEED_EXISTS, 'release-warehouse.sqlite 없음 — SEED 폴백 빌드');

  let app, win, tmpDir;
  test.beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'myh-release-'));
    // 설치 직후 시뮬레이션: userData 가 비어있으면 bootstrap 이 release seed 를 복사
    // 여기서는 시간 절약을 위해 직접 seed 를 userData 에 복사
    fs.copyFileSync(SEED, path.join(tmpDir, 'warehouse.sqlite'));
    const env = { ...process.env, NODE_ENV: 'production', MYH_USERDATA: tmpDir, MYH_NO_NET: '1' };
    const exe = findUnpackedExe();
    const launchOpts = exe
      ? { executablePath: exe, env, timeout: 60_000 }
      : { args: [path.join(PROJECT_ROOT, 'electron', 'main.js')], env, cwd: PROJECT_ROOT, timeout: 60_000 };
    app = await _electron.launch(launchOpts);
    win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForFunction(() => !!window.api, null, { timeout: 30_000 });
  });
  test.afterAll(async () => {
    try { await app?.close(); } catch {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  test('[rel-1] stocks 테이블 2600종목 이상', async () => {
    const ds = await win.evaluate(() => window.api.getDataSource());
    // label: "Yahoo Finance · {N}개 종목"
    const match = /(\d+)개 종목/.exec(ds?.label || '');
    const n = match ? parseInt(match[1], 10) : 0;
    expect(n).toBeGreaterThanOrEqual(2600);
  });

  test('[rel-2] KOSPI + KOSDAQ 혼재 (시총 랭킹 기준)', async () => {
    const dates = await win.evaluate(() => window.api.getMarketCapDates(1));
    const ranking = await win.evaluate((ts) => window.api.getMarketCapRanking({ ts, limit: 3000 }), dates[0]);
    const markets = new Set(ranking.rows.map((r) => r.market));
    expect(markets.has('KOSPI')).toBe(true);
    expect(markets.has('KOSDAQ')).toBe(true);
    const kospi = ranking.rows.filter((r) => r.market === 'KOSPI').length;
    const kosdaq = ranking.rows.filter((r) => r.market === 'KOSDAQ').length;
    expect(kospi).toBeGreaterThanOrEqual(500);    // shares 수집률 반영
    expect(kosdaq).toBeGreaterThanOrEqual(1000);
  });

  test('[rel-3] 시총 랭킹 2000행 이상 (shares_outstanding 80% 이상 수집됨)', async () => {
    const dates = await win.evaluate(() => window.api.getMarketCapDates(1));
    expect(dates.length).toBeGreaterThan(0);
    const ranking = await win.evaluate((ts) => window.api.getMarketCapRanking({ ts, limit: 3000 }), dates[0]);
    expect(ranking?.rows?.length).toBeGreaterThanOrEqual(2000);
    // 시총 내림차순
    for (let i = 1; i < Math.min(ranking.rows.length, 100); i++) {
      expect(ranking.rows[i - 1].market_cap).toBeGreaterThanOrEqual(ranking.rows[i].market_cap);
    }
  });

  test('[rel-4] 삼성전자 10년 일봉 (2016~2025) 로드', async () => {
    const candles = await win.evaluate(() => window.api.getCandles('005930', 'D'));
    expect(candles.length).toBeGreaterThanOrEqual(2400);
    const first = new Date(candles[0].timestamp).getUTCFullYear();
    const last = new Date(candles[candles.length - 1].timestamp).getUTCFullYear();
    expect(first).toBeLessThanOrEqual(2016);
    expect(last).toBeGreaterThanOrEqual(2025);
  });

  test('[rel-5] 임의 10종목 샘플링 — 일봉 100개 이상', async () => {
    const stocks = await win.evaluate(() => window.api.searchStocks(''));
    // 시총 순위 상위 종목 10개 추출
    const dates = await win.evaluate(() => window.api.getMarketCapDates(1));
    const ranking = await win.evaluate((ts) => window.api.getMarketCapRanking({ ts, limit: 10 }), dates[0]);
    const top10 = ranking.rows.map((r) => r.code);
    let okCount = 0;
    for (const code of top10) {
      const candles = await win.evaluate((c) => window.api.getCandles(c, 'D'), code);
      if (candles.length >= 100) okCount++;
    }
    expect(okCount).toBeGreaterThanOrEqual(9);  // 10개 중 9개 이상은 양호한 데이터
  });
});
