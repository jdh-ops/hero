// 장비: 생성(드랍), 옵션 설명, 스탯 반영.
import type { DamageType, FlatStat, Mod, Tag } from './types';
import type { Rng } from './damage';
import basesJson from '../data/items.json';
import affixesJson from '../data/affixes.json';

export const SLOTS = ['weapon', 'helmet', 'chest', 'boots', 'ring'] as const;
export type Slot = (typeof SLOTS)[number];
export const SLOT_NAMES: Record<Slot, string> = {
  weapon: '무기', helmet: '투구', chest: '갑옷', boots: '신발', ring: '반지',
};

export type Rarity = 'normal' | 'magic' | 'rare';
/** 장비 등급 이름 (내부 id 'magic' = 고급) */
export const RARITY_NAMES: Record<Rarity, string> = { normal: '일반', magic: '고급', rare: '희귀' };

export interface ItemBase {
  id: string;
  slot: Slot;
  name: string;
  /** 이 아이템 레벨부터 나옴 */
  level: number;
  implicit: Mod[];
}

/** 옵션 희귀도: 자주 나오는 옵션(일반) ~ 드문 옵션(희귀) */
export type AffixRarity = 'common' | 'uncommon' | 'rare';
export const AFFIX_RARITY_NAMES: Record<AffixRarity, string> = { common: '일반', uncommon: '고급', rare: '희귀' };

/** 옵션 정의. mod 는 값이 빠진 틀이고, 티어에서 값 범위를 고른다 */
export interface AffixDef {
  id: string;
  slots: Slot[];
  mod: { kind: 'flat'; stat: FlatStat } | { kind: 'added'; type: DamageType } | { kind: 'inc' | 'more'; tag: Tag | 'all' };
  /** 티어 1 = 최상. level 이상 아이템에서만 나옴. added 는 lo~hi 가 최솟값, 최댓값은 그 2배 */
  tiers: { tier: number; level: number; lo: number; hi: number }[];
  rarity: AffixRarity;
}

export interface Item {
  uid: string;
  baseId: string;
  name: string;
  slot: Slot;
  rarity: Rarity;
  ilvl: number;
  implicit: Mod[];
  /** tier: 1 = 최상 */
  affixes: { id: string; tier: number; mod: Mod }[];
  /** 세이브 형식 (2 = 5티어 체계) */
  v?: number;
}

export const BASES = basesJson as Record<string, ItemBase>;
export const AFFIXES = affixesJson as unknown as Record<string, AffixDef>;

/** 등급별 확률과 옵션 개수 */
export const RARITY_RULES: Record<Rarity, { weight: number; affixes: [number, number] }> = {
  normal: { weight: 60, affixes: [1, 1] },
  magic: { weight: 30, affixes: [2, 2] },
  rare: { weight: 10, affixes: [3, 4] },
};

/**
 * 옵션 굴림 가중치.
 * - 옵션 희귀도: 일반 옵션이 자주, 희귀 옵션은 드물게
 * - 티어: 아이템 레벨로 열린 가장 높은 티어가 가장 드묾 (한 단계 낮을수록 2배)
 * - 금괴 굴림(boosted): 희귀 옵션과 높은 티어가 훨씬 잘 나옴
 */
export const ROLL_WEIGHTS = {
  rarity: { common: 100, uncommon: 45, rare: 15 } as Record<AffixRarity, number>,
  rarityBoosted: { common: 60, uncommon: 60, rare: 45 } as Record<AffixRarity, number>,
  tierStep: 2,
  tierStepBoosted: 1.2,
};

const RARE_WORDS_A = ['폭풍', '잿빛', '서리', '피', '별', '그림자', '천둥', '용암', '고요', '맹수'];
const RARE_WORDS_B = ['송곳니', '맹세', '비명', '수호', '심장', '파편', '울음', '손길', '징표', '불꽃'];

const pick = <T>(arr: readonly T[], rng: Rng): T => arr[Math.floor(rng() * arr.length)];

