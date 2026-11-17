import Phaser from 'phaser';
import { StatSheet } from '../core/stats';
import {
  DEFENSE_RULES, applyToPools, computeHit, expectedDps, mitigate,
  type Defender, type Hit,
} from '../core/damage';
import type { SkillDef } from '../core/types';
import { CLASSES, MONSTERS, SKILLS, type MonsterDef } from '../data';
import { Joystick } from '../ui/Joystick';

// 2단계 전투 프로토타입: 이동, 자동 기본공격, 스킬 1개, 몬스터 1종

const WORLD = 2400;
const PLAYER_RADIUS = 16;
const MAX_MONSTERS = 35;
/** 몬스터 레벨이 1 오르는 데 걸리는 시간(초) */
const LEVEL_UP_EVERY = 45;

class Monster extends Phaser.Physics.Arcade.Image {
  def!: MonsterDef;
  level = 1;
  life = 0;
  maxLife = 0;
  attackCd = 0;

  get defender(): Defender {
    return { level: this.level, armor: this.def.armor, evasion: 0, res: this.def.res };
  }
}

interface FloatText { text: Phaser.GameObjects.Text; life: number; vy: number }

export class GameScene extends Phaser.Scene {
  private stats!: StatSheet;
  private basic!: SkillDef;
  private skill!: SkillDef;
  private player!: Phaser.Physics.Arcade.Image;
  private monsters!: Phaser.Physics.Arcade.Group;
  private joystick!: Joystick;
  private keys!: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd' | 'skill' | 'skill2', Phaser.Input.Keyboard.Key>;

  private life = 0;
  private mana = 0;
  private shield = 0;
  private sinceHit = 99;
  private actionCd = 0;
  private skillCd = 0;
  private facing = 0;
  private elapsed = 0;
  private spawnTimer = 0;
  private kills = 0;
  private dead = false;

  private overlay!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Graphics;
  private hudText!: Phaser.GameObjects.Text;
  private infoText!: Phaser.GameObjects.Text;
  private skillBtn!: Phaser.GameObjects.Container;
  private skillBtnGfx!: Phaser.GameObjects.Graphics;
  private floats: FloatText[] = [];

  constructor() {
    super('game');
  }

