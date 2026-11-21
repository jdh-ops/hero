// 밸런싱 시트: 지역마다 "평범한 플레이어"를 가정해 처치 시간(TTK)과 버티는 시간(TTD)을 계산한다.
// 실행: npm run balance  → docs/밸런스.md 생성
import { writeFileSync } from 'node:fs';
import { StatSheet } from '../src/core/stats';
import { armorReduction, averageHit, evadeChance, expectedDps } from '../src/core/damage';
import { AFFIXES, BASES, type Item, type Slot } from '../src/core/items';
import { resolveSkill } from '../src/core/skills';
import { levelMods, monsterXp, xpToNext, areaLevel, dropTableFor, bossDropTableFor, type RunConfig } from '../src/core/progress';
import { talentMods } from '../src/core/talents';
import { gemKey } from '../src/core/gems';
import { monsterLife, monsterDamageMult } from '../src/core/scaling';
import { CLASSES, ECONOMY, MAPS, MONSTERS, SKILLS } from '../src/data';
import type { Mod } from '../src/core/types';

type Grade = 'normal' | 'hard' | 'hell' | 'mapping';

// ---------- 평범한 플레이어 ----------

/** 그 시점에 끼고 있을 법한 장비: 등급별 옵션 수, 열린 티어 중 두 번째로 좋은 티어의 중간값 */
function typicalItem(slot: Slot, ilvl: number, grade: Grade, element: string): Item {
  const bases = Object.values(BASES).filter((b) => b.slot === slot && b.level <= ilvl && !b.id.includes('evasion') && !b.id.includes('shield'));
  // 반지는 그 맵 속성 저항 반지가 있으면 그것
  const elemRing = { fire: 'ring_ruby', cold: 'ring_sapphire', lightning: 'ring_topaz' }[element as 'fire'];
  const base = slot === 'ring' && elemRing && BASES[elemRing].level <= ilvl ? BASES[elemRing]
    : bases.sort((a, b) => b.level - a.level)[0];
  const wish: Record<Slot, string[]> = {
    weapon: ['addPhys', 'incPhys', 'critChance', 'incAttack'],
    helmet: ['maxLife', 'armor', 'resFire', 'incArea'],
    chest: ['maxLife', 'armor', 'resCold', 'lifeRegen'],
    boots: ['maxLife', 'moveSpeedInc', 'armor', 'resLightning'],
    ring: ['maxLife', 'addPhys', 'resFire', 'critMulti'],
  };
  const count = grade === 'normal' ? 2 : grade === 'hard' ? 2 : grade === 'hell' ? 3 : 4;
  const affixes = wish[slot].slice(0, count).map((id) => {
    const def = AFFIXES[id];
    const open = def.tiers.filter((t) => t.level <= ilvl).sort((a, b) => a.tier - b.tier);
    const t = open[Math.min(1, open.length - 1)]; // 최고 티어는 드물어서 한 단계 아래
    const mid = (t.lo + t.hi) / 2;
    const m = def.mod;
    const mod: Mod = m.kind === 'added' ? { kind: 'added', type: m.type, min: Math.round(mid), max: Math.round(mid * 2 + 1) }
      : m.kind === 'flat' ? { kind: 'flat', stat: m.stat, value: mid } : { kind: m.kind, tag: m.tag, value: mid };
    return { id, tier: t.tier, mod };
  });
  return { uid: slot, baseId: base.id, name: base.name, slot, rarity: 'magic', ilvl, implicit: base.implicit, affixes, v: 2 };
}

const TALENT_ORDER = ['w_phys', 'w_life', 'w_melee', 'w_key', 'w_armor', 'w_str', 'w_regen', 's_res', 'h_crit', 'h_critdmg', 'h_speed'];
const TALENT_MAX: Record<string, number> = { w_key: 1, w_str: 3, w_regen: 3 };

function typicalTalents(points: number): Record<string, number> {
  const r: Record<string, number> = {};
  for (const id of TALENT_ORDER) {
    const max = TALENT_MAX[id] ?? 5;
    while (points > 0 && (r[id] ?? 0) < max) {
      // 핵심 특성은 투사 계열 10포인트 이후
      if (id === 'w_key' && Object.entries(r).filter(([k]) => k.startsWith('w_')).reduce((a, [, n]) => a + n, 0) < 10) break;
      r[id] = (r[id] ?? 0) + 1;
      points--;
    }
  }
  return r;
}

const GEM_RARITY: Record<Grade, 'common' | 'uncommon' | 'rare'> = { normal: 'common', hard: 'uncommon', hell: 'rare', mapping: 'rare' };
const SKILL_LV: Record<Grade, number> = { normal: 1, hard: 3, hell: 5, mapping: 6 };

