import Phaser from 'phaser';

/**
 * 화면 왼쪽 절반을 누르면 그 자리에 생기는 가상 조이스틱.
 * vector: 길이 0~1 의 이동 방향.
 */
export class Joystick {
  readonly vector = new Phaser.Math.Vector2();
  private pointerId: number | null = null;
  private readonly origin = new Phaser.Math.Vector2();
  private readonly base: Phaser.GameObjects.Arc;
  private readonly thumb: Phaser.GameObjects.Arc;
  private readonly radius = 60;

  constructor(private readonly scene: Phaser.Scene, private readonly isBlocked: (p: Phaser.Input.Pointer) => boolean) {
    this.base = scene.add.circle(0, 0, this.radius, 0xffffff, 0.08).setStrokeStyle(2, 0xffffff, 0.25);
    this.thumb = scene.add.circle(0, 0, 26, 0xffffff, 0.3);
    for (const o of [this.base, this.thumb]) o.setScrollFactor(0).setDepth(1000).setVisible(false);

    scene.input.on('pointerdown', this.onDown, this);
    scene.input.on('pointermove', this.onMove, this);
    scene.input.on('pointerup', this.onUp, this);
    scene.input.on('pointerupoutside', this.onUp, this);
  }

  private onDown(p: Phaser.Input.Pointer) {
    if (this.pointerId !== null || p.x > this.scene.scale.width * 0.5 || this.isBlocked(p)) return;
    this.pointerId = p.id;
    this.origin.set(p.x, p.y);
    this.base.setPosition(p.x, p.y).setVisible(true);
    this.thumb.setPosition(p.x, p.y).setVisible(true);
    this.vector.reset();
  }

  private onMove(p: Phaser.Input.Pointer) {
    if (p.id !== this.pointerId) return;
    const d = new Phaser.Math.Vector2(p.x - this.origin.x, p.y - this.origin.y);
    const len = Math.min(d.length(), this.radius);
    if (d.length() > 0) d.setLength(len);
    this.thumb.setPosition(this.origin.x + d.x, this.origin.y + d.y);
    const strength = len / this.radius;
    if (strength < 0.15) this.vector.reset();
    else this.vector.copy(d.normalize().scale(strength));
  }

  private onUp(p: Phaser.Input.Pointer) {
    if (p.id !== this.pointerId) return;
    this.pointerId = null;
    this.vector.reset();
    this.base.setVisible(false);
    this.thumb.setVisible(false);
  }
}
