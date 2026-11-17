// 특성: 레벨업 포인트를 3계열(투사/사냥꾼/현자) 특성에 찍는다.
import { TALENTS, type TalentDef } from '../data';
import type { Mod } from './types';

export type TalentRanks = Record<string, number>;

export const talentById = (id: string): TalentDef | undefined => TALENTS.talents.find((t) => t.id === id);

/** 레벨 2부터 레벨당 1포인트 */
export const totalPoints = (level: number) => Math.max(0, level - 1);

export const spentPoints = (ranks: TalentRanks) => Object.values(ranks).reduce((a, n) => a + n, 0);

export function branchPoints(ranks: TalentRanks, branch: string): number {
  return TALENTS.talents.filter((t) => t.branch === branch).reduce((a, t) => a + (ranks[t.id] ?? 0), 0);
}

export type TalentCheck = 'ok' | 'max' | 'no-points' | 'locked';

export function canRankUp(ranks: TalentRanks, level: number, id: string): TalentCheck {
  const t = talentById(id);
  if (!t) return 'locked';
  if ((ranks[id] ?? 0) >= t.maxRank) return 'max';
  if (spentPoints(ranks) >= totalPoints(level)) return 'no-points';
  if (branchPoints(ranks, t.branch) < TALENTS.tierPoints[t.tier]) return 'locked';
  return 'ok';
}

export function rankUp(ranks: TalentRanks, level: number, id: string): boolean {
  if (canRankUp(ranks, level, id) !== 'ok') return false;
  ranks[id] = (ranks[id] ?? 0) + 1;
  return true;
}

/** 찍은 특성의 수치 (랭크만큼 곱함) */
export function talentMods(ranks: TalentRanks): Mod[] {
  const out: Mod[] = [];
  for (const [id, rank] of Object.entries(ranks)) {
    const t = talentById(id);
    if (!t || rank <= 0) continue;
    for (const m of t.mods) {
      if (m.kind === 'added') out.push({ ...m, min: m.min * rank, max: m.max * rank });
      else out.push({ ...m, value: m.value * rank });
    }
  }
  return out;
}
