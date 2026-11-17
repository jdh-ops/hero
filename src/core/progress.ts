// 진행: 스토리(3난이도 × 4맵) → 맵핑(티어). 캐릭터 레벨·경험치. 드랍 테이블.
import { DROPS, MAPS, SUPPORTS, type DropTable, type GemRarity, type MapDef } from '../data';
import type { Rng } from './damage';
import type { Mod } from './types';

export type StoryDifficulty = 'normal' | 'hard' | 'hell';

/** 한 판의 설정 */
export type RunConfig =
  | { mode: 'story'; difficulty: StoryDifficulty; mapIndex: number }
  | { mode: 'mapping'; mapId: string; tier: number };

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

export function rollItemRarity(table: DropTable, rng: Rng = Math.random) {
  return pickWeighted(table.itemRarity, rng);
}

/** 희귀도를 먼저 고르고 그 희귀도의 젬 중 하나 */
export function rollGem(table: DropTable, rng: Rng = Math.random): string {
  const rarity = pickWeighted(table.gemRarity, rng) as GemRarity;
  const pool = Object.values(SUPPORTS).filter((s) => s.rarity === rarity);
  const list = pool.length ? pool : Object.values(SUPPORTS);
  return list[Math.floor(rng() * list.length)].id;
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
