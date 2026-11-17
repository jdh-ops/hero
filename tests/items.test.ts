import { describe, expect, it } from 'vitest';
import { AFFIXES, BASES, generateItem, itemMods, makeItem, describeMod } from '../src/core/items';
import { equipFromBag, newBuild, pickUp, statsFor, summarize, BAG_SIZE } from '../src/core/build';

describe('장비', () => {
  it('등급별 옵션 개수와 중복 없음', () => {
    for (let i = 0; i < 300; i++) {
      const it_ = generateItem(1 + (i % 20));
      const n = it_.affixes.length;
      if (it_.rarity === 'normal') expect(n).toBe(1);
      if (it_.rarity === 'magic') expect(n).toBe(2);
      if (it_.rarity === 'rare') expect(n).toBeGreaterThanOrEqual(3);
      expect(new Set(it_.affixes.map((a) => a.id)).size).toBe(n);
      for (const a of it_.affixes) expect(AFFIXES[a.id].slots).toContain(it_.slot);
      expect(BASES[it_.baseId].level).toBeLessThanOrEqual(it_.ilvl);
      for (const m of itemMods(it_)) expect(describeMod(m)).not.toMatch(/undefined|NaN/);
    }
  });

  it('옵션 최대 티어는 아이템 레벨에 따름 (T1 = 최상)', () => {
    const tiers = (ilvl: number) => Array.from({ length: 200 }, () => makeItem('ring_copper', 'rare', ilvl)).flatMap((i) => i.affixes.map((a) => a.tier));
    expect(Math.min(...tiers(1))).toBe(5);
    expect(Math.min(...tiers(20))).toBe(3);
    expect(Math.min(...tiers(40))).toBe(1);
    // 최고 티어는 가장 드묾
    const t40 = tiers(40);
    expect(t40.filter((t) => t === 1).length).toBeLessThan(t40.filter((t) => t === 3).length);
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

import { activeSkills, freeGems, pickUpGem, socketGem } from '../src/core/build';
import { averageHit } from '../src/core/damage';
import { gemKey, migrateGemKey } from '../src/core/gems';

const F = gemKey('sup_focus', 'common');

describe('보조 젬', () => {
  it('태그가 맞는 스킬에만, 가진 개수만큼만, 같은 종류는 한 스킬에 하나', () => {
    const b = newBuild();
    expect(socketGem(b, 'warrior_whirl', 0, gemKey('sup_multi', 'common'))).toBe(false); // 투사체 전용
    expect(socketGem(b, 'warrior_whirl', 0, F)).toBe(true);
    expect(freeGems(b, F)).toBe(0);
    expect(socketGem(b, 'warrior_slam', 0, F)).toBe(false); // 하나뿐
    pickUpGem(b, gemKey('sup_focus', 'rare'));
    expect(socketGem(b, 'warrior_whirl', 1, gemKey('sup_focus', 'rare'))).toBe(false); // 희귀도가 달라도 같은 종류
    expect(socketGem(b, 'warrior_whirl', 0, gemKey('sup_focus', 'rare'))).toBe(true); // 같은 칸에서 교체는 가능
    expect(freeGems(b, F)).toBe(1);
  });

  it('희귀도가 높을수록 효과가 크다', () => {
    // 시작 무기 옵션이 무작위라 옵션을 비운 빌드로 비교
    const fresh = () => { const b = newBuild(); b.equipment.weapon!.affixes = []; return b; };
    const hit = (r: 'common' | 'uncommon' | 'rare') => {
      const b = fresh();
      pickUpGem(b, gemKey('sup_focus', r));
      socketGem(b, 'warrior_whirl', 0, gemKey('sup_focus', r));
      const a = activeSkills(b)[0];
      return averageHit(a.stats, a.def);
    };
    const base = (() => { const a = activeSkills(fresh())[0]; return averageHit(a.stats, a.def); })();
    expect(hit('common')).toBeCloseTo(base * 1.25);
    expect(hit('uncommon')).toBeCloseTo(base * 1.32);
    expect(hit('rare')).toBeCloseTo(base * 1.4);
  });

  it('다중 투사체: 희귀는 투사체 3개 추가', () => {
    const b = newBuild();
    pickUpGem(b, gemKey('sup_multi', 'rare'));
    socketGem(b, 'warrior_axe', 0, gemKey('sup_multi', 'rare'));
    expect(activeSkills(b)[2].def.projectiles).toBe(4);
  });

  it('예전 세이브 젬 키는 일반 등급으로', () => {
    expect(migrateGemKey('sup_fire')).toBe('sup_fire:common');
    expect(migrateGemKey('sup_fire:rare')).toBe('sup_fire:rare');
  });
});
