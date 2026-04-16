#!/usr/bin/env node
/**
 * KRX 상장법인 전체 목록 수집 → warehouse.sqlite 의 stocks 테이블.
 *
 * 사용: node scripts/fetch-krx-master.js
 *
 * KIND 엔드포인트는 EUC-KR 인코딩 HTML 테이블을 반환한다.
 * 컬럼 순서: 회사명, 시장, 종목코드, 업종, 주요제품, 상장일, 결산월, 대표자, 홈페이지, 지역
 */

const fs = require('fs');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const { getUserDataPath } = require('../electron/userdata');
const { openWarehouse, upsertStocks, countStocks } = require('../electron/warehouse');

const buildUrl = (marketType) =>
  `https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13&marketType=${marketType}`;

const MARKETS = [
  { key: 'KOSPI',  param: 'stockMkt',  suffix: '.KS' },
  { key: 'KOSDAQ', param: 'kosdaqMkt', suffix: '.KQ' },
];

async function fetchMarket({ key, param, suffix }) {
  const res = await fetch(buildUrl(param), { headers: { 'user-agent': 'Mozilla/5.0 my-heroic-mun/0.1' } });
  if (!res.ok) throw new Error(`KRX ${key} HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const $ = cheerio.load(iconv.decode(buf, 'EUC-KR'));
  const rows = [];
  $('table tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 6) return;
    const name    = $(tds[0]).text().trim();
    const codeRaw = $(tds[2]).text().trim();
    const sector  = $(tds[3]).text().trim();
    const listing = $(tds[5]).text().trim();
    const code = codeRaw.replace(/\D/g, '').padStart(6, '0').slice(-6);
    if (!/^\d{6}$/.test(code) || !name) return;
    rows.push({
      code, name, market: key,
      sector: sector || null,
      listing_date: parseDate(listing),
      yahoo_symbol: `${code}${suffix}`,
      updated_at: Date.now(),
    });
  });
  return rows;
}

function parseDate(s) {
  const m = String(s).match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
}

async function main() {
  const userData = getUserDataPath();
  fs.mkdirSync(userData, { recursive: true });
  openWarehouse(userData);
  console.log(`[KRX] warehouse: ${userData}/warehouse.sqlite`);

  const before = countStocks();
  for (const m of MARKETS) {
    process.stdout.write(`[KRX] ${m.key} 수집 중... `);
    const rows = await fetchMarket(m);
    upsertStocks(rows);
    console.log(`${rows.length}개`);
  }
  console.log(`[KRX] ✓ 완료 — 총 ${countStocks()}개 종목 (이전 ${before}개)`);
}

main().catch((e) => { console.error('[KRX] 실패:', e); process.exit(1); });
