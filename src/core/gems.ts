// 보조 젬: 종류(id) × 희귀도. 가진 젬과 끼운 젬은 "id:희귀도" 문자열로 저장한다.
import { SUPPORTS } from '../data';
import type { GemRarity, SupportDef, SupportEffect, Tag } from './types';

export const GEM_RARITIES: GemRarity[] = ['common', 'uncommon', 'rare'];
export const GEM_RARITY_KO: Record<GemRarity, string> = { common: '일반', uncommon: '고급', rare: '희귀' };
export const GEM_RARITY_COLOR: Record<GemRarity, string> = { common: '#c9ccd2', uncommon: '#7aa7ff', rare: '#ffd54f' };

export const gemKey = (id: string, rarity: GemRarity) => `${id}:${rarity}`;

export interface Gem {
  key: string;
  def: SupportDef;
  rarity: GemRarity;
  effect: SupportEffect;
}

export function parseGem(key: string): Gem | null {
  const [id, r] = key.split(':');
  const def = SUPPORTS[id];
  const rarity = (GEM_RARITIES.includes(r as GemRarity) ? r : 'common') as GemRarity;
  if (!def) return null;
  return { key: gemKey(id, rarity), def, rarity, effect: def.levels[rarity] };
}

export function gemName(key: string): string {
  const g = parseGem(key);
  return g ? `${g.def.name} (${GEM_RARITY_KO[g.rarity]})` : key;
}

const TAG_KO: Partial<Record<Tag | 'all', string>> = {
  all: '', melee: '근접 ', projectile: '투사체 ', attack: '공격 ', area: '범위 ',
};
const pct = (v: number) => `${+(v * 100).toFixed(0)}%`;
const DMG_KO = { physical: '물리', fire: '화염', cold: '냉기', lightning: '번개' } as const;

/** 효과를 사람이 읽는 문장으로 */
export function describeEffect(e: SupportEffect): string {
  const parts: string[] = [];
  for (const m of e.mods ?? []) {
    if (m.kind === 'more') parts.push(m.value >= 0 ? `${TAG_KO[m.tag] ?? ''}피해 추가 ${pct(m.value)}` : `피해 ${pct(-m.value)} 감소(추가 −${pct(-m.value)})`);
    else if (m.kind === 'inc') parts.push(`${TAG_KO[m.tag] ?? ''}피해 +${pct(m.value)}`);
    else if (m.kind === 'flat' && m.stat === 'critChance') parts.push(`치명타 확률 +${pct(m.value)}`);
    else if (m.kind === 'flat' && m.stat === 'critMulti') parts.push(`치명타 피해 +${pct(m.value)}`);
  }
  if (e.extraProjectiles) parts.push(`투사체 +${e.extraProjectiles}`);
  if (e.extraPierce) parts.push(`적 ${e.extraPierce}명 더 관통`);
  if (e.radiusMult) parts.push(`범위 반경 +${pct(e.radiusMult - 1)}`);
  if (e.durationMult) parts.push(`지속 시간 +${pct(e.durationMult - 1)}`);
  if (e.cooldownMult) parts.push(`쿨다운 −${pct(1 - e.cooldownMult)}`);
  for (const g of e.gainAs ?? []) parts.push(`물리 피해의 ${pct(g.ratio)}를 ${DMG_KO[g.type]} 피해로 추가`);
  if (e.manaMult) parts.push(`마나 소모 +${pct(e.manaMult - 1)}`);
  return parts.join(', ');
}

export function describeGem(key: string): string {
  const g = parseGem(key);
  return g ? describeEffect(g.effect) : '';
}

/** 예전 세이브의 "sup_focus" 같은 키를 "sup_focus:common" 으로 */
export function migrateGemKey(key: string): string {
  return key.includes(':') ? key : gemKey(key, 'common');
}
