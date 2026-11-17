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
export const RARITY_NAMES: Record<Rarity, string> = { normal: '일반', magic: '마법', rare: '희귀' };

export interface ItemBase {
  id: string;
  slot: Slot;
  name: string;
  /** 이 아이템 레벨부터 나옴 */
  level: number;
  implicit: Mod[];
}

/** 옵션 정의. mod 는 값이 빠진 틀이고, 단계(tier)에서 값 범위를 고른다 */
export interface AffixDef {
  id: string;
  slots: Slot[];
  mod: { kind: 'flat'; stat: FlatStat } | { kind: 'added'; type: DamageType } | { kind: 'inc' | 'more'; tag: Tag | 'all' };
  /** level 이상 아이템에서 나오는 값 범위. added 는 lo~hi 가 최솟값, 최댓값은 그 2배 */
  tiers: { level: number; lo: number; hi: number }[];
  weight: number;
}

export interface Item {
  uid: string;
  baseId: string;
  name: string;
  slot: Slot;
  rarity: Rarity;
  ilvl: number;
  implicit: Mod[];
  affixes: { id: string; tier: number; mod: Mod }[];
}

export const BASES = basesJson as Record<string, ItemBase>;
export const AFFIXES = affixesJson as Record<string, AffixDef>;

/** 등급별 확률과 옵션 개수 */
export const RARITY_RULES: Record<Rarity, { weight: number; affixes: [number, number] }> = {
  normal: { weight: 60, affixes: [0, 0] },
  magic: { weight: 30, affixes: [1, 2] },
  rare: { weight: 10, affixes: [3, 4] },
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

function rollAffix(def: AffixDef, ilvl: number, rng: Rng): Item['affixes'][number] {
  const tierIdx = def.tiers.reduce((best, t, i) => (t.level <= ilvl ? i : best), 0);
  const t = def.tiers[tierIdx];
  const raw = t.lo + (t.hi - t.lo) * rng();
  const m = def.mod;
  let mod: Mod;
  if (m.kind === 'added') {
    const min = Math.round(raw);
    mod = { kind: 'added', type: m.type, min, max: Math.round(min * 2 + rng() * 2) };
  } else if (m.kind === 'flat') {
    mod = { kind: 'flat', stat: m.stat, value: t.hi < 1 ? round(raw, 0.005) : Math.round(raw) };
  } else {
    mod = { kind: m.kind, tag: m.tag, value: round(raw, 0.01) };
  }
  return { id: def.id, tier: tierIdx + 1, mod };
}

let uidCounter = 0;
export const newUid = () => `${Date.now().toString(36)}${(uidCounter++).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

export function makeItem(baseId: string, rarity: Rarity, ilvl: number, rng: Rng = Math.random): Item {
  const base = BASES[baseId];
  const [lo, hi] = RARITY_RULES[rarity].affixes;
  const count = lo + Math.floor(rng() * (hi - lo + 1));
  const pool = Object.values(AFFIXES).filter((a) => a.slots.includes(base.slot));
  const affixes: Item['affixes'] = [];
  while (affixes.length < count && pool.length > 0) {
    const def = pickWeighted(pool, (a) => a.weight, rng);
    pool.splice(pool.indexOf(def), 1);
    affixes.push(rollAffix(def, ilvl, rng));
  }
  const name = rarity === 'rare' ? `${pick(RARE_WORDS_A, rng)}의 ${pick(RARE_WORDS_B, rng)}` : base.name;
  return { uid: newUid(), baseId, name, slot: base.slot, rarity, ilvl, implicit: base.implicit, affixes };
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

export function itemMods(item: Item): Mod[] {
  return [...item.implicit, ...item.affixes.map((a) => a.mod)];
}

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
