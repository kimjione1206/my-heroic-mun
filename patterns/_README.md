# patterns/ — 내가 원하는 패턴을 자유롭게 만드는 공간

## 이 폴더의 역할

이 폴더는 **나(또는 Claude Code)만 건드리는 영역**이다.
앱의 나머지 코드는 절대 수정하지 않고, 여기에 파일 하나만 추가/수정하면
차트에 새로운 마커·존·라인이 즉시 표시된다.

## 새 패턴 만드는 법 (30초)

1. `_template.js` 를 복사해서 `patterns/내-패턴.js` 로 저장.
2. `id`, `name`, `detect()` 세 가지만 바꾼다.
3. 저장하면 앱이 자동으로 리로드 (재시작 불필요).
4. 좌측 사이드바 "활성 패턴" 목록에서 체크.

## Claude Code 에게 요청하는 예시

- "patterns 에 RSI 14 가 30 아래에서 반등한 날을 감지하는 패턴을 만들어줘"
- "patterns/volume-spike.js 를 복사해서 5배 이상 버전인 volume-spike-extreme.js 를 만들어줘"
- "골든크로스(5일선이 20일선 위로 돌파) 패턴을 만들어줘. 마커는 초록색 ▲ 로"

Claude Code 는 이 폴더 안에서만 작업한다.
나머지 코드(electron/, renderer/, lib/)는 건드릴 필요가 없도록 설계되어 있다.

## 패턴 파일 구조

```js
module.exports = {
  id: 'unique-id',
  name: '사람이 읽는 이름',
  description: '무엇을 감지하는지',
  color: '#ffbb00',
  defaultEnabled: false,
  applicableTimeframes: ['D', 'W', 'M'],

  detect(candles, indicators, ctx) {
    // candles: [{timestamp, open, high, low, close, volume}, ...]
    // indicators: [{ma5, ma20, ma60, rsi14, bb_upper, bb_mid, bb_lower, macd, ...}, ...]
    // ctx: { code, name, market, period }

    const hits = [];
    // ... 감지 로직 ...
    return hits;
  },
};
```

## Hit 종류

| kind | 의미 | 필요한 필드 |
|---|---|---|
| `marker` | 캔들 위/아래 아이콘 | `symbol`, `label` |
| `zone` | 배경 색상 구간 | `endTimestamp`, `color` |
| `line` | 수평/추세선 | `y`, `endTimestamp` |
| `annotation` | 텍스트 라벨 | `text`, `y` |

## 사용 가능한 선계산 지표 (indicators 배열의 각 원소)

- `ma5`, `ma20`, `ma60`, `ma120` — 단순이동평균
- `ema12`, `ema26` — 지수이동평균
- `rsi14` — RSI 14
- `bb_upper`, `bb_mid`, `bb_lower` — 볼린저밴드(20, 2σ)
- `macd`, `macd_signal`, `macd_hist` — MACD
- `vol_ma20` — 거래량 20일 평균

없는 지표가 필요하면 `electron/indicators.js` 에 계산을 추가하고 테이블에 컬럼을 더한다.

## 안전 규칙

- `detect()` 에서 예외가 나도 다른 패턴에는 영향 없음 (try/catch 샌드박스)
- 파일명이 `_` 로 시작하면 로드되지 않음 (템플릿/문서 보관용)
- 같은 `id` 를 가진 파일이 둘 이상이면 나중에 로드된 것이 우선
