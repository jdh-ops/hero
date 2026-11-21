// 몬스터 레벨 성장 곡선. 밸런싱은 scripts/balance.ts (npm run balance) 로 확인한다.
import { MAPS, type MonsterDef } from '../data';

const B = () => MAPS.balance;

/** 체력 = 기본 × (1 + 레벨당 × (L−1) + quad × (L−1)²). 후반 장비·특성 성장을 따라가도록 2차 항 */
export function monsterLife(def: MonsterDef, level: number): number {
  const n = level - 1;
  return def.life * (1 + def.lifePerLevel * n + B().lifeQuad * n * n);
}

export function monsterDamageMult(def: MonsterDef, level: number): number {
  const n = level - 1;
  return 1 + def.damagePerLevel * n + B().damageQuad * n * n;
}
