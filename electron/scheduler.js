/**
 * 장 마감 후 증분 동기화 스케줄러.
 * node-cron 같은 의존성 없이 매 분 확인 방식.
 */

const { syncMany } = require('./sync');

// KST (UTC+9) 기준 {year, month, date, day, hour, minute} 반환.
// JS Date의 getUTC* 만 사용하여 로컬 시간대 영향을 제거.
function partsKST(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 3600000);
  return {
    year: kst.getUTCFullYear(),
    month: kst.getUTCMonth() + 1,  // 1~12
    date: kst.getUTCDate(),        // 1~31
    day: kst.getUTCDay(),          // 0=일, 1~5=평일, 6=토
    hour: kst.getUTCHours(),
    minute: kst.getUTCMinutes(),
  };
}

function ymdKST(now) {
  const p = partsKST(now);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.date).padStart(2, '0')}`;
}

class Scheduler {
  constructor({ db, stocks, targetHour = 16, targetMin = 0, onStart, onProgress, onDone }) {
    this.db = db;
    this.stocks = stocks;
    this.targetHour = targetHour;
    this.targetMin = targetMin;
    this.onStart = onStart;
    this.onProgress = onProgress;
    this.onDone = onDone;
    this.lastRunDay = null;
    this.lastRunAt = null;
    this.running = false;
    this.timer = null;
  }

  start() {
    this.stop();
    this.timer = setInterval(() => this.tick(), 60_000);
    this.tick();
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  async tick() {
    const p = partsKST();
    if (p.day < 1 || p.day > 5) return;  // 평일만
    if (p.hour < this.targetHour) return;
    if (p.hour === this.targetHour && p.minute < this.targetMin) return;
    const today = ymdKST();
    if (this.lastRunDay === today) return;
    this.lastRunDay = today;
    await this.runNow({ trigger: 'scheduled' }).catch((e) => console.error('[scheduler]', e));
  }

  async runNow({ trigger = 'manual' } = {}) {
    if (this.running) return { skipped: true, reason: 'already-running' };
    this.running = true;
    this.onStart?.({ total: this.stocks.length, trigger });
    try {
      const results = await syncMany(this.db, this.stocks, {
        mode: 'incremental',
        period: 'D',
        concurrency: 5,
        onProgress: this.onProgress,
      });
      const ok = results.filter((r) => !r.error).length;
      const fail = results.length - ok;
      this.lastRunAt = Date.now();
      this.onDone?.({ ok, fail, total: results.length, at: this.lastRunAt, trigger });
      return { ok, fail, total: results.length, at: this.lastRunAt };
    } finally {
      this.running = false;
    }
  }

  status() {
    return { running: this.running, lastRunAt: this.lastRunAt, total: this.stocks.length };
  }
}

module.exports = { Scheduler };