interface Player { level: number; stats: StatSheet; dps: number; single: number; ehp: number; regen: number; armor: number; evasion: number; res: number }

function typicalPlayer(level: number, ilvl: number, grade: Grade, element: string): Player {
  const cls = CLASSES.warrior;
  const gear = (['weapon', 'helmet', 'chest', 'boots', 'ring'] as Slot[]).map((s) => typicalItem(s, ilvl, grade, element));
  const mods = [...cls.mods, ...levelMods(level), ...talentMods(typicalTalents(level - 1)), ...gear.flatMap((i) => [...i.implicit, ...i.affixes.map((a) => a.mod)])];
  const stats = new StatSheet(mods);
  const gr = GEM_RARITY[grade];
  const sk = (id: string, gems: string[]) => resolveSkill(SKILLS[id], gems.map((g) => gemKey(g, gr)), mods, SKILL_LV[grade]);
  const skills = [sk('warrior_whirl', ['sup_focus', 'sup_melee']), sk('warrior_slam', ['sup_melee']), sk('warrior_axe', []), sk('warrior_blaze', [])];
  // 마나가 버티는 만큼만 스킬 사용
  const manaPerSec = skills.reduce((a, s) => a + s.def.manaCost / Math.max(s.def.cooldown, s.def.useTime), 0);
  const use = Math.min(1, stats.flat.manaRegen / manaPerSec + 0.35); // 최대 마나 여유분 반영
  const skillDps = skills.reduce((a, s) => {
    const per = s.def.shape === 'ground' ? averageHit(s.stats, s.def) * ((s.def.duration ?? 3) / (s.def.tickInterval ?? 0.5)) : averageHit(s.stats, s.def);
    return a + per / Math.max(s.def.cooldown, s.def.useTime);
  }, 0) * use;
  const basic = expectedDps(stats, SKILLS[cls.basicAttack]);
  const f = stats.flat;
  const res = element === 'physical' ? 0 : Math.min(0.75, f[`res${element[0].toUpperCase()}${element.slice(1)}` as 'resFire'] ?? 0);
  // 기본공격은 스킬 쓰는 동안 줄어듦
  return { level, stats, dps: basic * 0.7 + skillDps, single: basic * 0.7 + skillDps, ehp: f.maxLife + f.maxShield, regen: f.lifeRegen, armor: f.armor, evasion: f.evasion, res };
}

// ---------- 진행 (레벨 흐름) ----------

interface Row { gold: number; items: number; gems: number; cur: number; name: string; grade: Grade; area: number; level: number; dps: number; mobLife: number; ttk: number; bossTtk: number; ttd: number; hitPct: number; clearMin: number }

const RUNS_PER_MAP = 1.4; // 실패·재도전 포함 평균 판 수
const rows: Row[] = [];
const prog = { level: 1, xp: 0 };

function addXp(n: number) {
  prog.xp += n;
  while (prog.xp >= xpToNext(prog.level) && prog.level < 60) { prog.xp -= xpToNext(prog.level); prog.level++; }
}

function evalRun(run: RunConfig, grade: Grade, name: string) {
  const L = areaLevel(run);
  const map = run.mode === 'story' ? MAPS.maps[run.mapIndex] : MAPS.maps.find((m) => m.id === run.mapId)!;
  const p = typicalPlayer(prog.level, Math.max(1, L - 2), grade, map.element);
  const mobs = map.monsters.map((e) => MONSTERS[e.id]);
  const avgLife = mobs.reduce((a, m) => a + monsterLife(m, L), 0) / mobs.length;
  // 몹 방어: 물리는 방어도, 원소 피해는 거의 없음(전사는 물리 위주)
  const mobArmorRed = mobs.reduce((a, m) => a + armorReduction(m.armor, 1), 0) / mobs.length;
  const ttk = avgLife / (p.single * (1 - mobArmorRed));
  const boss = MONSTERS[map.boss];
  const bossTtk = monsterLife(boss, L) / (p.single * (1 - armorReduction(boss.armor, 1)));
  // 받는 피해: 근접 몹 3마리가 붙어 있을 때
  const melee = mobs.find((m) => m.kind === 'melee')!;
  const raw = ((melee.damageMin + melee.damageMax) / 2) * monsterDamageMult(melee, L);
  const mit = melee.damageType === 'physical' ? 1 - armorReduction(p.armor, L) : 1 - p.res;
  const hit = raw * mit * (1 - evadeChance(p.evasion, L));
  const incoming = (3 * hit) / melee.attackInterval;
  const ttd = incoming > p.regen ? p.ehp / (incoming - p.regen) : 999;
  // 한 판 시간: 60마리 (범위 스킬로 2~3마리씩) + 보스 + 이동
  // 출현 속도와 처치 속도 중 느린 쪽 + 보스 + 이동·줍기 30초
  const K = MAPS.killTarget, B = MAPS.balance;
  const spawnTime = K / ((1 + B.doubleSpawnChance) / B.spawnInterval);
  const clearMin = (Math.max(spawnTime, (K * ttk) / 2.2) + bossTtk + 30) / 60;
  const dt = dropTableFor(run), bt = bossDropTableFor(run);
  const K2 = MAPS.killTarget;
  const gold = K2 * L * (dt.goldPerLevel[0] + dt.goldPerLevel[1]) / 2 + ((bt.currency.gold as number) ?? 0);
  const items = K2 * dt.itemChance + bt.items;
  const gems = K2 * dt.gemChance + bt.gemChance;
  const cur = K2 * dt.currencyChance;
  rows.push({ gold, items, gems, cur, name, grade, area: L, level: p.level, dps: p.single, mobLife: avgLife, ttk, bossTtk, ttd, hitPct: (raw * mit) / p.ehp * 100, clearMin });
  // 경험치
  const xpRun = mobs.reduce((a, m) => a + monsterXp(L, m.xp, prog.level), 0) / mobs.length * MAPS.killTarget + monsterXp(L, boss.xp, prog.level);
  addXp(xpRun * RUNS_PER_MAP);
}

