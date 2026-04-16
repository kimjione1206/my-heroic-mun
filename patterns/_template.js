/**
 * 패턴 플러그인 템플릿.
 * 이 파일을 복사해서 patterns/내-패턴.js 로 저장 후 detect() 만 수정하면 된다.
 *
 * 규칙:
 *   - 언더스코어(_) 로 시작하는 파일은 로드되지 않음 (_template.js, _README.md 등)
 *   - 파일 저장 즉시 앱이 자동 리로드 (앱 재시작 불필요)
 *   - detect() 에서 예외가 나도 다른 패턴은 영향받지 않음 (샌드박스 처리됨)
 */

module.exports = {
  // 필수: URL-safe 유일 id. 파일 이름과 맞춰두면 관리 편함.
  id: 'template',

  // 필수: UI 에 보일 이름.
  name: '템플릿 패턴',

  // 선택: 한 줄 설명.
  description: '이 자리에 무엇을 감지하는지 한 줄로 적는다.',

  // 선택: 마커 색 (기본 노랑).
  color: '#ffbb00',

  // 선택: 앱 첫 실행 시 켜져 있을지.
  defaultEnabled: false,

  // 선택: 적용 가능한 타임프레임. 생략하면 전체.
  applicableTimeframes: ['D', 'W', 'M'],

  /**
   * 패턴 감지 함수.
   *
   * @param {Array<{timestamp:number, open:number, high:number, low:number, close:number, volume:number}>} candles
   *        시간순 정렬된 OHLCV 배열.
   * @param {Array<{ma5:number, ma20:number, rsi14:number, bb_upper:number, ...}>} indicators
   *        candles 와 같은 길이의 선계산 지표 배열. 값이 없으면 null.
   * @param {{code:string, name:string, market:string, period:string}} ctx
   *        현재 스캔 중인 종목 정보.
   * @returns {Array<Hit>} 감지된 시점 배열.
   *
   * Hit 구조:
   *   {
   *     timestamp: number,           // 이 시점(해당 캔들)
   *     kind: 'marker'|'zone'|'line'|'annotation',
   *     symbol?: string,             // 이모지/문자 (marker 일 때)
   *     label?: string,              // 툴팁 본문
   *     score?: number,              // 강도. 정렬/필터용
   *     endTimestamp?: number,       // zone 일 때 끝 지점
   *     y?: number,                  // line 일 때 수평선 가격
   *   }
   */
  detect(candles, indicators, ctx) {
    const hits = [];

    // 예시: 20일 이동평균 위에서 거래량이 평균의 3배 이상 터진 날
    for (let i = 20; i < candles.length; i++) {
      const c = candles[i];
      const ind = indicators[i];
      if (!ind?.ma20 || !ind?.vol_ma20) continue;

      const aboveMA = c.close > ind.ma20;
      const volRatio = c.volume / ind.vol_ma20;

      if (aboveMA && volRatio >= 3) {
        hits.push({
          timestamp: c.timestamp,
          kind: 'marker',
          symbol: '🔥',
          label: `거래량 ${volRatio.toFixed(1)}배 · MA20 위`,
          score: volRatio,
        });
      }
    }

    return hits;
  },
};
