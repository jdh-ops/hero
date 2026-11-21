// 처음 하는 사람을 위한 안내: 아래쪽에 잠깐 뜨는 팁, 첫 입장 안내 카드.
import { MAPS } from '../data';

let current: HTMLElement | null = null;
let timer = 0;

/** html 은 코드에서 정한 문장만 넘긴다 (사용자 입력 아님) */
export function showTip(html: string, ms = 5500): void {
  current?.remove();
  clearTimeout(timer);
  const el = document.createElement('div');
  el.className = 'tip-toast';
  el.setAttribute('role', 'status');
  el.innerHTML = html;
  document.body.append(el);
  current = el;
  timer = window.setTimeout(() => { el.remove(); if (current === el) current = null; }, ms);
}

export function clearTips(): void {
  current?.remove();
  current = null;
  clearTimeout(timer);
}

/** 첫 입장 안내. 닫으면 onDone */
export function showIntro(touch: boolean, onDone: () => void): HTMLElement {
  const el = document.createElement('div');
  el.className = 'intro';
  const move = touch ? '화면 아래쪽을 누른 채 끌면 이동합니다.' : 'WASD 또는 방향키로 이동합니다.';
  const skill = touch ? '오른쪽 아래 버튼으로 스킬을 씁니다.' : '1~4 키(Space = 1)로 스킬을 씁니다.';
  el.innerHTML = `<div class="intro-box" role="dialog" aria-label="안내">
    <h2>처음 오셨네요</h2>
    <ol>
      <li>${move} 기본공격은 가까운 적에게 자동으로 나갑니다.</li>
      <li>${skill} 범위 스킬로 여러 마리를 한 번에 잡으세요.</li>
      <li>몬스터 ${MAPS.killTarget}마리를 잡으면 보스가 나오고, 보스를 잡으면 클리어입니다.</li>
      <li>떨어진 장비·젬·재화는 가까이 가면 줍습니다. 가방에서 <b>공격▲ 방어▲</b> 표시를 보고 바꿔 끼우세요.</li>
    </ol>
    <button type="button">시작</button></div>`;
  el.querySelector('button')!.addEventListener('click', () => { el.remove(); onDone(); });
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  document.body.append(el);
  return el;
}
