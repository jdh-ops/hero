// 진행: 스토리(3난이도 × 4맵) → 맵핑(티어). 캐릭터 레벨·경험치. 드랍 테이블.
import { DROPS, MAPS, SUPPORTS, type BossDropTable, type DropTable, type GemRarity, type MapDef } from '../data';
import type { Rng } from './damage';
import type { Mod } from './types';
import { gemKey } from './gems';

export type StoryDifficulty = 'normal' | 'hard' | 'hell';

/** 한 판의 설정 */
export type RunConfig =
  | { mode: 'story'; difficulty: StoryDifficulty; mapIndex: number }
  /** mobMap: 이번 판 일반 몹을 가져올 맵(속성). 입장할 때 무작위로 정함. 보스는 mapId 지역 고정 */
  | { mode: 'mapping'; mapId: string; tier: number; mobMap?: string };

export interface Progress {
  /** 난이도별로 클리어한 맵 수 (순서대로 해금) */
  story: Record<StoryDifficulty, number>;
  /** 맵핑에서 깬 가장 높은 티어 (0 = 아직 없음) */
  mappingTier: number;
}

export const newProgress = (): Progress => ({ story: { normal: 0, hard: 0, hell: 0 }, mappingTier: 0 });

export function mapOf(run: RunConfig): MapDef {
  if (run.mode === 'story') return MAPS.maps[run.mapIndex];
  return MAPS.maps.find((m) => m.id === run.mapId) ?? MAPS.maps[0];
}

/** 이번 판 일반 몹 목록. 스토리는 맵 고정, 맵핑은 입장 때 정한 무작위 속성 */
export function mobPool(run: RunConfig): MapDef['monsters'] {
  if (run.mode === 'mapping' && run.mobMap) return (MAPS.maps.find((m) => m.id === run.mobMap) ?? mapOf(run)).monsters;
  return mapOf(run).monsters;
}

export function mobElement(run: RunConfig): MapDef['element'] {
  if (run.mode === 'mapping' && run.mobMap) return (MAPS.maps.find((m) => m.id === run.mobMap) ?? mapOf(run)).element;
  return mapOf(run).element;
}

/** 맵핑 입장: 일반 몹 속성을 무작위로 */
export function newMappingRun(mapId: string, tier: number, rng: Rng = Math.random): RunConfig {
  const mob = MAPS.maps[Math.floor(rng() * MAPS.maps.length)];
  return { mode: 'mapping', mapId, tier, mobMap: mob.id };
}

/** 지역 레벨 = 몬스터 레벨 = 아이템 레벨 */
export function areaLevel(run: RunConfig): number {
  if (run.mode === 'story') return MAPS.story.find((s) => s.id === run.difficulty)!.levels[run.mapIndex];
  return MAPS.mapping.baseLevel + MAPS.mapping.perTier * (run.tier - 1);
}

export function runName(run: RunConfig): string {
  const map = mapOf(run).name;
  if (run.mode === 'story') return `${MAPS.story.find((s) => s.id === run.difficulty)!.name} · ${map}`;
  return `맵핑 ${run.tier}티어 · ${map}`;
}

export function storyUnlocked(p: Progress, difficulty: StoryDifficulty, mapIndex: number): boolean {
  const order: StoryDifficulty[] = ['normal', 'hard', 'hell'];
  const di = order.indexOf(difficulty);
  if (di > 0 && p.story[order[di - 1]] < MAPS.maps.length) return false; // 이전 난이도를 다 깨야 함
  return mapIndex <= p.story[difficulty];
}

export function mappingUnlocked(p: Progress): boolean {
  return p.story.hell >= MAPS.maps.length;
}

/** 도전 가능한 최고 티어 */
export function maxMappingTier(p: Progress): number {
  return Math.min(MAPS.mapping.maxTier, p.mappingTier + 1);
}

export function canStart(p: Progress, run: RunConfig): boolean {
  if (run.mode === 'story') return storyUnlocked(p, run.difficulty, run.mapIndex);
  return mappingUnlocked(p) && run.tier >= 1 && run.tier <= maxMappingTier(p);
}

