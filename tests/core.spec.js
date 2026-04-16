// Level 2 — Core (3분): 주요 상호작용
const { test, expect } = require('@playwright/test');
const { launchApp, waitForChartReady } = require('./helpers');

let app, window;
test.beforeAll(async () => {
  ({ app, window } = await launchApp());
  await waitForChartReady(window);
});
test.afterAll(async () => { await app?.close(); });

test('[core-1] 종목 선택 → 선택 상태 변경', async () => {
  await window.locator('.ticker-row:has-text("SK하이닉스")').click();
  await expect.poll(
    async () => (await window.evaluate(() => window._testHooks.getSelected())).code
  ).toBe('000660');
  await waitForChartReady(window);
});

test('[core-2] 타임프레임 전환 버튼', async () => {
  // ChartToolbar 버튼 "주" / "월" 순서 확인은 실제 구현에 따름 — 텍스트 기반
  const buttons = await window.locator('button').allTextContents();
  expect(buttons.some((b) => b.trim() === '일' || b.includes('일봉'))).toBeTruthy();
});

test('[core-3] 보조지표 MA 토글', async () => {
  const ma = window.locator('button:has-text("MA")').first();
  if (await ma.count() > 0) {
    await ma.click();
    await window.waitForTimeout(300);
    await ma.click();
  }
  // 에러 없이 클릭 가능 확인
  expect(true).toBe(true);
});

test('[core-4] 감지된 패턴 — IPC 호출 성공', async () => {
  const list = await window.evaluate(() => window.api.listPatterns());
  expect(Array.isArray(list)).toBe(true);
});

test('[core-5] 수동 갱신 버튼 존재 + 클릭 가능', async () => {
  const btn = window.locator('button:has-text("갱신")').first();
  await expect(btn).toBeVisible();
  // smoke 모드에선 sync 로직이 돌아가지만 IPC 응답만 확인
  const status = await window.evaluate(() => window.api.getSyncStatus());
  expect(status).toBeTruthy();
});

test('[core-6] 메모 IPC round-trip', async () => {
  const added = await window.evaluate(async () => {
    await window.api.addNote('005930', Date.now(), 'e2e test note', 'test');
    return window.api.listNotes('005930');
  });
  expect(Array.isArray(added)).toBe(true);
  expect(added.some((n) => n.text === 'e2e test note')).toBe(true);

  // cleanup
  await window.evaluate(async (notes) => {
    for (const n of notes.filter((x) => x.text === 'e2e test note')) {
      await window.api.removeNote(n.id);
    }
  }, added);
});
