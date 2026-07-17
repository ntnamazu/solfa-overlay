import { useEffect, useState } from 'react';

/** 起動画面のスタブ（画面遷移図の Home。PDF取込・既存プロジェクトを開く導線は今後実装） */
export function Home() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    void window.solfaOverlay.getAppVersion().then(setVersion);
  }, []);

  return (
    <main>
      <h1>Solfa Overlay</h1>
      <p>合唱楽譜PDFへの移動ド階名自動付与アプリ</p>
      <p>{version === null ? 'バージョン取得中…' : `バージョン: ${version}`}</p>
    </main>
  );
}
