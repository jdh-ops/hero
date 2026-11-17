// 지도: 스토리(3난이도 × 4맵) / 맵핑(티어) 선택 화면.
import './mapselect.css';
import type { Build } from '../core/build';
import {
  areaLevel, canStart, dropTableFor, mappingUnlocked, maxMappingTier, storyUnlocked, xpToNext,
  type RunConfig, type StoryDifficulty,
} from '../core/progress';
import { MAPS } from '../data';

const ELEMENT_KO = { physical: '물리', fire: '화염', cold: '냉기', lightning: '번개' } as const;

export class MapSelectUI {
  private readonly root: HTMLElement;
  private tab: StoryDifficulty | 'mapping' = 'normal';
  private tier = 1;

  constructor(
    private readonly getBuild: () => Build,
    private readonly onStart: (run: RunConfig) => void,
    private readonly onOpenInventory: () => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'maps';
    this.root.addEventListener('click', (e) => this.onClick(e));
    document.body.append(this.root);

    // 처음 열 때는 아직 안 깬 가장 낮은 난이도 탭
    const p = getBuild().progress;
    this.tab = mappingUnlocked(p) ? 'mapping' : p.story.normal < MAPS.maps.length ? 'normal' : p.story.hard < MAPS.maps.length ? 'hard' : 'hell';
    this.tier = maxMappingTier(p);
    this.render();
  }

  destroy() {
    this.root.remove();
  }

  private onClick(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el) return;
    const d = el.dataset;
    switch (d.act) {
      case 'tab': this.tab = d.tab as MapSelectUI['tab']; break;
      case 'tier': this.tier = Math.max(1, Math.min(maxMappingTier(this.getBuild().progress), this.tier + Number(d.delta))); break;
      case 'inv': this.onOpenInventory(); return;
      case 'start': {
        const run: RunConfig = this.tab === 'mapping'
          ? { mode: 'mapping', mapId: d.map!, tier: this.tier }
          : { mode: 'story', difficulty: this.tab, mapIndex: Number(d.index) };
        if (canStart(this.getBuild().progress, run)) this.onStart(run);
        return;
      }
    }
    this.render();
  }

  render() {
    const b = this.getBuild();
    const p = b.progress;
    const xpPct = Math.min(100, (b.xp / xpToNext(b.level)) * 100);
    const tabs = MAPS.story.map((s) => {
      const done = p.story[s.id as StoryDifficulty];
      return `<button type="button" data-act="tab" data-tab="${s.id}" class="${this.tab === s.id ? 'on' : ''}">${s.name}<span class="n">${done}/${MAPS.maps.length}</span></button>`;
    }).join('') + `<button type="button" data-act="tab" data-tab="mapping" class="${this.tab === 'mapping' ? 'on' : ''}" ${mappingUnlocked(p) ? '' : 'disabled'}>맵핑${mappingUnlocked(p) ? `<span class="n">${p.mappingTier}티어</span>` : '<span class="n">지옥 클리어 후</span>'}</button>`;

    let body = '';
    if (this.tab === 'mapping') {
      const max = maxMappingTier(p);
      body = `<div class="tier"><button type="button" data-act="tier" data-delta="-1" ${this.tier <= 1 ? 'disabled' : ''}>−</button>
        <b>${this.tier}티어</b><button type="button" data-act="tier" data-delta="1" ${this.tier >= max ? 'disabled' : ''}>+</button>
        <span class="dim">도전 가능 최고 ${max}티어 · 맵을 깨면 다음 티어가 열립니다</span></div>`;
      body += this.cards((i) => ({ mode: 'mapping', mapId: MAPS.maps[i].id, tier: this.tier }), () => true, () => false);
    } else {
      const diff = this.tab;
      body = this.cards(
        (i) => ({ mode: 'story', difficulty: diff, mapIndex: i }),
        (i) => storyUnlocked(p, diff, i),
        (i) => i < p.story[diff],
      );
    }

    this.root.innerHTML = `
      <header>
        <h2>지도</h2>
        <div class="lv"><span>Lv.${b.level}</span><span class="xp"><i style="width:${xpPct}%"></i></span></div>
        <button type="button" data-act="inv">가방·스킬</button>
      </header>
      <nav class="maps-tabs">${tabs}</nav>
      ${body}`;
  }

  private cards(runOf: (i: number) => RunConfig, unlocked: (i: number) => boolean, cleared: (i: number) => boolean): string {
    return `<div class="map-cards">${MAPS.maps.map((m, i) => {
      const run = runOf(i);
      const open = unlocked(i);
      const done = cleared(i);
      const table = dropTableFor(run);
      const rarePct = (table.itemRarity.rare / Object.values(table.itemRarity).reduce((a, v) => a + v, 0)) * 100;
      const status = done ? '<span class="st done">클리어</span>' : open ? '<span class="st open">도전 가능</span>' : '<span class="st lock">잠김</span>';
      return `<article class="map-card el-${m.element}${open ? '' : ' locked'}">
        <div class="top"><span class="el">${ELEMENT_KO[m.element]}</span>${status}</div>
        <h3>${m.name}</h3>
        <p>${m.description}</p>
        <dl><dt>지역 레벨</dt><dd>${areaLevel(run)}</dd><dt>희귀 장비</dt><dd>${rarePct.toFixed(0)}%</dd></dl>
        <button type="button" class="go" data-act="start" data-index="${i}" data-map="${m.id}" ${open ? '' : 'disabled'}>입장</button>
      </article>`;
    }).join('')}</div>`;
  }
}
