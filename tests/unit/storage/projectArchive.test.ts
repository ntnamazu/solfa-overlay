import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { Project } from '../../../src/shared/types/Project';
import { ProjectStore } from '../../../src/storage/ProjectStore';
import { ProjectFileError } from '../../../src/storage/errors';
import { packProject, unpackProject } from '../../../src/storage/projectArchive';
import { unzipEntries, zipEntries } from '../../../src/storage/zipArchive';

const project = (): Project => new ProjectStore().create();
const bytes = (text: string) => strToU8(text);

/** 正常な `.solfaproj` の中身を組み立てる（movement 数は Victoria 相当の 2 を既定にする） */
const archive = (movements = ['mxl-0', 'mxl-1']) => ({
  project: project(),
  sourcePdf: bytes('pdf'),
  omr: { omr: bytes('omr'), movements: movements.map(bytes) },
});

/** ProjectFileError の reason を取り出す */
function reasonOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof ProjectFileError) {
      return error.reason;
    }
    throw error;
  }
  throw new Error('例外が投げられなかった');
}

describe('projectArchive', () => {
  it('pack した内容を unpack で復元できる', async () => {
    const source = archive();
    const restored = unpackProject(await packProject(source));

    expect(restored.project).toEqual(source.project);
    expect(restored.sourcePdf).toEqual(source.sourcePdf);
    expect(restored.omr.omr).toEqual(source.omr.omr);
    expect(restored.omr.movements).toEqual(source.omr.movements);
  });

  it('機能設計書どおりのエントリ名で書き出す', async () => {
    const entries = unzipEntries(await packProject(archive()));
    expect([...entries.keys()].sort()).toEqual([
      'omr/score.2.mxl',
      'omr/score.mxl',
      'omr/score.omr',
      'project.json',
      'source.pdf',
    ]);
  });

  it('movement が 1 つだけなら添字なしのエントリのみになる', async () => {
    const entries = unzipEntries(await packProject(archive(['only'])));
    expect(entries.has('omr/score.mxl')).toBe(true);
    expect(entries.has('omr/score.2.mxl')).toBe(false);
  });

  it('movement を 3 つ以上でも順序どおり往復する', async () => {
    const source = archive(['a', 'b', 'c', 'd']);
    expect(unpackProject(await packProject(source)).omr.movements).toEqual(source.omr.movements);
  });

  it('project.json は人が読める整形済み JSON で入る（差分確認・障害調査のため）', async () => {
    const entries = unzipEntries(await packProject(archive()));
    const json = new TextDecoder().decode(entries.get('project.json'));
    expect(json).toContain('\n  "id"');
  });

  describe('壊れた入力', () => {
    it('zip でないバイト列は zip エラー', async () => {
      expect(reasonOf(() => unpackProject(bytes('not a zip')))).toBe('zip');
    });

    it('project.json がなければ zip エラー', async () => {
      const entries = unzipEntries(await packProject(archive()));
      entries.delete('project.json');
      expect(reasonOf(() => unpackProject(zipEntries(entries)))).toBe('zip');
    });

    it('source.pdf がなければ zip エラー', async () => {
      const entries = unzipEntries(await packProject(archive()));
      entries.delete('source.pdf');
      expect(reasonOf(() => unpackProject(zipEntries(entries)))).toBe('zip');
    });

    it('MusicXML が 1 つもなければ zip エラー', async () => {
      const entries = unzipEntries(await packProject(archive()));
      entries.delete('omr/score.mxl');
      entries.delete('omr/score.2.mxl');
      expect(reasonOf(() => unpackProject(zipEntries(entries)))).toBe('zip');
    });

    it('movement が歯抜けなら詰めずに打ち切る（楽章の対応がずれないこと）', async () => {
      const entries = unzipEntries(await packProject(archive(['a', 'b', 'c'])));
      entries.delete('omr/score.2.mxl'); // movement 1 を欠落させる
      // 詰めてしまうと movement 2 が musicXmlIndex 1 として扱われ、別の楽章を指す
      expect(unpackProject(zipEntries(entries)).omr.movements).toEqual([bytes('a')]);
    });

    it('project.json が JSON として壊れていれば schema エラー', async () => {
      const entries = unzipEntries(await packProject(archive()));
      entries.set('project.json', bytes('{ broken'));
      expect(reasonOf(() => unpackProject(zipEntries(entries)))).toBe('schema');
    });

    it('project.json の構造が不正なら schema エラー', async () => {
      const entries = unzipEntries(await packProject(archive()));
      entries.set('project.json', bytes('{"schemaVersion":1}'));
      expect(reasonOf(() => unpackProject(zipEntries(entries)))).toBe('schema');
    });

    it('新しい版数のファイルは version エラー（内容を書き換えず更新を案内するため）', async () => {
      const entries = unzipEntries(await packProject(archive()));
      const parsed = JSON.parse(new TextDecoder().decode(entries.get('project.json')));
      entries.set('project.json', bytes(JSON.stringify({ ...parsed, schemaVersion: 99 })));
      expect(reasonOf(() => unpackProject(zipEntries(entries)))).toBe('version');
    });
  });

  describe('パストラバーサル', () => {
    it.each([
      ['../../etc/passwd', '親ディレクトリ参照'],
      ['omr/../../escape.mxl', '途中に現れる親ディレクトリ参照'],
      ['/etc/passwd', 'POSIX 絶対パス'],
      ['C:\\Windows\\system32', 'Windows 絶対パス'],
      ['..\\..\\escape', 'Windows 区切りの親ディレクトリ参照'],
    ])('%s を含むアーカイブは zip エラーで拒否する（%s）', async (name) => {
      // 検証を迂回して危険なエントリを持つ zip を作る（悪意ある入力の再現）
      const entries = unzipEntries(await packProject(archive()));
      const raw = new Map(entries);
      raw.set(name, bytes('payload'));
      const malicious = zipEntriesUnchecked(raw);
      expect(reasonOf(() => unpackProject(malicious))).toBe('zip');
    });

    it('書き出し側でも危険なエントリ名を拒否する', async () => {
      expect(() => zipEntries(new Map([['../escape', bytes('x')]]))).toThrow(/パストラバーサル/);
    });

    it('通常のサブディレクトリ名は拒否しない', async () => {
      expect(() => zipEntries(new Map([['omr/score.mxl', bytes('x')]]))).not.toThrow();
    });
  });
});

/** `zipEntries` の名前検証を通さずに zip を作る（攻撃者が作った zip の再現用） */
function zipEntriesUnchecked(entries: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const raw: Record<string, Uint8Array> = {};
  for (const [name, data] of entries) {
    raw[name] = data;
  }
  return zipSync(raw);
}
