// 데이터 테이블(JSON)을 타입이 붙은 형태로 내보낸다.
import type { ElementType, GemRarity, Mod, SkillDef, SupportDef } from '../core/types';
export type { GemRarity };
import skillsJson from './skills.json';
import classesJson from './classes.json';
import monstersJson from './monsters.json';
import supportsJson from './supports.json';
import mapsJson from './maps.json';
import dropsJson from './drops.json';
import currenciesJson from './currencies.json';
import economyJson from './economy.json';
import talentsJson from './talents.json';

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
  /** melee: 쫓아와서 때림, ranged: 거리를 두고 투사체, boss: 쫓아오며 특수 패턴 */
  kind: 'melee' | 'ranged' | 'boss';
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
  /** 보스 특수 패턴: slam 내려찍기(표시 후 범위), volley 부채꼴 투사체, nova 사방 투사체, charge 돌진 */
  pattern?: 'slam' | 'volley' | 'nova' | 'charge';
  patternInterval?: number;
}

export interface MapDef {
  id: string;
  name: string;
  element: 'physical' | ElementType;
  description: string;
  bg: string;
  line: string;
  monsters: { id: string; weight: number }[];
  /** 이 지역의 보스 (맵핑에서도 고정) */
  boss: string;
}

export interface BossDropTable {
  /** 확정으로 떨어지는 장비 수 */
  items: number;
  itemRarity: Record<'normal' | 'magic' | 'rare', number>;
  gemChance: number;
  gemRarity: Record<GemRarity, number>;
  /** 보스 재화: [최소, 최대] 개수 또는 기대 개수(정수 부분 확정 + 소수 부분 확률) */
  currency: Record<string, number | [number, number]>;
}


export interface DropTable {
  itemChance: number;
  itemRarity: Record<'normal' | 'magic' | 'rare', number>;
  gemChance: number;
  gemRarity: Record<GemRarity, number>;
  /** 재화(금화 제외) 드랍 확률과 희귀도 비율 */
  currencyChance: number;
  currencyRarity: Record<GemRarity, number>;
  /** 처치당 금화 = 몬스터 레벨 × [최소, 최대] */
  goldPerLevel: [number, number];
}

export interface MapsData {
  maps: MapDef[];
  story: { id: string; name: string; levels: number[] }[];
  mapping: { baseLevel: number; perTier: number; maxTier: number };
  killTarget: number;
  /** 밸런스 조정값 (scripts/balance.ts 로 확인) */
  balance: {
    /** 몬스터 체력·피해 = 기본 × (1 + 레벨당 × (L−1) + quad × (L−1)²) */
    lifeQuad: number;
    damageQuad: number;
    /** 몬스터 출현 간격(초)과 한 번에 2마리 나올 확률 */
    spawnInterval: number;
    doubleSpawnChance: number;
    /** 몬스터 경험치 = xpBase × 레벨^xpExp, 다음 레벨까지 = xpToNextBase × 레벨^xpToNextExp */
    xpBase: number;
    xpExp: number;
    xpToNextBase: number;
    xpToNextExp: number;
  };
}

export const SKILLS = skillsJson as unknown as Record<string, SkillDef>;
export const SUPPORTS = supportsJson as unknown as Record<string, SupportDef>;
export const CLASSES = classesJson as Record<string, ClassDef>;
export const MONSTERS = monstersJson as unknown as Record<string, MonsterDef>;
export const MAPS = mapsJson as unknown as MapsData;
export const DROPS = dropsJson as unknown as Record<'normal' | 'hard' | 'hell', DropTable> & {
  mapping: DropTable & { perTier: { itemChance: number; rare: number; gemRare: number; currencyRare: number } };
  /** 희귀도별 재화 종류와 가중치 */
  currencyPool: Record<GemRarity, Record<string, number>>;
  /** 보스 전용 드랍 테이블 */
  boss: Record<'normal' | 'hard' | 'hell', BossDropTable> & {
    mapping: BossDropTable & { perTier: { rare: number; gemRare: number; extraItemEvery: number } };
  };
};

export interface CurrencyDef {
  id: string;
  name: string;
  rarity: GemRarity;
  color: string;
  description: string;
}

export interface EconomyData {
  /** 스킬 강화: 단계별 성공 확률과 재료 (+0→+1 이 [0]) */
  skill: { perLevel: number; chances: number[]; costs: Record<string, number>[] };
  /**
   * 장비 옵션 굴리기: 그 장비에 붙을 수 있는 최고 티어(아이템 레벨로 정해짐)별 강화석,
   * 금화 = 기본 + 아이템 레벨 × n, 금괴 굴림은 최고 티어가 boostTier 이상일 때
   */
  reroll: { stone: Record<string, string>; goldBase: number; goldPerIlvl: number; goldBar: number; boostTier: number };
  /** 분해: 성공 확률, 등급별 보상 */
  salvage: {
    chance: number;
    item: Record<'normal' | 'magic' | 'rare', Record<string, number>>;
    gem: Record<GemRarity, Record<string, number>>;
  };
  /** gold: [기본, 레벨당] */
  shop: { id: string; name: string; description: string; gold: [number, number] }[];
  respec: { goldPerLevel: number };
  mappingUnlockMaps: number;
}

export interface TalentDef {
  id: string;
  branch: string;
  tier: number;
  name: string;
  maxRank: number;
  /** 1랭크당 수치 */
  mods: Mod[];
  description: string;
}

export interface TalentsData {
  branches: { id: string; name: string; description: string }[];
  /** 단계별로 그 계열에 먼저 찍어야 하는 포인트 */
  tierPoints: number[];
  talents: TalentDef[];
}

export const CURRENCIES = currenciesJson as unknown as Record<string, CurrencyDef>;
export const ECONOMY = economyJson as unknown as EconomyData;
export const TALENTS = talentsJson as unknown as TalentsData;
