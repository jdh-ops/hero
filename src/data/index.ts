// 데이터 테이블(JSON)을 타입이 붙은 형태로 내보낸다.
import type { ElementType, Mod, SkillDef } from '../core/types';
import skillsJson from './skills.json';
import classesJson from './classes.json';
import monstersJson from './monsters.json';

export interface ClassDef {
  id: string;
  name: string;
  basicAttack: string;
  skills: string[];
  mods: Mod[];
  startingGear: Mod[];
}

export interface MonsterDef {
  id: string;
  name: string;
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
}

export const SKILLS = skillsJson as Record<string, SkillDef>;
export const CLASSES = classesJson as Record<string, ClassDef>;
export const MONSTERS = monstersJson as Record<string, MonsterDef>;
