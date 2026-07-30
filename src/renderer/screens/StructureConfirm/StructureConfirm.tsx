import { useState } from 'react';
import type { StructureIssue } from '../../../shared/types/Issues';
import type { StructureDecision } from '../../../shared/types/StructureDecision';

/**
 * 楽譜の構成の確認画面（画面遷移図の StructureConfirm）
 *
 * 段あたりの小節数のズレは 1 箇所でも以降のページ全体へ波及する（divisi 実データでは
 * 2 段のズレが skipped 561 小節を生んでいた）。訂正できるのはこの「段の小節数」だけに絞る。
 *
 * **直せるものと、報告でしかないものを分ける**のが画面構成の要点。混ぜて 1 つの表に並べると、
 * 訂正欄が全行「—」になった状態（実データで起こる）で「何をすればよいか分からない画面」に
 * なる。報告のみの項目は折りたたみ、既定では目に入らないようにする。
 *
 * 「譜表」「システム」という語は画面に出さない。前者は「パート」、後者は「段」と呼ぶ
 * （練習現場の「2段目の4小節目から」という言い方に合わせる。用語集「パート」を参照）
 */
export interface StructureConfirmProps {
  issues: StructureIssue[];
  decisions: StructureDecision[];
  onApply: (decisions: StructureDecision[]) => void;
  onNext: () => void;
  busy: boolean;
}

/** 訂正できる issue か（段の小節数のズレだけがユーザー入力で直せる） */
function isCorrectable(
  issue: StructureIssue,
): issue is Extract<StructureIssue, { kind: 'systemMeasureCountMismatch' }> {
  return issue.kind === 'systemMeasureCountMismatch';
}

/**
 * 段ごとのパート数の不揃いが、インチピットによる誤分割の形をしているか
 *
 * インチピットは「1 パートだけの段」として誤検出されるため、`(1, 1, 1, 1, 4, 4)` のように
 * **1 の段と本来のパート数の段が混在する**形になる（実データ o-quam-gloriosum の 1 ページ目）。
 * `(8, 9)` のような 1 つずれは別物（段の検出失敗）であり、同じ説明を当てると
 * 「そのまま進めてよい」という誤った助言になる
 */
function looksLikeIncipit(staffCounts: readonly number[]): boolean {
  return staffCounts.includes(1) && staffCounts.some((count) => count > 1);
}

/**
 * issue をユーザー向けの一行説明にする
 *
 * 「楽譜 5 / 出力 4」のような裸の数値の並びは、どちらが何なのか読み手に推測させる。
 * 「元の楽譜」と「読み取り結果」という言葉で、比べているものを明示する
 */
function describe(issue: StructureIssue): string {
  switch (issue.kind) {
    case 'movementCountMismatch':
      return `曲の分かれ方が読み取り結果と合いません（元の楽譜 ${issue.omrMovementCount} 曲 / 読み取り ${issue.musicXmlCount} 曲）`;
    case 'pageCountMismatch':
      return `${issue.movementIndex + 1}曲目のページ数が合いません（元の楽譜 ${issue.omrPageCount} ページ / 読み取り ${issue.xmlPageCount} ページ）`;
    case 'systemCountMismatch':
      return `${issue.pageIndex + 1}ページ目の段数が合いません（元の楽譜 ${issue.omrSystemCount} 段 / 読み取り ${issue.xmlSystemCount} 段）`;
    case 'systemMeasureCountMismatch':
      return `${issue.pageIndex + 1}ページ ${issue.systemIndex + 1}段目の小節数が合いません`;
    case 'inconsistentSystemStaffCount': {
      const counts = `${issue.pageIndex + 1}ページ目は、段ごとのパート数がそろっていません（上から順に ${issue.staffCounts.join(' / ')} パート）`;
      // 用語集「インチピット」の既知の系統的エラー。アプリ側に概念と名前があるのに
      // 画面が数字の羅列しか出さないと、ユーザーは自力で意味を推し量るしかない。
      // ただし**インチピットだと言い切れる形のときだけ**言及する。(8, 9) のような
      // 1 パートずれは段の検出失敗であり、そこで「そのまま進めてよい」と書くと害になる
      return looksLikeIncipit(issue.staffCounts)
        ? `${counts}。曲の冒頭に置かれる小さな譜（インチピット）があると、この形になります。多くの場合はそのまま進めて問題ありません`
        : `${counts}。段の区切りを読み違えている可能性があります。次の画面でパートごとの音部記号が正しいかもあわせて確かめてください`;
    }
    case 'pageCorrespondenceMismatch':
      return `ページの対応が取れません（目次 ${issue.bookPageCount} ページ / 実際 ${issue.artifactPageCount} ページ）`;
  }
}

