import { describe, expect, it } from 'vitest';
import { AFFIXES, BASES, generateItem, itemMods, makeItem, describeMod } from '../src/core/items';
import { equipFromBag, newBuild, pickUp, statsFor, summarize, BAG_SIZE } from '../src/core/build';

describe('장비', () => {
  it('등급별 옵션 개수와 중복 없음', () => {
    for (let i = 0; i < 300; i++) {
      const it_ = generateItem(1 + (i % 20));
      const n = it_.affixes.length;
      if (it_.rarity === 'normal') expect(n).toBe(0);
      if (it_.rarity === 'magic') expect(n).toBeGreaterThanOrEqual(1);
      if (it_.rarity === 'rare') expect(n).toBeGreaterThanOrEqual(3);
      expect(new Set(it_.affixes.map((a) => a.id)).size).toBe(n);
      for (const a of it_.affixes) expect(AFFIXES[a.id].slots).toContain(it_.slot);
      expect(BASES[it_.baseId].level).toBeLessThanOrEqual(it_.ilvl);
      for (const m of itemMods(it_)) expect(describeMod(m)).not.toMatch(/undefined|NaN/);
    }
  });

  it('높은 아이템 레벨은 높은 단계 옵션', () => {
    const tiers = Array.from({ length: 50 }, () => makeItem('ring_copper', 'rare', 20)).flatMap((i) => i.affixes.map((a) => a.tier));
    expect(Math.min(...tiers)).toBe(3);
  });

  it('착용하면 스탯에 반영되고 원래 장비는 가방으로', () => {
    const b = newBuild();
    const before = summarize(b, statsFor(b)).basicDps;
    const axe = makeItem('war_axe', 'normal', 10);
    expect(pickUp(b, axe)).toBe('bag');
    equipFromBag(b, axe.uid);
    expect(b.equipment.weapon?.uid).toBe(axe.uid);
    expect(b.bag[0].baseId).toBe('short_sword');
    expect(summarize(b, statsFor(b)).basicDps).toBeGreaterThan(before);
  });

  it('빈 슬롯은 바로 착용, 가방이 차면 못 주움', () => {
    const b = newBuild();
    expect(pickUp(b, makeItem('ring_copper', 'normal', 1))).toBe('equipped');
    for (let i = 0; i < BAG_SIZE; i++) pickUp(b, makeItem('ring_copper', 'normal', 1));
    expect(pickUp(b, makeItem('ring_copper', 'normal', 1))).toBe('full');
  });
});
