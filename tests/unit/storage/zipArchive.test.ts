import { strToU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { isSafeEntryName, ZipError, zipEntriesAsync } from '../../../src/storage/zipArchive';

/**
 * zip の書き出し経路の性質を固定する
 *
 * 展開・パストラバーサル拒否の網羅は `projectArchive.test.ts` が実データ相当の
 * アーカイブで行うため、ここは**非同期性と圧縮レベル**に絞る
 */

const entriesOf = (map: Record<string, Uint8Array>) => new Map(Object.entries(map));

describe('zipEntriesAsync', () => {
  it('往復できる', async () => {
    const source = entriesOf({ 'project.json': strToU8('{"a":1}'), 'source.pdf': strToU8('pdf') });
    const restored = unzipSync(await zipEntriesAsync(source));

    expect(restored['project.json']).toEqual(strToU8('{"a":1}'));
    expect(restored['source.pdf']).toEqual(strToU8('pdf'));
  });

  it('圧縮を同期でブロックしない（Main プロセスで自動保存するため）', async () => {
    // 圧縮が同期なら、この Promise を作った直後の同期コードより先に完了してしまう。
    // マイクロタスクを 1 つ挟めるかどうかで「呼び出しから制御が返っているか」を見る
    const pending = zipEntriesAsync(entriesOf({ 'a.bin': new Uint8Array(1_000_000) }));
    let yielded = false;
    void Promise.resolve().then(() => {
      yielded = true;
    });
    await pending;
    expect(yielded).toBe(true);
  });

  it('圧縮済みのエントリは再圧縮しない（保存のたびに数十MBを deflate し直さない）', async () => {
    // 乱数列は deflate で縮まないため、無圧縮なら元サイズがほぼそのまま残る。
    // 逆に圧縮を掛けると走査コストだけ払って結果は同等以上のサイズになる
    const random = new Uint8Array(200_000).map(() => Math.floor(Math.random() * 256));
    const stored = await zipEntriesAsync(entriesOf({ 'omr/score.omr': random }));
    const deflated = await zipEntriesAsync(entriesOf({ 'notes.txt': random }));

    expect(unzipSync(stored)['omr/score.omr']).toEqual(random);
    // 無圧縮側は deflate のブロックヘッダ分だけ小さい（＝圧縮を掛けていない証拠）
    expect(stored.length).toBeLessThan(deflated.length);
  });

  it('テキストのエントリは圧縮する（project.json を無駄に膨らませない）', async () => {
    const repetitive = strToU8('{"measureIndex":0}'.repeat(5_000));
    const zipped = await zipEntriesAsync(entriesOf({ 'project.json': repetitive }));

    expect(zipped.length).toBeLessThan(repetitive.length / 10);
    expect(unzipSync(zipped)['project.json']).toEqual(repetitive);
  });

  it('危険なエントリ名は非同期版でも拒否する', async () => {
    await expect(zipEntriesAsync(entriesOf({ '../escape': strToU8('x') }))).rejects.toThrow(
      ZipError,
    );
  });
});

describe('isSafeEntryName', () => {
  it.each(['../etc/passwd', 'omr/../../escape', '/etc/passwd', 'C:\\Windows', '..\\escape'])(
    '%s を拒否する',
    (name) => {
      expect(isSafeEntryName(name)).toBe(false);
    },
  );

  it.each(['project.json', 'omr/score.mxl', 'a..b/c'])('%s は許可する', (name) => {
    expect(isSafeEntryName(name)).toBe(true);
  });
});
