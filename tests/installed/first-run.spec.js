// 실제 NSIS installer 로 설치된 바이너리 대상 E2E.
// CI 에서 `MYH_INSTALLED_EXE` 로 설치된 exe 경로가 주입됨.
// win-unpacked 직실행과 달리 실설치 경로·asar.unpacked 실제 위치·첫기동 bootstrap 전체 검증.
const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

const INSTALLED_EXE = process.env.MYH_INSTALLED_EXE;

test.beforeAll(() => {
  if (!INSTALLED_EXE) throw new Error('MYH_INSTALLED_EXE 미설정 — CI 의 Silent install step 확인');
  if (!fs.existsSync(INSTALLED_EXE)) throw new Error(`설치된 exe 없음: ${INSTALLED_EXE}`);
});

async function launch({ preStage = null } = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'myh-installed-'));
  if (preStage) fs.copyFileSync(preStage, path.join(tmpDir, 'warehouse.sqlite'));
  const env = { ...process.env, NODE_ENV: 'production', MYH_USERDATA: tmpDir, MYH_NO_NET: '1' };
  delete env.MYH_SMOKE;
  const app = await _electron.launch({
    executablePath: INSTALLED_EXE,
    env,
    timeout: 90_000,  // bootstrap 900MB copy 소요 감안
  });
  const cleanup = async () => {
    try { await app.close(); } catch {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  };
  return { app, tmpDir, cleanup };
}

async function getStockCount(win) {
  const ds = await win.evaluate(() => window.api.getDataSource());
  return parseInt(/(\d+)개 종목/.exec(ds?.label || '')?.[1] || '0', 10);
}

test('[inst-1] silent 설치 후 첫 기동 — bootstrap 으로 2,631종목 자동 로드', async () => {
  const { app, tmpDir, cleanup } = await launch();
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    // 첫 기동 bootstrap: 941MB release DB 를 userData 로 copy → 디스크 속도에 따라 10~60s
    await win.waitForFunction(() => !!window.api, null, { timeout: 90_000 });

    const n = await getStockCount(win);
    expect(n).toBeGreaterThanOrEqual(2600);

    // bootstrap 실행으로 userData 에 warehouse.sqlite 가 생성됐는지 확인
    const userDb = path.join(tmpDir, 'warehouse.sqlite');
    expect(fs.existsSync(userDb)).toBe(true);
    const sz = fs.statSync(userDb).size / (1024 * 1024);
    expect(sz).toBeGreaterThanOrEqual(900);  // release DB 원본 크기

    // 시총 창 열어서 실사용 스크린샷 저장
    await win.evaluate(() => window.api.openSheetWindow());
    const deadline = Date.now() + 15_000;
    let sheet = null;
    while (Date.now() < deadline && !sheet) {
      sheet = app.windows().find((w) => { try { return /sheet(\.html)?$/.test(w.url()); } catch { return false; } });
      if (!sheet) await new Promise((r) => setTimeout(r, 150));
    }
    expect(sheet).toBeTruthy();
    await sheet.waitForLoadState('domcontentloaded');
    await sheet.waitForFunction(() => !!window.api, null, { timeout: 20_000 });
    await sheet.waitForSelector('[data-testid="rank-row"]', { timeout: 20_000 });
    await sheet.screenshot({ path: 'test-results/installed-first-run-sheet.png', fullPage: false });
    await win.screenshot({ path: 'test-results/installed-first-run-chart.png', fullPage: false });
  } finally { await cleanup(); }
});

test('[inst-2] 옛 5종목 DB 잔존 → 실설치 앱이 자동 재복구', async () => {
  // 옛 버전 사용자의 실제 시나리오 재현: stale DB 를 userData 에 pre-stage
  // peekStocksCount 가드가 <100 감지 → release seed 로 강제 재복사
  const smokeSrc = path.join(__dirname, '..', '..', 'test', 'fixtures', 'smoke-warehouse.sqlite');
  test.skip(!fs.existsSync(smokeSrc), 'smoke seed 필요');
  const { app, cleanup } = await launch({ preStage: smokeSrc });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForFunction(() => !!window.api, null, { timeout: 90_000 });
    const n = await getStockCount(win);
    expect(n).toBeGreaterThanOrEqual(2600);
  } finally { await cleanup(); }
});
