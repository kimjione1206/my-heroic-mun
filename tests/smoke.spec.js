// Level 1 — Smoke (60초): 앱 기동·기본 렌더 확인
const { test, expect } = require('@playwright/test');
const { launchApp, waitForChartReady } = require('./helpers');

let app, chartWindow, sheetWindow;

test.beforeAll(async () => {
  ({ app, chartWindow, sheetWindow } = await launchApp());
});
test.afterAll(async () => {
  await app?.close();
});

test('[smoke-1] 차트 창 기동 + 타이틀 렌더', async () => {
  const title = await chartWindow.title();
  expect(title).toContain('나만의 영웅문');
  await expect(chartWindow.locator('.title').first()).toBeVisible();
});

test('[smoke-2] 시총 창에 fixture 2종목 로드', async () => {
  await expect(sheetWindow.locator('[data-testid="rank-row"][data-code="005930"]')).toBeVisible();
  await expect(sheetWindow.locator('[data-testid="rank-row"][data-code="000660"]')).toBeVisible();
});

test('[smoke-3] 차트 초기 렌더 (캔들 데이터 존재)', async () => {
  await waitForChartReady(chartWindow);
  const len = await chartWindow.evaluate(() => window._testHooks.getChart().getDataList().length);
  expect(len).toBeGreaterThanOrEqual(60);
  await expect(chartWindow.locator('[data-testid="kline-chart"] canvas').first()).toBeVisible();
  await chartWindow.screenshot({ path: 'test-results/visual-full.png', fullPage: false });
  const chart = chartWindow.locator('[data-testid="kline-chart"]');
  await chart.screenshot({ path: 'test-results/visual-chart.png' });
  await sheetWindow.screenshot({ path: 'test-results/visual-sheet.png', fullPage: false });
});
