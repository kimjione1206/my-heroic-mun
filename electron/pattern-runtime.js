/**
 * 패턴 플러그인 로더 + 샌드박스 + 핫 리로드.
 *
 * patterns/*.js 파일 하나당 하나의 패턴. _ 로 시작하는 파일은 로드하지 않음.
 * 파일 변경 시 require.cache 를 비우고 다시 로드 — 앱 재시작 불필요.
 */

const fs = require('fs');
const path = require('path');

class PatternRuntime {
  constructor(dir, getWindow) {
    this.dir = dir;
    this.getWindow = getWindow;
    this.patterns = new Map();
    this.errors = new Map();
    this.reload();
    this._watch();
  }

  _watch() {
    try {
      this._watcher = fs.watch(this.dir, { persistent: false }, (_event, filename) => {
        if (!filename || filename.startsWith('_') || !filename.endsWith('.js')) return;
        clearTimeout(this._debounce);
        this._debounce = setTimeout(() => this.reload(), 150);
      });
    } catch (e) { /* dir 없을 수 있음 */ }
  }

  stop() {
    try { this._watcher?.close(); } catch {}
    this._watcher = null;
    clearTimeout(this._debounce);
  }

  reload() {
    if (!fs.existsSync(this.dir)) return;
    this.patterns.clear();
    this.errors.clear();

    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(this.dir)) delete require.cache[key];
    }

    const files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.js') && !f.startsWith('_'));
    for (const file of files) {
      const full = path.join(this.dir, file);
      try {
        const mod = require(full);
        const p = mod.default || mod;
        if (!p?.id || typeof p.detect !== 'function') {
          throw new Error('패턴은 { id, name, detect } 를 반드시 포함해야 합니다');
        }
        this.patterns.set(p.id, p);
      } catch (e) {
        this.errors.set(file, e.message);
        console.error(`[pattern:${file}] 로드 실패 — ${e.message}`);
      }
    }
    this.getWindow()?.webContents.send('patterns:changed', {
      list: this.list(), errors: this._errorsArr(),
    });
  }

  list() {
    return [...this.patterns.values()].map((p) => ({
      id: p.id, name: p.name, description: p.description,
      color: p.color || '#ffbb00', defaultEnabled: !!p.defaultEnabled,
      applicableTimeframes: p.applicableTimeframes || ['D', 'W', 'M'],
    }));
  }

  _errorsArr() { return [...this.errors.entries()].map(([file, error]) => ({ file, error })); }

  runOne(id, candles, indicators, ctx) {
    const p = this.patterns.get(id);
    if (!p) return [];
    try { return p.detect(candles, indicators, ctx) || []; }
    catch (e) {
      console.error(`[pattern:${id}] detect 실패 — ${e.message}`);
      return [];
    }
  }

  runAll(ids, candles, indicators, ctx) {
    return ids.flatMap((id) =>
      this.runOne(id, candles, indicators, ctx).map((h) => ({ ...h, patternId: id }))
    );
  }
}

module.exports = { PatternRuntime };
