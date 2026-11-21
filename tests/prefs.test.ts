import { describe, expect, it } from 'vitest';
import { buildFromData, firstTime, newBuild, passesLootFilter, sortedBag, toSaveData } from '../src/core/build';
import { makeItem } from '../src/core/items';

describe('편의 기능', () => {
  it('줍기 필터', () => {
    const p = newBuild().prefs;
    const n = makeItem('ring_copper', 'normal', 1), m = makeItem('ring_copper', 'magic', 1), r = makeItem('ring_copper', 'rare', 1);
    expect([n, m, r].map((i) => passesLootFilter(p, i))).toEqual([true, true, true]);
    p.lootMin = 'magic';
    expect([n, m, r].map((i) => passesLootFilter(p, i))).toEqual([false, true, true]);
    p.lootMin = 'rare';
    expect([n, m, r].map((i) => passesLootFilter(p, i))).toEqual([false, false, true]);
  });

  it('가방 정렬은 표시만 바꾸고 원래 순서는 그대로', () => {
    const bag = [makeItem('ring_copper', 'normal', 5), makeItem('war_axe', 'rare', 12), makeItem('helmet_armor_0', 'magic', 30)];
    const ids = bag.map((i) => i.uid);
    expect(sortedBag(bag, 'recent').map((i) => i.uid)).toEqual([...ids].reverse());
    expect(sortedBag(bag, 'rarity').map((i) => i.rarity)).toEqual(['rare', 'magic', 'normal']);
    expect(sortedBag(bag, 'slot').map((i) => i.slot)).toEqual(['weapon', 'helmet', 'ring']);
    expect(sortedBag(bag, 'ilvl').map((i) => i.ilvl)).toEqual([30, 12, 5]);
    expect(bag.map((i) => i.uid)).toEqual(ids);
  });

  it('안내는 한 번만, 세이브에 남음', () => {
    const b = newBuild();
    expect(firstTime(b, 'intro')).toBe(true);
    expect(firstTime(b, 'intro')).toBe(false);
    const again = buildFromData(JSON.parse(JSON.stringify(toSaveData(b))))!;
    expect(firstTime(again, 'intro')).toBe(false);
    // 예전 세이브(설정 없음)는 기본값
    const old = toSaveData(newBuild()) as unknown as Record<string, unknown>;
    delete old.prefs;
    expect(buildFromData(old as never)!.prefs.lootMin).toBe('normal');
  });
});
