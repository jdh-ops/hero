// 액티브 스킬 + 보조 젬 → 실제로 쓰는 스킬 수치.
import { StatSheet } from './stats';
import { averageHit } from './damage';
import type { Mod, SkillDef, SupportDef } from './types';
import { parseGem } from './gems';

/** 스킬 하나에 연결할 수 있는 보조 젬 칸 수 */
export const SUPPORT_SOCKETS = 2;

export function canSupport(skill: SkillDef, support: SupportDef): boolean {
  if (!support.requires?.length) return true;
  return support.requires.some((t) => skill.tags.includes(t));
}

export interface ActiveSkill {
  /** 보조 젬이 반영된 스킬 정의 */
  def: SkillDef;
  /** 캐릭터 스탯 + 보조 젬 수치 */
  stats: StatSheet;
  /** 끼운 젬 키 ("id:희귀도") */
  supports: string[];
}

/** gemKeys: 끼운 보조 젬 ("id:희귀도"), baseMods: 캐릭터(직업 + 장비 + 레벨) 수정치 */
export function resolveSkill(skill: SkillDef, gemKeys: string[], baseMods: readonly Mod[]): ActiveSkill {
  const def: SkillDef = { ...skill, tags: [...skill.tags], gainAs: [...(skill.gainAs ?? [])] };
  const mods: Mod[] = [...baseMods];
  for (const key of gemKeys) {
    const gem = parseGem(key);
    if (!gem || !canSupport(skill, gem.def)) continue;
    const s = gem.effect;
    mods.push(...(s.mods ?? []));
    def.manaCost *= s.manaMult ?? 1;
    def.cooldown *= s.cooldownMult ?? 1;
    if (def.radius) def.radius *= s.radiusMult ?? 1;
    if (def.range && def.shape === 'cone') def.range *= s.radiusMult ?? 1;
    if (def.projectiles) def.projectiles += s.extraProjectiles ?? 0;
    if (def.pierce !== undefined) def.pierce += s.extraPierce ?? 0;
    if (def.duration) def.duration *= s.durationMult ?? 1;
    def.gainAs!.push(...(s.gainAs ?? []));
  }
  def.manaCost = Math.round(def.manaCost);
  return { def, stats: new StatSheet(mods), supports: gemKeys };
}

/** 스킬 창에 보여줄 수치 */
export function skillNumbers(a: ActiveSkill): { label: string; value: string }[] {
  const d = a.def;
  const hit = averageHit(a.stats, d);
  const rows = [{ label: d.shape === 'ground' ? '틱당 평균 피해' : '평균 피해', value: hit.toFixed(1) }];
  if (d.shape === 'ground' && d.duration && d.tickInterval) {
    rows.push({ label: '총 피해(적 1명)', value: (hit * Math.floor(d.duration / d.tickInterval)).toFixed(0) });
  }
  if (d.cooldown > 0) rows.push({ label: '쿨다운', value: `${(d.cooldown).toFixed(1)}초` });
  rows.push({ label: '마나', value: String(d.manaCost) });
  if (d.radius) rows.push({ label: '범위 반경', value: String(Math.round(d.radius)) });
  if (d.shape === 'cone') rows.push({ label: '사거리', value: String(Math.round(d.range)) });
  if (d.projectiles) rows.push({ label: '투사체', value: `${d.projectiles}개 · 관통 ${d.pierce ?? 0}` });
  if (d.duration) rows.push({ label: '지속 시간', value: `${d.duration.toFixed(1)}초` });
  return rows;
}
