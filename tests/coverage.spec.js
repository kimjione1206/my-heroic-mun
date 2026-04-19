// 핵심 기능 커버리지 — 패턴/백테스트/검색/워크스페이스/랭킹/기간
const { test, expect } = require('@playwright/test');
const { launchApp, waitForChartReady } = require('./helpers');

let app, chartWindow, sheetWindow;
test.beforeAll(async () => {
  ({ app, chartWindow, sheetWindow } = await launchApp());
  await waitForChartReady(chartWindow);
});
test.afterAll(async () => { await app?.close(); });

test('[cov-1] 일봉 데이터 범위 — 10년(2016~2025) 커버', async () => {
  const range = await chartWindow.evaluate(() => {
    const d = window._testHooks.getChart().getDataList();
    return { first: d[0]?.timestamp, last: d[d.length - 1]?.timestamp, len: d.length };
  });
  const first = new Date(range.first);
  const last = new Date(range.last);
  expect(first.getUTCFullYear()).toBeLessThanOrEqual(2016);
  expect(last.getUTCFullYear()).toBeGreaterThanOrEqual(2025);
  // 영업일 × 10년 ≈ 2500 ± 150
  expect(range.len).toBeGreaterThanOrEqual(2400);
});

test('[cov-2] 종목 전체 검색 (stocks:search) — KOSPI + KOSDAQ', async () => {
  const list = await chartWindow.evaluate(() => window.api.searchStocks(''));
  expect(Array.isArray(list)).toBe(true);
  expect(list.length).toBeGreaterThanOrEqual(10);
  const markets = new Set(list.map((s) => s.market));
  expect(markets.has('KOSPI')).toBe(true);
  expect(markets.has('KOSDAQ')).toBe(true);

  const naver = await chartWindow.evaluate(() => window.api.searchStocks('NAVER'));
  expect(naver.some((s) => s.code === '035420')).toBe(true);
});

test('[cov-3] 패턴 목록 + 단일 패턴 실행', async () => {
  const patterns = await chartWindow.evaluate(() => window.api.listPatterns());
  expect(patterns.length).toBeGreaterThan(0);
  const first = patterns[0];
  const hits = await chartWindow.evaluate((id) => window.api.runPattern(id, '005930', 'D'), first.id);
  expect(Array.isArray(hits)).toBe(true);
});

test('[cov-4] 백테스트 IPC round-trip', async () => {
  const patterns = await chartWindow.evaluate(() => window.api.listPatterns());
  const first = patterns[0];
  const res = await chartWindow.evaluate(
    (args) => window.api.runBacktest(args),
    { code: '005930', period: 'D', patternId: first.id, holdDays: 5, entryAt: 'nextOpen', exitAt: 'close' }
  );
  expect(res).toBeTruthy();
  expect(typeof res.hits).toBe('number');
});

test('[cov-5] 워크스페이스 저장/로드/목록', async () => {
  const name = `e2e_ws_${Date.now()}`;
  const config = { period: 'W', indicators: ['ma20', 'rsi14'], note: 'coverage-test' };
  await chartWindow.evaluate(({ n, c }) => window.api.saveWorkspace(n, c), { n: name, c: config });
  const loaded = await chartWindow.evaluate((n) => window.api.loadWorkspace(n), name);
  expect(loaded?.note).toBe('coverage-test');
  const list = await chartWindow.evaluate(() => window.api.listWorkspaces());
  expect(list.some((w) => w.name === name)).toBe(true);
  await chartWindow.evaluate((n) => window.api.deleteWorkspace(n), name);
});

test('[cov-6] 시총 랭킹 날짜 목록 · 정렬 (최신이 맨 위)', async () => {
  const dates = await sheetWindow.evaluate(() => window.api.getMarketCapDates(20));
  expect(dates.length).toBeGreaterThan(0);
  // 내림차순 (최신 → 과거)
  for (let i = 1; i < dates.length; i++) {
    expect(dates[i - 1]).toBeGreaterThan(dates[i]);
  }
  const ranking = await sheetWindow.evaluate((ts) => window.api.getMarketCapRanking({ ts }), dates[0]);
  expect(ranking?.rows?.length).toBeGreaterThanOrEqual(10);
  // 시총 내림차순 정렬 확인 (market_cap 필드)
  for (let i = 1; i < ranking.rows.length; i++) {
    expect(ranking.rows[i - 1].market_cap).toBeGreaterThanOrEqual(ranking.rows[i].market_cap);
  }
});

