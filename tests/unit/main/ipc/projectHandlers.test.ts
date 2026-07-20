import { describe, expect, it, vi } from 'vitest';
import type { ProjectSession } from '../../../../src/main/ProjectSession';
import { createProjectHandlers, toIpcError } from '../../../../src/main/ipc/projectHandlers';
import { ConfirmationRequiredError } from '../../../../src/main/errors';
import { OmrArchiveError, OmrRunError } from '../../../../src/main/omr/errors';
import { ProjectFileError } from '../../../../src/storage/errors';

/**
 * IPC ハンドラの単体テスト
 *
 * 検証対象は**エラーの分類**と**セッションへの委譲**。解析そのものは
 * ProjectSession の単体テストが担うため、ここではセッションを丸ごと擬似化する
 */

/** 呼び出しを記録するだけの擬似セッション */
function fakeSession(overrides: Partial<ProjectSession> = {}): ProjectSession {
  const snapshot = {
    project: {},
    structureIssues: [],
    buildIssues: [],
    keyRegionIssues: [],
  };
  return {
    importPdf: vi.fn().mockResolvedValue(snapshot),
    open: vi.fn().mockResolvedValue(snapshot),
    save: vi.fn().mockResolvedValue({}),
    cancelOmr: vi.fn(),
    setStructureDecisions: vi.fn().mockReturnValue(snapshot),
    setClefCorrections: vi.fn().mockReturnValue(snapshot),
    setKeyRegionDecisions: vi.fn().mockReturnValue(snapshot),
    setSettings: vi.fn().mockReturnValue(snapshot),
    completeConfirmation: vi.fn().mockReturnValue(snapshot),
    exportPdf: vi.fn().mockResolvedValue({
      outPath: '/out.pdf',
      drawnCount: 3,
      unresolvedPlacements: 0,
      renderIssues: [],
    }),
    ...overrides,
  } as unknown as ProjectSession;
}

describe('toIpcError', () => {
  it('新しい版数のファイルは projectVersion（アプリ更新を案内するため独立させる）', () => {
    const error = new ProjectFileError('新しい版です', 'version');
    expect(toIpcError(error)).toEqual({ kind: 'projectVersion', message: '新しい版です' });
  });

  it('壊れたファイル（zip / schema）は projectFile', () => {
    expect(toIpcError(new ProjectFileError('壊れています', 'zip')).kind).toBe('projectFile');
    expect(toIpcError(new ProjectFileError('構造が不正', 'schema')).kind).toBe('projectFile');
  });

  it('入出力エラーは io（保存先の変更を案内する）', () => {
    expect(toIpcError(new ProjectFileError('書けません', 'io')).kind).toBe('io');
  });

  it('OMR 由来のエラーは omr', () => {
    expect(toIpcError(new OmrRunError('起動失敗')).kind).toBe('omr');
    expect(toIpcError(new OmrArchiveError('展開失敗')).kind).toBe('omr');
  });

  it('確認が未完了なら confirmationRequired（確認画面へ戻る案内を出すため独立させる）', () => {
    expect(toIpcError(new ConfirmationRequiredError('未承認です'))).toEqual({
      kind: 'confirmationRequired',
      message: '未承認です',
    });
  });

  it('その他の Error は unexpected（メッセージは残す）', () => {
    expect(toIpcError(new Error('謎'))).toEqual({ kind: 'unexpected', message: '謎' });
  });

  it('Error でない値でも必ず IpcError を返す（IPC 越しに undefined を返さない）', () => {
    expect(toIpcError('文字列')).toEqual({
      kind: 'unexpected',
      message: '想定外のエラーが発生しました',
    });
    expect(toIpcError(null).kind).toBe('unexpected');
  });
});

describe('createProjectHandlers', () => {
  it('成功時は ok: true で値を返す', async () => {
    const handlers = createProjectHandlers(fakeSession(), () => {});
    const result = await handlers.open('/x.solfaproj');
    expect(result.ok).toBe(true);
  });

  it('非同期の失敗を例外にせず ok: false で返す', async () => {
    const session = fakeSession({
      open: vi.fn().mockRejectedValue(new ProjectFileError('壊れています', 'zip')),
    } as unknown as Partial<ProjectSession>);
    const result = await createProjectHandlers(session, () => {}).open('/x.solfaproj');

    expect(result).toEqual({
      ok: false,
      error: { kind: 'projectFile', message: '壊れています' },
    });
  });

  it('同期の失敗も ok: false で返す', () => {
    const session = fakeSession({
      completeConfirmation: vi.fn().mockImplementation(() => {
        throw new Error('プロジェクトが開かれていません');
      }),
    } as unknown as Partial<ProjectSession>);
    const result = createProjectHandlers(session, () => {}).completeConfirmation();

    expect(result.ok).toBe(false);
  });

  it('音部記号の訂正を Record から Map へ変換して渡す', () => {
    const session = fakeSession();
    createProjectHandlers(session, () => {}).setClefCorrections({
      'clef-P6-ALTO': 'TREBLE',
      'clef-P4-ALTO': null,
    });

    expect(session.setClefCorrections).toHaveBeenCalledWith(
      new Map([
        ['clef-P6-ALTO', 'TREBLE'],
        ['clef-P4-ALTO', null],
      ]),
    );
  });

  it('進捗コールバックをそのままセッションへ渡す', async () => {
    const session = fakeSession();
    const onProgress = vi.fn();
    await createProjectHandlers(session, onProgress).importPdf('/score.pdf');

    expect(session.importPdf).toHaveBeenCalledWith('/score.pdf', onProgress);
  });

  it('キャンセルは値を持たない成功として返す', () => {
    const session = fakeSession();
    expect(createProjectHandlers(session, () => {}).cancelOmr()).toEqual({
      ok: true,
      value: null,
    });
    expect(session.cancelOmr).toHaveBeenCalled();
  });

  it('保存先の省略をそのまま委譲する（上書き保存の経路）', async () => {
    const session = fakeSession();
    await createProjectHandlers(session, () => {}).save();
    expect(session.save).toHaveBeenCalledWith(undefined);
  });

  it('PDF 出力先をそのままセッションへ渡し、要約を返す', async () => {
    const session = fakeSession();
    const result = await createProjectHandlers(session, () => {}).exportPdf('/out.pdf');

    expect(session.exportPdf).toHaveBeenCalledWith('/out.pdf');
    expect(result).toEqual({
      ok: true,
      value: { outPath: '/out.pdf', drawnCount: 3, unresolvedPlacements: 0, renderIssues: [] },
    });
  });

  it('承認前の PDF 出力は confirmationRequired として返す（確認画面へ戻る案内を出せるように）', async () => {
    const session = fakeSession({
      exportPdf: vi.fn().mockRejectedValue(new ConfirmationRequiredError('確認が完了していません')),
    } as unknown as Partial<ProjectSession>);
    const result = await createProjectHandlers(session, () => {}).exportPdf('/out.pdf');

    expect(result).toEqual({
      ok: false,
      error: { kind: 'confirmationRequired', message: '確認が完了していません' },
    });
  });

  it('PDF の書き出し失敗は io として返す（保存先の変更を案内するため）', async () => {
    const session = fakeSession({
      exportPdf: vi.fn().mockRejectedValue(new ProjectFileError('書けません', 'io')),
    } as unknown as Partial<ProjectSession>);
    const result = await createProjectHandlers(session, () => {}).exportPdf('/out.pdf');

    expect(result).toEqual({ ok: false, error: { kind: 'io', message: '書けません' } });
  });
});
