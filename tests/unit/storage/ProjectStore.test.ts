import { strToU8 } from 'fflate';
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectStore } from '../../../src/storage/ProjectStore';
import { ProjectFileError } from '../../../src/storage/errors';

const bytes = (text: string) => strToU8(text);
const SOURCE_PDF = bytes('pdf');
const OMR = { omr: bytes('omr'), movements: [bytes('mxl-0'), bytes('mxl-1')] };

let directory: string;
let projectPath: string;
let store: ProjectStore;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'solfa-store-'));
  projectPath = join(directory, 'song.solfaproj');
  store = new ProjectStore();
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

/** ProjectFileError の reason を取り出す */
async function reasonOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ProjectFileError) {
      return error.reason;
    }
    throw error;
  }
  throw new Error('例外が投げられなかった');
}

describe('ProjectStore', () => {
  describe('create', () => {
    it('元PDFは固定の相対パスで持つ（他環境へ持ち出しても壊れない）', () => {
      expect(store.create().sourcePdf).toBe('source.pdf');
    });

    it('空の解析結果と既定設定を持つ', () => {
      const project = store.create();
      expect(project.score).toBeNull();
      expect(project.confirmation).toEqual({ items: [], completedAt: null });
      expect(project.settings.syllableSystem).toBe('kodaly');
    });

    it('プロジェクトごとに異なる id を振る', () => {
      expect(store.create().id).not.toBe(store.create().id);
    });
  });

  describe('save / load', () => {
    it('保存した内容をそのまま読み戻せる', async () => {
      const saved = await store.save(projectPath, store.create(), SOURCE_PDF, OMR);
      const loaded = await store.load(projectPath);

      expect(loaded.project).toEqual(saved);
      expect(loaded.sourcePdf).toEqual(SOURCE_PDF);
      expect(loaded.omr.movements).toEqual(OMR.movements);
    });

    it('保存時に updatedAt を更新し、戻り値で返す（呼び出し側の状態と一致させる）', async () => {
      const project = { ...store.create(), updatedAt: '2000-01-01T00:00:00.000Z' };
      const saved = await store.save(projectPath, project, SOURCE_PDF, OMR);

      expect(saved.updatedAt).not.toBe(project.updatedAt);
      expect(saved.createdAt).toBe(project.createdAt);
      expect((await store.load(projectPath)).project.updatedAt).toBe(saved.updatedAt);
    });

    it('確認結果や判断を含めて往復する（永続化の目的そのもの）', async () => {
      const project = {
        ...store.create(),
        keyRegionDecisions: [{ measureIndex: 0, mode: 'minor' as const }],
        structureDecisions: [
          { kind: 'systemMeasureCount' as const, pageIndex: 0, systemIndex: 1, measureCount: 4 },
        ],
      };
      await store.save(projectPath, project, SOURCE_PDF, OMR);
      const loaded = await store.load(projectPath);

      expect(loaded.project.keyRegionDecisions).toEqual(project.keyRegionDecisions);
      expect(loaded.project.structureDecisions).toEqual(project.structureDecisions);
    });

    it('保存後に一時ファイルを残さない', async () => {
      await store.save(projectPath, store.create(), SOURCE_PDF, OMR);
      expect(await readdir(directory)).toEqual(['song.solfaproj']);
    });
  });

  describe('世代バックアップ', () => {
    it('初回保存ではバックアップを作らない', async () => {
      await store.save(projectPath, store.create(), SOURCE_PDF, OMR);
      expect(await readdir(directory)).toEqual(['song.solfaproj']);
    });

    it('保存を重ねると直前版が bak1 へ落ち、3世代を超えない', async () => {
      for (let round = 0; round < 5; round += 1) {
        await store.save(projectPath, store.create(), SOURCE_PDF, OMR);
      }
      expect((await readdir(directory)).sort()).toEqual([
        'song.solfaproj',
        'song.solfaproj.bak1',
        'song.solfaproj.bak2',
        'song.solfaproj.bak3',
      ]);
    });

    it('各世代は異なる保存時点の内容を保持する（世代が潰れないこと）', async () => {
      const ids: string[] = [];
      for (let round = 0; round < 4; round += 1) {
        const project = store.create();
        ids.push(project.id);
        await store.save(projectPath, project, SOURCE_PDF, OMR);
      }
      // ids = [最古, …, 最新]。bak1 が 1 つ前、bak3 が 3 つ前を指す
      const idAt = async (path: string) => (await store.load(path)).project.id;
      expect(await idAt(projectPath)).toBe(ids[3]);
      expect(await idAt(`${projectPath}.bak1`)).toBe(ids[2]);
      expect(await idAt(`${projectPath}.bak2`)).toBe(ids[1]);
      expect(await idAt(`${projectPath}.bak3`)).toBe(ids[0]);
    });
  });

  describe('エラー分類', () => {
    it('存在しないファイルの読込は io', async () => {
      expect(await reasonOf(() => store.load(join(directory, 'missing.solfaproj')))).toBe('io');
    });

    it('書き込めない場所への保存は io', async () => {
      const path = join(directory, 'no-such-dir', 'song.solfaproj');
      expect(await reasonOf(() => store.save(path, store.create(), SOURCE_PDF, OMR))).toBe('io');
    });

    it('保存に失敗しても一時ファイルを残さない', async () => {
      // 最古世代の位置をディレクトリで塞ぐと、一時ファイルの書き込みが済んだあとの
      // ローテーションで失敗する。後始末の経路（catch 節）を通すための状況設定
      await mkdir(`${projectPath}.bak3`);

      await expect(store.save(projectPath, store.create(), SOURCE_PDF, OMR)).rejects.toThrow(
        ProjectFileError,
      );
      const leftovers = (await readdir(directory)).filter((name) => name.includes('.tmp-'));
      expect(leftovers).toEqual([]);
    });

    it('退避後に最終リネームが失敗しても本体を復旧する（保存に失敗してファイルが消えない）', async () => {
      const first = await store.save(projectPath, store.create(), SOURCE_PDF, OMR);

      // 一時ファイル → 本体 の最終リネームだけを失敗させる。
      // ここで失敗すると直前版は既に bak1 へ動いており、本体の位置が空になる
      const failing = new ProjectStore({
        fileOps: {
          rename: (from, to) => {
            if (to === projectPath && from.includes('.tmp-')) {
              return Promise.reject(new Error('ENOSPC'));
            }
            return rename(from, to);
          },
        },
      });

      await expect(failing.save(projectPath, store.create(), SOURCE_PDF, OMR)).rejects.toThrow(
        ProjectFileError,
      );

      // 直前版が本体の位置へ戻っていること（bak1 からの手動復旧を強いない）
      expect((await store.load(projectPath)).project.id).toBe(first.id);
      expect((await readdir(directory)).filter((name) => name.includes('.tmp-'))).toEqual([]);
    });

    it('壊れたファイルの読込は zip（io に丸めない）', async () => {
      await writeFile(projectPath, bytes('not a zip'));
      expect(await reasonOf(() => store.load(projectPath))).toBe('zip');
    });

    it('元PDFが読めなければ io', async () => {
      expect(await reasonOf(() => store.readSourcePdf(join(directory, 'missing.pdf')))).toBe('io');
    });

    it('元PDFを読み込める', async () => {
      const path = join(directory, 'source.pdf');
      await writeFile(path, SOURCE_PDF);
      expect(await store.readSourcePdf(path)).toEqual(SOURCE_PDF);
    });
  });
});
