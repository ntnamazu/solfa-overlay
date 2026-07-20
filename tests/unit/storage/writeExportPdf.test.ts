import { strToU8 } from 'fflate';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectFileError } from '../../../src/storage/errors';
import { writeExportPdf } from '../../../src/storage/writeExportPdf';

const PDF_BYTES = strToU8('%PDF-1.7 fake');

let directory: string;
let outPath: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'solfa-export-'));
  outPath = join(directory, 'score-solfa.pdf');
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('writeExportPdf', () => {
  it('指定パスへバイト列をそのまま書き出す', async () => {
    await writeExportPdf(outPath, PDF_BYTES);

    expect(new Uint8Array(await readFile(outPath))).toEqual(PDF_BYTES);
  });

  it('一時ファイルを残さない', async () => {
    await writeExportPdf(outPath, PDF_BYTES);

    expect(await readdir(directory)).toEqual(['score-solfa.pdf']);
  });

  it('既存ファイルを置き換える', async () => {
    await writeFile(outPath, strToU8('old contents'));
    await writeExportPdf(outPath, PDF_BYTES);

    expect(new Uint8Array(await readFile(outPath))).toEqual(PDF_BYTES);
  });

  it('書き込めない場所なら ProjectFileError(io) にする', async () => {
    const missing = join(directory, 'no-such-dir', 'out.pdf');

    await expect(writeExportPdf(missing, PDF_BYTES)).rejects.toThrow(ProjectFileError);
    await expect(writeExportPdf(missing, PDF_BYTES)).rejects.toMatchObject({ reason: 'io' });
  });

  it('リネームに失敗したら一時ファイルを消して ProjectFileError(io) にする', async () => {
    const failing = {
      rename: () => Promise.reject(new Error('rename failed')),
    };

    await expect(writeExportPdf(outPath, PDF_BYTES, { fileOps: failing })).rejects.toMatchObject({
      reason: 'io',
    });
    // 書きかけの一時ファイルが残っていない
    expect(await readdir(directory)).toEqual([]);
  });

  it('リネームに失敗しても既存の出力ファイルを壊さない', async () => {
    const previous = strToU8('previous export');
    await writeFile(outPath, previous);
    const failing = { rename: () => Promise.reject(new Error('rename failed')) };

    await expect(writeExportPdf(outPath, PDF_BYTES, { fileOps: failing })).rejects.toThrow();
    expect(new Uint8Array(await readFile(outPath))).toEqual(previous);
    expect(await readdir(directory)).toEqual(['score-solfa.pdf']);
  });
});
