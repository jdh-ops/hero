// 데미지 공식. docs/스탯과_데미지.md 3장.
//
// 최종 피해 = 기본 × 증가 × 추가 × 치명타 × 방어
//   기본 = (스킬 기본값 + 장비 추가 피해) × 스킬 배율

import type { StatSheet } from './stats';
import type { DamageType, ElementType, SkillDef, Tag } from './types';

export const DEFENSE_RULES = {
  /** 방어도 감소율 = 방어도 / (방어도 + armorK × 공격자 레벨) */
  armorK: 300,
  armorCap: 0.75,
  resCap: 0.75,
  /** 회피 확률 = 회피 / (회피 + evasionK × 공격자 레벨) */
  evasionK: 200,
  evasionCap: 0.5,
  /** 보호막: 마지막 피격 후 이 시간(초)이 지나면 초당 최대치의 rechargeRate 만큼 참 */
  shieldDelay: 2,
  shieldRechargeRate: 0.2,
} as const;

export const BASE_CRIT_CHANCE = 0.05;
export const BASE_CRIT_MULTI = 1.5;

export type Rng = () => number;

export interface Hit {
  amounts: Record<DamageType, number>;
  crit: boolean;
  /** 회피 판정 대상인지 (공격 태그이고 지속 피해가 아님) */
  evadable: boolean;
  attackerLevel: number;
}

export interface Defender {
  level: number;
  armor: number;
  evasion: number;
  res: Record<ElementType, number>;
}

const roll = (min: number, max: number, rng: Rng) => min + (max - min) * rng();

/** 피해 타입별로 적용되는 태그 = 스킬 태그 + 피해 타입 (+ 원소면 elemental) */
function tagsFor(skill: SkillDef, type: DamageType): Tag[] {
  const tags: Tag[] = [...skill.tags];
  if (!tags.includes(type)) tags.push(type);
  if (type !== 'physical') tags.push('elemental');
  return tags;
}

export function critChance(stats: StatSheet): number {
  return Math.min(1, BASE_CRIT_CHANCE + stats.flat.critChance);
}

export function critMulti(stats: StatSheet): number {
  return BASE_CRIT_MULTI + stats.flat.critMulti;
}

/** 타입별 기본 피해 (① 단계). gainAs 는 물리 기본 피해의 일부를 다른 타입으로 추가 */
function baseAmounts(stats: StatSheet, skill: SkillDef, pickValue: (min: number, max: number) => number) {
  const base = { physical: 0, fire: 0, cold: 0, lightning: 0 } as Record<DamageType, number>;
  for (const type of Object.keys(base) as DamageType[]) {
    const added = stats.added[type];
    base[type] = pickValue(added.min, added.max);
    if (type === skill.damageType) base[type] += pickValue(skill.baseMin, skill.baseMax);
  }
  const phys = base.physical;
  for (const g of skill.gainAs ?? []) base[g.type] += phys * g.ratio;
  return base;
}

/** ②~③: 배율 × 증가 × 추가 */
function scaled(stats: StatSheet, skill: SkillDef, type: DamageType, base: number): number {
  const tags = tagsFor(skill, type);
  return base * skill.effectiveness * (1 + stats.increased(tags)) * stats.more(tags);
}

/** 방어 전 피해 계산 (①~④) */
export function computeHit(stats: StatSheet, skill: SkillDef, level: number, rng: Rng = Math.random): Hit {
  const crit = rng() < critChance(stats);
  const critFactor = crit ? critMulti(stats) : 1;
  const base = baseAmounts(stats, skill, (min, max) => roll(min, max, rng));
  const amounts = { physical: 0, fire: 0, cold: 0, lightning: 0 } as Record<DamageType, number>;
  for (const type of Object.keys(amounts) as DamageType[]) {
    if (base[type] > 0) amounts[type] = scaled(stats, skill, type, base[type]) * critFactor;
  }
  return {
    amounts,
    crit,
    evadable: skill.tags.includes('attack') && !skill.tags.includes('sustained'),
    attackerLevel: level,
  };
}

/** 한 번 맞혔을 때 평균 피해 (방어 전, 치명타 기대값 포함) */
export function averageHit(stats: StatSheet, skill: SkillDef): number {
  const base = baseAmounts(stats, skill, (min, max) => (min + max) / 2);
  let total = 0;
  for (const type of Object.keys(base) as DamageType[]) if (base[type] > 0) total += scaled(stats, skill, type, base[type]);
  return total * (1 + critChance(stats) * (critMulti(stats) - 1));
}

export function armorReduction(armor: number, attackerLevel: number): number {
  if (armor <= 0) return 0;
  return Math.min(DEFENSE_RULES.armorCap, armor / (armor + DEFENSE_RULES.armorK * attackerLevel));
}

export function evadeChance(evasion: number, attackerLevel: number): number {
  if (evasion <= 0) return 0;
  return Math.min(DEFENSE_RULES.evasionCap, evasion / (evasion + DEFENSE_RULES.evasionK * attackerLevel));
}

export interface HitResult {
  evaded: boolean;
  total: number;
  crit: boolean;
}

/** 방어 적용 (⑤). 회피 → 방어도/저항 순서 */
export function mitigate(hit: Hit, def: Defender, rng: Rng = Math.random): HitResult {
  if (hit.evadable && rng() < evadeChance(def.evasion, hit.attackerLevel)) {
    return { evaded: true, total: 0, crit: hit.crit };
  }
  let total = 0;
  for (const [type, amount] of Object.entries(hit.amounts) as [DamageType, number][]) {
    if (amount <= 0) continue;
    if (type === 'physical') {
      total += amount * (1 - armorReduction(def.armor, hit.attackerLevel));
    } else {
      total += amount * (1 - Math.min(DEFENSE_RULES.resCap, def.res[type]));
    }
  }
  return { evaded: false, total, crit: hit.crit };
}

/** 보호막 → 생명력 순으로 깎는다. 남은 값을 돌려줌 */
export function applyToPools(damage: number, shield: number, life: number): { shield: number; life: number } {
  const absorbed = Math.min(shield, damage);
  return { shield: shield - absorbed, life: life - (damage - absorbed) };
}

/** 기대 DPS (밸런싱용, 방어 전). 쿨다운이 없는 스킬을 계속 쓸 때 */
export function expectedDps(stats: StatSheet, skill: SkillDef): number {
  return (averageHit(stats, skill) * stats.actionSpeed) / skill.useTime;
}
