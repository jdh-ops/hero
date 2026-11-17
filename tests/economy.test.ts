import { describe, expect, it } from 'vitest';
import {
  enhanceChance, gain, itemEnhanceCost, rollBossCurrency, rollCurrency, salvageGem, salvageItem, shopPrice, spend, tryEnhance,
} from '../src/core/economy';
import { itemMods, makeItem } from '../src/core/items';
import { activeSkills, newBuild, statsFor } from '../src/core/build';
import { averageHit } from '../src/core/damage';
import { bossDropTableFor, dropTableFor } from '../src/core/progress';
import { canRankUp, rankUp, talentMods } from '../src/core/talents';
import { CURRENCIES } from '../src/data';

describe('재화', () => {
  it('희귀도 제한: 보통은 일반 재화만, 어려움은 고급까지, 지옥부터 희귀', () => {
    const seen = (difficulty: 'normal' | 'hard' | 'hell') => {
      const t = dropTableFor({ mode: 'story', difficulty, mapIndex: 0 });
      const r = new Set<string>();
      for (let i = 0; i < 5000; i++) { const c = rollCurrency(t); if (c) r.add(CURRENCIES[c].rarity); }
      return r;
    };
    expect([...seen('normal')]).toEqual(['common']);
    expect(seen('hard').has('rare')).toBe(false);
    expect(seen('hard').has('uncommon')).toBe(true);
    expect(seen('hell').has('rare')).toBe(true);
  });

  it('보스 재화 묶음', () => {
    const b = rollBossCurrency(bossDropTableFor({ mode: 'mapping', mapId: 'canyon', tier: 1 }), () => 0);
    expect(b.stone).toBe(5);
    expect(b.rift_map).toBeGreaterThanOrEqual(1);
    expect(b.gold).toBeGreaterThan(0);
  });

  it('지갑', () => {
    const w = { gold: 10 };
    expect(spend(w, { gold: 20 })).toBe(false);
    gain(w, { gold: 15, stone: 2 });
    expect(spend(w, { gold: 20, stone: 1 })).toBe(true);
    expect(w).toEqual({ gold: 5, stone: 1 });
  });
});

describe('확률형 강화', () => {
  it('성공하면 단계 +1, 실패하면 재료만 잃고 다음 확률 상승', () => {
    const w = { stone: 100, gold: 10000, crystal: 1 };
    const t = { level: 3, fails: 0 };
    expect(enhanceChance(t, false)).toBeCloseTo(0.8);
    expect(tryEnhance(w, t, itemEnhanceCost(3), false, () => 0.99)).toBe('fail');
    expect(t).toEqual({ level: 3, fails: 1 });
    expect(enhanceChance(t, false)).toBeCloseTo(0.85);
    expect(enhanceChance(t, true)).toBeCloseTo(1);
    expect(tryEnhance(w, t, itemEnhanceCost(3), true, () => 0.5)).toBe('success');
    expect(t).toEqual({ level: 4, fails: 0 });
    expect(w.crystal).toBe(0);
    expect(tryEnhance({}, t, itemEnhanceCost(4), false)).toBe('no-money');
  });

  it('장비 강화는 옵션 수치를 올린다', () => {
    const b = newBuild();
    const sword = b.equipment.weapon!;
    const before = statsFor(b).added.physical.max;
    sword.enhance = 5;
    expect(itemMods(sword)[0]).toMatchObject({ kind: 'added' });
    expect(statsFor(b).added.physical.max).toBeGreaterThan(before);
  });

  it('스킬 강화는 스킬 피해를 올린다', () => {
    const b = newBuild();
    const a0 = activeSkills(b)[0];
    b.skillEnhance.warrior_whirl = { level: 5, fails: 0 };
    const a5 = activeSkills(b)[0];
    expect(averageHit(a5.stats, a5.def)).toBeCloseTo(averageHit(a0.stats, a0.def) * 1.3);
  });
});

describe('분해·상점', () => {
  it('분해하면 재화', () => {
    expect(salvageItem(makeItem('ring_copper', 'rare', 10), () => 0)).toMatchObject({ stone: 4, essence: 1 });
    expect(salvageGem('sup_focus:rare').essence).toBe(8);
    expect(shopPrice('rare_box', 10)).toBe(1000);
  });
});

describe('특성', () => {
  it('레벨당 1포인트, 계열 포인트가 쌓여야 다음 단계', () => {
    const r: Record<string, number> = {};
    expect(canRankUp(r, 1, 'w_life')).toBe('no-points');
    expect(canRankUp(r, 20, 'w_str')).toBe('locked');
    for (let i = 0; i < 5; i++) expect(rankUp(r, 20, 'w_life')).toBe(true);
    expect(canRankUp(r, 20, 'w_life')).toBe('max');
    expect(rankUp(r, 20, 'w_str')).toBe(true);
    expect(talentMods(r)).toContainEqual({ kind: 'flat', stat: 'maxLife', value: 60 });
    const b = newBuild();
    b.level = 6;
    const before = statsFor(b).flat.maxLife;
    b.talents = { w_life: 5 };
    expect(statsFor(b).flat.maxLife).toBe(before + 60);
  });
});
