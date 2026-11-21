import { describe, expect, it } from 'vitest';
import {
  gain, migrateWallet, rerollCost, rollBossCurrency, rollCurrency, rollSalvage, salvageGemReward, salvageItemReward,
  shopPrice, skillEnhanceCost, spend, tryEnhanceSkill, tryReroll,
} from '../src/core/economy';
import { AFFIXES, makeItem, migrateItem, rerollAffix, type Item } from '../src/core/items';
import { activeSkills, newBuild } from '../src/core/build';
import { averageHit } from '../src/core/damage';
import { bossDropTableFor, dropTableFor } from '../src/core/progress';
import { canRankUp, rankUp, talentMods } from '../src/core/talents';
import { CURRENCIES } from '../src/data';

describe('재화', () => {
  it('희귀도 제한: 보통은 일반 재화만, 어려움은 고급까지, 지옥부터 희귀(금괴 포함)', () => {
    const seen = (difficulty: 'normal' | 'hard' | 'hell') => {
      const t = dropTableFor({ mode: 'story', difficulty, mapIndex: 0 });
      const r = new Set<string>();
      for (let i = 0; i < 8000; i++) { const c = rollCurrency(t); if (c) r.add(c); }
      return r;
    };
    expect([...seen('normal')].every((c) => CURRENCIES[c].rarity === 'common')).toBe(true);
    const hard = seen('hard');
    expect([...hard].some((c) => CURRENCIES[c].rarity === 'rare')).toBe(false);
    expect(hard.has('stone_uncommon')).toBe(true);
    expect(seen('hell').has('gold_bar')).toBe(true);
  });

  it('금화는 분해·보스 재화 묶음 외 다른 곳에서 안 나옴 (분해 보상에 금화 없음)', () => {
    expect(salvageItemReward(makeItem('ring_copper', 'rare', 10)).gold).toBeUndefined();
    expect(salvageGemReward('sup_focus:rare').gold).toBeUndefined();
  });

  it('보스 재화 묶음', () => {
    const b = rollBossCurrency(bossDropTableFor({ mode: 'mapping', mapId: 'canyon', tier: 1 }), () => 0);
    expect(b.stone_rare).toBe(2);
    expect(b.rift_map).toBeGreaterThanOrEqual(1);
    expect(b.gold).toBeGreaterThan(0);
  });

  it('지갑과 예전 재화 변환', () => {
    const w = { gold: 10 };
    expect(spend(w, { gold: 20 })).toBe(false);
    gain(w, { gold: 15, stone_common: 2 });
    expect(spend(w, { gold: 20, stone_common: 1 })).toBe(true);
    expect(w).toEqual({ gold: 5, stone_common: 1 });
    expect(migrateWallet({ stone: 3, essence: 2, crystal: 1 })).toEqual({ stone_common: 3, essence_common: 2, gold_bar: 1 });
  });
});

describe('장비 옵션 굴리기', () => {
  it('비용은 장비 등급이 아니라 붙을 수 있는 최고 티어(아이템 레벨)에 따름', () => {
    // T5·T4 (Lv 1~15) 일반, T3·T2 (16~37) 고급, T1 (38~) 희귀
    expect(Object.keys(rerollCost(makeItem('ring_copper', 'rare', 5), false))).toEqual(['stone_common', 'gold']);
    expect(Object.keys(rerollCost(makeItem('ring_copper', 'normal', 20), false))).toEqual(['stone_uncommon', 'gold']);
    expect(Object.keys(rerollCost(makeItem('ring_copper', 'normal', 40), false))).toEqual(['stone_rare', 'gold']);
    expect(rerollCost(makeItem('ring_copper', 'magic', 40), true)).toEqual({ stone_rare: 1, gold_bar: 1 });
    const w = { stone_common: 1, gold_bar: 5 };
    expect(tryReroll(w, makeItem('ring_copper', 'rare', 5), 0, true)).toBe('invalid'); // T1 이 안 붙는 장비는 금괴 굴리기 불가
    expect(tryReroll(w, makeItem('ring_copper', 'normal', 5), 0, false)).toBe('no-money');
  });

  it('고른 옵션만 바뀌고 다른 옵션과 겹치지 않음', () => {
    const item = makeItem('ring_copper', 'rare', 40);
    const before = item.affixes.map((a) => a.id);
    for (let i = 0; i < 50; i++) {
      rerollAffix(item, 1);
      expect(item.affixes[0].id).toBe(before[0]);
      expect(new Set(item.affixes.map((a) => a.id)).size).toBe(item.affixes.length);
    }
  });

  it('금괴 굴리기는 희귀 옵션·높은 티어가 더 잘 나옴', () => {
    const stats = (boosted: boolean) => {
      let rare = 0, t1 = 0;
      for (let i = 0; i < 3000; i++) {
        const item = makeItem('ring_copper', 'rare', 40);
        rerollAffix(item, 0, Math.random, boosted);
        if (AFFIXES[item.affixes[0].id].rarity === 'rare') rare++;
        if (item.affixes[0].tier === 1) t1++;
      }
      return { rare, t1 };
    };
    const n = stats(false), g = stats(true);
    expect(g.rare).toBeGreaterThan(n.rare * 1.5);
    expect(g.t1).toBeGreaterThan(n.t1 * 1.5);
  });

  it('예전 장비 변환: 티어 뒤집기, 최소 옵션 수', () => {
    const old = { ...makeItem('ring_copper', 'normal', 1), affixes: [], v: undefined } as Item;
    expect(migrateItem(old).affixes.length).toBe(1);
    const old2 = { ...makeItem('ring_copper', 'magic', 1), v: undefined } as Item;
    old2.affixes = [{ ...old2.affixes[0], tier: 1 }];
    const m = migrateItem(old2);
    expect(m.affixes[0].tier).toBe(5);
    expect(m.affixes.length).toBe(2);
  });
});

describe('스킬 강화', () => {
  it('단계별 재료와 확률, 실패는 재료만', () => {
    expect(skillEnhanceCost(0)).toEqual({ essence_common: 1 });
    expect(Object.keys(skillEnhanceCost(4))).toEqual(['essence_uncommon']);
    expect(Object.keys(skillEnhanceCost(7))).toEqual(['essence_rare']);
    expect(skillEnhanceCost(9)).toEqual({ essence_special: 1, gold_bar: 1 });
    const w = { essence_common: 5 };
    const t = { level: 0 };
    expect(tryEnhanceSkill(w, t, () => 0.8)).toBe('fail'); // 75%
    expect(t.level).toBe(0);
    expect(w.essence_common).toBe(4);
    expect(tryEnhanceSkill(w, t, () => 0.7)).toBe('success');
    expect(t.level).toBe(1);
  });

  it('스킬 강화는 스킬 피해를 올린다', () => {
    const b = newBuild();
    const a0 = activeSkills(b)[0];
    b.skillEnhance.warrior_whirl = { level: 5 };
    const a5 = activeSkills(b)[0];
    expect(averageHit(a5.stats, a5.def)).toBeCloseTo(averageHit(a0.stats, a0.def) * 1.3);
  });
});

describe('분해·상점', () => {
  it('분해: 등급에 맞는 재화, 50% 성공', () => {
    expect(salvageItemReward(makeItem('ring_copper', 'magic', 10))).toEqual({ stone_uncommon: 1 });
    expect(salvageGemReward('sup_focus:rare')).toEqual({ essence_rare: 1 });
    expect(rollSalvage({ stone_common: 1 }, () => 0.4)).toEqual({ stone_common: 1 });
    expect(rollSalvage({ stone_common: 1 }, () => 0.6)).toEqual({});
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
  });
});
