// 캐릭터 빌드(직업 + 착용 장비 + 가방 + 보조 젬)와 로컬 저장.
import { StatSheet } from './stats';
import { averageHit, critChance, expectedDps } from './damage';
import { itemMods, makeItem, type Item, type Slot } from './items';
import { SUPPORT_SOCKETS, canSupport, resolveSkill, type ActiveSkill } from './skills';
import type { Mod } from './types';
import { levelMods, newProgress, type Progress } from './progress';
import { talentMods, type TalentRanks } from './talents';
import type { Wallet } from './economy';
import { CLASSES, SKILLS, type ClassDef } from '../data';
import { gemKey, migrateGemKey, parseGem } from './gems';

export const BAG_SIZE = 40;
const SAVE_KEY = 'hero.save';
export const SAVE_VERSION = 1;

export interface Build {
  classId: string;
  equipment: Partial<Record<Slot, Item>>;
  bag: Item[];
  /** 가진 보조 젬 개수. 키는 "id:희귀도" */
  gems: Record<string, number>;
  /** 스킬별 보조 젬 칸 ("id:희귀도" 또는 null) */
  sockets: Record<string, (string | null)[]>;
  level: number;
  xp: number;
  progress: Progress;
  /** 재화 */
  wallet: Wallet;
  /** 특성 랭크 */
  talents: TalentRanks;
  /** 스킬 강화 단계와 연속 실패 수 */
  skillEnhance: Record<string, { level: number; fails: number }>;
}

export interface SaveData extends Build {
  version: number;
  savedAt: string;
}

export function newBuild(classId = 'warrior'): Build {
  return {
    classId,
    equipment: { weapon: makeItem('short_sword', 'normal', 1) },
    bag: [],
    gems: { [gemKey('sup_focus', 'common')]: 1 },
    sockets: {},
    level: 1,
    xp: 0,
    progress: newProgress(),
    wallet: { gold: 0 },
    talents: {},
    skillEnhance: {},
  };
}

export function classOf(build: Build): ClassDef {
  return CLASSES[build.classId];
}

/** 직업 + 장비 수정치 */
export function baseMods(build: Build, equipment = build.equipment): Mod[] {
  const mods = [...classOf(build).mods, ...levelMods(build.level), ...talentMods(build.talents)];
  for (const item of Object.values(equipment)) if (item) mods.push(...itemMods(item));
  return mods;
}

export function statsFor(build: Build, equipment = build.equipment): StatSheet {
  return new StatSheet(baseMods(build, equipment));
}

// ---------- 스킬과 보조 젬 ----------

export function socketsOf(build: Build, skillId: string): (string | null)[] {
  const s = build.sockets[skillId] ?? [];
  return Array.from({ length: SUPPORT_SOCKETS }, (_, i) => s[i] ?? null);
}

/** 직업의 액티브 스킬들 (보조 젬 반영) */
export function activeSkills(build: Build, equipment = build.equipment): ActiveSkill[] {
  const mods = baseMods(build, equipment);
  return classOf(build).skills.map((id) => {
    const keys = socketsOf(build, id).filter((g): g is string => !!g);
    return resolveSkill(SKILLS[id], keys, mods, build.skillEnhance[id]?.level ?? 0);
  });
}

/** 아직 어느 스킬에도 끼우지 않은 젬 개수 */
export function freeGems(build: Build, gemId: string): number {
  let used = 0;
  for (const list of Object.values(build.sockets)) used += list.filter((g) => g === gemId).length;
  return (build.gems[gemId] ?? 0) - used;
}

/** 보조 젬 칸에 젬을 끼우거나(gemKey) 뺌(null). 성공하면 true */
export function socketGem(build: Build, skillId: string, index: number, key: string | null): boolean {
  const list = socketsOf(build, skillId);
  if (index < 0 || index >= list.length) return false;
  if (key) {
    const gem = parseGem(key);
    if (!gem || !canSupport(SKILLS[skillId], gem.def)) return false;
    // 같은 종류의 젬은 희귀도가 달라도 한 스킬에 하나만 (지금 칸에 있던 것과 바꾸는 건 허용)
    if (list.some((g, i) => i !== index && g && parseGem(g)?.def.id === gem.def.id)) return false;
    if (list[index] !== key && freeGems(build, key) <= 0) return false;
  }
  list[index] = key;
  build.sockets[skillId] = list;
  return true;
}

export function pickUpGem(build: Build, gemId: string): void {
  build.gems[gemId] = (build.gems[gemId] ?? 0) + 1;
}

/** 장비 비교에 쓰는 요약 수치 */
export interface Summary {
  basicDps: number;
  skillHit: number;
  maxLife: number;
  maxShield: number;
  maxMana: number;
  armor: number;
  evasion: number;
  resFire: number;
  resCold: number;
  resLightning: number;
  critChance: number;
  actionSpeed: number;
  moveSpeed: number;
}

