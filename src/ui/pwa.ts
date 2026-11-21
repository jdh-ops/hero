// PWA: 서비스 워커 등록(오프라인), 홈 화면 설치 안내, 저장 데이터 보존 요청.

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;

export function setupPwa(): void {
  // 안드로이드 크롬 등: 설치 버튼을 직접 띄울 수 있게 이벤트를 잡아 둠
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
  });

  // 오프라인 플레이용 서비스 워커 (GitHub Pages 배포본에서만. 한 파일 미리보기 빌드에는 없음)
  if (import.meta.env.PROD && import.meta.env.MODE !== 'single' && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => { /* 지원하지 않는 환경 */ });
    });
  }

  // 브라우저가 저장 데이터를 마음대로 지우지 않도록 요청 (거절돼도 게임은 그대로)
  navigator.storage?.persist?.().catch(() => {});
}

export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const canInstall = () => deferred !== null;

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  return outcome === 'accepted';
}

export function installHint(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'Safari 아래쪽 공유 버튼 → "홈 화면에 추가"를 누르세요.';
  if (/Android/.test(ua)) return '브라우저 메뉴(⋮) → "앱 설치" 또는 "홈 화면에 추가"를 누르세요.';
  return '주소창 오른쪽의 설치 아이콘이나 브라우저 메뉴의 "앱 설치"를 누르세요. (GitHub Pages 배포 주소에서 가능)';
}
