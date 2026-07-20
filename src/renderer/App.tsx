import type { ReactElement } from 'react';
import { useCallback, useEffect, useState } from 'react';
import type { ClefCorrections, IpcResult, ProjectSnapshot } from '../shared/ipc/contract';
import type { KeyRegionDecision } from '../shared/types/KeyRegion';
import type { OmrProgress as OmrProgressData } from '../shared/types/OmrProgress';
import type { StructureDecision } from '../shared/types/StructureDecision';
import { getApi } from './api';
import { ClefKeyConfirm } from './screens/ClefKeyConfirm/ClefKeyConfirm';
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
 * Editor / Export 画面は Phase 5 の担当。本フェーズは確認フローの完了までを繋ぐ
 */

export type Screen = 'home' | 'omr' | 'structure' | 'clefKey';

export function App() {
  const api = getApi();
  const [screen, setScreen] = useState<Screen>('home');
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [progress, setProgress] = useState<OmrProgressData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [canceling, setCanceling] = useState(false);

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
    } else {
      accept(result);
    }
    setBusy(false);
  }, [api, accept]);

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

  return (
    <Home
      onImportPdf={() => void importPdf()}
      onOpenProject={() => void openProject()}
      errorMessage={errorMessage}
      busy={busy}
    />
  );
}
