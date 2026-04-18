// Level 2 — MarketCapSheet (시총 창)
const { test, expect } = require('@playwright/test');
const { launchApp, waitForChartReady } = require('./helpers');

let app, chartWindow, sheetWindow;
test.beforeAll(async () => {
  ({ app, chartWindow, sheetWindow } = await launchApp());
  await waitForChartReady(chartWindow);
});
test.afterAll(async () => { await app?.close(); });

test('[sheet-1] 시총 창 랭킹 렌더 (fixture 2종목)', async () => {
  const rows = sheetWindow.locator('[data-testid="rank-row"]');
  await expect(rows).toHaveCount(2);
});

test('[sheet-2] 날짜 드롭다운 존재 + 옵션 있음', async () => {
  const select = sheetWindow.locator('[data-testid="date-select"]');
  await expect(select).toBeVisible();
  const count = await select.locator('option').count();
  expect(count).toBeGreaterThan(0);
});

test('[sheet-3] 커스텀 컬럼 추가 → 목록에 반영', async () => {
  await sheetWindow.locator('[data-testid="add-column-btn"]').click();
  await expect(sheetWindow.locator('[data-testid="add-column-modal"]')).toBeVisible();
  await sheetWindow.locator('[data-testid="new-column-label"]').fill('e2e_col');
  await sheetWindow.locator('[data-testid="add-column-submit"]').click();
  await expect(sheetWindow.locator('[data-testid="add-column-modal"]')).toHaveCount(0);
  const columns = await sheetWindow.evaluate(() => window.api.listSheetColumns());
  expect(columns.some((c) => c.label === 'e2e_col')).toBeTruthy();
  const key = columns.find((c) => c.label === 'e2e_col').key;
  await sheetWindow.evaluate((k) => window.api.removeSheetColumn(k), key);
});

test('[sheet-4] 셀 값 설정 → 재조회 시 유지', async () => {
  await sheetWindow.evaluate(async () => {
    await window.api.setSheetCell({ code: '005930', columnKey: 'qty', value: '123' });
  });
  const rankingRes = await sheetWindow.evaluate(async () => {
    const dates = await window.api.getMarketCapDates(10);
    return await window.api.getMarketCapRanking({ ts: dates[0] });
  });
  const samsung = rankingRes.rows.find((r) => r.code === '005930');
  expect(samsung?.cells?.qty).toBe('123');
  await sheetWindow.evaluate(async () => {
    await window.api.setSheetCell({ code: '005930', columnKey: 'qty', value: '' });
  });
});
