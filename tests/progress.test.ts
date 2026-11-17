import { describe, expect, it } from 'vitest';
import {
  addXp, areaLevel, canStart, dropTableFor, mappingUnlocked, maxMappingTier, newProgress, recordClear, rollGem, xpToNext,
} from '../src/core/progress';

describe('진행', () => {
  it('스토리는 순서대로 해금, 지옥까지 깨면 맵핑', () => {
    const p = newProgress();
    expect(canStart(p, { mode: 'story', difficulty: 'normal', mapIndex: 0 })).toBe(true);
    expect(canStart(p, { mode: 'story', difficulty: 'normal', mapIndex: 1 })).toBe(false);
    expect(canStart(p, { mode: 'story', difficulty: 'hard', mapIndex: 0 })).toBe(false);
    for (const d of ['normal', 'hard', 'hell'] as const) {
      for (let i = 0; i < 4; i++) {
        expect(canStart(p, { mode: 'story', difficulty: d, mapIndex: i })).toBe(true);
        expect(mappingUnlocked(p)).toBe(false);
        recordClear(p, { mode: 'story', difficulty: d, mapIndex: i });
      }
    }
    expect(mappingUnlocked(p)).toBe(true);
    expect(maxMappingTier(p)).toBe(1);
    expect(canStart(p, { mode: 'mapping', mapId: 'canyon', tier: 2 })).toBe(false);
    recordClear(p, { mode: 'mapping', mapId: 'canyon', tier: 1 });
    expect(canStart(p, { mode: 'mapping', mapId: 'canyon', tier: 2 })).toBe(true);
  });

  it('지역 레벨과 드랍 테이블은 난이도에 따라 오른다', () => {
    expect(areaLevel({ mode: 'story', difficulty: 'normal', mapIndex: 0 })).toBe(1);
    expect(areaLevel({ mode: 'story', difficulty: 'hell', mapIndex: 3 })).toBe(36);
    expect(areaLevel({ mode: 'mapping', mapId: 'cavern', tier: 3 })).toBe(46);
    const n = dropTableFor({ mode: 'story', difficulty: 'normal', mapIndex: 0 });
    const h = dropTableFor({ mode: 'story', difficulty: 'hell', mapIndex: 0 });
    const m5 = dropTableFor({ mode: 'mapping', mapId: 'cavern', tier: 5 });
    expect(h.gemRarity.rare).toBeGreaterThan(n.gemRarity.rare);
    expect(m5.itemRarity.rare).toBeGreaterThan(h.itemRarity.rare);
  });

  it('젬 희귀도: 보통은 일반만, 어려움은 고급까지, 지옥부터 희귀, 맵핑 티어마다 희귀 상승', () => {
    const seen = (run: Parameters<typeof dropTableFor>[0]) => {
      const t = dropTableFor(run);
      const out = { common: 0, uncommon: 0, rare: 0 };
      for (let i = 0; i < 3000; i++) out[rollGem(t).split(':')[1] as keyof typeof out]++;
      return out;
    };
    const n = seen({ mode: 'story', difficulty: 'normal', mapIndex: 0 });
    expect(n.uncommon + n.rare).toBe(0);
    const h = seen({ mode: 'story', difficulty: 'hard', mapIndex: 0 });
    expect(h.uncommon).toBeGreaterThan(0);
    expect(h.rare).toBe(0);
    expect(seen({ mode: 'story', difficulty: 'hell', mapIndex: 0 }).rare).toBeGreaterThan(0);
    const t1 = dropTableFor({ mode: 'mapping', mapId: 'canyon', tier: 1 }).gemRarity.rare;
    const t10 = dropTableFor({ mode: 'mapping', mapId: 'canyon', tier: 10 }).gemRarity.rare;
    expect(t10).toBeGreaterThan(t1);
  });

  it('경험치가 차면 레벨 업', () => {
    const s = { level: 1, xp: 0 };
    expect(addXp(s, xpToNext(1) + 1)).toBe(1);
    expect(s.level).toBe(2);
  });
});

import { bossDropTableFor, mobPool, newMappingRun } from '../src/core/progress';
import { MAPS, MONSTERS } from '../src/data';

describe('보스', () => {
  it('맵마다 다른 보스', () => {
    const bosses = MAPS.maps.map((m) => m.boss);
    expect(new Set(bosses).size).toBe(4);
    for (const b of bosses) expect(MONSTERS[b].kind).toBe('boss');
  });

  it('맵핑: 보스는 지역 고정, 일반 몹은 무작위 속성', () => {
    const elements = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const run = newMappingRun('fortress', 1);
      expect(run.mode === 'mapping' && run.mapId).toBe('fortress');
      elements.add(mobPool(run)[0].id);
    }
    expect(elements.size).toBe(4);
    // 스토리는 맵 고정
    expect(mobPool({ mode: 'story', difficulty: 'normal', mapIndex: 1 })[0].id).toBe('ember_sprite');
  });

  it('보스 드랍은 일반 몹보다 좋고, 젬 희귀도 제한은 난이도를 따른다', () => {
    const story = { mode: 'story', difficulty: 'normal', mapIndex: 0 } as const;
    const bt = bossDropTableFor(story);
    const nt = dropTableFor(story);
    expect(bt.items).toBeGreaterThanOrEqual(3);
    expect(bt.gemChance).toBeGreaterThan(nt.gemChance);
    expect(bt.itemRarity.rare / (bt.itemRarity.normal + bt.itemRarity.magic + bt.itemRarity.rare))
      .toBeGreaterThan(nt.itemRarity.rare / (nt.itemRarity.normal + nt.itemRarity.magic + nt.itemRarity.rare));
    expect(bt.gemRarity.uncommon + bt.gemRarity.rare).toBe(0);
    expect(bossDropTableFor({ mode: 'story', difficulty: 'hard', mapIndex: 0 }).gemRarity.rare).toBe(0);
    const t1 = bossDropTableFor({ mode: 'mapping', mapId: 'canyon', tier: 1 });
    const t10 = bossDropTableFor({ mode: 'mapping', mapId: 'canyon', tier: 10 });
    expect(t10.items).toBeGreaterThan(t1.items);
    expect(t10.gemRarity.rare).toBeGreaterThan(t1.gemRarity.rare);
  });
});
