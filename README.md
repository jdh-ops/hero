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
