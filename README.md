# RIFLE.GG

로블록스 RIVALS에서 영감을 받은 웹 기반 아레나 FPS. 브라우저에서 바로 실행됩니다.

**▶ 지금 플레이: [rifle-gg.onrender.com](https://rifle-gg.onrender.com)** (데스크톱·모바일 지원)

## 실행 방법

```bash
npm install
npm run dev      # 개발 서버 (http://localhost:5173)
npm run build    # 프로덕션 빌드 (dist/)
```

## 조작법

| 키 | 동작 |
|---|---|
| WASD | 이동 |
| 마우스 | 시점 |
| 클릭 | 발사 |
| 우클릭 | 조준(ADS) |
| R | 장전 |
| 1~4 | 무기 슬롯 (같은 키 재입력 시 슬롯 내 교체) |
| Space | 점프 |
| Shift | 대시 (쿨다운 2초) |
| C | 슬라이드 (달리는 중) |
| Esc | 메뉴 |

모바일(터치 기기)에서는 가로모드로 플레이합니다: 왼쪽 가상 조이스틱으로 이동,
오른쪽 화면 드래그로 시점, 점프/대시/슬라이드 버튼 제공. 세로로 들면 회전 안내가 표시됩니다.

## 현재 상태

- [x] Phase 0 — Three.js + TypeScript + Vite 셋업
- [x] Phase 1 — FPS 무브먼트 (대시/슬라이드/계단), 로우폴리 1v1 맵 "Foundry", 모바일 터치 지원
- [x] Phase 2 — 무기/전투 시스템 (무기 7종, 히트스캔/투사체, 표적 더미, 전투 HUD)
- [x] Phase 3 — 1v1 듀얼 게임 루프 (5선승 라운드, 봇 AI 난이도 3종, 로드아웃 선택)
- [x] Phase 4 — 폴리시 (절차 합성 사운드, 총구 화염, 피격 비네트, 설정 메뉴)
- [ ] Phase 5 — 온라인 멀티플레이 (1v1 방 코드)

전체 계획은 [PLAN.md](./PLAN.md) 참고.
