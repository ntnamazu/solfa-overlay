import type { ReactElement } from 'react';
import { useCallback, useEffect, useState } from 'react';
import type {
  ClefCorrections,
  ExportSummary,
  IpcResult,
  ProjectSnapshot,
} from '../shared/ipc/contract';
import type { KeyRegionDecision } from '../shared/types/KeyRegion';
import type { OmrProgress as OmrProgressData } from '../shared/types/OmrProgress';
import type { StructureDecision } from '../shared/types/StructureDecision';
import { getApi } from './api';
import { ClefKeyConfirm } from './screens/ClefKeyConfirm/ClefKeyConfirm';
import { Editor } from './screens/Editor/Editor';
import { Home } from './screens/Home/Home';
import { OmrProgress } from './screens/OmrProgress/OmrProgress';
import { StructureConfirm } from './screens/StructureConfirm/StructureConfirm';

/**
 * 画面遷移とIPC呼び出しの取りまとめ
 *
 * 各画面は受け取った props を描くだけの部品にし、IPC はここへ集約する。
 * 解析結果（スナップショット）は常に Main が返した最新のものを保持し、
 * Renderer 側で組み立て直さない（同じ状態を 2 箇所で持つと必ず食い違う）。
 *
 * Export は独立した画面にせず Editor 内に置く。実体が「保存先を選ぶ → 書き出す →
 * 結果を見る」という一過性の操作でしかなく、画面にすると Editor と同じ内容を二重に描くため
 */

export type Screen = 'home' | 'omr' | 'structure' | 'clefKey' | 'editor';

