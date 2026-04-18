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
  await expect(window.locator('.title').first()).toBeVisible();
});

test('[smoke-2] MarketCapSheet에 fixture 2종목 로드', async () => {
  // fixture의 2종목이 시총 순위 리스트에 렌더되어야 함
  await expect(window.locator('[data-testid="rank-row"][data-code="005930"]')).toBeVisible();
  await expect(window.locator('[data-testid="rank-row"][data-code="000660"]')).toBeVisible();
});

test('[smoke-3] 차트 초기 렌더 (캔들 데이터 존재)', async () => {
  await waitForChartReady(window);
  const len = await window.evaluate(() => window._testHooks.getChart().getDataList().length);
  expect(len).toBeGreaterThanOrEqual(60);
  await expect(window.locator('[data-testid="kline-chart"] canvas').first()).toBeVisible();
  await window.screenshot({ path: 'test-results/visual-full.png', fullPage: false });
  const chart = window.locator('[data-testid="kline-chart"]');
  await chart.screenshot({ path: 'test-results/visual-chart.png' });
});
