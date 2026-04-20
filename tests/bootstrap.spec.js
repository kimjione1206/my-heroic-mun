// 번들 release seed DB 복사 플로우 검증
// [boot-1] release seed 번들이 없을 때 SEED(5종목) 폴백
// [boot-2] 정상적으로 2,631종목 DB 가 이미 있으면 덮어쓰지 않음
// [boot-3] 옛 5/10종목 stale DB 가 있으면 release seed 로 자동 재복구 (핵심 회귀 방지)
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron } = require('@playwright/test');
const { findUnpackedExe } = require('./helpers');

const PROJECT_ROOT = path.join(__dirname, '..');
const RELEASE_SEED = path.join(PROJECT_ROOT, 'test', 'fixtures', 'release-warehouse.sqlite');
const SMOKE_SEED = path.join(PROJECT_ROOT, 'test', 'fixtures', 'smoke-warehouse.sqlite');
const RELEASE_EXISTS = fs.existsSync(RELEASE_SEED);

function launchOpts(env, exe) {
  return exe
    ? { executablePath: exe, env, timeout: 60_000 }
    : { args: [path.join(PROJECT_ROOT, 'electron', 'main.js')], env, cwd: PROJECT_ROOT, timeout: 60_000 };
}

async function launchClean({ preStage = null } = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'myh-boot-'));
  if (preStage) {
    fs.copyFileSync(preStage, path.join(tmpDir, 'warehouse.sqlite'));
  }
  const env = { ...process.env, NODE_ENV: 'production', MYH_USERDATA: tmpDir, MYH_NO_NET: '1' };
  delete env.MYH_SMOKE;
  const app = await _electron.launch(launchOpts(env, findUnpackedExe()));
  const cleanup = async () => {
    try { await app.close(); } catch {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  };
  return { app, tmpDir, cleanup };
}

test('[boot-1] release seed 번들 없으면 SEED(5종목) 폴백', async () => {
  // release seed 를 일시적으로 숨김
  const backup = `${RELEASE_SEED}.bak-${Date.now()}`;
  let moved = false;
  if (RELEASE_EXISTS) { fs.renameSync(RELEASE_SEED, backup); moved = true; }
  try {
    const { app, tmpDir, cleanup } = await launchClean();
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');
      await win.waitForFunction(() => !!window.api, null, { timeout: 20_000 });
      const stocks = await win.evaluate(() => window.api.searchStocks(''));
      expect(stocks.length).toBeGreaterThanOrEqual(5);
      expect(stocks.length).toBeLessThan(50);
      expect(fs.existsSync(path.join(tmpDir, 'warehouse.sqlite'))).toBe(true);
    } finally { await cleanup(); }
  } finally {
    if (moved) fs.renameSync(backup, RELEASE_SEED);
  }
});

test('[boot-2] 이미 정상 DB(2,600+) 가 있으면 덮어쓰지 않음', async () => {
  test.skip(!RELEASE_EXISTS, 'release seed 필요');
  const { app, tmpDir, cleanup } = await launchClean({ preStage: RELEASE_SEED });
  const sizeBefore = fs.statSync(path.join(tmpDir, 'warehouse.sqlite')).size;
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForFunction(() => !!window.api, null, { timeout: 30_000 });
    const ds = await win.evaluate(() => window.api.getDataSource());
    const n = parseInt(/(\d+)개 종목/.exec(ds?.label || '')?.[1] || '0', 10);
    expect(n).toBeGreaterThanOrEqual(2600);
    const sizeAfter = fs.statSync(path.join(tmpDir, 'warehouse.sqlite')).size;
    // WAL 체크포인트로 약간 늘 수 있으나 줄지는 않음
    expect(sizeAfter).toBeGreaterThanOrEqual(sizeBefore * 0.99);
  } finally { await cleanup(); }
});

test('[boot-3] stale 10종목 DB → release seed 로 자동 재복구 (회귀 방지)', async () => {
  test.skip(!RELEASE_EXISTS, 'release seed 필요');
  test.skip(!fs.existsSync(SMOKE_SEED), 'smoke seed 필요');

  // 옛 버전 사용자가 남긴 stale DB 를 시뮬레이션 — smoke fixture(10종목) 를 pre-stage
  const { app, tmpDir, cleanup } = await launchClean({ preStage: SMOKE_SEED });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForFunction(() => !!window.api, null, { timeout: 30_000 });

    // 새 가드: stocks < 100 감지 → release DB 로 재복사 → 2,631종목이 되어야 함
    const ds = await win.evaluate(() => window.api.getDataSource());
    const n = parseInt(/(\d+)개 종목/.exec(ds?.label || '')?.[1] || '0', 10);
    expect(n).toBeGreaterThanOrEqual(2600);

    // 시총창 스크린샷: "설치-직후-첫기동" 맥락
    await win.evaluate(() => window.api.openSheetWindow());
    const deadline = Date.now() + 15_000;
    let sheet = null;
    while (Date.now() < deadline && !sheet) {
      sheet = app.windows().find((w) => { try { return /sheet(\.html)?$/.test(w.url()); } catch { return false; } });
      if (!sheet) await new Promise((r) => setTimeout(r, 150));
    }
    expect(sheet).toBeTruthy();
    await sheet.waitForLoadState('domcontentloaded');
    await sheet.waitForFunction(() => !!window.api, null, { timeout: 15_000 });
    await sheet.waitForSelector('[data-testid="rank-row"]', { timeout: 15_000 });
    await sheet.screenshot({ path: 'test-results/bootstrap-first-run-sheet.png', fullPage: false });
  } finally { await cleanup(); }
});
