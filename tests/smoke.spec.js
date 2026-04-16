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
  expect(title).toContain('나만의 영웅문');
  // top bar 브랜드 텍스트
  await expect(window.locator('.title').first()).toBeVisible();
});

test('[smoke-2] fixture 관심종목 2종목 로드', async () => {
  const watchlist = await window.evaluate(() => window._testHooks.getWatchlist());
  expect(watchlist).toHaveLength(2);
  expect(watchlist.map((w) => w.code).sort()).toEqual(['000660', '005930']);
  // ticker-row 안의 항목으로 제한 (top bar 중복 회피)
  await expect(window.locator('.ticker-row:has-text("삼성전자")')).toBeVisible();
  await expect(window.locator('.ticker-row:has-text("SK하이닉스")')).toBeVisible();
});

test('[smoke-3] 차트 초기 렌더 (캔들 데이터 존재)', async () => {
  await waitForChartReady(window);
  const len = await window.evaluate(() => window._testHooks.getChart().getDataList().length);
  // KLineChart는 뷰포트 padding 포함 실제 캔들보다 큰 배열 반환 가능.
  // fixture의 60개 실 데이터 이상이면 통과 (padding 포함 300+ 가능).
  expect(len).toBeGreaterThanOrEqual(60);
  await expect(window.locator('[data-testid="kline-chart"] canvas').first()).toBeVisible();
});
