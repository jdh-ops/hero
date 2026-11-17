import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#14161c',
  scale: {
    // 최소 960×540 을 보장하고, 화면 비율에 맞춰 남는 쪽을 넓힌다
    mode: Phaser.Scale.EXPAND,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 960,
    height: 540,
  },
  input: { activePointers: 3 },
  physics: { default: 'arcade', arcade: { debug: false } },
  scene: [GameScene],
});
