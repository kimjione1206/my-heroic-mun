/**
 * 앱 데이터 경로를 CLI와 Electron 양쪽에서 동일하게 반환한다.
 * Electron 환경(app 객체 존재)에서는 app.getPath('userData'),
 * node CLI 에서는 OS 표준 경로를 사용한다.
 */

const path = require('path');
const os = require('os');

const APP_NAME = 'my-heroic-mun';

function getUserDataPath() {
  try {
    const { app } = require('electron');
    if (app?.getPath) return app.getPath('userData');
  } catch { /* CLI 환경 */ }

  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', APP_NAME);
  if (process.platform === 'win32')  return path.join(process.env.APPDATA || home, APP_NAME);
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), APP_NAME);
}

module.exports = { APP_NAME, getUserDataPath };
