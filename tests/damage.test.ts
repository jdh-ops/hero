import { describe, expect, it } from 'vitest';
import { StatSheet } from '../src/core/stats';
import { applyToPools, armorReduction, computeHit, evadeChance, mitigate } from '../src/core/damage';
import type { SkillDef } from '../src/core/types';

const skill: SkillDef = {
  id: 't', name: 't', tags: ['attack', 'melee', 'physical', 'str'], damageType: 'physical',
  baseMin: 100, baseMax: 100, effectiveness: 1, useTime: 1, cooldown: 0, manaCost: 0, range: 50,
};
const noCrit = () => 0.99; // 치명타 안 터짐, 굴림은 최댓값 쪽

describe('데미지 공식', () => {
  it('증가는 더하고 추가는 곱한다', () => {
    const s = new StatSheet([
      { kind: 'inc', tag: 'physical', value: 0.3 },
      { kind: 'inc', tag: 'melee', value: 0.3 },
      { kind: 'more', tag: 'all', value: 0.3 },
      { kind: 'more', tag: 'attack', value: 0.2 },
    ]);
    const hit = computeHit(s, skill, 1, noCrit);
    expect(hit.amounts.physical).toBeCloseTo(100 * 1.6 * 1.3 * 1.2);
  });

  it('연동 능력치 1포인트당 0.5% 증가', () => {
    const s = new StatSheet([{ kind: 'flat', stat: 'str', value: 20 }]);
    expect(computeHit(s, skill, 1, noCrit).amounts.physical).toBeCloseTo(110);
  });

  it('추가 피해는 스킬 배율의 영향을 받는다', () => {
    const s = new StatSheet([{ kind: 'added', type: 'fire', min: 10, max: 10 }]);
    const hit = computeHit(s, { ...skill, effectiveness: 1.5 }, 1, noCrit);
    expect(hit.amounts.physical).toBeCloseTo(150);
    expect(hit.amounts.fire).toBeCloseTo(15);
  });

  it('치명타는 기본 150%', () => {
    const hit = computeHit(new StatSheet([]), skill, 1, () => 0);
    expect(hit.crit).toBe(true);
    expect(hit.amounts.physical).toBeCloseTo(150);
  });

  it('방어도·저항·회피 상한', () => {
    expect(armorReduction(1e9, 1)).toBe(0.75);
    expect(evadeChance(1e9, 1)).toBe(0.5);
    const r = mitigate(
      { amounts: { physical: 0, fire: 100, cold: 0, lightning: 0 }, crit: false, evadable: false, attackerLevel: 1 },
      { level: 1, armor: 0, evasion: 0, res: { fire: 2, cold: 0, lightning: 0 } },
    );
    expect(r.total).toBeCloseTo(25);
  });

  it('보호막이 먼저 깎인다', () => {
    expect(applyToPools(30, 20, 100)).toEqual({ shield: 0, life: 90 });
  });
});
