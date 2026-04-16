# 나만의 영웅문 (My Heroic Mun)

커스텀 코스피 차트 데스크톱 앱. Electron + Next.js + KLineChart + 한국투자증권 KIS API 기반.

## Phase 0 스캐폴딩 완료

```
my-heroic-mun/
├── electron/          # Electron 메인/프리로드 프로세스
├── renderer/          # Next.js UI (영웅문 레이아웃)
│   ├── pages/         # index.js = 메인 차트 화면
│   ├── components/
│   └── styles/
├── .github/workflows/ # Windows exe 자동 빌드 CI
└── package.json       # electron-builder NSIS 타겟 포함
```

## 개발 시작

```bash
npm install
npm run dev   # Next dev + Electron 동시 실행
```

## Windows 설치 파일(.exe) 빌드

- 로컬(macOS에서도 가능하지만 Windows 러너 권장):
  ```bash
  npm run build
  ```
- CI(추천): `git tag v0.1.0 && git push --tags` → GitHub Actions가 `dist/MyHeroicMun-Setup-*.exe` 생성

## 다음 단계 (Phase 1)

1. KIS Developers API 키 발급 → `.env`에 저장
2. `electron/` 쪽에 토큰 갱신 + REST/WebSocket 클라이언트 추가
3. SQLite로 일봉 캐시
4. `renderer/pages/index.js`의 `genMockCandles` → 실제 데이터로 교체
