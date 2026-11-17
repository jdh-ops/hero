import { DAMAGE_TYPES, type Attribute, type DamageType, type FlatStat, type Mod, type Tag } from './types';

/** 능력치 1포인트당 효과 (임시값, docs/스탯과_데미지.md 4장) */
export const ATTRIBUTE_RULES = {
  /** 연동 능력치 1포인트당 피해 증가 */
  damagePerPoint: 0.005,
  str: { maxLife: 1 },
  dex: { actionSpeed: 0.001, evasion: 2 },
  int: { maxMana: 1, maxShield: 1 },
} as const;

export type FlatTotals = Record<FlatStat, number>;

const zeroFlat = (): FlatTotals => ({
  str: 0, dex: 0, int: 0,
  maxLife: 0, lifeRegen: 0, maxMana: 0, manaRegen: 0, maxShield: 0,
  armor: 0, evasion: 0,
  resFire: 0, resCold: 0, resLightning: 0,
  critChance: 0, critMulti: 0,
  actionSpeed: 0, moveSpeed: 0, moveSpeedInc: 0,
});

/**
 * 수정치 목록을 모아 최종 스탯을 계산한다.
 * 장비를 바꾸면 mods 를 바꾸고 다시 만들면 된다.
 */
export class StatSheet {
  readonly flat: FlatTotals;
  readonly added: Record<DamageType, { min: number; max: number }>;
  private readonly incMods: { tag: Tag | 'all'; value: number }[] = [];
  private readonly moreMods: { tag: Tag | 'all'; value: number }[] = [];

  constructor(readonly mods: readonly Mod[]) {
    this.flat = zeroFlat();
    this.added = Object.fromEntries(DAMAGE_TYPES.map((t) => [t, { min: 0, max: 0 }])) as StatSheet['added'];

    for (const m of mods) {
      switch (m.kind) {
        case 'flat': this.flat[m.stat] += m.value; break;
        case 'added': this.added[m.type].min += m.min; this.added[m.type].max += m.max; break;
        case 'inc': this.incMods.push(m); break;
        case 'more': this.moreMods.push(m); break;
      }
    }

    // 능력치 보조 효과
    const f = this.flat;
    f.maxLife += f.str * ATTRIBUTE_RULES.str.maxLife;
    f.actionSpeed += f.dex * ATTRIBUTE_RULES.dex.actionSpeed;
    f.evasion += f.dex * ATTRIBUTE_RULES.dex.evasion;
    f.maxMana += f.int * ATTRIBUTE_RULES.int.maxMana;
    f.maxShield += f.int * ATTRIBUTE_RULES.int.maxShield;
  }

  /** 해당 태그 묶음에 걸리는 "증가" 합 (능력치 보너스 포함) */
  increased(tags: readonly Tag[]): number {
    let sum = 0;
    for (const m of this.incMods) if (m.tag === 'all' || tags.includes(m.tag)) sum += m.value;
    for (const a of ['str', 'dex', 'int'] as Attribute[]) {
      if (tags.includes(a)) sum += this.flat[a] * ATTRIBUTE_RULES.damagePerPoint;
    }
    return sum;
  }

  /** 해당 태그 묶음에 걸리는 "추가" 곱 */
  more(tags: readonly Tag[]): number {
    let prod = 1;
    for (const m of this.moreMods) if (m.tag === 'all' || tags.includes(m.tag)) prod *= 1 + m.value;
    return prod;
  }

  /** 행동 속도 배수 (1 = 기본) */
  get actionSpeed(): number {
    return 1 + this.flat.actionSpeed;
  }

  /** 초당 이동 거리(px) */
  get moveSpeed(): number {
    return this.flat.moveSpeed * (1 + this.flat.moveSpeedInc);
  }
}
