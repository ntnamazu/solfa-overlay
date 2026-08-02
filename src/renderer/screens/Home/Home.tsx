import { useEffect, useState } from 'react';
import { getApi } from '../../api';

/**
 * 起動画面（画面遷移図の Home）
 *
 * 入口は 2 つだけ: PDF を取り込んで新規に始めるか、保存済みプロジェクトを開くか。
 * 実際の取り込み・読込は App が行い、この画面は選択の受け付けに徹する
 */
export interface HomeProps {
  onImportPdf: () => void;
  onOpenProject: () => void;
  /** 直前の操作が失敗したときのメッセージ（なければ null） */
  errorMessage: string | null;
  busy: boolean;
}

export function Home({ onImportPdf, onOpenProject, errorMessage, busy }: HomeProps) {
  const [version, setVersion] = useState<string | null>(null);
  const api = getApi();

  useEffect(() => {
    if (api === null) {
      return;
    }
    void api
      .getAppVersion()
      .then(setVersion)
      .catch((error: unknown) => {
        // 失敗すると「取得中…」のまま固まるため、エラーを表示に反映する
        console.error('app:getVersion の呼び出しに失敗しました:', error);
        setVersion('取得失敗');
      });
  }, [api]);

  return (
    <main>
      <h1>Solfa Overlay</h1>
      {/*
        全画面共通ルール: h1 の直下に「あなたが今すべきこと」を 1 文置く。
        操作できない環境（Electron 外）で存在しないボタンを案内しないよう、
        できることが実際にあるときだけ出す
      */}
      {api !== null && (
        <p>まず楽譜のPDFを取り込んでください（前回の続きなら「プロジェクトを開く」からどうぞ）。</p>
      )}
      <p>合唱楽譜PDFへの移動ド階名自動付与アプリ</p>

      {api === null ? (
        <p>ブラウザプレビュー（Electron 外で実行中のため IPC は無効）</p>
      ) : (
        <>
          <p>{version === null ? 'バージョン取得中…' : `バージョン: ${version}`}</p>
          <button type="button" onClick={onImportPdf} disabled={busy}>
            PDFを取り込む
          </button>
          <button type="button" onClick={onOpenProject} disabled={busy}>
            プロジェクトを開く
          </button>
        </>
      )}

      {errorMessage !== null && <p role="alert">{errorMessage}</p>}
    </main>
  );
}