test('[cov-7] 커스텀 컬럼 3종 타입 (number/text/bool) 저장·조회', async () => {
  // fixture 에 이미 qty(number), note(text), watch(bool) 3종이 있음
  const cols = await sheetWindow.evaluate(() => window.api.listSheetColumns());
  const types = new Set(cols.map((c) => c.type));
  expect(types.has('number')).toBe(true);
  expect(types.has('text')).toBe(true);
  expect(types.has('bool')).toBe(true);

  await sheetWindow.evaluate(async () => {
    await window.api.setSheetCell({ code: '005930', columnKey: 'note', value: 'cov-7 메모' });
    await window.api.setSheetCell({ code: '005930', columnKey: 'watch', value: 'true' });
  });
  const dates = await sheetWindow.evaluate(() => window.api.getMarketCapDates(1));
  const ranking = await sheetWindow.evaluate((ts) => window.api.getMarketCapRanking({ ts }), dates[0]);
  const samsung = ranking.rows.find((r) => r.code === '005930');
  expect(samsung?.cells?.note).toBe('cov-7 메모');
  expect(samsung?.cells?.watch).toBe('true');

  // cleanup
  await sheetWindow.evaluate(async () => {
    await window.api.setSheetCell({ code: '005930', columnKey: 'note', value: '' });
    await window.api.setSheetCell({ code: '005930', columnKey: 'watch', value: '' });
  });
});

test('[cov-8] 시총 창 키보드 네비 (↓ 화살표) → chartWindow 동기화', async () => {
  // 첫 row 선택 상태로 시작
  await sheetWindow.locator('[data-testid="rank-row"]').first().click();
  await chartWindow.waitForTimeout(200);
  const before = await chartWindow.evaluate(() => window._testHooks.getSelected()?.code);
  // sheetWindow 컨테이너에 포커스 보장 후 ↓
  await sheetWindow.locator('[data-testid="sheet-container"]').first().focus();
  await sheetWindow.keyboard.press('ArrowDown');
  await expect.poll(
    async () => (await chartWindow.evaluate(() => window._testHooks.getSelected()?.code)),
    { timeout: 4000 }
  ).not.toBe(before);
});

test('[cov-9] 주봉(W) / 월봉(M) 10년 범위 유지', async () => {
  const weekly = await chartWindow.evaluate(() => window.api.getCandles('005930', 'W'));
  const monthly = await chartWindow.evaluate(() => window.api.getCandles('005930', 'M'));
  expect(weekly.length).toBeGreaterThanOrEqual(400);   // ~10년 × 52주
  expect(monthly.length).toBeGreaterThanOrEqual(110);  // ~10년 × 12개월
  const firstWeekYear = new Date(weekly[0].timestamp).getUTCFullYear();
  const firstMonthYear = new Date(monthly[0].timestamp).getUTCFullYear();
  expect(firstWeekYear).toBeLessThanOrEqual(2016);
  expect(firstMonthYear).toBeLessThanOrEqual(2016);
});

test('[cov-10] 지표 IPC (MA/RSI/MACD) 로드', async () => {
  const ind = await chartWindow.evaluate(() => window.api.getIndicators('005930', 'D'));
  expect(Array.isArray(ind)).toBe(true);
  expect(ind.length).toBeGreaterThan(0);
  const last = ind[ind.length - 1];
  expect(last.ma5 ?? null).not.toBeNull();
  expect(last.rsi14 ?? null).not.toBeNull();
});

test('[cov-11] 스케줄러 상태 조회 + 수동 갱신 IPC (smoke 에서는 no-op)', async () => {
  const status = await chartWindow.evaluate(() => window.api.getSyncStatus());
  expect(status).toBeTruthy();
  // runSyncNow 는 smoke 모드에선 네트워크 호출 스킵되지만 IPC 자체는 응답해야 함
  const res = await chartWindow.evaluate(() => window.api.runSyncNow());
  expect(res).toBeTruthy();
});

test('[cov-12] fixture 기본 notes/workspace 존재 (seed 완결성)', async () => {
  const notes = await chartWindow.evaluate(() => window.api.listNotes('005930'));
  expect(notes.some((n) => n.text?.includes('삼성 메모'))).toBe(true);

  const wsList = await chartWindow.evaluate(() => window.api.listWorkspaces());
  expect(wsList.some((w) => w.name === 'default')).toBe(true);
});
