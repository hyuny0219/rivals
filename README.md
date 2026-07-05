# RIFLE.GG

로블록스 RIVALS에서 영감을 받은 웹 기반 아레나 FPS. 브라우저에서 바로 실행됩니다.

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
| Space | 점프 |
| Shift | 대시 (쿨다운 2초) |
| C / Ctrl | 슬라이드 (달리는 중) |
| Esc | 메뉴 |

## 현재 상태

- [x] Phase 0 — Three.js + TypeScript + Vite 셋업
- [x] Phase 1 — FPS 무브먼트 (대시/슬라이드/계단), 로우폴리 1v1 맵 "Foundry"
- [ ] Phase 2 — 무기/전투 시스템
- [ ] Phase 3 — 1v1 듀얼 게임 루프 + 봇 AI
- [ ] Phase 4 — 사운드/이펙트 폴리시
- [ ] Phase 5 — 온라인 멀티플레이 (1v1 방 코드)

전체 계획은 [PLAN.md](./PLAN.md) 참고.
