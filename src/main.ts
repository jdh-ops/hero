import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';

// 화면 방향에 따라 기준 해상도를 바꾼다.
// 세로(모바일 기본): 480×854, 가로(PC): 960×540. EXPAND 라 남는 쪽은 넓어진다.
const isPortrait = () => window.innerHeight > window.innerWidth;
const baseSize = () => (isPortrait() ? { width: 480, height: 854 } : { width: 960, height: 540 });

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#14161c',
  scale: {
    mode: Phaser.Scale.EXPAND,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    ...baseSize(),
  },
  input: { activePointers: 3 },
  physics: { default: 'arcade', arcade: { debug: false } },
  scene: [GameScene],
});

// PC 창 크기를 바꾸는 등으로 방향이 바뀌면 기준 해상도 교체
let portrait = isPortrait();
window.addEventListener('resize', () => {
  if (isPortrait() === portrait) return;
  portrait = !portrait;
  const { width, height } = baseSize();
  game.scale.setGameSize(width, height);
});
