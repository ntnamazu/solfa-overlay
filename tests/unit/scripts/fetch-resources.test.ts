import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findDirContaining, sha256 } from '../../../scripts/fetch-resources';

describe('fetch-resources のヘルパー', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'fetch-resources-test-'));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  describe('sha256', () => {
    it('ファイル内容の SHA-256 を 16 進小文字で返す', async () => {
      const file = join(workDir, 'data.bin');
      const content = 'audiveris';
      await writeFile(file, content);
      const expected = createHash('sha256').update(content).digest('hex');
      expect(await sha256(file)).toBe(expected);
    });
  });

  describe('findDirContaining', () => {
    it('ネストした階層から目的ファイルを含むディレクトリ（app root）を返す', async () => {
      // workDir/Audiveris/Audiveris.exe を作り、app root = workDir/Audiveris を期待する
      const appRoot = join(workDir, 'Audiveris');
      await mkdir(join(appRoot, 'runtime', 'bin'), { recursive: true });
      await mkdir(join(appRoot, 'app'), { recursive: true });
      await writeFile(join(appRoot, 'Audiveris.exe'), 'stub');
      expect(await findDirContaining(workDir, 'Audiveris.exe')).toBe(appRoot);
    });

    it('目的ファイルが存在しなければ null を返す', async () => {
      await mkdir(join(workDir, 'empty'), { recursive: true });
      expect(await findDirContaining(workDir, 'Audiveris.exe')).toBeNull();
    });
  });
});
