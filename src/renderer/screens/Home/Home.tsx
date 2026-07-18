import { useEffect, useState } from 'react';

// ブラウザで dev サーバを直接開いた場合は preload がなく window.solfaOverlay が
// 存在しないため、クラッシュさせずプレビュー表示に切り替える
const isElectron = typeof window.solfaOverlay !== 'undefined';

/** 起動画面のスタブ（画面遷移図の Home。PDF取込・既存プロジェクトを開く導線は今後実装） */
export function Home() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!isElectron) {
      return;
    }
    void window.solfaOverlay.getAppVersion().then(setVersion);
  }, []);

  return (
    <main>
      <h1>Solfa Overlay</h1>
      <p>合唱楽譜PDFへの移動ド階名自動付与アプリ</p>
      {isElectron ? (
        <p>{version === null ? 'バージョン取得中…' : `バージョン: ${version}`}</p>
      ) : (
        <p>ブラウザプレビュー（Electron 外で実行中のため IPC は無効）</p>
      )}
    </main>
  );
}
