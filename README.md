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
| 1~4 / 휠 | 무기 슬롯 (연습장에서는 같은 키 재입력 시 슬롯 내 교체) |
| Q | 직전 무기로 스왑 |
| G | 수류탄 퀵스로우 (무기 유지) |
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
- [x] Phase 5 — 온라인 멀티플레이 (4자리 방 코드 1v1, 서버 권위 HP/라운드)
- [x] 팀전 M1 — 로컬 1v1~4v4 봇 팀전 (팀 전멸 라운드, 아군 봇, 오사 방지)
- [x] 팀전 M2 — 온라인 로비 1v1~4v4 (최대 8인, 빈 슬롯은 방장 시뮬레이션 봇으로 채움)
- [x] 맵 5종 (파운드리/사막/네온/설원/정글) — 테마 + 구조가 모두 다름, 랜덤 선택, 온라인 동기화

## 온라인 대전

첫 화면에서 **닉네임을 입력하고 입장**하면 로비가 열립니다. 로비에는 **대기방 목록**이
실시간으로 표시되어 아무 방이나 **참가**를 눌러 바로 입장할 수 있고, **방 만들기**로
직접 방을 열 수도 있습니다(팀 규모 1v1~4v4, 맵 선택, 빈자리 봇 채우기 on/off, 봇 난이도).
전원이 **시작**을 누르면 5선승 매치가 시작됩니다. 봇 채우기를 켜면 빈 자리를 봇이 채우고,
방장은 **봇으로 채우고 시작**으로 인원이 부족해도 즉시 시작할 수 있습니다.
무료 호스팅은 유휴 시 잠들 수 있어 첫 연결에 수십 초가 걸릴 수 있습니다(클라이언트가 자동 재시도).

## 배포

클라이언트와 WebSocket 게임 서버는 **하나의 서비스(같은 origin)** 로 동작합니다. 게임 로직은
런타임 독립 모듈(`server/game.js`)이고, 전송 계층만 런타임별로 다릅니다:

- **Deno Deploy (기본, `console.deno.com` — Apps/Git 빌드)** — 저장소를 앱으로 연결하고
  아래 빌드 설정을 지정하면 푸시할 때마다 자동 빌드+배포됩니다. WebSocket 지원, 무료 플랜 카드 불필요.
  - Install Command: `npm install --include=dev` (`vite`/`tsc`가 devDependencies라 필요)
  - Build Command: `npm run build` (→ `dist/`)
  - Entrypoint: `server/deno.ts`
  - Framework preset: **None** (Vite 정적 사이트로 자동 감지되지 않도록)
- **구버전 Deno Deploy (`dash.deno.com` — Projects/deployctl)** — `.github/workflows/deploy.yml`
  (수동 실행). 저장소 시크릿 `DENO_DEPLOY_TOKEN`, 선택 `DENO_PROJECT` 필요.
- **Node 호스트 (Render 등)** — `server/index.js` 진입점. `render.yaml`은 Node 웹 서비스 하나로
  빌드+구동합니다.

로컬 개발은 `node server/index.js`(포트 8081)를 클라이언트(`npm run dev`)와 함께 실행하면 됩니다.

전체 계획은 [PLAN.md](./PLAN.md) 참고.
