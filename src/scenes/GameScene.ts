import Phaser from 'phaser';
import { StatSheet } from '../core/stats';
import {
  DEFENSE_RULES, applyToPools, computeHit, expectedDps, mitigate,
  type Defender, type Hit,
} from '../core/damage';
import type { SkillDef } from '../core/types';
import { activeSkills, classOf, firstTime, loadBuild, passesLootFilter, pickUp, pickUpGem, saveBuild, statsFor, type Build } from '../core/build';
import { clearTips, showIntro, showTip } from '../ui/Tips';
import type { ActiveSkill } from '../core/skills';
import type { StatSheet as Sheet } from '../core/stats';
import { generateItem, type Item, type Rarity } from '../core/items';
import { MAPS, MONSTERS, SKILLS, SUPPORTS, type MapDef, type MonsterDef } from '../data';
import {
  addXp, areaLevel, bossDropTableFor, dropTableFor, mapOf, mobElement, mobPool, monsterXp, recordClear, rollGem, rollItemRarity, runName, xpToNext,
  type RunConfig,
} from '../core/progress';
import { GEM_RARITIES, GEM_RARITY_COLOR, gemKey, gemName, parseGem } from '../core/gems';
import { formatCost, gain, rollBossCurrency, rollCurrency, rollGold, rollSalvage, salvageItemReward, type Wallet } from '../core/economy';
import { mappingUnlocked } from '../core/progress';
import { CURRENCIES, ECONOMY } from '../data';
import { monsterDamageMult, monsterLife } from '../core/scaling';
import { Joystick } from '../ui/Joystick';
import { InventoryUI } from '../ui/Inventory';
import { MapSelectUI } from '../ui/MapSelect';
import { SettingsUI } from '../ui/Settings';

// 전투 프로토타입
// 2단계: 이동, 자동 기본공격, 스킬 1개, 몬스터 1종
// 3단계: 드랍 → 줍기 → 착용 → 스탯 반영 (장비는 죽어도 유지, 로컬 저장)
// 4단계: 스킬 4개(범위·부채꼴·투사체·장판) + 보조 젬
// 5단계: 지도(스토리 3난이도 × 4맵 → 맵핑 티어), 맵별 몬스터, 드랍 테이블, 캐릭터 레벨
//        몹 60마리 → 지역 보스 등장 → 보스 처치 = 클리어 (보스는 전용 드랍 테이블)

const WORLD = 2400;
const PLAYER_RADIUS = 16;
const MAX_MONSTERS = 35;
const GEM_COLOR = 0x66d17a;
const PICKUP_RADIUS = 50;
/** 입장 후 첫 몬스터가 나오기까지(초) */
const START_GRACE = 1.5;
const RARITY_COLOR: Record<Rarity, number> = { normal: 0xc9ccd2, magic: 0x7aa7ff, rare: 0xffd54f };

/** 장비는 씬을 다시 시작해도(죽어도) 유지 */
let persistentBuild: Build | null = null;

class Monster extends Phaser.Physics.Arcade.Image {
  def!: MonsterDef;
  level = 1;
  life = 0;
  maxLife = 0;
  attackCd = 0;
  /** 보스 특수 패턴 대기 시간 */
  patternCd = 0;
  /** 돌진 중 남은 시간과 방향 */
  charging = 0;
  chargeAngle = 0;
  chargeHit = false;

  get defender(): Defender {
    return { level: this.level, armor: this.def.armor, evasion: 0, res: this.def.res };
  }
}

interface FloatText { text: Phaser.GameObjects.Text; life: number; vy: number }
interface Drop { item?: Item; gemId?: string; currency?: { id: string; n: number }; gem: Phaser.GameObjects.Shape; label: Phaser.GameObjects.Text }
interface Projectile { img: Phaser.GameObjects.Arc; vx: number; vy: number; travelled: number; maxDist: number; pierce: number; hit: Set<Monster>; skill: ActiveSkill }
interface Ground { x: number; y: number; r: number; left: number; tick: number; gfx: Phaser.GameObjects.Arc; skill: ActiveSkill }
interface EnemyShot { img: Phaser.GameObjects.Arc; vx: number; vy: number; left: number; hit: Hit }
interface SkillButton { box: Phaser.GameObjects.Container; gfx: Phaser.GameObjects.Graphics; r: number }

export class GameScene extends Phaser.Scene {
  private build!: Build;
  /** 지금 하는 판. null 이면 지도 화면 */
  private run: RunConfig | null = null;
  private map: MapDef = MAPS.maps[0];
  private level = 1;
  private cleared = false;
  private mapSelect?: MapSelectUI;
  private settings?: SettingsUI;
  private domButtons: HTMLElement[] = [];
  private enemyShots: EnemyShot[] = [];
  /** 이번 판에 얻은 재화 */
  private runGains: Wallet = {};
  private boss: Monster | null = null;
  private bossSpawned = false;
  private bossText!: Phaser.GameObjects.Text;  private stats!: StatSheet;
  private inventory!: InventoryUI;
  private drops: Drop[] = [];
  private basic!: SkillDef;
  private skills: ActiveSkill[] = [];
  private skillCds: number[] = [];
  private projectiles: Projectile[] = [];
  private grounds: Ground[] = [];
  private player!: Phaser.Physics.Arcade.Image;
  private monsters!: Phaser.Physics.Arcade.Group;
  private joystick!: Joystick;
  private keys!: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd' | 'space' | 'k1' | 'k2' | 'k3' | 'k4', Phaser.Input.Keyboard.Key>;

  private life = 0;
  private mana = 0;
  private shield = 0;
  private sinceHit = 99;
  private actionCd = 0;
  private facing = 0;
  private elapsed = 0;
  private spawnTimer = 0;
  private kills = 0;
  private dead = false;

  private overlay!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Graphics;
  private hudText!: Phaser.GameObjects.Text;
  private infoText!: Phaser.GameObjects.Text;
  private hintText?: Phaser.GameObjects.Text;
  private skillBtns: SkillButton[] = [];
  private floats: FloatText[] = [];

  constructor() {
    super('game');
  }

  init(data: { run?: RunConfig }) {
    this.run = data?.run ?? null;
  }

