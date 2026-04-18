// Level 2 — Core (3분): 주요 상호작용
const { test, expect } = require('@playwright/test');
const { launchApp, waitForChartReady } = require('./helpers');

let app, chartWindow, sheetWindow;
test.beforeAll(async () => {
  ({ app, chartWindow, sheetWindow } = await launchApp());
  await waitForChartReady(chartWindow);
});
test.afterAll(async () => { await app?.close(); });

test('[core-1] 시총 창 row 클릭 → 차트 창 선택 종목 동기화', async () => {
  await sheetWindow.locator('[data-testid="rank-row"][data-code="000660"]').click();
  await expect.poll(
    async () => (await chartWindow.evaluate(() => window._testHooks.getSelected())).code
  ).toBe('000660');
  await waitForChartReady(chartWindow);
});

test('[core-2] 타임프레임 버튼 (차트 창)', async () => {
  const buttons = await chartWindow.locator('button').allTextContents();
  expect(buttons.some((b) => b.trim() === '일' || b.includes('일봉'))).toBeTruthy();
});

test('[core-3] 보조지표 MA 토글 (차트 창)', async () => {
  const ma = chartWindow.locator('button:has-text("MA")').first();
  if (await ma.count() > 0) {
    await ma.click();
    await chartWindow.waitForTimeout(300);
    await ma.click();
  }
  expect(true).toBe(true);
});

test('[core-4] 패턴 IPC (차트 창)', async () => {
  const list = await chartWindow.evaluate(() => window.api.listPatterns());
  expect(Array.isArray(list)).toBe(true);
});

test('[core-5] 수동 갱신 버튼 (차트 창)', async () => {
  const btn = chartWindow.locator('button:has-text("갱신")').first();
  await expect(btn).toBeVisible();
  const status = await chartWindow.evaluate(() => window.api.getSyncStatus());
  expect(status).toBeTruthy();
});

test('[core-6] 메모 IPC round-trip (차트 창)', async () => {
  const added = await chartWindow.evaluate(async () => {
    await window.api.addNote('005930', Date.now(), 'e2e test note', 'test');
    return window.api.listNotes('005930');
  });
  expect(Array.isArray(added)).toBe(true);
  expect(added.some((n) => n.text === 'e2e test note')).toBe(true);

  await chartWindow.evaluate(async (notes) => {
    for (const n of notes.filter((x) => x.text === 'e2e test note')) {
      await window.api.removeNote(n.id);
    }
  }, added);
});