for (const d of MAPS.story) {
  for (let i = 0; i < MAPS.maps.length; i++) evalRun({ mode: 'story', difficulty: d.id as 'normal', mapIndex: i }, d.id as Grade, `${d.name} · ${MAPS.maps[i].name}`);
}
for (let t = 1; t <= MAPS.mapping.maxTier; t++) {
  const m = MAPS.maps[(t - 1) % MAPS.maps.length];
  evalRun({ mode: 'mapping', mapId: m.id, tier: t }, 'mapping', `맵핑 ${t}티어 · ${m.name}`);
}

// ---------- 출력 ----------

const f1 = (n: number) => (n >= 100 ? n.toFixed(0) : n.toFixed(1));
const flag = (v: number, lo: number, hi: number) => (v < lo ? ' ⬇' : v > hi ? ' ⬆' : '');
const TARGET = { ttk: [0.4, 1.2], boss: [15, 50], ttd: [5, 30], clear: [2, 5] } as const;

const lines = [
  '# 밸런스 시트',
  '',
  '`npm run balance` 로 다시 만든다 (scripts/balance.ts). 수치를 바꾸면 이 표로 확인.',
  '',
  '가정: 전사, 지역 레벨 −2 장비(고급 2옵션 → 희귀 3~4옵션, 열린 티어 중 두 번째), 투사 위주 특성, 스킬 강화 +1/+3/+5/+6,',
  `보조 젬(집중 타격·근접 숙련), 맵마다 평균 ${RUNS_PER_MAP}판. 받는 피해는 근접 몹 3마리가 붙었을 때.`,
  '',
  `목표: 일반 몹 처치 ${TARGET.ttk[0]}~${TARGET.ttk[1]}초, 보스 ${TARGET.boss[0]}~${TARGET.boss[1]}초, 버티는 시간 ${TARGET.ttd[0]}~${TARGET.ttd[1]}초, 한 판 ${TARGET.clear[0]}~${TARGET.clear[1]}분. ⬆⬇ = 목표 밖`,
  '',
  '| 맵 | 지역 Lv | 내 Lv | 몹 처치(초) | 보스 처치(초) | 버티는 시간(초) | 몹 한 방(생명력 %) | 한 판(분) |',
  '|---|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.name} | ${r.area} | ${r.level} | ${f1(r.ttk)}${flag(r.ttk, ...TARGET.ttk)} | ${f1(r.bossTtk)}${flag(r.bossTtk, ...TARGET.boss)} | ${f1(r.ttd)}${flag(r.ttd, ...TARGET.ttd)} | ${r.hitPct.toFixed(1)}% | ${r.clearMin.toFixed(1)}${flag(r.clearMin, ...TARGET.clear)} |`),
  '',
  '## 한 판 수입 (평균)',
  '',
  '| 맵 | 금화 | 장비 | 보조 젬 | 재화(금화 제외, 보스 묶음 별도) | 희귀 장비 굴리기 금화 |',
  '|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.name} | ${Math.round(r.gold)} | ${r.items.toFixed(1)} | ${r.gems.toFixed(1)} | ${r.cur.toFixed(1)} | ${ECONOMY.reroll.goldBase + ECONOMY.reroll.goldPerIlvl * r.area} |`),
  '',
];
const out = process.argv[2];
if (out) writeFileSync(out, lines.join('\n'));
if (process.env.DEBUG) for (const r of rows) console.error(r.area, r.level, r.dps.toFixed(1), r.mobLife.toFixed(0));
console.log(lines.join('\n'));
