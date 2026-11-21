// 경제: 재화 지갑, 재화 드랍, 장비 옵션 굴리기, 확률형 스킬 강화, 분해, 상점.
import { CURRENCIES, DROPS, ECONOMY, SUPPORTS, type BossDropTable, type DropTable, type GemRarity } from '../data';
import type { Rng } from './damage';
import { gemKey, parseGem } from './gems';
import { AFFIXES, generateItem, maxTierFor, rerollAffix, type Item } from './items';
import { pickWeighted } from './progress';

export type Wallet = Record<string, number>;

export const MAX_SKILL_ENHANCE = ECONOMY.skill.chances.length; // +10

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

/** 처치당 금화 (자동 획득). 금화는 사냥으로만 얻는다 */
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

/** 보스 재화 묶음. 값이 [최소, 최대] 면 그 사이, 숫자면 기대 개수(정수 확정 + 소수 확률) */
export function rollBossCurrency(table: BossDropTable, rng: Rng = Math.random): Wallet {
  const out: Wallet = {};
  for (const [id, v] of Object.entries(table.currency)) {
    out[id] = Array.isArray(v) ? v[0] + Math.floor(rng() * (v[1] - v[0] + 1)) : Math.floor(v) + (rng() < v % 1 ? 1 : 0);
  }
  return out;
}

// ---------- 장비 옵션 굴리기 ----------

/** 이 장비에 붙을 수 있는 최고 티어 (1 = 최상). 아이템 레벨로 정해지고 모든 옵션이 같은 기준 */
export function itemMaxTier(item: Item): number {
  return Math.min(...Object.values(AFFIXES).filter((a) => a.slots.includes(item.slot)).map((a) => maxTierFor(a, item.ilvl)));
}

/** 최고 티어에 맞는 강화석 + 금화. boosted(금괴) 는 T1 이 붙을 수 있는 장비만: 희귀 강화석 + 금괴 */
export function rerollCost(item: Item, boosted: boolean): Wallet {
  const r = ECONOMY.reroll;
  const stone = r.stone[String(itemMaxTier(item))];
  if (boosted) return { [stone]: 1, gold_bar: r.goldBar };
  return { [stone]: 1, gold: r.goldBase + r.goldPerIlvl * item.ilvl };
}

export const canBoost = (item: Item) => itemMaxTier(item) <= ECONOMY.reroll.boostTier;

export function tryReroll(w: Wallet, item: Item, index: number, boosted: boolean, rng: Rng = Math.random): 'ok' | 'no-money' | 'invalid' {
  if (boosted && !canBoost(item)) return 'invalid';
  if (index < 0 || index >= item.affixes.length) return 'invalid';
  if (!spend(w, rerollCost(item, boosted))) return 'no-money';
  rerollAffix(item, index, rng, boosted);
  return 'ok';
}

// ---------- 스킬 강화 (확률형) ----------

export function skillEnhanceChance(level: number): number {
  return ECONOMY.skill.chances[level] ?? 0;
}

export function skillEnhanceCost(level: number): Wallet {
  return { ...(ECONOMY.skill.costs[level] ?? {}) };
}

export type EnhanceResult = 'success' | 'fail' | 'no-money' | 'max';

/** 실패하면 재료만 잃고 단계 유지 */
export function tryEnhanceSkill(w: Wallet, t: { level: number }, rng: Rng = Math.random): EnhanceResult {
  if (t.level >= MAX_SKILL_ENHANCE) return 'max';
  if (!spend(w, skillEnhanceCost(t.level))) return 'no-money';
  if (rng() < skillEnhanceChance(t.level)) {
    t.level++;
    return 'success';
  }
  return 'fail';
}

// ---------- 분해 (50% 성공해야 재화) ----------

/** 장비 → 같은 등급 강화석 */
export function salvageItemReward(item: Item): Wallet {
  return { ...ECONOMY.salvage.item[item.rarity] };
}

/** 젬 → 같은 희귀도 스킬 정수 */
export function salvageGemReward(key: string): Wallet {
  const g = parseGem(key);
  return g ? { ...ECONOMY.salvage.gem[g.rarity] } : {};
}

/** 성공하면 보상, 실패하면 빈 지갑 (분해 대상은 어느 쪽이든 사라짐) */
export function rollSalvage(reward: Wallet, rng: Rng = Math.random): Wallet {
  return rng() < ECONOMY.salvage.chance ? reward : {};
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
    default: return { currency: { stone_common: 1 } };
  }
}

/** 예전 세이브 재화 → 새 재화 */
export function migrateWallet(w: Wallet): Wallet {
  const out: Wallet = { ...w };
  const move = (from: string, to: string) => {
    if (out[from]) { out[to] = (out[to] ?? 0) + out[from]; }
    delete out[from];
  };
  move('stone', 'stone_common');
  move('essence', 'essence_common');
  move('crystal', 'gold_bar');
  return out;
}
