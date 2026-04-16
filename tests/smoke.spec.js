// Level 1 — Smoke (60초): 앱 기동·기본 렌더 확인
const { test, expect } = require('@playwright/test');
const { launchApp, waitForChartReady } = require('./helpers');

let app, window;

test.beforeAll(async () => {
  ({ app, window } = await launchApp());
});
test.afterAll(async () => {
  await app?.close();
});

test('[smoke-1] 앱 기동 + 타이틀 렌더', async () => {
  const title = await window.title();
  expect(title.length).toBeGreaterThan(0);
  await expect(window.locator('text=나만의 영웅문').first()).toBeVisible();
});

test('[smoke-2] fixture 관심종목 2종목 로드', async () => {
  const watchlist = await window.evaluate(() => window._testHooks.getWatchlist());
  expect(watchlist).toHaveLength(2);
  expect(watchlist.map((w) => w.code).sort()).toEqual(['000660', '005930']);
  await expect(window.locator('text=삼성전자')).toBeVisible();
  await expect(window.locator('text=SK하이닉스')).toBeVisible();
});

test('[smoke-3] 차트 초기 렌더 + 캔들 60개', async () => {
  await waitForChartReady(window);
  const len = await window.evaluate(() => window._testHooks.getChart().getDataList().length);
  expect(len).toBe(60);
  await expect(window.locator('[data-testid="kline-chart"] canvas').first()).toBeVisible();
});
