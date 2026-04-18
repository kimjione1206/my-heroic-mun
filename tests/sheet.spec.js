// Level 2 — MarketCapSheet 동작
const { test, expect } = require('@playwright/test');
const { launchApp, waitForChartReady } = require('./helpers');

let app, window;
test.beforeAll(async () => {
  ({ app, window } = await launchApp());
  await waitForChartReady(window);
});
test.afterAll(async () => { await app?.close(); });

test('[sheet-1] 기본 랭킹 렌더 (fixture 2종목)', async () => {
  const rows = window.locator('[data-testid="rank-row"]');
  await expect(rows).toHaveCount(2);
});

test('[sheet-2] 날짜 드롭다운 존재 + 옵션 있음', async () => {
  const select = window.locator('[data-testid="date-select"]');
  await expect(select).toBeVisible();
  const count = await select.locator('option').count();
  expect(count).toBeGreaterThan(0);
});

test('[sheet-3] 커스텀 컬럼 추가 → 헤더에 표시', async () => {
  await window.locator('[data-testid="add-column-btn"]').click();
  await expect(window.locator('[data-testid="add-column-modal"]')).toBeVisible();
  await window.locator('[data-testid="new-column-label"]').fill('e2e_col');
  await window.locator('[data-testid="add-column-submit"]').click();
  // 모달 닫힘 + 컬럼 헤더 등장
  await expect(window.locator('[data-testid="add-column-modal"]')).toHaveCount(0);
  const columns = await window.evaluate(() => window.api.listSheetColumns());
  expect(columns.some((c) => c.label === 'e2e_col')).toBeTruthy();
  // cleanup
  const key = columns.find((c) => c.label === 'e2e_col').key;
  await window.evaluate((k) => window.api.removeSheetColumn(k), key);
});

test('[sheet-4] 셀 값 설정 → 재조회 시 유지', async () => {
  // 'qty' 컬럼은 fixture 에 포함
  await window.evaluate(async () => {
    await window.api.setSheetCell({ code: '005930', columnKey: 'qty', value: '123' });
  });
  const rankingRes = await window.evaluate(async () => {
    const dates = await window.api.getMarketCapDates(10);
    return await window.api.getMarketCapRanking({ ts: dates[0] });
  });
  const samsung = rankingRes.rows.find((r) => r.code === '005930');
  expect(samsung?.cells?.qty).toBe('123');
  // cleanup
  await window.evaluate(async () => {
    await window.api.setSheetCell({ code: '005930', columnKey: 'qty', value: '' });
  });
});