function pickWeighted<T>(items: readonly T[], weight: (t: T) => number, rng: Rng): T {
  const total = items.reduce((s, t) => s + weight(t), 0);
  let r = rng() * total;
  for (const t of items) {
    r -= weight(t);
    if (r < 0) return t;
  }
  return items[items.length - 1];
}

const round = (v: number, step: number) => Math.round(v / step) * step;

/** 아이템 레벨로 열린 최고 티어 (1 = 최상) */
export function maxTierFor(def: AffixDef, ilvl: number): number {
  return Math.min(...def.tiers.filter((t) => t.level <= ilvl).map((t) => t.tier));
}

function rollValue(def: AffixDef, tier: number, rng: Rng): Mod {
  const t = def.tiers.find((x) => x.tier === tier)!;
  const raw = t.lo + (t.hi - t.lo) * rng();
  const m = def.mod;
  if (m.kind === 'added') {
    const min = Math.round(raw);
    return { kind: 'added', type: m.type, min, max: Math.round(min * 2 + rng() * 2) };
  }
  if (m.kind === 'flat') return { kind: 'flat', stat: m.stat, value: t.hi < 1 ? round(raw, 0.005) : Math.round(raw) };
  return { kind: m.kind, tag: m.tag, value: round(raw, 0.01) };
}

export function rollAffix(def: AffixDef, ilvl: number, rng: Rng, boosted = false): Item['affixes'][number] {
  const open = def.tiers.filter((t) => t.level <= ilvl);
  const best = Math.min(...open.map((t) => t.tier));
  const step = boosted ? ROLL_WEIGHTS.tierStepBoosted : ROLL_WEIGHTS.tierStep;
  // 최고 티어 가중치 1, 한 단계 낮을 때마다 step 배
  const t = pickWeighted(open, (x) => Math.pow(step, x.tier - best), rng);
  return { id: def.id, tier: t.tier, mod: rollValue(def, t.tier, rng) };
}

/** 이 슬롯에 붙을 수 있는 옵션 중 하나 (exclude 는 이미 붙은 옵션) */
function pickAffixDef(slot: Slot, exclude: string[], rng: Rng, boosted: boolean): AffixDef | null {
  const pool = Object.values(AFFIXES).filter((a) => a.slots.includes(slot) && !exclude.includes(a.id));
  if (!pool.length) return null;
  const w = boosted ? ROLL_WEIGHTS.rarityBoosted : ROLL_WEIGHTS.rarity;
  return pickWeighted(pool, (a) => w[a.rarity], rng);
}