export function App() {
  const api = getApi();
  const [screen, setScreen] = useState<Screen>('home');
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [progress, setProgress] = useState<OmrProgressData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [exportSummary, setExportSummary] = useState<ExportSummary | null>(null);

  useEffect(() => {
    if (api === null) {
      return;
    }
    // 購読解除しないと画面が切り替わるたびにリスナーが積み上がる
    return api.onOmrProgress(setProgress);
  }, [api]);

  /** IPC の結果を受け取り、成功ならスナップショットを更新する */
  const accept = useCallback((result: IpcResult<ProjectSnapshot>, nextScreen?: Screen): boolean => {
    if (!result.ok) {
      setErrorMessage(result.error.message);
      return false;
    }
    setErrorMessage(null);
    setSnapshot(result.value);
    if (nextScreen !== undefined) {
      setScreen(nextScreen);
    }
    return true;
  }, []);

  const importPdf = useCallback(async () => {
    if (api === null) {
      return;
    }
    const pdfPath = await api.chooseSourcePdf();
    if (pdfPath === null) {
      return; // ダイアログのキャンセルはエラーではない
    }
    setBusy(true);
    setProgress(null);
    setExportSummary(null); // 別プロジェクトの出力結果を持ち越さない
    setScreen('omr');
    const result = await api.importPdf(pdfPath);
    setBusy(false);
    setCanceling(false);
    if (!accept(result, 'structure')) {
      // 認識に失敗したら Home へ戻す。進捗画面に留めるとキャンセル以外の出口がなくなる
      setScreen('home');
    }
  }, [api, accept]);

  const openProject = useCallback(async () => {
    if (api === null) {
      return;
    }
    const path = await api.chooseProjectFile();
    if (path === null) {
      return;
    }
    setBusy(true);
    setExportSummary(null); // 別プロジェクトの出力結果を持ち越さない
    const result = await api.openProject(path);
    setBusy(false);
    accept(result, 'structure');
  }, [api, accept]);

  const cancelOmr = useCallback(async () => {
    if (api === null) {
      return;
    }
    setCanceling(true);
    const result = await api.cancelOmr();
    if (!result.ok) {
      // 解除しないとボタンが「キャンセルしています…」のまま無効化され、
      // 走り続けている Audiveris を止める手段がなくなる
      setCanceling(false);
      setErrorMessage(result.error.message);
    }
  }, [api]);

  const applyStructureDecisions = useCallback(
    async (decisions: StructureDecision[]) => {
      if (api === null) {
        return;
      }
      setBusy(true);
      const result = await api.setStructureDecisions(decisions);
      setBusy(false);
      accept(result);
    },
    [api, accept],
  );

  const correctClef = useCallback(
    async (corrections: ClefCorrections) => {
      if (api === null) {
        return;
      }
      setBusy(true);
      const result = await api.setClefCorrections(corrections);
      setBusy(false);
      accept(result);
    },
    [api, accept],
  );

  const decideKeyRegions = useCallback(
    async (decisions: KeyRegionDecision[]) => {
      if (api === null) {
        return;
      }
      setBusy(true);
      const result = await api.setKeyRegionDecisions(decisions);
      setBusy(false);
      accept(result);
    },
    [api, accept],
  );

  const approve = useCallback(async () => {
    if (api === null) {
      return;
    }
    setBusy(true);
    const result = await api.completeConfirmation();
    if (result.ok) {
      accept(result);
      // 保存先が決まっていれば黙って上書きする。既存プロジェクトを開いているのに
      // 毎回「名前を付けて保存」を出すと、別名ファイルが増えて元が更新されない
      let path: string | undefined;
      if (result.value.filePath === null) {
        path = (await api.chooseSavePath()) ?? undefined;
        if (path === undefined) {
          // 保存先を選ばなければ保存できない。承認自体は済んでいるので状態は保つ
          setErrorMessage('保存先が選択されなかったため保存していません。');
          setBusy(false);
          return;
        }
      }
      const saved = await api.saveProject(path);
      if (!saved.ok) {
        setErrorMessage(saved.error.message);
      }
      // 保存に失敗しても承認そのものは済んでいるため Editor へ進める
      // （失敗の理由は画面上に出したまま残す）
      setScreen('editor');
    } else {
      accept(result);
    }
    setBusy(false);
  }, [api, accept]);

  const exportPdf = useCallback(async () => {
    if (api === null) {
      return;
    }
    const outPath = await api.chooseExportPdfPath();
    if (outPath === null) {
      return; // ダイアログのキャンセルはエラーではない
    }
    setBusy(true);
    const result = await api.exportPdf(outPath);
    setBusy(false);
    if (result.ok) {
      setErrorMessage(null);
      setExportSummary(result.value);
    } else {
      // 出力に失敗したら前回の成功結果を残さない（古い成功表示が誤解を生む）
      setExportSummary(null);
      setErrorMessage(result.error.message);
    }
  }, [api]);

  /**
   * 画面本体にエラー通知を添える
   *
   * Home は自前で通知を描くが、確認画面は描かない。保存の失敗など**画面遷移を伴わない失敗**は
   * ここで出さないと無言で握りつぶされる（操作したのに何も起きないように見える）
   */
  const withError = (content: ReactElement): ReactElement => (
    <>
      {errorMessage !== null && <p role="alert">{errorMessage}</p>}
      {content}
    </>
  );

  if (screen === 'omr') {
    return (
      <OmrProgress progress={progress} onCancel={() => void cancelOmr()} canceling={canceling} />
    );
  }

  if (screen === 'structure' && snapshot !== null) {
    return withError(
      <StructureConfirm
        issues={snapshot.structureIssues}
        decisions={snapshot.project.structureDecisions}
        onApply={(decisions) => void applyStructureDecisions(decisions)}
        onNext={() => {
          setScreen('clefKey');
        }}
        busy={busy}
      />,
    );
  }

  if (screen === 'clefKey' && snapshot !== null) {
    return withError(
      <ClefKeyConfirm
        items={snapshot.project.confirmation.items}
        keyRegions={snapshot.project.keyRegions}
        keyRegionDecisions={snapshot.project.keyRegionDecisions}
        onCorrectClef={(corrections) => void correctClef(corrections)}
        onDecideKeyRegions={(decisions) => void decideKeyRegions(decisions)}
        onApprove={() => void approve()}
        busy={busy}
      />,
    );
  }

  if (screen === 'editor' && snapshot !== null) {
    return withError(
      <Editor
        project={snapshot.project}
        preview={snapshot.preview}
        pageIssues={snapshot.pageIssues}
        annotationIssues={snapshot.annotationIssues}
        unmatchedCorrections={snapshot.unmatchedCorrections}
        exportSummary={exportSummary}
        onExportPdf={() => void exportPdf()}
        onBackToConfirm={() => {
          setScreen('clefKey');
        }}
        busy={busy}
      />,
    );
  }

  return (
    <Home
      onImportPdf={() => void importPdf()}
      onOpenProject={() => void openProject()}
      errorMessage={errorMessage}
      busy={busy}
    />
  );
}
