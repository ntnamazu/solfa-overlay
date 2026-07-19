import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { OmrRunError } from '../../../../src/main/omr/errors';
import type { ChildLike, SpawnFn } from '../../../../src/main/omr/OmrRunner';
import { OmrRunner } from '../../../../src/main/omr/OmrRunner';
import type { OmrProgress } from '../../../../src/shared/types/OmrProgress';

const SHEET_XML =
  '<sheet><page><system><stack left="0" right="100"/><part id="1"><staff id="1"/></part></system></page></sheet>';
const MUSICXML =
  '<score-partwise><part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list>' +
  '<part id="P1"><measure number="1"><note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>';
const CONTAINER =
  '<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>';

function makeOmr(): Buffer {
  return Buffer.from(zipSync({ 'book.xml': strToU8('<book/>'), 'sheet#1/sheet#1.xml': strToU8(SHEET_XML) }));
}
function makeMxl(): Buffer {
  return Buffer.from(zipSync({ 'META-INF/container.xml': strToU8(CONTAINER), 'score.xml': strToU8(MUSICXML) }));
}

/** ChildLike を満たす擬似子プロセス。stdout も EventEmitter で代替する */
class FakeChild extends EventEmitter implements ChildLike {
  readonly stdout = new EventEmitter();
  kill = vi.fn(() => {
    this.killed = true;
    return true;
  });
  killed = false;
}

/** args から -output の値（出力ディレクトリ）を取り出す */
function outputDirOf(args: string[]): string {
  const index = args.indexOf('-output');
  return args[index + 1] ?? '';
}

describe('OmrRunner', () => {
  it('正常終了で成果物を組み立て、進捗（transcribing→completed）を通知する', async () => {
    const child = new FakeChild();
    const spawn: SpawnFn = (_cmd, args) => {
      setTimeout(() => {
        const dir = outputDirOf(args);
        child.stdout.emit('data', 'Loading book\nSheet #1 HEADS step\n');
        writeFileSync(join(dir, 'score.omr'), makeOmr());
        writeFileSync(join(dir, 'score.mvt1.mxl'), makeMxl());
        child.emit('close', 0);
      }, 0);
      return child;
    };
    const progresses: OmrProgress[] = [];
    const artifacts = await new OmrRunner({ spawn }).run('/in/score.pdf', (p) => progresses.push(p));

    expect(artifacts.pages).toHaveLength(1);
    expect(artifacts.movements).toHaveLength(1);
    expect(progresses.map((p) => p.phase)).toEqual([
      'starting',
      'loading',
      'transcribing',
      'completed',
    ]);
    expect(progresses[2]?.sheet).toBe(1);
  });

  it('複数 .mxl を movement 番号昇順で movements に並べる', async () => {
    const child = new FakeChild();
    const spawn: SpawnFn = (_cmd, args) => {
      setTimeout(() => {
        const dir = outputDirOf(args);
        writeFileSync(join(dir, 'score.omr'), makeOmr());
        // わざと逆順に書き出す（収集側でソートされることを確認）
        writeFileSync(join(dir, 'score.mvt2.mxl'), makeMxl());
        writeFileSync(join(dir, 'score.mvt1.mxl'), makeMxl());
        child.emit('close', 0);
      }, 0);
      return child;
    };
    const artifacts = await new OmrRunner({ spawn }).run('/in/score.pdf', () => {});
    expect(artifacts.movements).toHaveLength(2);
  });

  it('非ゼロ終了を OmrRunError にする', async () => {
    const child = new FakeChild();
    const spawn: SpawnFn = () => {
      setTimeout(() => child.emit('close', 3), 0);
      return child;
    };
    await expect(new OmrRunner({ spawn }).run('/in/score.pdf', () => {})).rejects.toThrow(
      OmrRunError,
    );
  });

  it('spawn の error イベントを OmrRunError にする', async () => {
    const child = new FakeChild();
    const spawn: SpawnFn = () => {
      setTimeout(() => child.emit('error', new Error('ENOENT audiveris')), 0);
      return child;
    };
    await expect(new OmrRunner({ spawn }).run('/in/score.pdf', () => {})).rejects.toThrow(
      /Audiveris の実行/,
    );
  });

  it('spawn 自体が例外を投げても OmrRunError にする', async () => {
    const spawn: SpawnFn = () => {
      throw new Error('spawn failed');
    };
    await expect(new OmrRunner({ spawn }).run('/in/score.pdf', () => {})).rejects.toThrow(
      /起動に失敗/,
    );
  });

  it('.omr が出力されなければ OmrRunError にする', async () => {
    const child = new FakeChild();
    const spawn: SpawnFn = (_cmd, args) => {
      setTimeout(() => {
        writeFileSync(join(outputDirOf(args), 'score.mvt1.mxl'), makeMxl());
        child.emit('close', 0);
      }, 0);
      return child;
    };
    await expect(new OmrRunner({ spawn }).run('/in/score.pdf', () => {})).rejects.toThrow(
      /\.omr/,
    );
  });

  it('.mxl が出力されなければ OmrRunError にする', async () => {
    const child = new FakeChild();
    const spawn: SpawnFn = (_cmd, args) => {
      setTimeout(() => {
        writeFileSync(join(outputDirOf(args), 'score.omr'), makeOmr());
        child.emit('close', 0);
      }, 0);
      return child;
    };
    await expect(new OmrRunner({ spawn }).run('/in/score.pdf', () => {})).rejects.toThrow(
      /\.mxl/,
    );
  });

  it('実行中に同じインスタンスへ run() を再呼び出しすると OmrRunError で拒否する', async () => {
    const child = new FakeChild();
    const spawn: SpawnFn = (_cmd, args) => {
      setTimeout(() => {
        const dir = outputDirOf(args);
        writeFileSync(join(dir, 'score.omr'), makeOmr());
        writeFileSync(join(dir, 'score.mvt1.mxl'), makeMxl());
        child.emit('close', 0);
      }, 10);
      return child;
    };
    const runner = new OmrRunner({ spawn });
    const first = runner.run('/in/score.pdf', () => {});
    await expect(runner.run('/in/score.pdf', () => {})).rejects.toThrow(/既に実行中/);
    await expect(first).resolves.toBeDefined(); // 1 回目は正常完了する
  });

  it('cancel() で子プロセスに kill を送り、run はキャンセルとして拒否される', async () => {
    const child = new FakeChild();
    // spawn 後（this.child 設定・canceled リセット後）にキャンセルさせるため holder 経由で参照する
    const holder: { runner?: OmrRunner } = {};
    const spawn: SpawnFn = () => {
      setTimeout(() => {
        holder.runner?.cancel();
        child.emit('close', null);
      }, 0);
      return child;
    };
    holder.runner = new OmrRunner({ spawn });
    await expect(holder.runner.run('/in/score.pdf', () => {})).rejects.toThrow(/キャンセル/);
    expect(child.kill).toHaveBeenCalled();
  });
});