export function recordClear(p: Progress, run: RunConfig): void {
  if (run.mode === 'story') p.story[run.difficulty] = Math.max(p.story[run.difficulty], run.mapIndex + 1);
  else p.mappingTier = Math.max(p.mappingTier, run.tier);
}

// ---------- 드랍 테이블 ----------

export function dropTableFor(run: RunConfig): DropTable {
  if (run.mode === 'story') return DROPS[run.difficulty];
  const m = DROPS.mapping;
  const t = run.tier - 1;
  return {
    itemChance: m.itemChance + m.perTier.itemChance * t,
    itemRarity: { ...m.itemRarity, rare: m.itemRarity.rare + m.perTier.rare * t },
    gemChance: m.gemChance,
    // 티어가 오를수록 희귀 젬 비율 상승
    gemRarity: { ...m.gemRarity, rare: m.gemRarity.rare + m.perTier.gemRare * t },
  };
}

/** 보스 전용 드랍 테이블 */
export function bossDropTableFor(run: RunConfig): BossDropTable {
  if (run.mode === 'story') return DROPS.boss[run.difficulty];
  const m = DROPS.boss.mapping;
  const t = run.tier - 1;
  return {
    items: m.items + Math.floor(t / m.perTier.extraItemEvery),
    itemRarity: { ...m.itemRarity, rare: m.itemRarity.rare + m.perTier.rare * t },
    gemChance: m.gemChance,
    gemRarity: { ...m.gemRarity, rare: m.gemRarity.rare + m.perTier.gemRare * t },
  };
}

function pickWeighted<K extends string>(weights: Record<K, number>, rng: Rng): K {
  const entries = Object.entries(weights) as [K, number][];
  let r = rng() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of entries) {
    r -= w;
    if (r < 0) return k;
  }
  return entries[entries.length - 1][0];
}

export function rollItemRarity(table: Pick<DropTable, 'itemRarity'>, rng: Rng = Math.random) {
  return pickWeighted(table.itemRarity, rng);
}

/** 젬 종류는 고르게, 희귀도는 드랍 테이블 비율로. "id:희귀도" 를 돌려줌 */
export function rollGem(table: Pick<DropTable, 'gemRarity'>, rng: Rng = Math.random): string {
  const list = Object.values(SUPPORTS);
  const def = list[Math.floor(rng() * list.length)];
  return gemKey(def.id, pickWeighted(table.gemRarity, rng) as GemRarity);
}

// ---------- 캐릭터 레벨 ----------

export const MAX_LEVEL = 60;

/** 다음 레벨까지 필요한 경험치 */
export function xpToNext(level: number): number {
  return Math.round(20 * Math.pow(level, 1.7));
}

/** 몬스터 1마리 경험치. 내 레벨이 지역보다 많이 높으면 줄어듦 */
export function monsterXp(monsterLevel: number, xpMult: number, playerLevel: number): number {
  const base = 4 * Math.pow(monsterLevel, 1.25) * xpMult;
  const gap = Math.max(0, playerLevel - monsterLevel - 3);
  return base * Math.max(0.1, 1 - gap * 0.15);
}

/** 레벨당 보너스 (임시값): 생명력 +8, 마나 +3 */
export function levelMods(level: number): Mod[] {
  const n = level - 1;
  if (n <= 0) return [];
  return [
    { kind: 'flat', stat: 'maxLife', value: 8 * n },
    { kind: 'flat', stat: 'maxMana', value: 3 * n },
  ];
}

/** 경험치를 더하고 오른 레벨 수를 돌려줌 */
export function addXp(state: { level: number; xp: number }, amount: number): number {
  let ups = 0;
  state.xp += amount;
  while (state.level < MAX_LEVEL && state.xp >= xpToNext(state.level)) {
    state.xp -= xpToNext(state.level);
    state.level++;
    ups++;
  }
  if (state.level >= MAX_LEVEL) state.xp = 0;
  return ups;
}
