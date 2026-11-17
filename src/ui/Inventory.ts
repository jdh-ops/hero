// 가방·장비 창. 게임 캔버스 위에 HTML로 띄운다.
import './inventory.css';
import {
  BAG_SIZE, SUMMARY_LABELS, activeSkills, discard, equipFromBag, freeGems, socketGem, socketsOf, statsFor, summarize, unequip,
  type Build, type Summary,
} from '../core/build';
import { RARITY_NAMES, SLOTS, SLOT_NAMES, BASES, describeMod, type Item } from '../core/items';
import { canSupport, skillNumbers } from '../core/skills';
import type { Tag } from '../core/types';
import { SKILLS, SUPPORTS } from '../data';

const TAG_KO: Record<Tag, string> = {
  attack: '공격', spell: '주문', melee: '근접', ranged: '원거리', projectile: '투사체', area: '범위',
  instant: '즉발', sustained: '지속', str: '힘', dex: '민첩', int: '지능',
  physical: '물리', fire: '화염', cold: '냉기', lightning: '번개', elemental: '원소',
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function fmt(v: number, unit: 'num' | 'pct' | 'mult'): string {
  if (unit === 'pct') return `${+(v * 100).toFixed(1)}%`;
  if (unit === 'mult') return `×${v.toFixed(2)}`;
  return v >= 100 ? String(Math.round(v)) : String(+v.toFixed(1));
}

/** 바꿨을 때 전체적으로 나아지는지 (각 수치의 변화율 합) */
function isUpgrade(cur: Summary, next: Summary): boolean {
  let score = 0;
  for (const k of Object.keys(cur) as (keyof Summary)[]) {
    const a = cur[k], b = next[k];
    if (a === b) continue;
    score += (b - a) / Math.max(Math.abs(a), 1);
  }
  return score > 0.001;
}

export class InventoryUI {
  private readonly root: HTMLElement;
  private readonly button: HTMLButtonElement;
  private selected: { where: 'bag' | 'equip'; uid: string } | null = null;
  private tab: 'gear' | 'skills' = 'gear';
  /** 스킬 탭에서 고른 보조 젬 칸 */
  private socket: { skillId: string; index: number } | null = null;

  constructor(
    private readonly getBuild: () => Build,
    /** 장비가 바뀌면 호출 (스탯 다시 계산 + 저장) */
    private readonly onChange: () => void,
    private readonly onToggle: (open: boolean) => void,
  ) {
    this.button = document.createElement('button');
    this.button.className = 'hud-btn';
    this.button.type = 'button';
    this.button.addEventListener('click', () => this.toggle());
    this.button.addEventListener('pointerdown', (e) => e.stopPropagation());

    this.root = document.createElement('div');
    this.root.className = 'inv';
    this.root.hidden = true;
    this.root.addEventListener('click', (e) => this.onClick(e));

    document.body.append(this.button, this.root);
    window.addEventListener('keydown', this.onKey);
    this.refreshButton();
  }

  destroy() {
    window.removeEventListener('keydown', this.onKey);
    this.button.remove();
    this.root.remove();
  }

  get isOpen() {
    return !this.root.hidden;
  }

  toggle(force?: boolean) {
    const open = force ?? !this.isOpen;
    if (open === this.isOpen) return;
    this.root.hidden = !open;
    this.button.hidden = open;
    if (open) this.render();
    this.onToggle(open);
  }

  /** 가방 버튼의 개수 표시 */
  refreshButton() {
    const n = this.getBuild().bag.length;
    const key = matchMedia('(pointer: coarse)').matches ? '' : ' <span class="badge">I</span>';
    this.button.innerHTML = `가방·스킬 <span class="badge">${n}/${BAG_SIZE}</span>${key}`;
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'i' || e.key === 'I' || e.key === 'Tab' || (e.key === 'Escape' && this.isOpen)) {
      e.preventDefault();
      this.toggle();
    }
  };

  private findSelected(): Item | null {
    if (!this.selected) return null;
    const b = this.getBuild();
    if (this.selected.where === 'bag') return b.bag.find((i) => i.uid === this.selected!.uid) ?? null;
    return Object.values(b.equipment).find((i) => i?.uid === this.selected!.uid) ?? null;
  }

  private onClick(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el) return;
    const b = this.getBuild();
    const { act, uid, where } = el.dataset;
    switch (act) {
      case 'close': this.toggle(false); return;
      case 'tab': this.tab = el.dataset.tab as 'gear' | 'skills'; break;
      case 'socket': this.socket = { skillId: el.dataset.skill!, index: Number(el.dataset.index) }; break;
      case 'socket-cancel': this.socket = null; break;
      case 'gem':
        // 끼우거나 빼면 칸 선택을 풀어서 가려진 스킬 카드가 다시 보이게
        if (this.socket && socketGem(b, this.socket.skillId, this.socket.index, el.dataset.gem || null)) {
          this.socket = null;
          this.onChange();
        }
        break;
      case 'select': this.selected = { where: where as 'bag' | 'equip', uid: uid! }; break;
      case 'equip': if (uid) { equipFromBag(b, uid); this.selected = { where: 'equip', uid }; this.onChange(); } break;
      case 'unequip': {
        const item = this.findSelected();
        if (item && unequip(b, item.slot)) { this.selected = { where: 'bag', uid: item.uid }; this.onChange(); }
        break;
      }
      case 'discard': if (uid) { discard(b, uid); this.selected = null; this.onChange(); } break;
    }
    this.render();
  }

  render() {
    this.refreshButton();
    if (!this.isOpen) return;
    const b = this.getBuild();
    const tabs = `<nav class="inv-tabs">
        <button type="button" data-act="tab" data-tab="gear" class="${this.tab === 'gear' ? 'on' : ''}">장비</button>
        <button type="button" data-act="tab" data-tab="skills" class="${this.tab === 'skills' ? 'on' : ''}">스킬</button></nav>`;
    const header = `<header>${tabs}<span class="hint">I · Tab · Esc 로 닫기 · 열려 있는 동안 일시정지</span>
        <button type="button" data-act="close">닫기</button></header>`;
    if (this.tab === 'skills') {
      this.root.innerHTML = header + this.skillsTab(b);
      return;
    }
    const curStats = statsFor(b);
    const cur = summarize(b, curStats);
    const sel = this.findSelected();

    const tile = (item: Item, where: 'bag' | 'equip') => {
      let up = '';
      if (where === 'bag') {
        const next = summarize(b, statsFor(b, { ...b.equipment, [item.slot]: item }));
        if (isUpgrade(cur, next)) up = '<span class="up" title="착용하면 더 좋아짐">▲</span>';
      }
      const isSel = sel?.uid === item.uid ? ' selected' : '';
      return `<button type="button" class="inv-tile r-${item.rarity}${isSel}" data-act="select" data-where="${where}" data-uid="${item.uid}">
        ${up}<span class="slot">${SLOT_NAMES[item.slot]} · Lv.${item.ilvl}</span><span class="name">${esc(item.name)}</span></button>`;
    };

    const slots = SLOTS.map((s) => {
      const item = b.equipment[s];
      return `<div class="inv-slot"><span class="label">${SLOT_NAMES[s]}</span>${
        item ? tile(item, 'equip') : `<button type="button" class="inv-tile empty" disabled><span class="slot">${SLOT_NAMES[s]}</span><span class="name">비어 있음</span></button>`}</div>`;
    }).join('');

    const statRows = (Object.keys(SUMMARY_LABELS) as (keyof Summary)[])
      .map((k) => `<dt>${SUMMARY_LABELS[k][0]}</dt><dd>${fmt(cur[k], SUMMARY_LABELS[k][1])}</dd>`).join('');

    const bag = b.bag.length
      ? `<div class="inv-bag">${b.bag.map((i) => tile(i, 'bag')).join('')}</div>`
      : '<p class="inv-empty">비어 있음. 몬스터를 처치하면 장비가 떨어집니다.</p>';

    this.root.innerHTML = `${header}
      <section><h3>착용 중</h3><div class="inv-slots">${slots}</div><dl class="inv-stats wide-only">${statRows}</dl></section>
      <section><h3>가방 ${b.bag.length}/${BAG_SIZE}</h3>${bag}</section>
      <section class="narrow-only"><h3>능력치</h3><dl class="inv-stats">${statRows}</dl></section>
      <section class="inv-detail">${sel ? this.detail(b, sel, cur) : '<p class="inv-empty">장비를 누르면 옵션과 비교가 보입니다.</p>'}</section>`;
  }

  private skillsTab(b: Build): string {
    const actives = activeSkills(b);
    const cards = actives.map((a, i) => {
      const id = a.def.id;
      const chips = a.def.tags.map((t) => `<span class="chip">${TAG_KO[t]}</span>`).join('');
      const nums = skillNumbers(a).map((r) => `<dt>${r.label}</dt><dd>${r.value}</dd>`).join('');
      const sockets = socketsOf(b, id).map((g, idx) => {
        const on = this.socket?.skillId === id && this.socket.index === idx ? ' selected' : '';
        return `<button type="button" class="gem-socket${g ? ' filled' : ''}${on}" data-act="socket" data-skill="${id}" data-index="${idx}">
          ${g ? esc(SUPPORTS[g]?.name ?? g) : '+ 보조 젬'}</button>`;
      }).join('');
      return `<article class="skill-card">
        <h4><span class="key">${i + 1}</span>${esc(a.def.name)}</h4>
        <div class="chips">${chips}</div>
        <p class="desc">${esc(a.def.description)}</p>
        <dl class="inv-stats">${nums}</dl>
        <div class="sockets">${sockets}</div></article>`;
    }).join('');

    return `<section class="skills-list"><h3>스킬 (보조 젬 칸을 눌러 젬을 끼우세요)</h3><div class="skill-cards">${cards}</div></section>
      <section class="inv-detail">${this.gemPicker(b)}</section>`;
  }

  private gemPicker(b: Build): string {
    const owned = Object.keys(SUPPORTS).filter((g) => (b.gems[g] ?? 0) > 0);
    if (!this.socket) {
      const list = owned.map((g) => `<li><b>${esc(SUPPORTS[g].name)}</b> ×${b.gems[g]}<br><span class="dim">${esc(SUPPORTS[g].description)}</span></li>`).join('');
      return `<h3>가진 보조 젬</h3>${list ? `<ul class="gem-list">${list}</ul>` : '<p class="inv-empty">없음. 몬스터가 가끔 떨어뜨립니다.</p>'}`;
    }
    const skill = SKILLS[this.socket.skillId];
    const current = socketsOf(b, skill.id)[this.socket.index];
    const rows = owned.map((g) => {
      const sup = SUPPORTS[g];
      const ok = canSupport(skill, sup);
      const free = freeGems(b, g);
      const already = socketsOf(b, skill.id).includes(g);
      const why = !ok ? `${sup.requires!.map((t) => TAG_KO[t]).join('/')} 스킬 전용` : already ? '이미 연결됨' : free <= 0 ? '모두 사용 중' : `남은 개수 ${free}`;
      const disabled = !ok || already || free <= 0;
      return `<button type="button" class="gem-option" data-act="gem" data-gem="${g}" ${disabled ? 'disabled' : ''}>
        <b>${esc(sup.name)}</b> <span class="dim">· ${why}</span><br><span class="dim">${esc(sup.description)}</span></button>`;
    }).join('');
    const remove = current ? `<button type="button" data-act="gem" data-gem="">${esc(SUPPORTS[current].name)} 빼기</button>` : '';
    return `<p class="title">${esc(skill.name)} · ${this.socket.index + 1}번 칸</p>
      <div class="inv-actions">${remove}<button type="button" data-act="socket-cancel">취소</button></div>
      <div class="gem-options">${rows || '<p class="inv-empty">가진 보조 젬이 없습니다.</p>'}</div>`;
  }

  private detail(b: Build, item: Item, cur: Summary): string {
    const inBag = b.bag.some((i) => i.uid === item.uid);
    const lines = [
      ...item.implicit.map((m) => `<li class="implicit">${describeMod(m)}</li>`),
      ...item.affixes.map((a) => `<li>${describeMod(a.mod)}<span class="tier">${a.tier}단계</span></li>`),
    ].join('');

    let compare = '';
    if (inBag) {
      const next = summarize(b, statsFor(b, { ...b.equipment, [item.slot]: item }));
      const rows = (Object.keys(SUMMARY_LABELS) as (keyof Summary)[])
        .filter((k) => Math.abs(next[k] - cur[k]) > 1e-6)
        .map((k) => {
          const [label, unit] = SUMMARY_LABELS[k];
          const cls = next[k] > cur[k] ? 'up' : 'down';
          return `<tr><td>${label}</td><td>${fmt(cur[k], unit)}</td><td class="${cls}">${fmt(next[k], unit)}</td></tr>`;
        }).join('');
      const vs = b.equipment[item.slot] ? `${esc(b.equipment[item.slot]!.name)} 대신 착용하면` : '빈 칸에 착용하면';
      compare = `<h3>${vs}</h3>${rows ? `<table class="inv-compare">${rows}</table>` : '<p class="inv-empty">변화 없음</p>'}`;
    }

    const actions = inBag
      ? `<button type="button" class="primary" data-act="equip" data-uid="${item.uid}">착용</button>
         <button type="button" data-act="discard" data-uid="${item.uid}">버리기</button>`
      : `<button type="button" data-act="unequip" ${b.bag.length >= BAG_SIZE ? 'disabled' : ''}>해제</button>`;

    return `<p class="title t-${item.rarity}">${esc(item.name)}</p>
      <p class="sub">${RARITY_NAMES[item.rarity]} ${SLOT_NAMES[item.slot]} · ${esc(BASES[item.baseId]?.name ?? '')} · 아이템 레벨 ${item.ilvl}</p>
      <ul>${lines}</ul>${compare}<div class="inv-actions">${actions}</div>`;
  }
}
