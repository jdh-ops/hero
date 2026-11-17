// 데이터 테이블(JSON)을 타입이 붙은 형태로 내보낸다.
import type { ElementType, GemRarity, Mod, SkillDef, SupportDef } from '../core/types';
export type { GemRarity };
import skillsJson from './skills.json';
import classesJson from './classes.json';
import monstersJson from './monsters.json';
import supportsJson from './supports.json';
import mapsJson from './maps.json';
import dropsJson from './drops.json';

export interface ClassDef {
  id: string;
  name: string;
  basicAttack: string;
  skills: string[];
  mods: Mod[];
}

export interface MonsterDef {
  id: string;
  name: string;
  /** melee: 쫓아와서 때림, ranged: 거리를 두고 투사체 */
  kind: 'melee' | 'ranged';
  life: number;
  /** 레벨당 생명력 증가 비율 */
  lifePerLevel: number;
  damageMin: number;
  damageMax: number;
  damagePerLevel: number;
  damageType: 'physical' | ElementType;
  attackInterval: number;
  moveSpeed: number;
  radius: number;
  armor: number;
  res: Record<ElementType, number>;
  color: string;
  /** 경험치 배수 */
  xp: number;
  range?: number;
  projectileSpeed?: number;
}

export interface MapDef {
  id: string;
  name: string;
  element: 'physical' | ElementType;
  description: string;
  bg: string;
  line: string;
  monsters: { id: string; weight: number }[];
}


export interface DropTable {
  itemChance: number;
  itemRarity: Record<'normal' | 'magic' | 'rare', number>;
  gemChance: number;
  gemRarity: Record<GemRarity, number>;
}

export interface MapsData {
  maps: MapDef[];
  story: { id: string; name: string; levels: number[] }[];
  mapping: { baseLevel: number; perTier: number; maxTier: number };
  killTarget: number;
}

export const SKILLS = skillsJson as unknown as Record<string, SkillDef>;
export const SUPPORTS = supportsJson as unknown as Record<string, SupportDef>;
export const CLASSES = classesJson as Record<string, ClassDef>;
export const MONSTERS = monstersJson as unknown as Record<string, MonsterDef>;
export const MAPS = mapsJson as unknown as MapsData;
export const DROPS = dropsJson as unknown as Record<'normal' | 'hard' | 'hell', DropTable> & {
  mapping: DropTable & { perTier: { itemChance: number; rare: number; gemRare: number } };
};
