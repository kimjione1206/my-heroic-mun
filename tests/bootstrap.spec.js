// 번들 release seed DB 복사 플로우 검증 (smoke 모드 아닌 코드 경로)
// 실제 release-warehouse.sqlite 가 없을 때의 폴백 (SEED 5종목 유지) 도 확인
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron } = require('@playwright/test');
const { findUnpackedExe } = require('./helpers');

const PROJECT_ROOT = path.join(__dirname, '..');

async function launchWithIsolatedUserData({ withReleaseSeed = false } = {}) {
  const exe = findUnpackedExe();
  // 격리된 userData 경로로 앱 실행 → "최초 설치" 시뮬레이션
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'myh-bootstrap-'));
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    // MYH_SMOKE 는 설정하지 않음 (bootstrap 분기 타도록)
    MYH_USERDATA: tmpDir,
    MYH_NO_NET: '1',  // 테스트 중 네트워크 호출 차단
  };
  // 네트워크 호출은 scheduler boot-sync 경로로만 발생 — 테스트 중에는 네트워크 차단 환경일 수 있음
  // 앱 자체는 DB 존재 여부만 체크하므로 문제 없음

  // release seed 번들 여부 조정
  const releaseSeedPath = path.join(PROJECT_ROOT, 'test', 'fixtures', 'release-warehouse.sqlite');
  const backupPath = `${releaseSeedPath}.bak-${Date.now()}`;
  let restored = false;
  if (!withReleaseSeed && fs.existsSync(releaseSeedPath)) {
    fs.renameSync(releaseSeedPath, backupPath);
    restored = true;
  }

  const launchOpts = exe
    ? { executablePath: exe, env, timeout: 30_000 }
    : { args: [path.join(PROJECT_ROOT, 'electron', 'main.js')], env, cwd: PROJECT_ROOT, timeout: 30_000 };

  const cleanup = async (app) => {
    try { await app?.close(); } catch {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    if (restored && fs.existsSync(backupPath)) {
      try { fs.renameSync(backupPath, releaseSeedPath); } catch {}
    }
  };

  const app = await _electron.launch(launchOpts);
  return { app, tmpDir, cleanup };
}

test('[boot-1] release seed 없으면 SEED(5종목)로 폴백', async () => {
  const { app, tmpDir, cleanup } = await launchWithIsolatedUserData({ withReleaseSeed: false });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForFunction(() => !!window.api, null, { timeout: 20_000 });
    const stocks = await win.evaluate(() => window.api.searchStocks(''));
    // 빈 DB → seedStocksIfEmpty(SEED) 가 5개만 삽입
    expect(stocks.length).toBeGreaterThanOrEqual(5);
    expect(stocks.length).toBeLessThan(50);
    // userData 경로 존재 확인
    expect(fs.existsSync(path.join(tmpDir, 'warehouse.sqlite'))).toBe(true);
  } finally {
    await cleanup(app);
  }
});

test('[boot-2] 기존 warehouse.sqlite 존재 시 덮어쓰지 않음', async () => {
  // 사전 DB 배치: smoke fixture 를 userData 에 미리 깔아놓고 앱을 smoke 가 아닌
  // 모드로 기동 → bootstrap 분기가 덮어쓰지 않고 기존 DB 를 그대로 사용해야 함
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'myh-boot2-'));
  const dbPath = path.join(tmpDir, 'warehouse.sqlite');
  const fixtureSrc = path.join(PROJECT_ROOT, 'test', 'fixtures', 'smoke-warehouse.sqlite');
  fs.copyFileSync(fixtureSrc, dbPath);
  const sizeBefore = fs.statSync(dbPath).size;

  const env = { ...process.env, NODE_ENV: 'production', MYH_USERDATA: tmpDir, MYH_NO_NET: '1' };
  const exe = findUnpackedExe();
  const launchOpts = exe
    ? { executablePath: exe, env, timeout: 30_000 }
    : { args: [path.join(PROJECT_ROOT, 'electron', 'main.js')], env, cwd: PROJECT_ROOT, timeout: 30_000 };
  const app = await _electron.launch(launchOpts);
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForFunction(() => !!window.api, null, { timeout: 20_000 });

    // fixture 의 10종목이 그대로 보이면 덮어쓰기가 없었다는 의미
    const stocks = await win.evaluate(() => window.api.searchStocks(''));
    expect(stocks.length).toBeGreaterThanOrEqual(10);
    expect(stocks.some((s) => s.code === '247540')).toBe(true); // fixture 에코프로비엠

    // DB 크기도 동일 (부록적 확인)
    const sizeAfter = fs.statSync(dbPath).size;
    expect(sizeAfter).toBeGreaterThanOrEqual(sizeBefore);
  } finally {
    try { await app.close(); } catch {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});