let uidCounter = 0;
export const newUid = () => `${Date.now().toString(36)}${(uidCounter++).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

export function makeItem(baseId: string, rarity: Rarity, ilvl: number, rng: Rng = Math.random): Item {
  const base = BASES[baseId];
  const [lo, hi] = RARITY_RULES[rarity].affixes;
  const count = lo + Math.floor(rng() * (hi - lo + 1));
  const affixes: Item['affixes'] = [];
  while (affixes.length < count) {
    const def = pickAffixDef(base.slot, affixes.map((a) => a.id), rng, false);
    if (!def) break;
    affixes.push(rollAffix(def, ilvl, rng));
  }
  const name = rarity === 'rare' ? `${pick(RARE_WORDS_A, rng)}의 ${pick(RARE_WORDS_B, rng)}` : base.name;
  return { uid: newUid(), baseId, name, slot: base.slot, rarity, ilvl, implicit: base.implicit, affixes, v: 2 };
}

/** 장비 강화: 옵션 하나(index)를 새 옵션으로 다시 굴림. 나머지 옵션과 겹치지 않음 */
export function rerollAffix(item: Item, index: number, rng: Rng = Math.random, boosted = false): boolean {
  if (index < 0 || index >= item.affixes.length) return false;
  const others = item.affixes.filter((_, i) => i !== index).map((a) => a.id);
  const def = pickAffixDef(item.slot, others, rng, boosted);
  if (!def) return false;
  item.affixes[index] = rollAffix(def, item.ilvl, rng, boosted);
  return true;
}

/** 몬스터 레벨 = 아이템 레벨. 그 레벨 이하에서 나오는 장비 중 하나. rarity 를 안 주면 기본 확률 */
export function generateItem(ilvl: number, rng: Rng = Math.random, forcedRarity?: Rarity): Item {
  const slot = pick(SLOTS, rng);
  const candidates = Object.values(BASES).filter((b) => b.slot === slot && b.level <= ilvl);
  // 높은 단계 장비가 나올 수 있으면 그쪽을 더 자주
  const base = pickWeighted(candidates, (b) => 1 + b.level, rng);
  const rarity = forcedRarity ?? pickWeighted(Object.keys(RARITY_RULES) as Rarity[], (r) => RARITY_RULES[r].weight, rng);
  return makeItem(base.id, rarity, ilvl, rng);
}

/**
 * 예전 세이브 장비를 새 체계로:
 * - 옛 티어(1~3, 3 = 최상) → 새 티어(5~3, 1 = 최상)
 * - 등급별 최소 옵션 수를 채움 (일반 1, 고급 2)
 */
export function migrateItem(item: Item & { enhance?: number; enhanceFails?: number }, rng: Rng = Math.random): Item {
  if (item.v === 2) return item;
  const out: Item = { ...item, affixes: item.affixes.map((a) => ({ ...a, tier: 6 - a.tier })), v: 2 };
  delete (out as { enhance?: number }).enhance;
  delete (out as { enhanceFails?: number }).enhanceFails;
  while (out.affixes.length < RARITY_RULES[out.rarity].affixes[0]) {
    const def = pickAffixDef(out.slot, out.affixes.map((a) => a.id), rng, false);
    if (!def) break;
    out.affixes.push(rollAffix(def, out.ilvl, rng));
  }
  return out;
}

export const implicitMods = (item: Item) => item.implicit;
export const affixMod = (item: Item, i: number) => item.affixes[i].mod;

export function itemMods(item: Item): Mod[] {
  return [...item.implicit, ...item.affixes.map((a) => a.mod)];
}

export const itemTitle = (item: Item) => item.name;

// ---------- 표시 ----------

const FLAT_LABEL: Record<FlatStat, [string, 'num' | 'pct']> = {
  str: ['힘', 'num'], dex: ['민첩', 'num'], int: ['지능', 'num'],
  maxLife: ['최대 생명력', 'num'], lifeRegen: ['초당 생명력 재생', 'num'],
  maxMana: ['최대 마나', 'num'], manaRegen: ['초당 마나 재생', 'num'],
  maxShield: ['최대 보호막', 'num'], armor: ['방어도', 'num'], evasion: ['회피', 'num'],
  resFire: ['화염 저항', 'pct'], resCold: ['냉기 저항', 'pct'], resLightning: ['번개 저항', 'pct'],
  critChance: ['치명타 확률', 'pct'], critMulti: ['치명타 피해', 'pct'],
  actionSpeed: ['행동 속도', 'pct'], moveSpeed: ['이동 속도', 'num'], moveSpeedInc: ['이동 속도', 'pct'],
};

export const DAMAGE_NAMES: Record<DamageType, string> = { physical: '물리', fire: '화염', cold: '냉기', lightning: '번개' };

const TAG_NAMES: Partial<Record<Tag | 'all', string>> = {
  all: '', attack: '공격 ', spell: '주문 ', melee: '근접 ', ranged: '원거리 ', projectile: '투사체 ', area: '범위 ',
  physical: '물리 ', fire: '화염 ', cold: '냉기 ', lightning: '번개 ', elemental: '원소 ', sustained: '지속 ',
};

const pct = (v: number) => `${+(v * 100).toFixed(1)}%`;

export function describeMod(m: Mod): string {
  switch (m.kind) {
    case 'flat': {
      const [label, unit] = FLAT_LABEL[m.stat];
      return `+${unit === 'pct' ? pct(m.value) : +m.value.toFixed(1)} ${label}`;
    }
    case 'added': return `+${m.min}~${m.max} ${DAMAGE_NAMES[m.type]} 피해`;
    case 'inc': return `+${pct(m.value)} ${TAG_NAMES[m.tag] ?? ''}피해`;
    case 'more': return `추가 ${pct(m.value)} ${TAG_NAMES[m.tag] ?? ''}피해`;
  }
}
