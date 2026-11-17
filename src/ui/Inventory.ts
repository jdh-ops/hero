// 가방·장비 창. 게임 캔버스 위에 HTML로 띄운다.
import './inventory.css';
import {
  BAG_SIZE, SUMMARY_LABELS, discard, equipFromBag, statsFor, summarize, unequip,
  type Build, type Summary,
} from '../core/build';
import { RARITY_NAMES, SLOTS, SLOT_NAMES, BASES, describeMod, type Item } from '../core/items';

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
    this.button.innerHTML = `가방 <span class="badge">${n}/${BAG_SIZE}</span>${key}`;
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

    this.root.innerHTML = `
      <header><h2>장비</h2><span class="hint">I · Tab · Esc 로 닫기 · 열려 있는 동안 일시정지</span>
        <button type="button" data-act="close">닫기</button></header>
      <section><h3>착용 중</h3><div class="inv-slots">${slots}</div><dl class="inv-stats wide-only">${statRows}</dl></section>
      <section><h3>가방 ${b.bag.length}/${BAG_SIZE}</h3>${bag}</section>
      <section class="narrow-only"><h3>능력치</h3><dl class="inv-stats">${statRows}</dl></section>
      <section class="inv-detail">${sel ? this.detail(b, sel, cur) : '<p class="inv-empty">장비를 누르면 옵션과 비교가 보입니다.</p>'}</section>`;
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
