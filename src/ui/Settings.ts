// 설정: 세이브 코드 내보내기/불러오기, 홈 화면 설치, 새로 시작.
import './settings.css';
import { backupSave, newBuild, type Build } from '../core/build';
import { exportSaveCode, importSaveCode, type ImportResult } from '../core/savecode';
import { canInstall, installHint, isStandalone, promptInstall } from './pwa';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class SettingsUI {
  private readonly root: HTMLElement;
  private code = '';
  private pending: Extract<ImportResult, { ok: true }> | null = null;
  private msg = '';
  private confirmReset = false;

  constructor(
    private readonly getBuild: () => Build,
    /** 세이브를 통째로 바꿀 때 (불러오기·새로 시작) */
    private readonly onReplace: (build: Build) => void,
    private readonly onClose: () => void,
    /** 편의 설정이 바뀌면 저장 */
    private readonly onPrefs: () => void = () => {},
  ) {
    this.root = document.createElement('div');
    this.root.className = 'settings';
    this.root.addEventListener('click', (e) => void this.onClick(e));
    this.root.addEventListener('change', (e) => {
      const el = e.target as HTMLInputElement;
      const prefs = this.getBuild().prefs;
      if (el.name === 'loot-min') prefs.lootMin = el.value as typeof prefs.lootMin;
      else if (el.name === 'auto-salvage') prefs.autoSalvage = el.checked;
      else return;
      this.onPrefs();
    });
    document.body.append(this.root);
    this.render();
  }

  destroy() {
    this.root.remove();
  }

  private async onClick(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (act !== 'reset') this.confirmReset = false;
    switch (act) {
      case 'close': this.onClose(); return;
      case 'export':
        this.code = await exportSaveCode(this.getBuild());
        this.msg = '세이브 코드를 만들었습니다. 복사해서 메모장 등에 보관하세요.';
        break;
      case 'copy': {
        const ta = this.root.querySelector<HTMLTextAreaElement>('#save-out');
        try {
          await navigator.clipboard.writeText(this.code);
          this.msg = '복사했습니다.';
        } catch {
          // 클립보드를 못 쓰면 글자를 선택해 둠
          ta?.select();
          this.msg = '자동 복사가 안 됩니다. 선택된 글자를 길게 눌러 복사하세요.';
        }
        this.renderMsg();
        return;
      }
      case 'check': {
        const text = this.root.querySelector<HTMLTextAreaElement>('#save-in')?.value ?? '';
        const r = await importSaveCode(text);
        if (r.ok) { this.pending = r; this.msg = ''; }
        else { this.pending = null; this.msg = r.reason; }
        break;
      }
      case 'apply':
        if (!this.pending) break;
        backupSave();
        this.onReplace(this.pending.build);
        this.pending = null;
        this.msg = '불러왔습니다. 이전 세이브는 이 기기에 백업해 두었습니다.';
        break;
      case 'cancel-import': this.pending = null; break;
      case 'install':
        this.msg = (await promptInstall()) ? '설치를 시작했습니다.' : '설치를 취소했거나 지금은 설치할 수 없습니다.';
        break;
      case 'reset':
        if (!this.confirmReset) { this.confirmReset = true; break; }
        backupSave();
        this.onReplace(newBuild());
        this.confirmReset = false;
        this.msg = '새로 시작했습니다. 이전 세이브는 이 기기에 백업해 두었습니다.';
        break;
    }
    this.render();
  }

  private renderMsg() {
    const m = this.root.querySelector('.settings-msg');
    if (m) m.textContent = this.msg;
  }

  render() {
    const b = this.getBuild();
    const install = isStandalone()
      ? '<p>홈 화면 앱으로 실행 중입니다.</p>'
      : canInstall()
        ? '<button type="button" class="primary" data-act="install">홈 화면에 설치</button>'
        : `<p class="dim">${esc(installHint())}</p>`;
    const preview = this.pending
      ? `<div class="confirm"><p>불러올 세이브: <b>Lv.${this.pending.level}</b> · 저장 ${esc(new Date(this.pending.savedAt).toLocaleString('ko-KR'))}</p>
          <p class="dim">지금 진행(Lv.${b.level})을 이 세이브로 바꿉니다.</p>
          <div class="row"><button type="button" class="primary" data-act="apply">이 세이브로 바꾸기</button><button type="button" data-act="cancel-import">취소</button></div></div>`
      : '';
    this.root.innerHTML = `
      <div class="settings-box" role="dialog" aria-label="설정">
        <header><h2>설정</h2><button type="button" data-act="close">닫기</button></header>
        <p class="settings-msg" aria-live="polite">${esc(this.msg)}</p>

        <section>
          <h3>줍기 필터</h3>
          <p class="dim">고른 등급보다 낮은 장비는 바닥에 떨어지지 않습니다. 보조 젬·재화는 항상 떨어집니다.</p>
          <div class="radios">${([['normal', '모두 줍기'], ['magic', '고급 이상만'], ['rare', '희귀만']] as const).map(([v, t]) =>
            `<label><input type="radio" name="loot-min" value="${v}" ${b.prefs.lootMin === v ? 'checked' : ''}> ${t}</label>`).join('')}</div>
          <label class="chk"><input type="checkbox" name="auto-salvage" ${b.prefs.autoSalvage ? 'checked' : ''}> 걸러진 장비는 자동 분해 (50% 확률로 강화석)</label>
        </section>

        <section>
          <h3>세이브 코드 내보내기</h3>
          <p class="dim">진행 상황 전체를 글자 한 줄로 만듭니다. 다른 기기에서 불러오거나, 저장 데이터가 지워졌을 때 되살릴 수 있습니다.</p>
          <div class="row"><button type="button" data-act="export">코드 만들기</button>${this.code ? '<button type="button" class="primary" data-act="copy">복사</button>' : ''}</div>
          ${this.code ? `<textarea id="save-out" readonly rows="3">${esc(this.code)}</textarea><p class="dim">${this.code.length.toLocaleString()}자</p>` : ''}
        </section>

        <section>
          <h3>세이브 코드 불러오기</h3>
          <textarea id="save-in" rows="3" placeholder="HERO1. 로 시작하는 코드를 붙여 넣으세요"></textarea>
          <div class="row"><button type="button" data-act="check">확인</button></div>
          ${preview}
        </section>

        <section>
          <h3>홈 화면에 설치</h3>
          <p class="dim">설치하면 전체 화면으로 열리고, 한 번 받은 뒤에는 인터넷 없이도 플레이할 수 있습니다. iPhone Safari는 설치하지 않은 사이트의 저장 데이터를 지울 수 있어 설치를 권장합니다.</p>
          ${install}
        </section>

        <section>
          <h3>새로 시작</h3>
          <p class="dim">레벨·장비·재화를 모두 처음으로 되돌립니다. 지금 세이브는 이 기기에 백업됩니다.</p>
          <button type="button" class="${this.confirmReset ? 'danger' : ''}" data-act="reset">${this.confirmReset ? '정말 새로 시작 (한 번 더 누르기)' : '새로 시작'}</button>
        </section>
      </div>`;
  }
}