/** 既存の判断から、その段に対する上書き値を引く */
function overrideOf(
  decisions: StructureDecision[],
  pageIndex: number,
  systemIndex: number,
): number | null {
  const found = decisions.find(
    (decision) =>
      decision.kind === 'systemMeasureCount' &&
      decision.pageIndex === pageIndex &&
      decision.systemIndex === systemIndex,
  );
  return found?.kind === 'systemMeasureCount' ? found.measureCount : null;
}

export function StructureConfirm({
  issues,
  decisions,
  onApply,
  onNext,
  busy,
}: StructureConfirmProps) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const correctable = issues.filter(isCorrectable);
  const reportOnly = issues.filter((issue) => !isCorrectable(issue));

  const apply = (pageIndex: number, systemIndex: number, raw: string): void => {
    const measureCount = Number.parseInt(raw, 10);
    if (!Number.isInteger(measureCount) || measureCount < 0) {
      return; // 空欄や不正値では判断を作らない（0 として適用すると段が丸ごと消える）
    }
    const others = decisions.filter(
      (decision) =>
        !(
          decision.kind === 'systemMeasureCount' &&
          decision.pageIndex === pageIndex &&
          decision.systemIndex === systemIndex
        ),
    );
    onApply([...others, { kind: 'systemMeasureCount', pageIndex, systemIndex, measureCount }]);
  };

  return (
    <main>
      <h1>楽譜の構成の確認</h1>
      <p>
        {correctable.length > 0
          ? '入力欄のある行について、その段に実際いくつ小節があるかを楽譜と見比べて入れてください。'
          : reportOnly.length > 0
            ? '入力して直していただくところはありませんが、読み取りで気になった点があるので目を通してから進んでください。'
            : '直していただくことはありません。そのまま次へ進んでください。'}
      </p>

      <section>
        <h2>直していただきたいところ（{correctable.length} 件）</h2>
        {correctable.length === 0 ? (
          <p>読み取った構成に、直す必要のあるところは見つかりませんでした。このまま進めます。</p>
        ) : (
          <table>
            <caption>
              段の小節数がずれると、そのあとのページ全体に影響します。ここだけは直しておく価値があります
            </caption>
            <thead>
              <tr>
                <th scope="col">場所</th>
                <th scope="col">実際の小節数</th>
              </tr>
            </thead>
            <tbody>
              {correctable.map((issue) => {
                // 配列添字をキーにしてはいけない。訂正が効いて issue が 1 件消えると
                // 以降の行が繰り上がり、入力中の値が**別の段の行**へ引き継がれてしまう
                // （そのままタブ移動すると、その値が別の段へ書き込まれる）
                const key = `system-${issue.pageIndex}-${issue.systemIndex}`;
                const current =
                  overrideOf(decisions, issue.pageIndex, issue.systemIndex) ??
                  issue.xmlMeasureCount;
                return (
                  <tr key={key}>
                    <td>
                      {describe(issue)}（元の楽譜 {issue.omrStackCount} 小節 / 読み取り{' '}
                      {issue.xmlMeasureCount} 小節）
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        aria-label={`${issue.pageIndex + 1}ページ ${issue.systemIndex + 1}段目の小節数`}
                        value={edits[key] ?? String(current)}
                        onChange={(event) => {
                          setEdits({ ...edits, [key]: event.target.value });
                        }}
                        onBlur={(event) => {
                          apply(issue.pageIndex, issue.systemIndex, event.target.value);
                        }}
                        disabled={busy}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/*
        直せない項目は既定で畳む。件数は要約に出し、開かなくても規模が分かるようにする。
        「操作は不要」とは書かない。入力欄で直せないだけで、取り込み直しや元PDFの確認が
        要る場合がある（ページの対応が取れない等）
      */}
      {reportOnly.length > 0 && (
        <section>
          <details>
            <summary>
              読み取りで気になった点（{reportOnly.length} 件・入力欄では直せません）
            </summary>
            <ul>
              {reportOnly.map((issue) => (
                <li key={`${issue.kind}-${describe(issue)}`}>{describe(issue)}</li>
              ))}
            </ul>
          </details>
        </section>
      )}

      <button type="button" onClick={onNext} disabled={busy}>
        音部記号と調の確認へ
      </button>
    </main>
  );
}