  create() {
    this.resetState();
    this.makeTextures();

    this.add.tileSprite(0, 0, WORLD, WORLD, 'grid').setOrigin(0);
    this.physics.world.setBounds(0, 0, WORLD, WORLD);

    this.player = this.physics.add.image(WORLD / 2, WORLD / 2, 'player').setDepth(10);
    this.player.setCircle(PLAYER_RADIUS).setCollideWorldBounds(true);
    this.cameras.main.setBounds(0, 0, WORLD, WORLD).startFollow(this.player, true, 0.15, 0.15);

    this.monsters = this.physics.add.group({ classType: Monster, maxSize: MAX_MONSTERS });
    this.physics.add.collider(this.monsters, this.monsters);

    this.overlay = this.add.graphics().setDepth(20); // 몬스터 체력바·이펙트
    this.createHud();
    this.createInput();
    this.scale.on('resize', this.layout, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.layout, this));
    this.layout();
  }

  private resetState() {
    const cls = CLASSES.warrior;
    this.stats = new StatSheet([...cls.mods, ...cls.startingGear]);
    this.basic = SKILLS[cls.basicAttack];
    this.skill = SKILLS[cls.skills[0]];
    this.life = this.stats.flat.maxLife;
    this.mana = this.stats.flat.maxMana;
    this.shield = this.stats.flat.maxShield;
    this.sinceHit = 99;
    this.actionCd = 0;
    this.skillCd = 0;
    this.elapsed = 0;
    this.spawnTimer = 0;
    this.kills = 0;
    this.dead = false;
    this.floats = [];
  }

  // ---------- 그래픽 (도형으로 만든 임시 텍스처) ----------

  private makeTextures() {
    if (this.textures.exists('player')) return;
    const g = this.make.graphics({}, false);

    g.fillStyle(0x4f8cff).fillCircle(20, 20, PLAYER_RADIUS);
    g.fillStyle(0xffffff).fillTriangle(30, 14, 30, 26, 38, 20); // 바라보는 방향
    g.generateTexture('player', 40, 40).clear();

    for (const def of Object.values(MONSTERS)) {
      const r = def.radius;
      g.fillStyle(Number(def.color)).fillCircle(r + 2, r + 2, r);
      g.fillStyle(0x000000, 0.5).fillCircle(r - 3, r - 1, 3).fillCircle(r + 7, r - 1, 3);
      g.generateTexture(def.id, r * 2 + 4, r * 2 + 4).clear();
    }

    g.fillStyle(0x1b1e26).fillRect(0, 0, 64, 64);
    g.lineStyle(1, 0x262a35).strokeRect(0, 0, 64, 64);
    g.generateTexture('grid', 64, 64).destroy();
  }

  // ---------- 입력 ----------

  private createInput() {
    const kb = this.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = kb.addKeys({
      up: K.UP, down: K.DOWN, left: K.LEFT, right: K.RIGHT,
      w: K.W, a: K.A, s: K.S, d: K.D, skill: K.SPACE, skill2: K.J,
    }) as GameScene['keys'];

    this.joystick = new Joystick(this, (p) => this.isOnSkillButton(p));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.dead) this.scene.restart();
      else if (this.isOnSkillButton(p)) this.castSkill();
    });
    kb.on('keydown-ENTER', () => this.dead && this.scene.restart());
  }

  private isOnSkillButton(p: Phaser.Input.Pointer) {
    return Phaser.Math.Distance.Between(p.x, p.y, this.skillBtn.x, this.skillBtn.y) < 60;
  }

  private moveVector(): Phaser.Math.Vector2 {
    const k = this.keys;
    const v = new Phaser.Math.Vector2(
      Number(k.right.isDown || k.d.isDown) - Number(k.left.isDown || k.a.isDown),
      Number(k.down.isDown || k.s.isDown) - Number(k.up.isDown || k.w.isDown),
    );
    if (v.lengthSq() > 0) return v.normalize();
    return this.joystick.vector.clone();
  }

  // ---------- 메인 루프 ----------

  update(_time: number, deltaMs: number) {
    const dt = Math.min(deltaMs / 1000, 0.05);
    this.updateFloats(dt);
    if (this.dead) return;

    this.elapsed += dt;
    this.updatePlayer(dt);
    this.updateSpawns(dt);
    this.updateMonsters(dt);
    this.updateCombat(dt);
    if (Phaser.Input.Keyboard.JustDown(this.keys.skill) || Phaser.Input.Keyboard.JustDown(this.keys.skill2)) this.castSkill();

    this.drawOverlay();
    this.drawHud();
  }

  private updatePlayer(dt: number) {
    const f = this.stats.flat;
    const v = this.moveVector();
    this.player.setVelocity(v.x * f.moveSpeed, v.y * f.moveSpeed);
    if (v.lengthSq() > 0.01) this.facing = v.angle();
    this.player.setRotation(this.facing);

    this.life = Math.min(f.maxLife, this.life + f.lifeRegen * dt);
    this.mana = Math.min(f.maxMana, this.mana + f.manaRegen * dt);
    this.sinceHit += dt;
    if (this.sinceHit >= DEFENSE_RULES.shieldDelay) {
      this.shield = Math.min(f.maxShield, this.shield + f.maxShield * DEFENSE_RULES.shieldRechargeRate * dt);
    }
  }

  private monsterLevel() {
    return 1 + Math.floor(this.elapsed / LEVEL_UP_EVERY);
  }

  private updateSpawns(dt: number) {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    // 시간이 지날수록 자주 나옴
    this.spawnTimer = Math.max(0.35, 1.3 - this.elapsed * 0.004);
    const count = Phaser.Math.Between(1, 1 + Math.floor(this.elapsed / 60));
    for (let i = 0; i < count; i++) this.spawnMonster();
  }

  private spawnMonster() {
    const cam = this.cameras.main.worldView;
    // 화면 바로 바깥 무작위 지점
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.hypot(cam.width, cam.height) / 2 + 40;
    const x = Phaser.Math.Clamp(this.player.x + Math.cos(angle) * dist, 20, WORLD - 20);
    const y = Phaser.Math.Clamp(this.player.y + Math.sin(angle) * dist, 20, WORLD - 20);

    const def = MONSTERS.blob;
    const m = this.monsters.get(x, y, def.id) as Monster | null;
    if (!m) return; // 상한 도달
    m.setActive(true).setVisible(true).setDepth(5);
    m.body!.enable = true;
    m.setCircle(def.radius, 2, 2);
    m.def = def;
    m.level = this.monsterLevel();
    m.maxLife = def.life * (1 + def.lifePerLevel * (m.level - 1));
    m.life = m.maxLife;
    m.attackCd = def.attackInterval;
    m.setAlpha(0);
    this.tweens.add({ targets: m, alpha: 1, duration: 250 });
  }

  private activeMonsters(): Monster[] {
    return (this.monsters.getChildren() as Monster[]).filter((m) => m.active);
  }

  private updateMonsters(dt: number) {
    for (const m of this.activeMonsters()) {
      const d = Phaser.Math.Distance.Between(m.x, m.y, this.player.x, this.player.y);
      const reach = m.def.radius + PLAYER_RADIUS + 4;
      if (d > reach - 2) this.physics.moveToObject(m, this.player, m.def.moveSpeed);
      else m.setVelocity(0, 0);

      m.attackCd -= dt;
      if (d <= reach && m.attackCd <= 0) {
        m.attackCd = m.def.attackInterval;
        this.monsterHitsPlayer(m);
      }
    }
  }

  private monsterHitsPlayer(m: Monster) {
    const scale = 1 + m.def.damagePerLevel * (m.level - 1);
    const amounts = { physical: 0, fire: 0, cold: 0, lightning: 0 };
    amounts[m.def.damageType] = Phaser.Math.FloatBetween(m.def.damageMin, m.def.damageMax) * scale;
    const hit: Hit = { amounts, crit: false, evadable: true, attackerLevel: m.level };

    const f = this.stats.flat;
    const result = mitigate(hit, {
      level: 1, armor: f.armor, evasion: f.evasion,
      res: { fire: f.resFire, cold: f.resCold, lightning: f.resLightning },
    });
    if (result.evaded) {
      this.floatText(this.player.x, this.player.y - 24, '회피', '#9fd3ff');
      return;
    }
    const pools = applyToPools(result.total, this.shield, this.life);
    this.shield = pools.shield;
    this.life = pools.life;
    this.sinceHit = 0;
    this.floatText(this.player.x, this.player.y - 24, String(Math.round(result.total)), '#ff6b6b');
    this.player.setTintFill(0xff4444);
    this.time.delayedCall(80, () => this.player.clearTint());
    if (this.life <= 0) this.die();
  }

  // ---------- 전투 ----------

  private updateCombat(dt: number) {
    this.actionCd -= dt;
    this.skillCd = Math.max(0, this.skillCd - dt);
    if (this.actionCd > 0) return;

    // 기본공격: 사거리 안의 가장 가까운 적에게 자동으로 휘두름
    const range = this.basic.range;
    let target: Monster | null = null;
    let best = Infinity;
    for (const m of this.activeMonsters()) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, m.x, m.y) - m.def.radius;
      if (d < range && d < best) { best = d; target = m; }
    }
    if (!target) return;

    const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, target.x, target.y);
    this.facing = angle;
    this.player.setRotation(angle);
    this.actionCd = this.basic.useTime / this.stats.actionSpeed;

    const half = Phaser.Math.DegToRad((this.basic.arc ?? 90) / 2);
    for (const m of this.activeMonsters()) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, m.x, m.y) - m.def.radius;
      const a = Phaser.Math.Angle.Between(this.player.x, this.player.y, m.x, m.y);
      if (d < range && Math.abs(Phaser.Math.Angle.Wrap(a - angle)) <= half) this.hitMonster(m, this.basic);
    }
    this.slashEffect(angle, range, half);
  }

  private castSkill() {
    if (this.dead || this.skillCd > 0 || this.mana < this.skill.manaCost) return;
    this.mana -= this.skill.manaCost;
    this.skillCd = this.skill.cooldown;
    this.actionCd = Math.max(this.actionCd, this.skill.useTime / this.stats.actionSpeed);

    const r = this.skill.radius ?? 100;
    for (const m of this.activeMonsters()) {
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, m.x, m.y) - m.def.radius < r) this.hitMonster(m, this.skill);
    }
    this.whirlEffect(r);
  }

  private hitMonster(m: Monster, skill: SkillDef) {
    const hit = computeHit(this.stats, skill, 1);
    const result = mitigate(hit, m.defender);
    m.life -= result.total;
    this.floatText(m.x, m.y - 20, String(Math.round(result.total)), result.crit ? '#ffd54f' : '#ffffff', result.crit);

    // 살짝 밀려남
    const a = Phaser.Math.Angle.Between(this.player.x, this.player.y, m.x, m.y);
    m.x += Math.cos(a) * 6;
    m.y += Math.sin(a) * 6;

    if (m.life <= 0) this.killMonster(m);
  }

  private killMonster(m: Monster) {
    this.kills++;
    const x = m.x, y = m.y;
    m.setActive(false).setVisible(false);
    m.body!.enable = false;
    m.setVelocity(0, 0);
    const puff = this.add.circle(x, y, m.def.radius, Number(m.def.color), 0.6).setDepth(4);
    this.tweens.add({ targets: puff, scale: 1.8, alpha: 0, duration: 250, onComplete: () => puff.destroy() });
  }

  private die() {
    this.dead = true;
    this.player.setVelocity(0, 0);
    for (const m of this.activeMonsters()) m.setVelocity(0, 0);
    const { width, height } = this.scale;
    const t = Math.floor(this.elapsed);
    this.add.rectangle(0, 0, width, height, 0x000000, 0.6).setOrigin(0).setScrollFactor(0).setDepth(2000);
    this.add.text(width / 2, height / 2,
      `쓰러졌습니다\n\n처치 ${this.kills} · 생존 ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')} · 위험도 ${this.monsterLevel()}\n\n화면을 누르거나 Enter로 다시 시작`,
      { fontFamily: 'system-ui, sans-serif', fontSize: '22px', color: '#ffffff', align: 'center' },
    ).setOrigin(0.5).setScrollFactor(0).setDepth(2001);
  }

  // ---------- 이펙트 ----------

  private slashEffect(angle: number, range: number, half: number) {
    const g = this.add.graphics().setDepth(15);
    g.fillStyle(0xffffff, 0.35);
    g.slice(this.player.x, this.player.y, range, angle - half, angle + half).fillPath();
    this.tweens.add({ targets: g, alpha: 0, duration: 150, onComplete: () => g.destroy() });
  }

  private whirlEffect(r: number) {
    const c = this.add.circle(this.player.x, this.player.y, r, 0xffc857, 0.25).setStrokeStyle(4, 0xffc857, 0.9).setDepth(15);
    c.setScale(0.3);
    this.tweens.add({ targets: c, scale: 1, alpha: 0, duration: 260, onComplete: () => c.destroy() });
  }

  private floatText(x: number, y: number, s: string, color: string, big = false) {
    const t = this.add.text(x + Phaser.Math.Between(-8, 8), y, s, {
      fontFamily: 'system-ui, sans-serif', fontSize: big ? '22px' : '15px', fontStyle: 'bold',
      color, stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(30);
    this.floats.push({ text: t, life: 0.7, vy: -50 });
  }

  private updateFloats(dt: number) {
    this.floats = this.floats.filter((f) => {
      f.life -= dt;
      f.text.y += f.vy * dt;
      f.text.setAlpha(Math.min(1, f.life / 0.3));
      if (f.life <= 0) { f.text.destroy(); return false; }
      return true;
    });
  }

  private drawOverlay() {
    const g = this.overlay.clear();
    for (const m of this.activeMonsters()) {
      if (m.life >= m.maxLife) continue;
      const w = 30, x = m.x - w / 2, y = m.y - m.def.radius - 8;
      g.fillStyle(0x000000, 0.6).fillRect(x - 1, y - 1, w + 2, 6);
      g.fillStyle(0xe53935).fillRect(x, y, w * Math.max(0, m.life / m.maxLife), 4);
    }
  }

  // ---------- HUD ----------

  private createHud() {
    this.hud = this.add.graphics().setScrollFactor(0).setDepth(1000);
    const style = { fontFamily: 'system-ui, sans-serif', fontSize: '14px', color: '#e8e6e3' };
    this.hudText = this.add.text(16, 62, '', style).setScrollFactor(0).setDepth(1000);
    this.infoText = this.add.text(0, 16, '', { ...style, align: 'right', color: '#9aa0aa' })
      .setOrigin(1, 0).setScrollFactor(0).setDepth(1000);

    this.skillBtnGfx = this.add.graphics();
    const label = this.add.text(0, 0, this.skill.name.replace(' ', '\n'), {
      fontFamily: 'system-ui, sans-serif', fontSize: '15px', fontStyle: 'bold', color: '#ffffff', align: 'center',
    }).setOrigin(0.5);
    this.skillBtn = this.add.container(0, 0, [this.skillBtnGfx, label]).setScrollFactor(0).setDepth(1000);

    const hint = this.sys.game.device.input.touch
      ? '왼쪽을 눌러 이동 · 오른쪽 버튼으로 스킬'
      : '이동 WASD / 방향키 · 스킬 Space';
    const h = this.add.text(this.scale.width / 2, this.scale.height - 40, `${hint} · 기본공격은 자동`, style)
      .setOrigin(0.5).setScrollFactor(0).setDepth(1000);
    this.tweens.add({ targets: h, alpha: 0, delay: 5000, duration: 800, onComplete: () => h.destroy() });
  }

  private layout() {
    const { width, height } = this.scale;
    this.skillBtn.setPosition(width - 90, height - 90);
    this.infoText.setX(width - 16);
  }

  private drawHud() {
    const f = this.stats.flat;
    const g = this.hud.clear();
    const bar = (y: number, ratio: number, color: number, h = 14) => {
      g.fillStyle(0x000000, 0.55).fillRect(14, y - 2, 224, h + 4);
      g.fillStyle(color).fillRect(16, y, 220 * Phaser.Math.Clamp(ratio, 0, 1), h);
    };
    bar(16, this.life / f.maxLife, 0xe53935);
    if (f.maxShield > 0) bar(16, this.shield / f.maxShield, 0x4dd0e1, 4); // 보호막: 생명력 바 위 얇은 줄
    bar(38, this.mana / f.maxMana, 0x3f6fd8, 10);

    const t = Math.floor(this.elapsed);
    this.hudText.setText(
      `생명력 ${Math.max(0, Math.ceil(this.life))}/${f.maxLife}  보호막 ${Math.floor(this.shield)}/${f.maxShield}  마나 ${Math.floor(this.mana)}/${f.maxMana}`,
    );
    this.infoText.setText(
      `처치 ${this.kills}   ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}   위험도 ${this.monsterLevel()}\n` +
      `기본공격 DPS ${expectedDps(this.stats, this.basic).toFixed(1)}`,
    );

    // 스킬 버튼 + 쿨다운
    const bg = this.skillBtnGfx.clear();
    const ready = this.skillCd <= 0 && this.mana >= this.skill.manaCost;
    bg.fillStyle(ready ? 0xc9822b : 0x555555, 0.85).fillCircle(0, 0, 46);
    bg.lineStyle(3, 0xffffff, 0.6).strokeCircle(0, 0, 46);
    if (this.skillCd > 0) {
      const ratio = this.skillCd / this.skill.cooldown;
      bg.fillStyle(0x000000, 0.55).slice(0, 0, 46, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio).fillPath();
    }
  }
}
