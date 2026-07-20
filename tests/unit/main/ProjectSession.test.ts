import { strToU8 } from 'fflate';
import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectSession } from '../../../src/main/ProjectSession';
import type { OmrRunnerLike } from '../../../src/main/ProjectSession';
import { assembleArtifacts } from '../../../src/main/omr/omrArchive';
import { ProjectStore } from '../../../src/storage/ProjectStore';
import type { OmrProgress } from '../../../src/shared/types/OmrProgress';
import type { OmrRawArtifacts } from '../../../src/shared/types/OmrRawArtifacts';

/**
 * 編成レイヤーの単体テスト
 *
 * Audiveris は動かせないため、実フィクスチャの `.omr` / `.mxl` を返す擬似実行器を注入する。
 * 検証対象は**パイプラインを呼ぶ順序と、ユーザー判断の保持**であり、domain 各部品の
 * 正しさは domain 側の単体テストが担う
 */

const readFixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../../fixtures/victoria/${name}`, import.meta.url)));

const RAW: OmrRawArtifacts = {
  omr: readFixture('IMSLP19716.omr'),
  movements: [readFixture('IMSLP19716.mvt1.mxl'), readFixture('IMSLP19716.mvt2.mxl')],
};

/** 常に同じ成果物を返す擬似 OMR 実行器 */
class FakeRunner implements OmrRunnerLike {
  canceled = false;
  calls = 0;

  run(_pdfPath: string, onProgress: (progress: OmrProgress) => void) {
    this.calls += 1;
    onProgress({ phase: 'starting', sheet: null, totalSheets: null, message: '' });
    onProgress({ phase: 'completed', sheet: null, totalSheets: null, message: '' });
    return Promise.resolve({ artifacts: assembleArtifacts(RAW), raw: RAW });
  }

  cancel(): void {
    this.canceled = true;
  }
}

let directory: string;
let pdfPath: string;
let runner: FakeRunner;
let session: ProjectSession;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'solfa-session-'));
  pdfPath = join(directory, 'score.pdf');
  await writeFile(pdfPath, new Uint8Array([0x25, 0x50, 0x44, 0x46])); // "%PDF"
  runner = new FakeRunner();
  session = new ProjectSession({ runner });
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('ProjectSession', () => {
  describe('importPdf', () => {
    it('OMR から階名までを 1 度の呼び出しで通す', async () => {
      const snapshot = await session.importPdf(pdfPath, () => {});

      expect(runner.calls).toBe(1);
      expect(snapshot.project.score).not.toBeNull();
      expect(snapshot.project.keyRegions.length).toBeGreaterThan(0);
      const notes = snapshot.project.score?.measures.flatMap((m) => m.notes) ?? [];
      expect(notes.filter((note) => note.solfa !== null).length).toBeGreaterThan(0);
    });

    it('確認項目を生成し、未訂正の状態で返す', async () => {
      const snapshot = await session.importPdf(pdfPath, () => {});

      expect(snapshot.project.confirmation.items).toHaveLength(5);
      expect(snapshot.project.confirmation.items.every((item) => item.corrected === null)).toBe(
        true,
      );
      expect(snapshot.project.confirmation.completedAt).toBeNull();
    });

    it('進捗をそのまま呼び出し側へ流す', async () => {
      const progresses: OmrProgress[] = [];
      await session.importPdf(pdfPath, (progress) => progresses.push(progress));
      expect(progresses.map((p) => p.phase)).toEqual(['starting', 'completed']);
    });

    it('取り込み直後はまだファイルを持たない（OMR 失敗時に空ファイルを残さない設計）', async () => {
      await session.importPdf(pdfPath, () => {});
      expect(session.filePath).toBeNull();
    });
  });

  describe('確認と再解析', () => {
    it('音部記号を訂正すると照合し直され、訂正値が保持される', async () => {
      const before = await session.importPdf(pdfPath, () => {});
      const target = before.project.confirmation.items[0];
      expect(target).toBeDefined();

      const after = session.setClefCorrections(new Map([[target!.id, 'TREBLE']]));
      const corrected = after.project.confirmation.items.find((item) => item.id === target!.id);

      // 確認項目は再生成されるが、訂正値は id で引き継がれる
      expect(corrected?.corrected).toBe('TREBLE');
      expect(after.project.confirmation.items).toHaveLength(
        before.project.confirmation.items.length,
      );
    });

    it('訂正を取り消すと元の解析結果へ戻る', async () => {
      const before = await session.importPdf(pdfPath, () => {});
      const target = before.project.confirmation.items[0]!;

      session.setClefCorrections(new Map([[target.id, 'BASS']]));
      const reverted = session.setClefCorrections(new Map([[target.id, null]]));

      expect(reverted.project.score).toEqual(before.project.score);
    });

    it('旋法の指定が調文脈と階名へ反映される', async () => {
      const before = await session.importPdf(pdfPath, () => {});
      const first = before.project.keyRegions[0]!;
      expect(first.mode).toBe('major'); // Audiveris は mode を出さないため自動検出は必ず長調

      const after = session.setKeyRegionDecisions([
        { measureIndex: first.start.measureIndex, mode: 'minor' },
      ]);
      expect(after.project.keyRegions[0]?.mode).toBe('minor');
      expect(after.project.keyRegions[0]?.source).toBe('user');

      // La 基準では階名は変わらない。短調の主音を La と数える流儀では、平行調へ移しても
      // 度数の割り当てが平行長調と一致するため（これは欠陥ではなく移動ドの定義どおり）。
      // 旋法の指定が階名に効くのは Do 基準のとき（次のテスト）
      expect(after.project.score).toEqual(before.project.score);
    });

    it('短調基準の設定変更が階名へ反映される', async () => {
      const imported = await session.importPdf(pdfPath, () => {});
      const first = imported.project.keyRegions[0]!;
      const minor = session.setKeyRegionDecisions([
        { measureIndex: first.start.measureIndex, mode: 'minor' },
      ]);

      const withDo = session.setSettings({ ...minor.project.settings, minorBasis: 'do' });
      expect(withDo.project.score).not.toEqual(minor.project.score);
    });

    it('構造判断が確定構造へ渡る', async () => {
      const before = await session.importPdf(pdfPath, () => {});
      const after = session.setStructureDecisions([
        { kind: 'systemMeasureCount', pageIndex: 0, systemIndex: 0, measureCount: 1 },
      ]);

      expect(after.project.structureDecisions).toHaveLength(1);
      expect(after.project.score).not.toEqual(before.project.score);
    });

    it('承認すると completedAt が入り、解析結果は変わらない', async () => {
      const before = await session.importPdf(pdfPath, () => {});
      const after = session.completeConfirmation(new Date('2026-07-19T12:00:00Z'));

      expect(after.project.confirmation.completedAt).toBe('2026-07-19T12:00:00.000Z');
      expect(after.project.score).toEqual(before.project.score);
    });

    it('再解析しても確認項目の並びが変わらない（目視照合が破綻しない）', async () => {
      const before = await session.importPdf(pdfPath, () => {});
      const after = session.setStructureDecisions([]);

      expect(after.project.confirmation.items.map((item) => item.id)).toEqual(
        before.project.confirmation.items.map((item) => item.id),
      );
    });
  });

  describe('承認の無効化と未一致訂正の報告', () => {
    it('承認後に訂正すると承認が取り消される（未確認の内容を承認済みとして出力しない）', async () => {
      await session.importPdf(pdfPath, () => {});
      const target = session.completeConfirmation().project.confirmation.items[0]!;

      const after = session.setClefCorrections(new Map([[target.id, 'TREBLE']]));
      expect(after.project.confirmation.completedAt).toBeNull();
    });

    it.each([
      ['調の指定', () => session.setKeyRegionDecisions([{ measureIndex: 0, mode: 'minor' }])],
      ['構造の訂正', () => session.setStructureDecisions([])],
    ])('%s でも承認は取り消される', async (_name, mutate) => {
      await session.importPdf(pdfPath, () => {});
      session.completeConfirmation();
      expect(mutate().project.confirmation.completedAt).toBeNull();
    });

    it('設定の変更では承認を取り消さない（何を確認したかは変わらないため）', async () => {
      const imported = await session.importPdf(pdfPath, () => {});
      session.completeConfirmation();

      const after = session.setSettings({ ...imported.project.settings, minorBasis: 'do' });
      expect(after.project.confirmation.completedAt).not.toBeNull();
    });

    it('存在しない確認項目への訂正を報告する（無言で取りこぼさない）', async () => {
      await session.importPdf(pdfPath, () => {});
      const after = session.setClefCorrections(new Map([['clef-P99-ALTO', 'TREBLE']]));

      expect(after.unmatchedCorrections).toEqual([{ kind: 'clef', itemId: 'clef-P99-ALTO' }]);
    });

    it('存在しない段への構造訂正を報告する', async () => {
      await session.importPdf(pdfPath, () => {});
      const after = session.setStructureDecisions([
        { kind: 'systemMeasureCount', pageIndex: 99, systemIndex: 0, measureCount: 4 },
      ]);

      expect(after.unmatchedCorrections).toEqual([
        { kind: 'structure', pageIndex: 99, systemIndex: 0 },
      ]);
    });

    it('適用できた訂正は報告に含めない', async () => {
      const before = await session.importPdf(pdfPath, () => {});
      const target = before.project.confirmation.items[0]!;

      expect(
        session.setClefCorrections(new Map([[target.id, 'TREBLE']])).unmatchedCorrections,
      ).toEqual([]);
    });
  });

  describe('自動保存', () => {
    /** 予約された自動保存が走るまで待つ（実時間に依存させず、条件が満たされるまで粘る） */
    async function waitUntil(condition: () => Promise<boolean>): Promise<boolean> {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (await condition()) {
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return false;
    }

    /** 自動保存が起きないことの確認用。デバウンス時間より十分長く待つ */
    const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

    it('保存先が決まっていれば訂正のたびに自動保存する', async () => {
      const auto = new ProjectSession({ runner: new FakeRunner(), autoSaveDelayMs: 5 });
      await auto.importPdf(pdfPath, () => {});
      const path = join(directory, 'song.solfaproj');
      await auto.save(path);

      auto.setKeyRegionDecisions([{ measureIndex: 0, mode: 'minor' }]);

      const reopened = new ProjectSession({ runner: new FakeRunner() });
      const saved = await waitUntil(async () => {
        const { project } = await reopened.open(path);
        return project.keyRegionDecisions.length === 1;
      });
      expect(saved).toBe(true);
    });

    it('保存先が未確定なら自動保存しない（どこへ書けばよいか決まっていない）', async () => {
      const auto = new ProjectSession({ runner: new FakeRunner(), autoSaveDelayMs: 5 });
      await auto.importPdf(pdfPath, () => {});

      auto.setKeyRegionDecisions([{ measureIndex: 0, mode: 'minor' }]);
      await settle();

      expect(auto.filePath).toBeNull();
      expect(await readdir(directory)).toEqual(['score.pdf']);
    });

    it('ファイルを開いただけでは保存しない（バックアップ世代を無駄に消費しない）', async () => {
      const auto = new ProjectSession({ runner: new FakeRunner(), autoSaveDelayMs: 5 });
      await auto.importPdf(pdfPath, () => {});
      const path = join(directory, 'song.solfaproj');
      await auto.save(path);

      const reopened = new ProjectSession({ runner: new FakeRunner(), autoSaveDelayMs: 5 });
      await reopened.open(path);
      await settle();

      expect((await readdir(directory)).sort()).toEqual(['score.pdf', 'song.solfaproj']);
    });

    it('flushPendingSave で予約分を取りこぼさず書き切る', async () => {
      const auto = new ProjectSession({ runner: new FakeRunner(), autoSaveDelayMs: 10_000 });
      await auto.importPdf(pdfPath, () => {});
      const path = join(directory, 'song.solfaproj');
      await auto.save(path);

      auto.setKeyRegionDecisions([{ measureIndex: 0, mode: 'minor' }]);
      await auto.flushPendingSave();

      const reopened = new ProjectSession({ runner: new FakeRunner() });
      expect((await reopened.open(path)).project.keyRegionDecisions).toHaveLength(1);
    });
  });

  describe('失敗しても状態を壊さない', () => {
    it('壊れたプロジェクトを開こうとしても、開いていたプロジェクトが保たれる', async () => {
      const first = await session.importPdf(pdfPath, () => {});
      const path = join(directory, 'song.solfaproj');
      await session.save(path);

      // book.xml を欠いた .omr を同梱したファイルを作る（open の途中で throw する）
      const brokenPath = join(directory, 'broken.solfaproj');
      const broken = new ProjectStore();
      await broken.save(brokenPath, broken.create(), new Uint8Array([1, 2]), {
        omr: strToU8('not a real omr'),
        movements: RAW.movements,
      });

      await expect(session.open(brokenPath)).rejects.toThrow();

      // 元のプロジェクトのまま。ここで PDF だけ差し替わっていると、
      // 次の保存で song.solfaproj へ別プロジェクトの PDF を書き込んでしまう
      expect(session.filePath).toBe(path);
      const saved = await session.save();
      expect(saved.id).toBe(first.project.id);

      // 同梱された元PDF が差し替わっていないこと（"%PDF" の 4 バイトのまま）
      const archive = await new ProjectStore().load(path);
      expect(archive.project.id).toBe(first.project.id);
      expect(archive.sourcePdf).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    });

    it('承認しても検出済みの問題は消えない（「問題なし」と偽らない）', async () => {
      const analyzed = await session.importPdf(pdfPath, () => {});
      const approved = session.completeConfirmation();

      expect(approved.structureIssues).toEqual(analyzed.structureIssues);
      expect(approved.buildIssues).toEqual(analyzed.buildIssues);
      expect(approved.keyRegionIssues).toEqual(analyzed.keyRegionIssues);
    });

    it('未一致の報告は次の操作へ持ち越さない', async () => {
      await session.importPdf(pdfPath, () => {});
      expect(
        session.setClefCorrections(new Map([['clef-P99-ALTO', 'TREBLE']])).unmatchedCorrections,
      ).toHaveLength(1);
      expect(session.completeConfirmation().unmatchedCorrections).toHaveLength(1);
      // 新しい操作が成功したら報告は空に戻る
      expect(session.setKeyRegionDecisions([]).unmatchedCorrections).toEqual([]);
    });
  });

  describe('保存の直列化', () => {
    it('保存が重なっても世代バックアップが壊れない', async () => {
      await session.importPdf(pdfPath, () => {});
      const path = join(directory, 'song.solfaproj');
      await session.save(path);

      // 3 本の保存を同時に投げる。直列化されていなければローテーションが
      // 二重に走り、世代が重複したり最古世代が余計に消えたりする
      await Promise.all([session.save(), session.save(), session.save()]);

      expect((await readdir(directory)).sort()).toEqual([
        'score.pdf',
        'song.solfaproj',
        'song.solfaproj.bak1',
        'song.solfaproj.bak2',
        'song.solfaproj.bak3',
      ]);
      // 本体が読める＝最後の rename が壊れていない
      await expect(new ProjectStore().load(path)).resolves.toBeDefined();
    });

    it('保存中に入った訂正を巻き戻さない', async () => {
      await session.importPdf(pdfPath, () => {});
      const path = join(directory, 'song.solfaproj');
      await session.save(path);

      const saving = session.save();
      session.setKeyRegionDecisions([{ measureIndex: 0, mode: 'minor' }]);
      await saving;

      expect(session.completeConfirmation().project.keyRegionDecisions).toEqual([
        { measureIndex: 0, mode: 'minor' },
      ]);
    });
  });

  describe('保存と再開', () => {
    it('保存して開き直すと判断が復元される', async () => {
      await session.importPdf(pdfPath, () => {});
      const target = session.completeConfirmation().project.confirmation.items[0]!;
      session.setClefCorrections(new Map([[target.id, 'TREBLE']]));
      session.setKeyRegionDecisions([{ measureIndex: 0, mode: 'minor' }]);
      session.completeConfirmation(); // 訂正で承認は無効化されるため、改めて承認する

      const path = join(directory, 'song.solfaproj');
      await session.save(path);

      const reopened = new ProjectSession({ runner: new FakeRunner() });
      const snapshot = await reopened.open(path);

      expect(snapshot.project.keyRegionDecisions).toEqual([{ measureIndex: 0, mode: 'minor' }]);
      expect(
        snapshot.project.confirmation.items.find((item) => item.id === target.id)?.corrected,
      ).toBe('TREBLE');
      expect(snapshot.project.confirmation.completedAt).not.toBeNull();
    });

    it('開き直しても OMR は再実行されない（中間データを同梱しているため）', async () => {
      await session.importPdf(pdfPath, () => {});
      const path = join(directory, 'song.solfaproj');
      await session.save(path);

      const reopenRunner = new FakeRunner();
      await new ProjectSession({ runner: reopenRunner }).open(path);
      expect(reopenRunner.calls).toBe(0);
    });

    it('保存後はパスを覚え、引数なしで上書き保存できる', async () => {
      await session.importPdf(pdfPath, () => {});
      const path = join(directory, 'song.solfaproj');
      await session.save(path);
      expect(session.filePath).toBe(path);

      await expect(session.save()).resolves.toBeDefined();
    });

    it('保存先を一度も指定していなければ引数なしの保存を拒否する', async () => {
      await session.importPdf(pdfPath, () => {});
      await expect(session.save()).rejects.toThrow(/保存先/);
    });
  });

  describe('未オープン時の操作', () => {
    it.each([
      ['save', () => session.save('/tmp/x.solfaproj')],
      ['setStructureDecisions', () => session.setStructureDecisions([])],
      ['setClefCorrections', () => session.setClefCorrections(new Map())],
      ['setKeyRegionDecisions', () => session.setKeyRegionDecisions([])],
      ['completeConfirmation', () => session.completeConfirmation()],
    ])('%s はプロジェクト未オープンを明示的に拒否する', async (_name, run) => {
      // 同期で throw する操作と Promise を返す操作が混在するため、両方を同じ形で受ける
      await expect((async () => run())()).rejects.toThrow(/開かれていません/);
    });
  });

  describe('キャンセル', () => {
    it('実行器へキャンセルを委譲する', () => {
      session.cancelOmr();
      expect(runner.canceled).toBe(true);
    });

    it('OMR が失敗した場合はプロジェクトを開かない（壊れた状態を残さない）', async () => {
      const failing: OmrRunnerLike = {
        run: () => Promise.reject(new Error('OMR がキャンセルされました')),
        cancel: vi.fn(),
      };
      const failed = new ProjectSession({ runner: failing });

      await expect(failed.importPdf(pdfPath, () => {})).rejects.toThrow(/キャンセル/);
      expect(() => failed.completeConfirmation()).toThrow(/開かれていません/);
    });
  });
});
