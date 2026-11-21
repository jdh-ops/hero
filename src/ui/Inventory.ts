// 가방·장비 창. 게임 캔버스 위에 HTML로 띄운다.
import './inventory.css';
import {
  BAG_SIZE, SUMMARY_LABELS, activeSkills, discard, equipFromBag, freeGems, socketGem, socketsOf, statsFor, summarize, unequip,
  type Build, type Summary,
} from '../core/build';
import {
  AFFIXES, AFFIX_RARITY_NAMES, RARITY_NAMES, SLOTS, SLOT_NAMES, BASES, affixMod, describeMod, implicitMods, itemTitle, maxTierFor, type Item,
} from '../core/items';
import {
  MAX_SKILL_ENHANCE, canBoost, itemMaxTier, formatCost, gain, has, rerollCost, rollSalvage, salvageGemReward, salvageItemReward, shopPrice, shopRoll,
  skillEnhanceChance, skillEnhanceCost, spend, tryEnhanceSkill, tryReroll, type EnhanceResult, type Wallet,
} from '../core/economy';
import { branchPoints, canRankUp, rankUp, spentPoints, totalPoints } from '../core/talents';
import { CURRENCIES, ECONOMY, TALENTS } from '../data';
import { canSupport, skillNumbers } from '../core/skills';
import type { Tag } from '../core/types';
import { SKILLS, SUPPORTS } from '../data';
import { GEM_RARITIES, GEM_RARITY_KO, describeGem, gemKey, parseGem } from '../core/gems';

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
  private tab: 'gear' | 'skills' | 'talents' | 'shop' = 'gear';
  /** 스킬 탭에서 강화하려고 고른 스킬 */
  private skillPick: string | null = null;
  /** 장비 상세에서 굴리려고 고른 옵션 번호 */
  private affixPick: number | null = null;
  /** 마지막 행동 결과 안내 */
  private msg = '';
  /** 스킬 탭에서 고른 보조 젬 칸 */
  private socket: { skillId: string; index: number } | null = null;

  constructor(
    private readonly getBuild: () => Build,
    /** 장비가 바뀌면 호출 (스탯 다시 계산 + 저장) */
    private readonly onChange: () => void,
    private readonly onToggle: (open: boolean) => void,
    /** 상점은 지도 화면에서만 */
    private readonly canShop: () => boolean = () => false,
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
    // 특성 포인트가 남으면 표시
    const b = this.getBuild();
    if (spentPoints(b.talents) < totalPoints(b.level)) this.button.innerHTML += ' <span class="dot" title="남은 특성 포인트"></span>';
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
    this.msg = '';
    switch (act) {
      case 'close': this.toggle(false); return;
      case 'tab': this.tab = el.dataset.tab as InventoryUI['tab']; break;
      case 'socket': this.socket = { skillId: el.dataset.skill!, index: Number(el.dataset.index) }; this.skillPick = null; break;
      case 'skill-pick': this.skillPick = el.dataset.skill!; this.socket = null; break;
      case 'affix': this.affixPick = Number(el.dataset.index); break;
      case 'reroll': {
        const item = this.findSelected();
        if (!item || this.affixPick === null) break;
        const boosted = el.dataset.boost === '1';
        const r = tryReroll(b.wallet, item, this.affixPick, boosted);
        if (r === 'ok') {
          const a = item.affixes[this.affixPick];
          this.msg = `${boosted ? '금괴 굴림' : '굴림'} 결과: ${describeMod(a.mod)} (T${a.tier} · ${AFFIX_RARITY_NAMES[AFFIXES[a.id].rarity]})`;
          this.onChange();
        } else this.msg = r === 'no-money' ? '재료가 부족합니다.' : '굴릴 수 없습니다.';
        break;
      }
      case 'enh-skill': {
        if (!this.skillPick) break;
        const t = (b.skillEnhance[this.skillPick] ??= { level: 0 });
        this.msg = this.enhanceMsg(tryEnhanceSkill(b.wallet, t), t.level);
        this.onChange();
        break;
      }
      case 'salvage': {
        const item = b.bag.find((i) => i.uid === uid);
        if (!item) break;
        const got = rollSalvage(salvageItemReward(item));
        gain(b.wallet, got);
        discard(b, item.uid);
        this.selected = null;
        this.msg = Object.keys(got).length ? `분해 성공: ${formatCost(got)}` : '분해 실패: 아무것도 얻지 못했습니다.';
        this.onChange();
        break;
      }
      case 'salvage-normal': {
        const total: Wallet = {};
        let n = 0, ok = 0;
        for (const item of b.bag.filter((i) => i.rarity === 'normal')) {
          const got = rollSalvage(salvageItemReward(item));
          if (Object.keys(got).length) ok++;
          gain(total, got);
          discard(b, item.uid);
          n++;
        }
        gain(b.wallet, total);
        this.selected = null;
        this.msg = n ? `일반 장비 ${n}개 분해 (성공 ${ok}): ${formatCost(total) || '없음'}` : '분해할 일반 장비가 없습니다.';
        this.onChange();
        break;
      }
      case 'gem-salvage': {
        const key = el.dataset.gem!;
        if (freeGems(b, key) <= 0) break;
        b.gems[key]--;
        const got = rollSalvage(salvageGemReward(key));
        gain(b.wallet, got);
        this.msg = Object.keys(got).length ? `젬 분해 성공: ${formatCost(got)}` : '젬 분해 실패: 아무것도 얻지 못했습니다.';
        this.onChange();
        break;
      }
      case 'talent':
        if (rankUp(b.talents, b.level, el.dataset.id!)) this.onChange();
        break;
      case 'respec': {
        const cost = { gold: ECONOMY.respec.goldPerLevel * b.level };
        if (spend(b.wallet, cost)) { b.talents = {}; this.msg = '특성을 초기화했습니다.'; this.onChange(); }
        else this.msg = `금화가 부족합니다 (${formatCost(cost)})`;
        break;
      }
      case 'buy': {
        if (!this.canShop()) break;
        const id = el.dataset.id!;
        const price = { gold: shopPrice(id, b.level) };
        if (!spend(b.wallet, price)) { this.msg = '금화가 부족합니다.'; break; }
        const r = shopRoll(id, b.level);
        if ('item' in r) {
          if (b.bag.length >= BAG_SIZE) { gain(b.wallet, price); this.msg = '가방이 가득 찼습니다.'; break; }
          b.bag.push(r.item);
          this.msg = `구매: ${r.item.name} (가방)`;
        } else if ('gem' in r) {
          b.gems[r.gem] = (b.gems[r.gem] ?? 0) + 1;
          this.msg = `구매: 보조 젬 ${parseGem(r.gem)?.def.name}`;
        } else {
          gain(b.wallet, r.currency);
          this.msg = `구매: ${formatCost(r.currency)}`;
        }
        this.onChange();
        break;
      }
      case 'socket-cancel': this.socket = null; break;
      case 'skill-pick-cancel': this.skillPick = null; break;
      case 'gem':
        // 끼우거나 빼면 칸 선택을 풀어서 가려진 스킬 카드가 다시 보이게
        if (this.socket && socketGem(b, this.socket.skillId, this.socket.index, el.dataset.gem || null)) {
          this.socket = null;
          this.onChange();
        }
        break;
      case 'select': this.selected = { where: where as 'bag' | 'equip', uid: uid! }; this.affixPick = null; break;
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

  private enhanceMsg(r: EnhanceResult, level: number): string {
    if (r === 'success') return `강화 성공! +${level}`;
    if (r === 'fail') return `강화 실패 (+${level} 유지, 재료만 사라짐)`;
    if (r === 'no-money') return '재료가 부족합니다.';
    return '최대 단계입니다.';
  }

  render() {
    this.refreshButton();
    if (!this.isOpen) return;
    const b = this.getBuild();
    const tabBtn = (id: InventoryUI['tab'], label: string) =>
      `<button type="button" data-act="tab" data-tab="${id}" class="${this.tab === id ? 'on' : ''}">${label}</button>`;
    const left = totalPoints(b.level) - spentPoints(b.talents);
    const tabs = `<nav class="inv-tabs">${tabBtn('gear', '장비')}${tabBtn('skills', '스킬')}${tabBtn('talents', left > 0 ? `특성 <b class="pts">${left}</b>` : '특성')}${this.canShop() ? tabBtn('shop', '상점') : ''}</nav>`;
    // 금화와 가진 재화만 표시 (모바일에서 줄이 길어지지 않게)
    const wallet = Object.values(CURRENCIES).filter((c) => c.id === 'gold' || (b.wallet[c.id] ?? 0) > 0).map((c) =>
      `<span class="cur" style="--c:#${Number(c.color).toString(16).padStart(6, '0')}" title="${esc(c.description)}">${c.name} <b>${b.wallet[c.id] ?? 0}</b></span>`).join('');
    const header = `<header>${tabs}<span class="hint">I · Tab · Esc 로 닫기 · 열려 있는 동안 일시정지</span>
        <button type="button" data-act="close">닫기</button>
        <div class="wallet">${wallet}</div>${this.msg ? `<p class="inv-msg">${esc(this.msg)}</p>` : ''}</header>`;
    if (this.tab === 'shop' && !this.canShop()) this.tab = 'gear';
    if (this.tab === 'skills') {
      this.root.innerHTML = header + this.skillsTab(b);
      return;
    }
    if (this.tab === 'talents') {
      this.root.innerHTML = header + this.talentsTab(b);
      return;
    }
    if (this.tab === 'shop') {
      this.root.innerHTML = header + this.shopTab(b);
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
        ${up}<span class="slot">${SLOT_NAMES[item.slot]} · Lv.${item.ilvl}</span><span class="name">${esc(itemTitle(item))}</span></button>`;
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
      <section><h3 class="row">가방 ${b.bag.length}/${BAG_SIZE}<button type="button" class="mini" data-act="salvage-normal">일반 모두 분해</button></h3>${bag}</section>
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
        const gem = g ? parseGem(g) : null;
        return `<button type="button" class="gem-socket${gem ? ` filled g-${gem.rarity}` : ''}${on}" data-act="socket" data-skill="${id}" data-index="${idx}">
          ${gem ? `${esc(gem.def.name)}<small>${GEM_RARITY_KO[gem.rarity]}</small>` : '+ 보조 젬'}</button>`;
      }).join('');
      const lv = b.skillEnhance[id]?.level ?? 0;
      return `<article class="skill-card${this.skillPick === id ? ' picked' : ''}">
        <h4><span class="key">${i + 1}</span>${esc(a.def.name)}${lv ? ` <span class="enh">+${lv}</span>` : ''}
          <button type="button" class="mini push" data-act="skill-pick" data-skill="${id}">강화</button></h4>
        <div class="chips">${chips}</div>
        <p class="desc">${esc(a.def.description)}</p>
        <dl class="inv-stats">${nums}</dl>
        <div class="sockets">${sockets}</div></article>`;
    }).join('');

    return `<section class="skills-list"><h3>스킬 (보조 젬 칸을 눌러 젬을 끼우세요)</h3><div class="skill-cards">${cards}</div></section>
      <section class="inv-detail">${this.skillPick ? this.skillEnhancePanel(b, this.skillPick) : this.gemPicker(b)}</section>`;
  }

  private skillEnhancePanel(b: Build, skillId: string): string {
    const level = b.skillEnhance[skillId]?.level ?? 0;
    const pct = Math.round(ECONOMY.skill.perLevel * 100);
    let body: string;
    if (level >= MAX_SKILL_ENHANCE) body = '<p class="dim">최대 단계(+10)입니다.</p>';
    else {
      const cost = skillEnhanceCost(level);
      body = `<div class="enh-box">
        <p><b>+${level} → +${level + 1}</b> · 성공 확률 <b>${Math.round(skillEnhanceChance(level) * 100)}%</b></p>
        <p class="dim">단계마다 스킬 배율 +${pct}% (지금 +${level * pct}%)</p>
        <p>재료: ${formatCost(cost)}</p>
        <div class="inv-actions"><button type="button" class="primary" data-act="enh-skill" ${has(b.wallet, cost) ? '' : 'disabled'}>강화</button></div>
        <p class="dim">실패하면 재료만 사라지고 단계는 그대로입니다.</p></div>`;
    }
    const table = ECONOMY.skill.chances.map((c, i) => `<tr${i === level ? ' class="now"' : ''}><td>+${i + 1}</td><td>${Math.round(c * 100)}%</td><td>${formatCost(ECONOMY.skill.costs[i])}</td></tr>`).join('');
    return `<p class="title">${esc(SKILLS[skillId].name)} 강화</p>
      <div class="inv-actions"><button type="button" data-act="skill-pick-cancel">닫기</button></div>
      ${body}<table class="inv-compare enh-table">${table}</table>`;
  }

  private talentsTab(b: Build): string {
    const left = totalPoints(b.level) - spentPoints(b.talents);
    const cols = TALENTS.branches.map((br) => {
      const pts = branchPoints(b.talents, br.id);
      const tiers = TALENTS.tierPoints.map((need, tier) => {
        const list = TALENTS.talents.filter((t) => t.branch === br.id && t.tier === tier).map((t) => {
          const rank = b.talents[t.id] ?? 0;
          const check = canRankUp(b.talents, b.level, t.id);
          const cls = rank >= t.maxRank ? 'full' : check === 'locked' ? 'locked' : rank > 0 ? 'some' : '';
          return `<button type="button" class="talent ${cls}${tier === 2 ? ' key' : ''}" data-act="talent" data-id="${t.id}" ${check === 'ok' ? '' : 'aria-disabled="true"'}>
            <span class="tn">${esc(t.name)}</span><span class="tr">${rank}/${t.maxRank}</span><span class="td">${esc(t.description)}</span></button>`;
        }).join('');
        return `<div class="tier"><span class="tier-label">${need ? `${need}포인트 이상` : '기본'}</span>${list}</div>`;
      }).join('');
      return `<section class="branch"><h3>${esc(br.name)} <span class="dim">· ${pts}포인트</span></h3><p class="dim">${esc(br.description)}</p>${tiers}</section>`;
    }).join('');
    return `<section class="talents-wrap"><div class="talent-head"><span>남은 포인트 <b>${left}</b> / 전체 ${totalPoints(b.level)} (레벨당 1)</span>
        <button type="button" class="mini" data-act="respec">초기화 (금화 ${ECONOMY.respec.goldPerLevel * b.level})</button></div>
      <div class="branches">${cols}</div></section>`;
  }

  private shopTab(b: Build): string {
    const rows = ECONOMY.shop.map((s) => {
      const price = shopPrice(s.id, b.level);
      return `<div class="shop-row"><div><b>${esc(s.name)}</b><br><span class="dim">${esc(s.description)}</span></div>
        <button type="button" class="primary" data-act="buy" data-id="${s.id}" ${(b.wallet.gold ?? 0) >= price ? '' : 'disabled'}>금화 ${price}</button></div>`;
    }).join('');
    return `<section class="shop"><h3>상점 (지도 화면에서만 이용)</h3>${rows}</section>`;
  }

  private gemPicker(b: Build): string {
    // 가진 젬: 종류 순서 → 희귀도 높은 순
    const owned: string[] = [];
    for (const def of Object.values(SUPPORTS)) {
      for (const r of [...GEM_RARITIES].reverse()) if ((b.gems[gemKey(def.id, r)] ?? 0) > 0) owned.push(gemKey(def.id, r));
    }
    const label = (key: string) => {
      const g = parseGem(key)!;
      return `<b>${esc(g.def.name)}</b> <span class="g-tag g-${g.rarity}">${GEM_RARITY_KO[g.rarity]}</span>`;
    };
    if (!this.socket) {
      const list = owned.map((k) => {
        const free = freeGems(b, k);
        const btn = free > 0 ? `<button type="button" class="mini" data-act="gem-salvage" data-gem="${k}">분해 (50%: ${formatCost(salvageGemReward(k))})</button>` : '';
        return `<li>${label(k)} ×${b.gems[k]} ${btn}<br><span class="dim">${esc(describeGem(k))}</span></li>`;
      }).join('');
      return `<h3>가진 보조 젬 (같은 젬도 희귀도가 높을수록 수치가 큼)</h3>${list ? `<ul class="gem-list">${list}</ul>` : '<p class="inv-empty">없음. 몬스터가 가끔 떨어뜨립니다.</p>'}`;
    }
    const skill = SKILLS[this.socket.skillId];
    const sockets = socketsOf(b, skill.id);
    const current = sockets[this.socket.index];
    // 이 스킬에 맞지 않는 젬은 목록에서 뺌
    const rows = owned.filter((k) => canSupport(skill, parseGem(k)!.def)).map((k) => {
      const g = parseGem(k)!;
      const free = freeGems(b, k);
      const other = sockets.some((s, i) => i !== this.socket!.index && s && parseGem(s)?.def.id === g.def.id);
      const isCurrent = current === k;
      const why = isCurrent ? '지금 이 칸' : other ? '같은 종류가 이미 연결됨' : free <= 0 ? '모두 사용 중' : `남은 개수 ${free}`;
      const disabled = isCurrent || other || free <= 0;
      return `<button type="button" class="gem-option" data-act="gem" data-gem="${k}" ${disabled ? 'disabled' : ''}>
        ${label(k)} <span class="dim">· ${why}</span><br><span class="dim">${esc(describeGem(k))}</span></button>`;
    }).join('');
    const remove = current ? `<button type="button" data-act="gem" data-gem="">${esc(parseGem(current)?.def.name ?? '')} 빼기</button>` : '';
    return `<p class="title">${esc(skill.name)} · ${this.socket.index + 1}번 칸</p>
      <div class="inv-actions">${remove}<button type="button" data-act="socket-cancel">취소</button></div>
      <div class="gem-options">${rows || '<p class="inv-empty">이 스킬에 끼울 수 있는 보조 젬이 없습니다.</p>'}</div>`;
  }

  private detail(b: Build, item: Item, cur: Summary): string {
    const inBag = b.bag.some((i) => i.uid === item.uid);
    const affixLines = item.affixes.map((a, i) => {
      const def = AFFIXES[a.id];
      const max = maxTierFor(def, item.ilvl);
      const on = this.affixPick === i ? ' on' : '';
      return `<li><button type="button" class="affix${on}" data-act="affix" data-index="${i}">
        <span>${describeMod(affixMod(item, i))}</span>
        <span class="atag ar-${def.rarity}">T${a.tier}${a.tier === max ? '·최대' : ''} · ${AFFIX_RARITY_NAMES[def.rarity]}</span></button></li>`;
    }).join('');
    const lines = implicitMods(item).map((m) => `<li class="implicit">${describeMod(m)}</li>`).join('') + affixLines;

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
      const vs = b.equipment[item.slot] ? `${esc(itemTitle(b.equipment[item.slot]!))} 대신 착용하면` : '빈 칸에 착용하면';
      compare = `<h3>${vs}</h3>${rows ? `<table class="inv-compare">${rows}</table>` : '<p class="inv-empty">변화 없음</p>'}`;
    }

    const actions = inBag
      ? `<button type="button" class="primary" data-act="equip" data-uid="${item.uid}">착용</button>
         <button type="button" data-act="salvage" data-uid="${item.uid}">분해 (50%: ${formatCost(salvageItemReward(item))})</button>`
      : `<button type="button" data-act="unequip" ${b.bag.length >= BAG_SIZE ? 'disabled' : ''}>해제</button>`;

    // 옵션 굴리기
    let reroll: string;
    if (this.affixPick === null || this.affixPick >= item.affixes.length) {
      reroll = '<p class="dim">굴릴 옵션을 위 목록에서 누르세요. 고른 옵션 하나가 새 옵션(종류·티어·희귀도 무작위)으로 바뀝니다.</p>';
    } else {
      const cost = rerollCost(item, false);
      const btns = [`<button type="button" class="primary" data-act="reroll" data-boost="0" ${has(b.wallet, cost) ? '' : 'disabled'}>굴리기 (${formatCost(cost)})</button>`];
      if (canBoost(item)) {
        const bc = rerollCost(item, true);
        btns.push(`<button type="button" class="gold" data-act="reroll" data-boost="1" ${has(b.wallet, bc) ? '' : 'disabled'}>금괴 굴리기 (${formatCost(bc)})</button>`);
      }
      reroll = `<p class="dim">${this.affixPick + 1}번째 옵션을 다시 굴립니다. 이 장비(아이템 레벨 ${item.ilvl})에는 최고 T${itemMaxTier(item)} 옵션까지 붙습니다.${canBoost(item) ? ' 금괴 굴리기는 희귀 옵션과 높은 티어가 훨씬 잘 나옵니다.' : ''}</p>
        <div class="inv-actions">${btns.join('')}</div>`;
    }

    return `<p class="title t-${item.rarity}">${esc(itemTitle(item))}</p>
      <p class="sub">${RARITY_NAMES[item.rarity]} ${SLOT_NAMES[item.slot]} · ${esc(BASES[item.baseId]?.name ?? '')} · 아이템 레벨 ${item.ilvl}</p>
      <div class="inv-actions">${actions}</div>
      <ul>${lines}</ul><h3>옵션 굴리기 (강화)</h3>${reroll}${compare}`;
  }
}
