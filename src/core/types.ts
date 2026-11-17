// 공통 타입. docs/스탯과_데미지.md 의 스탯 사전·태그 체계를 코드로 옮긴 것.

export const DAMAGE_TYPES = ['physical', 'fire', 'cold', 'lightning'] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];
export type ElementType = Exclude<DamageType, 'physical'>;

export type Attribute = 'str' | 'dex' | 'int';

/** 스킬 태그. 피해 타입도 태그로 취급한다. */
export type Tag =
  | 'attack' | 'spell'          // 형태 (주문 = 주술)
  | 'melee' | 'ranged'          // 거리
  | 'projectile' | 'area'       // 전달
  | 'instant' | 'sustained'     // 시간
  | Attribute                   // 연동 능력치
  | DamageType                  // 타입
  | 'elemental';                // 화염·냉기·번개 공통

/** 고정값으로 더해지는 스탯 */
export type FlatStat =
  | Attribute
  | 'maxLife' | 'lifeRegen' | 'maxMana' | 'manaRegen' | 'maxShield'
  | 'armor' | 'evasion'
  | 'resFire' | 'resCold' | 'resLightning'
  | 'critChance' | 'critMulti'
  | 'actionSpeed' | 'moveSpeed' | 'moveSpeedInc';

/**
 * 스탯 수정치. 장비 옵션·특성·보조 젬이 모두 이 형태를 쓴다.
 * - flat:  고정값 (+10 힘, +40 최대 생명력)
 * - added: 추가 피해 (+5~9 화염 피해)
 * - inc:   증가. 같은 종류끼리 더함 (+20% 화염 피해 → 0.2)
 * - more:  추가(곱연산). 하나씩 곱함 (추가 30% → 0.3)
 */
export type Mod =
  | { kind: 'flat'; stat: FlatStat; value: number }
  | { kind: 'added'; type: DamageType; min: number; max: number }
  | { kind: 'inc'; tag: Tag | 'all'; value: number }
  | { kind: 'more'; tag: Tag | 'all'; value: number };

export interface SkillDef {
  id: string;
  name: string;
  tags: Tag[];
  damageType: DamageType;
  baseMin: number;
  baseMax: number;
  /** 스킬 배율. (기본값 + 추가 피해) 에 곱한다. 1.4 = 140% */
  effectiveness: number;
  /** 한 번 쓰는 데 걸리는 시간(초). 행동 속도로 나눔 */
  useTime: number;
  cooldown: number;
  manaCost: number;
  range: number;
  /** 범위 스킬 반경, 근접 기본공격은 부채꼴 각도(도) */
  radius?: number;
  arc?: number;
}
