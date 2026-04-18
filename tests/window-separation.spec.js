// 멀티 윈도우 분리 검증
const { test, expect } = require('@playwright/test');
const { launchApp, waitForChartReady } = require('./helpers');

test('[win-1] 차트 창 + 시총 창 둘 다 열린 상태', async () => {
  const { app, chartWindow, sheetWindow } = await launchApp();
  try {
    expect(chartWindow).toBeTruthy();
    expect(sheetWindow).toBeTruthy();
    const windows = app.windows();
    expect(windows.length).toBeGreaterThanOrEqual(2);
  } finally {
    await app.close();
  }
});

test('[win-2] 시총 창 row 클릭 → 차트 창 선택 종목 동기화', async () => {
  const { app, chartWindow, sheetWindow } = await launchApp();
  try {
    await waitForChartReady(chartWindow);
    await sheetWindow.locator('[data-testid="rank-row"][data-code="000660"]').click();
    await expect.poll(
      async () => (await chartWindow.evaluate(() => window._testHooks.getSelected())).code,
      { timeout: 5_000 }
    ).toBe('000660');
  } finally {
    await app.close();
  }
});

test('[win-3] 시총 창 닫기 → 차트 창 생존', async () => {
  const { app, chartWindow, sheetWindow } = await launchApp();
  try {
    await waitForChartReady(chartWindow);
    await sheetWindow.close();
    // 차트 창은 계속 반응
    const version = await chartWindow.evaluate(() => window.api.getVersion());
    expect(typeof version).toBe('string');
    // 시총 창 다시 열기
    const waitForSheet = app.waitForEvent('window');
    await chartWindow.evaluate(() => window.api.openSheetWindow());
    const reopened = await waitForSheet;
    await reopened.waitForLoadState('domcontentloaded');
    expect(reopened).toBeTruthy();
  } finally {
    await app.close();
  }
});

test('[win-4] isSheetOpen IPC 응답', async () => {
  const { app, chartWindow, sheetWindow } = await launchApp();
  try {
    const open1 = await chartWindow.evaluate(() => window.api.isSheetOpen());
    expect(open1).toBe(true);
    await sheetWindow.close();
    // close 전파 잠깐 대기
    await chartWindow.waitForTimeout(500);
    const open2 = await chartWindow.evaluate(() => window.api.isSheetOpen());
    expect(open2).toBe(false);
  } finally {
    await app.close();
  }
});
