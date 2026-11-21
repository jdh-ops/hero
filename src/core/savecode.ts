// 세이브 코드: 저장 데이터를 텍스트 한 줄로 내보내고 불러온다 (기기 이동·백업용).
// 형식: "HERO1." + base64url(deflate(JSON)) + "." + 체크섬(8자)
import { buildFromData, toSaveData, type Build, type SaveData } from './build';

const PREFIX = 'HERO1.';

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64(text: string): Uint8Array {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** 오타·잘림 확인용 (FNV-1a) */
function checksum(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function exportSaveCode(build: Build): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(toSaveData(build)));
  const body = toB64(await pipe(json, new CompressionStream('deflate-raw')));
  return `${PREFIX}${body}.${checksum(body)}`;
}

export type ImportResult = { ok: true; build: Build; savedAt: string; level: number } | { ok: false; reason: string };

export async function importSaveCode(code: string): Promise<ImportResult> {
  const text = code.replace(/\s+/g, '');
  if (!text.startsWith(PREFIX)) return { ok: false, reason: '세이브 코드 형식이 아닙니다. HERO1. 로 시작해야 합니다.' };
  const [body, sum] = text.slice(PREFIX.length).split('.');
  if (!body || sum !== checksum(body)) return { ok: false, reason: '코드가 잘렸거나 바뀌었습니다. 전체를 다시 복사해 주세요.' };
  try {
    const json = new TextDecoder().decode(await pipe(fromB64(body), new DecompressionStream('deflate-raw')));
    const data = JSON.parse(json) as SaveData;
    const build = buildFromData(data);
    if (!build) return { ok: false, reason: '이 버전에서 읽을 수 없는 세이브입니다.' };
    return { ok: true, build, savedAt: data.savedAt, level: build.level };
  } catch {
    return { ok: false, reason: '코드를 풀지 못했습니다. 전체를 다시 복사해 주세요.' };
  }
}