export function summarize(build: Build, stats: StatSheet): Summary {
  const cls = classOf(build);
  const f = stats.flat;
  const first = resolveSkill(SKILLS[cls.skills[0]], [], stats.mods);
  return {
    basicDps: expectedDps(stats, SKILLS[cls.basicAttack]),
    // 1번 스킬 1회 평균 피해 (쿨다운 스킬이라 DPS 대신, 보조 젬 제외)
    skillHit: averageHit(first.stats, first.def),
    maxLife: f.maxLife, maxShield: f.maxShield, maxMana: f.maxMana,
    armor: f.armor, evasion: f.evasion,
    resFire: f.resFire, resCold: f.resCold, resLightning: f.resLightning,
    critChance: critChance(stats), actionSpeed: stats.actionSpeed, moveSpeed: stats.moveSpeed,
  };
}

export const SUMMARY_LABELS: Record<keyof Summary, [string, 'num' | 'pct' | 'mult']> = {
  basicDps: ['기본공격 DPS', 'num'],
  skillHit: ['1번 스킬 피해', 'num'],
  maxLife: ['최대 생명력', 'num'],
  maxShield: ['최대 보호막', 'num'],
  maxMana: ['최대 마나', 'num'],
  armor: ['방어도', 'num'],
  evasion: ['회피', 'num'],
  resFire: ['화염 저항', 'pct'],
  resCold: ['냉기 저항', 'pct'],
  resLightning: ['번개 저항', 'pct'],
  critChance: ['치명타 확률', 'pct'],
  actionSpeed: ['행동 속도', 'mult'],
  moveSpeed: ['이동 속도', 'num'],
};

// ---------- 장비 조작 ----------

/** 가방의 아이템을 착용. 원래 끼던 건 가방으로 */
export function equipFromBag(build: Build, uid: string): void {
  const idx = build.bag.findIndex((i) => i.uid === uid);
  if (idx < 0) return;
  const item = build.bag[idx];
  const prev = build.equipment[item.slot];
  build.equipment[item.slot] = item;
  if (prev) build.bag[idx] = prev;
  else build.bag.splice(idx, 1);
}

export function unequip(build: Build, slot: Slot): boolean {
  const item = build.equipment[slot];
  if (!item || build.bag.length >= BAG_SIZE) return false;
  delete build.equipment[slot];
  build.bag.push(item);
  return true;
}

export function discard(build: Build, uid: string): void {
  build.bag = build.bag.filter((i) => i.uid !== uid);
}

/** 주운 아이템: 빈 슬롯이면 바로 착용, 아니면 가방. 가방이 꽉 차면 false */
export function pickUp(build: Build, item: Item): 'equipped' | 'bag' | 'full' {
  if (!build.equipment[item.slot]) {
    build.equipment[item.slot] = item;
    return 'equipped';
  }
  if (build.bag.length >= BAG_SIZE) return 'full';
  build.bag.push(item);
  return 'bag';
}

// ---------- 저장 ----------

export function saveBuild(build: Build): void {
  const data: SaveData = { ...build, version: SAVE_VERSION, savedAt: new Date().toISOString() };
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // 저장 공간을 못 쓰는 환경(시크릿 창 등)에서는 저장 없이 진행
  }
}

export function loadBuild(): Build {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as SaveData;
      if (data.version === SAVE_VERSION && CLASSES[data.classId]) {
        return {
          classId: data.classId,
          equipment: data.equipment ?? {},
          bag: data.bag ?? [],
          // 4단계 이전 세이브에는 없음
          // 젬 희귀도 도입 전 세이브는 모두 일반 등급으로
          gems: Object.fromEntries(Object.entries(data.gems ?? { sup_focus: 1 }).map(([k, n]) => [migrateGemKey(k), n])),
          sockets: Object.fromEntries(Object.entries(data.sockets ?? {}).map(([s, l]) => [s, l.map((g) => (g ? migrateGemKey(g) : null))])),
          // 5단계 이전 세이브에는 없음
          level: data.level ?? 1,
          xp: data.xp ?? 0,
          progress: { ...newProgress(), ...data.progress, story: { ...newProgress().story, ...data.progress?.story } },
          // 6단계 이전 세이브에는 없음
          wallet: data.wallet ?? { gold: 0 },
          talents: data.talents ?? {},
          skillEnhance: data.skillEnhance ?? {},
        };
      }
    }
  } catch {
    // 손상된 세이브는 무시하고 새로 시작
  }
  return newBuild();
}

export function resetSave(): Build {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* 무시 */ }
  return newBuild();
}
