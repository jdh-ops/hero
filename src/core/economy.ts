// 경제: 재화 지갑, 재화 드랍, 확률형 강화(장비·스킬), 분해, 상점.
import { CURRENCIES, DROPS, ECONOMY, type BossDropTable, type DropTable, type GemRarity } from '../data';
import type { Rng } from './damage';
import { gemKey, parseGem } from './gems';
import { generateItem, makeItem, type Item } from './items';
export { enhanceMods } from './items';
import { pickWeighted } from './progress';
import { SUPPORTS } from '../data';

export type Wallet = Record<string, number>;

export const MAX_ENHANCE = ECONOMY.chances.length; // +10

export function has(w: Wallet, cost: Wallet): boolean {
  return Object.entries(cost).every(([k, n]) => (w[k] ?? 0) >= n);
}

export function spend(w: Wallet, cost: Wallet): boolean {
  if (!has(w, cost)) return false;
  for (const [k, n] of Object.entries(cost)) w[k] = (w[k] ?? 0) - n;
  return true;
}

export function gain(w: Wallet, add: Wallet): void {
  for (const [k, n] of Object.entries(add)) if (n > 0) w[k] = (w[k] ?? 0) + n;
}

export function formatCost(cost: Wallet): string {
  return Object.entries(cost).filter(([, n]) => n > 0).map(([k, n]) => `${CURRENCIES[k]?.name ?? k} ${n}`).join(' · ');
}

// ---------- 드랍 ----------

/** 처치당 금화 (자동 획득) */
export function rollGold(table: DropTable, monsterLevel: number, rng: Rng = Math.random): number {
  const [lo, hi] = table.goldPerLevel;
  return Math.round(monsterLevel * (lo + (hi - lo) * rng()));
}

/** 재화 하나 (없으면 null). 희귀도를 먼저 고르고 그 희귀도의 재화 중 하나 */
export function rollCurrency(table: DropTable, rng: Rng = Math.random): string | null {
  if (rng() >= table.currencyChance) return null;
  const rarity = pickWeighted(table.currencyRarity, rng) as GemRarity;
  return pickWeighted(DROPS.currencyPool[rarity], rng);
}

/** 기대 개수 → 실제 개수 (정수 부분 확정, 소수 부분은 확률) */
const expected = (v: number, rng: Rng) => Math.floor(v) + (rng() < v % 1 ? 1 : 0);

/** 보스가 떨어뜨리는 재화 묶음 */
export function rollBossCurrency(table: BossDropTable, rng: Rng = Math.random): Wallet {
  const c = table.currency;
  return {
    gold: c.gold,
    stone: c.stone[0] + Math.floor(rng() * (c.stone[1] - c.stone[0] + 1)),
    essence: expected(c.essence, rng),
    rift_map: expected(c.rift_map, rng),
    crystal: expected(c.crystal, rng),
  };
}

// ---------- 강화 ----------

export interface EnhanceTarget {
  level: number;
  /** 연속 실패 수 (성공하면 0) */
  fails: number;
}

export function enhanceChance(t: EnhanceTarget, useCrystal: boolean): number {
  if (t.level >= MAX_ENHANCE) return 0;
  const c = ECONOMY.chances[t.level] + t.fails * ECONOMY.failBonus + (useCrystal ? ECONOMY.crystalBonus : 0);
  return Math.min(1, c);
}

export function itemEnhanceCost(level: number): Wallet {
  return { stone: ECONOMY.item.stone[level], gold: ECONOMY.item.gold[level] };
}

export function skillEnhanceCost(level: number): Wallet {
  return { essence: ECONOMY.skill.essence[level], gold: ECONOMY.skill.gold[level] };
}

export type EnhanceResult = 'success' | 'fail' | 'no-money' | 'max';

/** 확률형 강화. 실패하면 재료만 잃고 단계 유지, 다음 확률 상승 */
export function tryEnhance(w: Wallet, t: EnhanceTarget, cost: Wallet, useCrystal: boolean, rng: Rng = Math.random): EnhanceResult {
  if (t.level >= MAX_ENHANCE) return 'max';
  const total = useCrystal ? { ...cost, crystal: (cost.crystal ?? 0) + 1 } : cost;
  const chance = enhanceChance(t, useCrystal);
  if (!spend(w, total)) return 'no-money';
  if (rng() < chance) {
    t.level++;
    t.fails = 0;
    return 'success';
  }
  t.fails++;
  return 'fail';
}

/** 스킬 강화: 스킬 배율 × (1 + 6% × 단계) */
export function skillEnhanceMult(level: number): number {
  return 1 + ECONOMY.skill.perLevel * level;
}

// ---------- 분해 ----------

export function salvageItem(item: Item, rng: Rng = Math.random): Wallet {
  const s = ECONOMY.salvage.item[item.rarity];
  const out: Wallet = { gold: s.gold + Math.round(item.ilvl * 0.5), stone: s.stone };
  if (s.essenceChance && rng() < s.essenceChance) out.essence = 1;
  return out;
}

export function salvageGem(key: string): Wallet {
  const g = parseGem(key);
  return { essence: g ? ECONOMY.salvage.gem[g.rarity].essence : 0 };
}

// ---------- 상점 ----------

export function shopPrice(id: string, level: number): number {
  const s = ECONOMY.shop.find((x) => x.id === id)!;
  return s.gold[0] + s.gold[1] * level;
}

/** 상점 구매 결과: 장비 / 젬 / 재화 */
export type ShopReward = { item: Item } | { gem: string } | { currency: Wallet };

export function shopRoll(id: string, level: number, rng: Rng = Math.random): ShopReward {
  switch (id) {
    case 'magic_box': return { item: generateItem(level, rng, 'magic') };
    case 'rare_box': return { item: generateItem(level, rng, 'rare') };
    case 'common_gem': {
      const ids = Object.keys(SUPPORTS);
      return { gem: gemKey(ids[Math.floor(rng() * ids.length)], 'common') };
    }
    default: return { currency: { stone: 1 } };
  }
}

export { makeItem };
