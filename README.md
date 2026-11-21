# hero

핵앤슬래시 + 파밍 + 빌드 싱글 웹 게임 (TypeScript + Vite + Phaser 3).

- 기획: [docs/기획.md](docs/기획.md)
- 스탯과 데미지 공식: [docs/스탯과_데미지.md](docs/스탯과_데미지.md)

## 실행

```bash
npm install
npm run dev        # 개발 서버
npm test           # 데미지 공식 테스트
npm run build      # dist/ (GitHub Pages용)
npm run build:single  # dist-single/index.html 한 파일짜리 미리보기
```

## 구조

| 경로 | 내용 |
|---|---|
| `src/core/` | 스탯 계산(`stats.ts`), 데미지 공식(`damage.ts`), 공통 타입 |
| `src/data/` | 스킬·직업·몬스터 데이터 (JSON) |
| `src/scenes/GameScene.ts` | 전투 프로토타입 |
| `src/ui/Joystick.ts` | 모바일 가상 조이스틱 |

## 배포

`main`에 푸시하면 GitHub Actions가 GitHub Pages로 배포한다.
처음 한 번은 저장소 Settings → Pages → Source를 **GitHub Actions**로 바꿔야 한다.

## 저장 · 설치

- 저장: 브라우저(localStorage)에 자동 저장 (변경 시, 앱이 백그라운드로 갈 때)
- 지도 화면 → 설정: 세이브 코드 내보내기/불러오기(텍스트 백업), 새로 시작 (이전 세이브는 `hero.save.backup` 에 백업)
- PWA: `public/manifest.webmanifest`, `public/sw.js` (배포본에서 오프라인 플레이), 아이콘 `public/icons/`