  create() {
    this.resetState();
    this.makeTextures();

    this.add.tileSprite(0, 0, WORLD, WORLD, `grid_${this.map.id}`).setOrigin(0);
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

    this.inventory = new InventoryUI(
      () => this.build,
      () => this.onBuildChanged(),
      (open) => {
        if (open) this.scene.pause();
        else { this.scene.resume(); this.mapSelect?.render(); }
      },
      () => !this.run,
    );
    this.events.once('shutdown', () => {
      this.inventory.destroy();
      this.mapSelect?.destroy();
      this.settings?.destroy();
      document.removeEventListener('visibilitychange', this.onVisibility);
      clearTips();
      for (const el of this.domButtons) el.remove();
    });

    // 앱이 백그라운드로 갈 때 저장 (휴대폰에서 앱 전환·화면 끄기)
    document.addEventListener('visibilitychange', this.onVisibility);

    if (!this.run) this.openMapSelect();
    else {
      this.addDomButton('지도로', 'leave', () => this.backToMap());
      if (firstTime(this.build, 'intro')) {
        saveBuild(this.build);
        // 안내를 읽는 동안 멈춤
        this.domButtons.push(showIntro(this.sys.game.device.input.touch, () => this.scene.resume()));
        this.scene.pause();
      }
    }

    // 테스트용: 주소에 ?debug 가 있으면 콘솔에서 씬에 접근 가능
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as { hero: GameScene }).hero = this;
  }

  /** 디버그: 플레이어 발밑에 장비를 떨어뜨림 */
  debugDrop(count = 1, ilvl = 1) {
    for (let i = 0; i < count; i++) this.spawnDrop(this.player.x + 80 + i * 20, this.player.y, generateItem(ilvl));
  }

  private openMapSelect() {
    this.player.setVisible(false);
    for (const b of this.skillBtns) b.box.setVisible(false);
    this.hud.setVisible(false);
    this.hudText.setVisible(false);
    this.infoText.setVisible(false);
    this.hintText?.setVisible(false);
    this.mapSelect = new MapSelectUI(
      () => this.build,
      (run) => this.scene.restart({ run }),
      () => this.inventory.toggle(true),
      () => this.openSettings(),
    );
  }

  private openSettings() {
    this.settings?.destroy();
    this.settings = new SettingsUI(
      () => this.build,
      (b) => {
        // 세이브를 통째로 교체 (지도 화면에서만 열림)
        persistentBuild = b;
        this.build = b;
        this.onBuildChanged();
        const f = this.stats.flat;
        this.life = f.maxLife;
        this.mana = f.maxMana;
        this.shield = f.maxShield;
        this.mapSelect?.render();
      },
      () => {
        this.settings?.destroy();
        this.settings = undefined;
        this.mapSelect?.render();
      },
      () => saveBuild(this.build),
    );
  }

  private onVisibility = () => {
    if (document.visibilityState === 'hidden') saveBuild(this.build);
  };

  private backToMap() {
    saveBuild(this.build);
    this.scene.restart({});
  }

  private addDomButton(text: string, cls: string, onClick: () => void): HTMLButtonElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `hud-btn ${cls}`;
    el.textContent = text;
    el.addEventListener('click', onClick);
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.append(el);
    this.domButtons.push(el);
    return el;
  }

  /** 디버그: 보스 바로 소환 */
  debugBoss() {
    this.kills = MAPS.killTarget;
    if (!this.bossSpawned) this.spawnBoss();
  }

  /** 디버그: 맵을 바로 클리어 */
  debugClear() {
    this.debugBoss();
    if (this.boss) this.killMonster(this.boss);
  }

  /** 디버그: 보조 젬을 하나씩 모두 줌 */
  debugGems() {
    for (const id of Object.keys(SUPPORTS)) for (const r of GEM_RARITIES) pickUpGem(this.build, gemKey(id, r));
    this.onBuildChanged();
  }

  private resetState() {
    persistentBuild ??= loadBuild();
    this.build = persistentBuild;
    this.map = this.run ? mapOf(this.run) : MAPS.maps[0];
    this.level = this.run ? areaLevel(this.run) : 1;
    this.cleared = false;
    this.runGains = {};
    this.boss = null;
    this.bossSpawned = false;
    this.enemyShots = [];
    this.domButtons = [];
    this.mapSelect = undefined;    const cls = classOf(this.build);
    this.stats = statsFor(this.build);
    this.basic = SKILLS[cls.basicAttack];
    this.skills = activeSkills(this.build);
    this.skillCds = this.skills.map(() => 0);
    this.projectiles = [];
    this.grounds = [];
    this.life = this.stats.flat.maxLife;
    this.mana = this.stats.flat.maxMana;
    this.shield = this.stats.flat.maxShield;
    this.sinceHit = 99;
    this.actionCd = 0;
    this.elapsed = 0;
    // 입장 직후 잠깐은 몬스터가 나오지 않게
    this.spawnTimer = START_GRACE;
    this.kills = 0;
    this.dead = false;
    this.floats = [];
    this.drops = [];
  }

  /** 장비·보조 젬이 바뀌면 스탯과 스킬을 다시 계산. 생명력 등은 비율을 유지 */
  private onBuildChanged() {
    const old = this.stats.flat;
    const lifeR = this.life / old.maxLife;
    const manaR = this.mana / old.maxMana;
    const shieldR = old.maxShield > 0 ? this.shield / old.maxShield : 1;
    this.stats = statsFor(this.build);
    this.skills = activeSkills(this.build);
    const f = this.stats.flat;
    if (!this.dead) {
      this.life = f.maxLife * lifeR;
      this.mana = f.maxMana * manaR;
      this.shield = f.maxShield * shieldR;
    }
    saveBuild(this.build);
    this.inventory.refreshButton();
    if (!this.inventory.isOpen && !this.dead) this.drawHud();
  }

  // ---------- 그래픽 (도형으로 만든 임시 텍스처) ----------

  private makeTextures() {
    if (this.textures.exists('player')) return;
    const g = this.make.graphics({}, false);

    for (const m of MAPS.maps) {
      g.fillStyle(Number(m.bg)).fillRect(0, 0, 64, 64);
      g.lineStyle(1, Number(m.line)).strokeRect(0, 0, 64, 64);
      g.generateTexture(`grid_${m.id}`, 64, 64).clear();
    }

    g.fillStyle(0x4f8cff).fillCircle(20, 20, PLAYER_RADIUS);
    g.fillStyle(0xffffff).fillTriangle(30, 14, 30, 26, 38, 20); // 바라보는 방향
    g.generateTexture('player', 40, 40).clear();

    for (const def of Object.values(MONSTERS)) {
      const r = def.radius;
      g.fillStyle(Number(def.color));
      if (def.kind === 'boss') {
        // 보스: 큰 원 + 테두리 + 왕관 점
        g.fillCircle(r + 2, r + 2, r);
        g.lineStyle(4, 0x000000, 0.5).strokeCircle(r + 2, r + 2, r - 2);
        g.fillStyle(0xffd54f).fillTriangle(r - 10, 10, r - 4, 2, r + 2, 10).fillTriangle(r + 2, 10, r + 8, 2, r + 14, 10);
        g.fillStyle(Number(def.color));
      } else if (def.kind === 'ranged') {
        // 원거리 몹은 마름모
        g.fillPoints([{ x: r + 2, y: 2 }, { x: r * 2 + 2, y: r + 2 }, { x: r + 2, y: r * 2 + 2 }, { x: 2, y: r + 2 }], true);
      } else {
        g.fillCircle(r + 2, r + 2, r);
      }
      g.fillStyle(0x000000, 0.5).fillCircle(r - 3, r - 1, 3).fillCircle(r + 7, r - 1, 3);
      g.generateTexture(def.id, r * 2 + 4, r * 2 + 4).clear();
    }

    g.destroy();
  }

  // ---------- 입력 ----------

  private createInput() {
    const kb = this.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = kb.addKeys({
      up: K.UP, down: K.DOWN, left: K.LEFT, right: K.RIGHT,
      w: K.W, a: K.A, s: K.S, d: K.D,
      space: K.SPACE, k1: K.ONE, k2: K.TWO, k3: K.THREE, k4: K.FOUR,
    }) as GameScene['keys'];

    this.joystick = new Joystick(this, (p) => this.inJoystickZone(p));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.dead) this.backToMap();
      else {
        const i = this.skillButtonAt(p);
        if (i >= 0) this.castSkill(i);
      }
    });
    kb.on('keydown-ENTER', () => this.dead && this.backToMap());
  }

  /** 누른 위치의 스킬 버튼 번호 (없으면 -1). 손가락이라 실제보다 조금 넓게 */
  private skillButtonAt(p: Phaser.Input.Pointer): number {
    return this.skillBtns.findIndex((b) => Phaser.Math.Distance.Between(p.x, p.y, b.box.x, b.box.y) < b.r + 10);
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
    if (this.dead || !this.run) return;

    this.elapsed += dt;
    this.updatePlayer(dt);
    this.updateSpawns(dt);
    this.updateMonsters(dt);
    this.updateCombat(dt);
    this.updateProjectiles(dt);
    this.updateGrounds(dt);
    this.updateEnemyShots(dt);
    this.updatePickups();
    const k = this.keys, J = Phaser.Input.Keyboard.JustDown;
    if (J(k.space) || J(k.k1)) this.castSkill(0);
    if (J(k.k2)) this.castSkill(1);
    if (J(k.k3)) this.castSkill(2);
    if (J(k.k4)) this.castSkill(3);

    this.drawOverlay();
    this.drawHud();
  }

  private updatePlayer(dt: number) {
    const f = this.stats.flat;
    const v = this.moveVector();
    this.player.setVelocity(v.x * this.stats.moveSpeed, v.y * this.stats.moveSpeed);
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
    return this.level;
  }

  private updateSpawns(dt: number) {
    if (this.cleared || this.bossSpawned) return;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = MAPS.balance.spawnInterval;
    const count = Math.random() < MAPS.balance.doubleSpawnChance ? 2 : 1;
    for (let i = 0; i < count; i++) this.spawnMonster();
  }

  private spawnMonster() {
    // 화면 바로 바깥 무작위 지점.
    // worldView 는 첫 프레임에 아직 0 이라 화면 크기(scale)로 계산해야 몬스터가 바로 옆에 생기지 않는다
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.hypot(this.scale.width, this.scale.height) / 2 + 40;
    const x = Phaser.Math.Clamp(this.player.x + Math.cos(angle) * dist, 20, WORLD - 20);
    const y = Phaser.Math.Clamp(this.player.y + Math.sin(angle) * dist, 20, WORLD - 20);

    const pool = this.run ? mobPool(this.run) : this.map.monsters;
    const pick = Phaser.Math.Between(1, pool.reduce((a, e) => a + e.weight, 0));
    let acc = 0;
    const entry = pool.find((e) => (acc += e.weight) >= pick)!;
    const def = MONSTERS[entry.id];
    const m = this.monsters.get(x, y, def.id) as Monster | null;
    if (!m) return; // 상한 도달
    m.setTexture(def.id);
    m.setActive(true).setVisible(true).setDepth(5);
    m.body!.enable = true;
    m.setCircle(def.radius, 2, 2);
    m.def = def;
    m.level = this.monsterLevel();
    m.maxLife = monsterLife(def, m.level);
    m.life = m.maxLife;
    m.attackCd = def.attackInterval;
    m.setAlpha(0);
    this.tweens.add({ targets: m, alpha: 1, duration: 250 });
  }

  /** 몹을 다 잡으면 지역 보스 등장. 풀 상한과 상관없이 따로 만든다 */
  private spawnBoss() {
    this.bossSpawned = true;
    const def = MONSTERS[this.map.boss];
    const a = Math.random() * Math.PI * 2;
    const x = Phaser.Math.Clamp(this.player.x + Math.cos(a) * 320, 60, WORLD - 60);
    const y = Phaser.Math.Clamp(this.player.y + Math.sin(a) * 320, 60, WORLD - 60);
    const m = new Monster(this, x, y, def.id);
    this.add.existing(m);
    this.physics.add.existing(m);
    this.monsters.add(m);
    m.setDepth(6).setCircle(def.radius, 2, 2);
    m.def = def;
    m.level = this.monsterLevel();
    m.maxLife = monsterLife(def, m.level);
    m.life = m.maxLife;
    m.attackCd = def.attackInterval;
    m.patternCd = 2;
    (m.body as Phaser.Physics.Arcade.Body).pushable = false;
    this.boss = m;
    this.floatText(this.player.x, this.player.y - 70, `보스 등장: ${def.name}`, '#ffd54f', true);
    this.tip('first-boss', '<b>보스</b>가 나왔습니다. 바닥에 표시가 뜨면 그 자리를 피하세요.');
    this.cameras.main.flash(250, 80, 20, 20);
  }

  // ---------- 보스 패턴 ----------

  private updateBoss(m: Monster, dt: number) {
    const d = Phaser.Math.Distance.Between(m.x, m.y, this.player.x, this.player.y);
    if (m.charging < 0) {
      // 돌진 준비: 멈춰서 기다림
      m.charging = Math.min(0, m.charging + dt);
      m.setVelocity(0, 0);
      return;
    }
    if (m.charging > 0) {
      m.charging -= dt;
      const sp = m.def.moveSpeed * 5;
      m.setVelocity(Math.cos(m.chargeAngle) * sp, Math.sin(m.chargeAngle) * sp);
      if (!m.chargeHit && d < m.def.radius + PLAYER_RADIUS + 4) {
        m.chargeHit = true;
        this.playerTakesHit(this.scaledHit(this.monsterHit(m), 1.6));
      }
      return;
    }
    const reach = m.def.radius + PLAYER_RADIUS + 4;
    if (d > reach - 2) this.physics.moveToObject(m, this.player, m.def.moveSpeed);
    else m.setVelocity(0, 0);
    m.attackCd -= dt;
    if (d <= reach && m.attackCd <= 0) {
      m.attackCd = m.def.attackInterval;
      this.monsterHitsPlayer(m);
    }
    m.patternCd -= dt;
    if (m.patternCd > 0) return;
    m.patternCd = m.def.patternInterval ?? 3;
    const toPlayer = Phaser.Math.Angle.Between(m.x, m.y, this.player.x, this.player.y);
    switch (m.def.pattern) {
      case 'slam': {
        // 플레이어 위치에 표시 → 0.9초 뒤 범위 피해 (피할 수 있음)
        const tx = this.player.x, ty = this.player.y, r = 110;
        const mark = this.add.circle(tx, ty, r, 0xff3d00, 0.18).setStrokeStyle(3, 0xff3d00, 0.9).setDepth(2);
        this.tweens.add({ targets: mark, alpha: 0.6, duration: 900 });
        this.time.delayedCall(900, () => {
          mark.destroy();
          if (!m.active || this.dead) return;
          const hitFx = this.add.circle(tx, ty, r, 0xffffff, 0.35).setDepth(14);
          this.tweens.add({ targets: hitFx, alpha: 0, scale: 1.15, duration: 250, onComplete: () => hitFx.destroy() });
          this.cameras.main.shake(120, 0.006);
          if (Phaser.Math.Distance.Between(tx, ty, this.player.x, this.player.y) < r + PLAYER_RADIUS) {
            this.playerTakesHit(this.scaledHit(this.monsterHit(m), 2));
          }
        });
        break;
      }
      case 'volley':
        for (let i = -2; i <= 2; i++) this.bossShot(m, toPlayer + Phaser.Math.DegToRad(12) * i);
        break;
      case 'nova':
        for (let i = 0; i < 12; i++) this.bossShot(m, (Math.PI * 2 * i) / 12);
        break;
      case 'charge': {
        // 0.6초 동안 돌진 방향 표시 → 돌진
        m.setVelocity(0, 0);
        const line = this.add.rectangle(m.x, m.y, 420, m.def.radius * 2, 0xfdd835, 0.18).setOrigin(0, 0.5).setRotation(toPlayer).setDepth(2);
        m.patternCd += 0.6;
        m.charging = -0.6; // 표시 동안은 멈춤
        this.time.delayedCall(600, () => {
          line.destroy();
          if (!m.active) return;
          m.chargeAngle = toPlayer;
          m.charging = 0.5;
          m.chargeHit = false;
        });
        break;
      }
    }
  }

  private scaledHit(hit: Hit, mult: number): Hit {
    const amounts = { ...hit.amounts };
    for (const k of Object.keys(amounts) as (keyof typeof amounts)[]) amounts[k] *= mult;
    return { ...hit, amounts };
  }

  private bossShot(m: Monster, angle: number) {
    const speed = m.def.projectileSpeed ?? 250;
    const img = this.add.circle(m.x, m.y, 8, Number(m.def.color)).setStrokeStyle(2, 0xffffff, 0.8).setDepth(11);
    this.enemyShots.push({ img, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, left: 2.2, hit: this.monsterHit(m) });
  }

  private activeMonsters(): Monster[] {
    return (this.monsters.getChildren() as Monster[]).filter((m) => m.active);
  }

  private updateMonsters(dt: number) {
    for (const m of this.activeMonsters()) {
      if (m.def.kind === 'boss') { this.updateBoss(m, dt); continue; }
      const d = Phaser.Math.Distance.Between(m.x, m.y, this.player.x, this.player.y);
      m.attackCd -= dt;
      if (m.def.kind === 'ranged') {
        // 거리를 유지하며 투사체
        const range = m.def.range ?? 300;
        if (d > range * 0.9) this.physics.moveToObject(m, this.player, m.def.moveSpeed);
        else if (d < range * 0.5) {
          const a = Phaser.Math.Angle.Between(this.player.x, this.player.y, m.x, m.y);
          m.setVelocity(Math.cos(a) * m.def.moveSpeed, Math.sin(a) * m.def.moveSpeed);
        } else m.setVelocity(0, 0);
        if (d <= range && m.attackCd <= 0) {
          m.attackCd = m.def.attackInterval;
          this.monsterShoots(m);
        }
        continue;
      }
      const reach = m.def.radius + PLAYER_RADIUS + 4;
      if (d > reach - 2) this.physics.moveToObject(m, this.player, m.def.moveSpeed);
      else m.setVelocity(0, 0);
      if (d <= reach && m.attackCd <= 0) {
        m.attackCd = m.def.attackInterval;
        this.monsterHitsPlayer(m);
      }
    }
  }

  private monsterHit(m: Monster): Hit {
    const scale = monsterDamageMult(m.def, m.level);
    const amounts = { physical: 0, fire: 0, cold: 0, lightning: 0 };
    amounts[m.def.damageType] = Phaser.Math.FloatBetween(m.def.damageMin, m.def.damageMax) * scale;
    return { amounts, crit: false, evadable: true, attackerLevel: m.level };
  }

  private monsterShoots(m: Monster) {
    const a = Phaser.Math.Angle.Between(m.x, m.y, this.player.x, this.player.y);
    const speed = m.def.projectileSpeed ?? 250;
    const img = this.add.circle(m.x, m.y, 6, Number(m.def.color)).setStrokeStyle(2, 0xffffff, 0.7).setDepth(11);
    this.enemyShots.push({ img, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, left: ((m.def.range ?? 300) * 1.4) / speed, hit: this.monsterHit(m) });
  }

  private updateEnemyShots(dt: number) {
    this.enemyShots = this.enemyShots.filter((s) => {
      s.img.x += s.vx * dt;
      s.img.y += s.vy * dt;
      s.left -= dt;
      if (Phaser.Math.Distance.Between(s.img.x, s.img.y, this.player.x, this.player.y) < PLAYER_RADIUS + 6) {
        this.playerTakesHit(s.hit);
        s.img.destroy();
        return false;
      }
      if (s.left <= 0) { s.img.destroy(); return false; }
      return true;
    });
  }

  private monsterHitsPlayer(m: Monster) {
    this.playerTakesHit(this.monsterHit(m));
  }

  private playerTakesHit(hit: Hit) {
    if (this.dead) return;

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
    const colors = { physical: '#ff6b6b', fire: '#ff9a52', cold: '#7fd3ff', lightning: '#ffe45c' };
    const main = (Object.keys(hit.amounts) as (keyof typeof colors)[]).find((k) => hit.amounts[k] > 0) ?? 'physical';
    this.floatText(this.player.x, this.player.y - 24, String(Math.round(result.total)), colors[main]);
    this.player.setTintFill(0xff4444);
    this.time.delayedCall(80, () => this.player.clearTint());
    if (this.life <= 0) this.die();
  }

  // ---------- 전투 ----------

  private distTo(m: Monster) {
    return Phaser.Math.Distance.Between(this.player.x, this.player.y, m.x, m.y) - m.def.radius;
  }

  private nearestMonster(maxDist: number): Monster | null {
    let target: Monster | null = null;
    let best = maxDist;
    for (const m of this.activeMonsters()) {
      const d = this.distTo(m);
      if (d < best) { best = d; target = m; }
    }
    return target;
  }

  /** 가까운 적 쪽으로 몸을 돌림. 없으면 지금 바라보는 방향 */
  private aim(maxDist: number): number {
    const t = this.nearestMonster(maxDist);
    if (t) this.facing = Phaser.Math.Angle.Between(this.player.x, this.player.y, t.x, t.y);
    this.player.setRotation(this.facing);
    return this.facing;
  }

  private updateCombat(dt: number) {
    this.actionCd -= dt;
    for (let i = 0; i < this.skillCds.length; i++) this.skillCds[i] = Math.max(0, this.skillCds[i] - dt);
    if (this.actionCd > 0) return;

    // 기본공격: 사거리 안에 적이 있으면 자동으로 휘두름
    const range = this.basic.range;
    if (!this.nearestMonster(range)) return;
    const angle = this.aim(range);
    this.actionCd = this.basic.useTime / this.stats.actionSpeed;
    this.hitCone(angle, range, this.basic.arc ?? 90, this.basic, this.stats);
    this.coneEffect(angle, range, this.basic.arc ?? 90, 0xffffff, 150);
  }

  private hitCone(angle: number, range: number, arcDeg: number, def: SkillDef, stats: Sheet) {
    const half = Phaser.Math.DegToRad(arcDeg / 2);
    for (const m of this.activeMonsters()) {
      const a = Phaser.Math.Angle.Between(this.player.x, this.player.y, m.x, m.y);
      if (this.distTo(m) < range && Math.abs(Phaser.Math.Angle.Wrap(a - angle)) <= half) this.hitMonster(m, def, stats);
    }
  }

  private castSkill(i: number) {
    const a = this.skills[i];
    if (!a || this.dead || this.skillCds[i] > 0 || this.mana < a.def.manaCost) return;
    const d = a.def;
    this.mana -= d.manaCost;
    this.skillCds[i] = d.cooldown;
    this.actionCd = Math.max(this.actionCd, d.useTime / a.stats.actionSpeed);

    switch (d.shape) {
      case 'nova': {
        const r = d.radius ?? 100;
        for (const m of this.activeMonsters()) if (this.distTo(m) < r) this.hitMonster(m, d, a.stats);
        this.novaEffect(r, 0xffc857);
        break;
      }
      case 'cone': {
        const angle = this.aim(d.range * 1.5);
        this.hitCone(angle, d.range, d.arc ?? 90, d, a.stats);
        this.coneEffect(angle, d.range, d.arc ?? 90, 0xd9a35b, 280);
        this.cameras.main.shake(90, 0.004);
        break;
      }
      case 'projectile': {
        const angle = this.aim(d.range);
        const n = d.projectiles ?? 1;
        const spread = Phaser.Math.DegToRad(12);
        for (let k = 0; k < n; k++) {
          const ang = angle + (k - (n - 1) / 2) * spread;
          const img = this.add.circle(this.player.x, this.player.y, 7, 0xe0e0e0).setStrokeStyle(2, 0x555555).setDepth(12);
          const speed = d.projectileSpeed ?? 500;
          this.projectiles.push({
            img, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
            travelled: 0, maxDist: d.range, pierce: d.pierce ?? 0, hit: new Set(), skill: a,
          });
        }
        break;
      }
      case 'ground': {
        const r = d.radius ?? 100;
        const gfx = this.add.circle(this.player.x, this.player.y, r, 0xff6a2b, 0.22).setStrokeStyle(3, 0xff8a3d, 0.7).setDepth(2);
        this.grounds.push({ x: this.player.x, y: this.player.y, r, left: d.duration ?? 3, tick: 0, gfx, skill: a });
        break;
      }
    }
  }

  private updateProjectiles(dt: number) {
    this.projectiles = this.projectiles.filter((p) => {
      p.img.x += p.vx * dt;
      p.img.y += p.vy * dt;
      p.travelled += Math.hypot(p.vx, p.vy) * dt;
      for (const m of this.activeMonsters()) {
        if (p.hit.has(m)) continue;
        if (Phaser.Math.Distance.Between(p.img.x, p.img.y, m.x, m.y) > m.def.radius + 7) continue;
        p.hit.add(m);
        this.hitMonster(m, p.skill.def, p.skill.stats, p.img.x - p.vx, p.img.y - p.vy);
        if (p.pierce-- <= 0) { p.img.destroy(); return false; }
      }
      if (p.travelled >= p.maxDist) { p.img.destroy(); return false; }
      return true;
    });
  }

  private updateGrounds(dt: number) {
    this.grounds = this.grounds.filter((g) => {
      g.left -= dt;
      g.tick -= dt;
      if (g.tick <= 0) {
        g.tick = g.skill.def.tickInterval ?? 0.5;
        for (const m of this.activeMonsters()) {
          if (Phaser.Math.Distance.Between(g.x, g.y, m.x, m.y) - m.def.radius < g.r) this.hitMonster(m, g.skill.def, g.skill.stats, g.x, g.y, false);
        }
      }
      g.gfx.setAlpha(Math.min(1, g.left / 0.5) * (0.8 + 0.2 * Math.sin(this.elapsed * 20)));
      if (g.left <= 0) { g.gfx.destroy(); return false; }
      return true;
    });
  }

  /** fromX/fromY: 밀려나는 기준점 (기본은 플레이어) */
  private hitMonster(m: Monster, def: SkillDef, stats: Sheet, fromX = this.player.x, fromY = this.player.y, knockback = true) {
    if (!m.active) return;
    const hit = computeHit(stats, def, 1);
    const result = mitigate(hit, m.defender);
    m.life -= result.total;
    const color = result.crit ? '#ffd54f' : hit.amounts.fire > hit.amounts.physical ? '#ffab73' : '#ffffff';
    this.floatText(m.x, m.y - 20, String(Math.round(result.total)), color, result.crit);

    if (knockback) {
      const a = Phaser.Math.Angle.Between(fromX, fromY, m.x, m.y);
      m.x += Math.cos(a) * 6;
      m.y += Math.sin(a) * 6;
    }
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
    if (!this.run) return;
    if (m.def.kind === 'boss') {
      // 보스 전용 드랍 테이블: 장비 여러 개 확정 + 젬
      const bt = bossDropTableFor(this.run);
      for (let i = 0; i < bt.items; i++) {
        const a = (Math.PI * 2 * i) / bt.items;
        this.dropLoot(x + Math.cos(a) * 40, y + Math.sin(a) * 40, generateItem(m.level, Math.random, rollItemRarity(bt)));
      }
      if (Math.random() < bt.gemChance) this.spawnGemDrop(x, y, rollGem(bt));
      const bundle = rollBossCurrency(bt);
      this.addGold(bundle.gold ?? 0);
      let k = 0;
      for (const [id, n] of Object.entries(bundle)) {
        if (id === 'gold' || n <= 0) continue;
        const a = Math.PI / 4 + (Math.PI * 2 * k++) / 4;
        this.spawnCurrencyDrop(x + Math.cos(a) * 70, y + Math.sin(a) * 70, id, n);
      }
      this.boss = null;
      m.destroy();
    } else {
      const table = dropTableFor(this.run);
      if (Math.random() < table.itemChance) this.dropLoot(x, y, generateItem(m.level, Math.random, rollItemRarity(table)));
      if (Math.random() < table.gemChance) this.spawnGemDrop(x + 14, y + 6, rollGem(table));
      this.addGold(rollGold(table, m.level));
      const cur = rollCurrency(table);
      if (cur) this.spawnCurrencyDrop(x - 14, y + 6, cur, 1);
    }

    // 경험치
    const ups = addXp(this.build, monsterXp(m.level, m.def.xp, this.build.level));
    if (ups > 0) {
      this.onBuildChanged();
      const f = this.stats.flat;
      this.life = f.maxLife;
      this.mana = f.maxMana;
      this.floatText(this.player.x, this.player.y - 56, `레벨 업! Lv.${this.build.level}`, '#d1b3ff', true);
      this.tip('first-level', '레벨이 올라 <b>특성 포인트</b>가 생겼습니다. 가방 → 특성 탭에서 찍으세요.');
    }
    if (m.def.kind === 'boss') this.checkClear(true);
    else if (!this.bossSpawned && this.kills >= MAPS.killTarget) this.spawnBoss();
  }

  /** 보스를 잡으면 클리어 */
  private checkClear(bossDown = false) {
    if (this.cleared || !this.run || !bossDown) return;
    this.cleared = true;
    const wasMapping = mappingUnlocked(this.build.progress);
    recordClear(this.build.progress, this.run);
    // 지옥을 다 깨서 맵핑이 처음 열리면 균열 지도 지급
    const unlockedNow = !wasMapping && mappingUnlocked(this.build.progress);
    if (unlockedNow) gain(this.build.wallet, { rift_map: ECONOMY.mappingUnlockMaps });
    saveBuild(this.build);
    // 남은 몬스터는 사라짐 (드랍 없음)
    for (const m of this.activeMonsters()) {
      m.setActive(false).setVisible(false);
      m.body!.enable = false;
    }
    for (const s of this.enemyShots) s.img.destroy();
    this.enemyShots = [];

    const banner = document.createElement('div');
    banner.className = 'clear-banner';
    banner.innerHTML = `<b>클리어!</b><span>${runName(this.run)}</span>
      ${unlockedNow ? `<span>맵핑이 열렸습니다! 균열 지도 ${ECONOMY.mappingUnlockMaps}장을 받았습니다.</span>` : ''}
      <span class="gains">지금까지 얻은 재화: ${formatCost(this.runGains) || '없음'}</span>
      <span class="dim">떨어진 아이템을 줍고 돌아가세요</span>`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '지도로 돌아가기';
    btn.addEventListener('click', () => this.backToMap());
    banner.append(btn);
    banner.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.append(banner);
    this.domButtons.push(banner);
  }

  // ---------- 드랍 / 줍기 ----------

  /** 줍기 필터: 걸러진 장비는 떨어뜨리지 않고, 설정에 따라 자동 분해(50%) */
  private dropLoot(x: number, y: number, item: Item) {
    const prefs = this.build.prefs;
    if (passesLootFilter(prefs, item)) { this.spawnDrop(x, y, item); return; }
    if (!prefs.autoSalvage) return;
    const got = rollSalvage(salvageItemReward(item));
    gain(this.build.wallet, got);
    gain(this.runGains, got);
  }

  private tip(id: string, html: string) {
    if (!firstTime(this.build, id)) return;
    showTip(html);
    saveBuild(this.build);
  }

  private spawnDrop(x: number, y: number, item: Item) {
    const color = RARITY_COLOR[item.rarity];
    const gem = this.add.rectangle(x, y, 12, 12, color).setAngle(45).setStrokeStyle(2, 0x000000, 0.6).setDepth(3);
    const label = this.add.text(x, y - 16, item.name, {
      fontFamily: 'system-ui, sans-serif', fontSize: '12px', color: Phaser.Display.Color.IntegerToColor(color).rgba,
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(3);
    if (item.rarity === 'rare') {
      this.tweens.add({ targets: gem, scale: 1.4, yoyo: true, repeat: -1, duration: 500 });
    }
    this.drops.push({ item, gem, label });
  }

  /** gemId: "id:희귀도". 동그란 초록 젬 + 희귀도 색 테두리 */
  /** 금화는 줍지 않아도 바로 들어옴 */
  private addGold(n: number) {
    if (n <= 0) return;
    gain(this.build.wallet, { gold: n });
    gain(this.runGains, { gold: n });
  }

  private spawnCurrencyDrop(x: number, y: number, id: string, n: number) {
    const def = CURRENCIES[id];
    const color = Number(def.color);
    const gem = this.add.rectangle(x, y, 10, 10, color).setAngle(45).setStrokeStyle(2, 0xffffff, 0.8).setDepth(3);
    const label = this.add.text(x, y - 15, n > 1 ? `${def.name} ×${n}` : def.name, {
      fontFamily: 'system-ui, sans-serif', fontSize: '12px', color: Phaser.Display.Color.IntegerToColor(color).rgba,
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(3);
    if (def.rarity !== 'common') this.tweens.add({ targets: gem, scale: 1.4, yoyo: true, repeat: -1, duration: 450 });
    this.drops.push({ currency: { id, n }, gem, label });
  }

  private spawnGemDrop(x: number, y: number, gemId: string) {
    const rarity = parseGem(gemId)?.rarity ?? 'common';
    const color = GEM_RARITY_COLOR[rarity];
    const gem = this.add.circle(x, y, 7, GEM_COLOR).setStrokeStyle(3, Phaser.Display.Color.HexStringToColor(color).color, 1).setDepth(3);
    const label = this.add.text(x, y - 16, `보조 젬: ${gemName(gemId)}`, {
      fontFamily: 'system-ui, sans-serif', fontSize: '12px', color, stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(3);
    this.tweens.add({ targets: gem, scale: 1.3, yoyo: true, repeat: -1, duration: 600 });
    this.drops.push({ gemId, gem, label });
  }

  private updatePickups() {
    this.drops = this.drops.filter((d) => {
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, d.gem.x, d.gem.y) > PICKUP_RADIUS) return true;
      if (d.currency) {
        const add = { [d.currency.id]: d.currency.n };
        gain(this.build.wallet, add);
        gain(this.runGains, add);
        this.floatText(this.player.x, this.player.y - 40, formatCost(add), d.label.style.color as string);
        d.gem.destroy();
        d.label.destroy();
        saveBuild(this.build);
        return false;
      }
      if (d.gemId) {
        pickUpGem(this.build, d.gemId);
        this.tip('first-gem', '<b>보조 젬</b>을 얻었습니다. 가방 → 스킬 탭에서 스킬 칸에 끼우세요.');
        this.floatText(this.player.x, this.player.y - 40, `보조 젬: ${gemName(d.gemId)}`, GEM_RARITY_COLOR[parseGem(d.gemId)?.rarity ?? 'common']);
        d.gem.destroy();
        d.label.destroy();
        saveBuild(this.build);
        this.inventory.refreshButton();
        return false;
      }
      const result = pickUp(this.build, d.item!);
      if (result === 'full') {
        if (!d.label.getData('warned')) {
          d.label.setData('warned', true);
          this.floatText(this.player.x, this.player.y - 40, '가방이 가득 찼습니다', '#ff9f43');
        }
        return true;
      }
      const item = d.item!;
      const color = Phaser.Display.Color.IntegerToColor(RARITY_COLOR[item.rarity]).rgba;
      this.floatText(this.player.x, this.player.y - 40, result === 'equipped' ? `${item.name} 착용` : item.name, color);
      d.gem.destroy();
      d.label.destroy();
      if (result === 'equipped') this.tip('first-equip', '빈 칸이라 <b>바로 착용</b>했습니다.');
      else this.tip('first-item', '장비를 주웠습니다. <b>가방</b>에서 공격▲ 방어▲ 표시를 보고 바꿔 끼우세요.');
      if (result === 'equipped') this.onBuildChanged();
      else { saveBuild(this.build); this.inventory.refreshButton(); }
      return false;
    });
  }

  private die() {
    this.dead = true;
    this.player.setVelocity(0, 0);
    for (const m of this.activeMonsters()) m.setVelocity(0, 0);
    const { width, height } = this.scale;
    const t = Math.floor(this.elapsed);
    this.add.rectangle(0, 0, width, height, 0x000000, 0.6).setOrigin(0).setScrollFactor(0).setDepth(2000);
    this.add.text(width / 2, height / 2,
      `쓰러졌습니다\n\n${this.run ? runName(this.run) : ''}\n처치 ${this.kills}/${MAPS.killTarget} · ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}\n장비와 레벨은 그대로 남습니다\n\n화면을 누르거나 Enter로 지도로`,
      { fontFamily: 'system-ui, sans-serif', fontSize: '22px', color: '#ffffff', align: 'center' },
    ).setOrigin(0.5).setScrollFactor(0).setDepth(2001);
  }

  // ---------- 이펙트 ----------

  private coneEffect(angle: number, range: number, arcDeg: number, color: number, duration: number) {
    const half = Phaser.Math.DegToRad(arcDeg / 2);
    const g = this.add.graphics().setDepth(15);
    g.fillStyle(color, 0.35);
    g.slice(this.player.x, this.player.y, range, angle - half, angle + half).fillPath();
    this.tweens.add({ targets: g, alpha: 0, duration, onComplete: () => g.destroy() });
  }

  private novaEffect(r: number, color: number) {
    const c = this.add.circle(this.player.x, this.player.y, r, color, 0.25).setStrokeStyle(4, color, 0.9).setDepth(15);
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
      if (m.life >= m.maxLife || m.def.kind === 'boss') continue;
      const w = 30, x = m.x - w / 2, y = m.y - m.def.radius - 8;
      g.fillStyle(0x000000, 0.6).fillRect(x - 1, y - 1, w + 2, 6);
      g.fillStyle(0xe53935).fillRect(x, y, w * Math.max(0, m.life / m.maxLife), 4);
    }
  }

  // ---------- HUD ----------

  private createHud() {
    this.hud = this.add.graphics().setScrollFactor(0).setDepth(1000);
    const style = { fontFamily: 'system-ui, sans-serif', fontSize: '15px', color: '#e8e6e3' };
    this.hudText = this.add.text(16, 62, '', style).setScrollFactor(0).setDepth(1000);
    this.infoText = this.add.text(0, 16, '', { ...style, align: 'right', color: '#9aa0aa' })
      .setOrigin(1, 0).setScrollFactor(0).setDepth(1000);
    this.bossText = this.add.text(0, 0, '', { ...style, fontStyle: 'bold', color: '#ffd54f', stroke: '#000000', strokeThickness: 3 })
      .setOrigin(0.5, 1).setScrollFactor(0).setDepth(1000);

    // 스킬 버튼: 1번은 크게, 나머지는 그 둘레에 부채꼴로
    this.skillBtns = this.skills.map((a, i) => {
      const r = i === 0 ? 44 : 33;
      const gfx = this.add.graphics();
      const label = this.add.text(0, 0, a.def.name.replace(' ', '\n'), {
        fontFamily: 'system-ui, sans-serif', fontSize: i === 0 ? '15px' : '12px', fontStyle: 'bold', color: '#ffffff', align: 'center',
      }).setOrigin(0.5);
      const box = this.add.container(0, 0, [gfx, label]).setScrollFactor(0).setDepth(1000);
      return { box, gfx, r };
    });

    const touch = this.sys.game.device.input.touch;
    const hint = touch
      ? (this.isPortrait() ? '아래쪽을 눌러 끌면 이동\n오른쪽 아래 버튼으로 스킬' : '왼쪽을 눌러 이동 · 오른쪽 버튼으로 스킬')
      : '이동 WASD / 방향키 · 스킬 1~4 (Space = 1) · 가방 I';
    this.hintText = this.add.text(0, 0, `${hint}\n기본공격은 자동`, { ...style, align: 'center' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(1000);
    this.tweens.add({ targets: this.hintText, alpha: 0, delay: 5000, duration: 800, onComplete: () => this.hintText?.destroy() });
  }

  isPortrait() {
    return this.scale.height > this.scale.width;
  }

  /** 세로: 화면 아래쪽 / 가로: 왼쪽 절반을 누르면 조이스틱 */
  private inJoystickZone(p: Phaser.Input.Pointer) {
    if (this.skillButtonAt(p) >= 0) return false;
    return this.isPortrait() ? p.y > this.scale.height * 0.4 : p.x < this.scale.width * 0.5;
  }

  private layout() {
    const { width, height } = this.scale;
    const portrait = this.isPortrait();
    // 세로 화면에서는 엄지가 닿기 쉽게 버튼을 조금 위로
    const ax = width - 80, ay = height - (portrait ? 130 : 86);
    const angles = [0, 180, 225, 270];
    this.skillBtns.forEach((b, i) => {
      if (i === 0) { b.box.setPosition(ax, ay); return; }
      const rad = Phaser.Math.DegToRad(angles[i] ?? 270);
      b.box.setPosition(ax + Math.cos(rad) * 98, ay + Math.sin(rad) * 98);
    });
    this.infoText.setX(width - 16);
    this.hintText?.setPosition(width / 2, portrait ? height * 0.62 : height - 50);
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
      `Lv.${this.build.level}  생명력 ${Math.max(0, Math.ceil(this.life))}/${f.maxLife}  보호막 ${Math.floor(this.shield)}/${f.maxShield}  마나 ${Math.floor(this.mana)}/${f.maxMana}`,
    );
    const ELEM = { physical: '물리', fire: '화염', cold: '냉기', lightning: '번개' } as const;
    const goal = this.cleared ? '클리어' : this.bossSpawned ? `보스 ${MONSTERS[this.map.boss].name}` : `처치 ${Math.min(this.kills, MAPS.killTarget)}/${MAPS.killTarget}`;
    const mobs = this.run?.mode === 'mapping' ? `몹 ${ELEM[mobElement(this.run)]} · ` : '';
    this.infoText.setText(
      `${this.run ? runName(this.run) : ''} (Lv.${this.level})\n` +
      `${mobs}${goal}   ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}\n` +
      `기본공격 DPS ${expectedDps(this.stats, this.basic).toFixed(1)} · 금화 +${this.runGains.gold ?? 0}`,
    );
    // 보스 체력 바 (화면 위 가운데)
    const bw = Math.min(380, this.scale.width - 40);
    const bx = (this.scale.width - bw) / 2;
    const by = this.isPortrait() ? 236 : 104; // 세로: 오른쪽 위 버튼 아래
    if (this.boss?.active) {
      g.fillStyle(0x000000, 0.65).fillRect(bx - 2, by - 2, bw + 4, 14);
      g.fillStyle(0xc62828).fillRect(bx, by, bw * Math.max(0, this.boss.life / this.boss.maxLife), 10);
      this.bossText.setPosition(this.scale.width / 2, by - 4).setText(this.boss.def.name).setVisible(true);
    } else this.bossText.setVisible(false);
    // 경험치 바
    g.fillStyle(0x000000, 0.55).fillRect(14, 54, 224, 6);
    g.fillStyle(0xb388ff).fillRect(16, 55, 220 * Math.min(1, this.build.xp / xpToNext(this.build.level)), 4);

    // 스킬 버튼 + 쿨다운
    this.skillBtns.forEach((b, i) => {
      const a = this.skills[i];
      const cd = this.skillCds[i];
      const ready = cd <= 0 && this.mana >= a.def.manaCost;
      const g2 = b.gfx.clear();
      g2.fillStyle(ready ? 0xc9822b : 0x555555, 0.85).fillCircle(0, 0, b.r);
      g2.lineStyle(3, 0xffffff, 0.6).strokeCircle(0, 0, b.r);
      if (cd > 0 && a.def.cooldown > 0) {
        const ratio = cd / a.def.cooldown;
        g2.fillStyle(0x000000, 0.55).slice(0, 0, b.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio).fillPath();
      }
    });
  }
}
