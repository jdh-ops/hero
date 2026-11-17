// 캐릭터 빌드(직업 + 착용 장비 + 가방)와 로컬 저장.
import { StatSheet } from './stats';
import { critChance, expectedDps } from './damage';
import { itemMods, makeItem, type Item, type Slot } from './items';
import { CLASSES, SKILLS, type ClassDef } from '../data';

export const BAG_SIZE = 40;
const SAVE_KEY = 'hero.save';
export const SAVE_VERSION = 1;

export interface Build {
  classId: string;
  equipment: Partial<Record<Slot, Item>>;
  bag: Item[];
}

export interface SaveData extends Build {
  version: number;
  savedAt: string;
}

export function newBuild(classId = 'warrior'): Build {
  return { classId, equipment: { weapon: makeItem('short_sword', 'normal', 1) }, bag: [] };
}

export function classOf(build: Build): ClassDef {
  return CLASSES[build.classId];
}

export function statsFor(build: Build, equipment = build.equipment): StatSheet {
  const mods = [...classOf(build).mods];
  for (const item of Object.values(equipment)) if (item) mods.push(...itemMods(item));
  return new StatSheet(mods);
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
  const skill = SKILLS[cls.skills[0]];
  const f = stats.flat;
  return {
    basicDps: expectedDps(stats, SKILLS[cls.basicAttack]),
    // 스킬 1회 평균 피해 (쿨다운 스킬이라 DPS 대신)
    skillHit: expectedDps(stats, skill) * skill.useTime / stats.actionSpeed,
    maxLife: f.maxLife, maxShield: f.maxShield, maxMana: f.maxMana,
    armor: f.armor, evasion: f.evasion,
    resFire: f.resFire, resCold: f.resCold, resLightning: f.resLightning,
    critChance: critChance(stats), actionSpeed: stats.actionSpeed, moveSpeed: stats.moveSpeed,
  };
}

export const SUMMARY_LABELS: Record<keyof Summary, [string, 'num' | 'pct' | 'mult']> = {
  basicDps: ['기본공격 DPS', 'num'],
  skillHit: ['스킬 1회 피해', 'num'],
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
        return { classId: data.classId, equipment: data.equipment ?? {}, bag: data.bag ?? [] };
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
