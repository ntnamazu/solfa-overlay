import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveBundledAudiverisPath } from '../../../../src/main/omr/resolveBundledAudiverisPath';

describe('resolveBundledAudiverisPath', () => {
  it('非パッケージ（開発時）は undefined を返し、OmrRunner の既定チェーンに委ねる', () => {
    expect(
      resolveBundledAudiverisPath({
        isPackaged: false,
        resourcesPath: '/app/resources',
        platform: 'win32',
      }),
    ).toBeUndefined();
  });

  it('パッケージ＋Windows は resourcesPath 配下の同梱ランチャ絶対パスを返す', () => {
    expect(
      resolveBundledAudiverisPath({
        isPackaged: true,
        resourcesPath: '/app/resources',
        platform: 'win32',
      }),
    ).toBe(join('/app/resources', 'audiveris', 'win', 'Audiveris.exe'));
  });

  it('パッケージでも配布対象外 OS（darwin/linux）は undefined を返す', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      expect(
        resolveBundledAudiverisPath({
          isPackaged: true,
          resourcesPath: '/app/resources',
          platform,
        }),
      ).toBeUndefined();
    }
  });
});
