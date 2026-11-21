import { describe, expect, it } from 'vitest';
import { exportSaveCode, importSaveCode } from '../src/core/savecode';
import { newBuild } from '../src/core/build';
import { generateItem } from '../src/core/items';

describe('세이브 코드', () => {
  it('내보낸 코드를 그대로 불러온다', async () => {
    const b = newBuild();
    b.level = 23;
    b.wallet = { gold: 1234, stone_rare: 2 };
    for (let i = 0; i < 40; i++) b.bag.push(generateItem(30));
    const code = await exportSaveCode(b);
    expect(code.startsWith('HERO1.')).toBe(true);
    const r = await importSaveCode(`  ${code}\n`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.build.level).toBe(23);
      expect(r.build.wallet).toEqual({ gold: 1234, stone_rare: 2 });
      expect(r.build.bag).toEqual(b.bag);
    }
  });

  it('잘리거나 바뀐 코드는 거부', async () => {
    const code = await exportSaveCode(newBuild());
    expect((await importSaveCode(code.slice(0, -20))).ok).toBe(false);
    expect((await importSaveCode('abc')).ok).toBe(false);
    const broken = code.replace(/.(?=\.[0-9a-f]{8}$)/, (c) => (c === 'A' ? 'B' : 'A'));
    expect((await importSaveCode(broken)).ok).toBe(false);
  });
});
