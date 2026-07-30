import type { OmrProgress as OmrProgressData, OmrPhase } from '../../../shared/types/OmrProgress';

/** 進捗の局面をユーザー向けの日本語にする */
const PHASE_LABELS: Readonly<Record<OmrPhase, string>> = {
  starting: 'Audiveris を起動しています…',
  loading: 'PDF を読み込んでいます…',
  transcribing: '楽譜を認識しています…',
  exporting: '認識結果を書き出しています…',
  completed: '認識が完了しました',
};

/**
 * OMR 実行中の進捗画面（画面遷移図の OmrProgress）
 *
 * 実データでは 20 ページで数分かかるため、**いま何をしているか**と
 * **あと何ページか**が分からないと固まったように見える
 */
export interface OmrProgressProps {
  progress: OmrProgressData | null;
  onCancel: () => void;
  canceling: boolean;
}

export function OmrProgress({ progress, onCancel, canceling }: OmrProgressProps) {
  const phase = progress?.phase ?? 'starting';
  const sheet = progress?.sheet ?? null;
  const total = progress?.totalSheets ?? null;

  return (
    <main>
      <h1>楽譜を認識しています</h1>
      {/* 全画面共通ルール: h1 の直下に「あなたが今すべきこと」を 1 文置く */}
      <p>終わるまでお待ちください（時間がかかりすぎるときは中止できます）。</p>
      <p>{PHASE_LABELS[phase]}</p>

      {sheet !== null && (
        <p>{total === null ? `${sheet} ページ目` : `${sheet} / ${total} ページ`}</p>
      )}

      {/* 総ページ数が判明するまでは進捗率を出せない（不明な分母で偽の割合を見せない） */}
      {sheet !== null && total !== null && (
        <progress value={sheet} max={total} aria-label="認識の進捗" />
      )}

      <button type="button" onClick={onCancel} disabled={canceling}>
        {canceling ? 'キャンセルしています…' : 'キャンセル'}
      </button>
    </main>
  );
}
