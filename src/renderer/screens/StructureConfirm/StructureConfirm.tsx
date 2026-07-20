import { useState } from 'react';
import type { StructureIssue } from '../../../shared/types/Issues';
import type { StructureDecision } from '../../../shared/types/StructureDecision';

/**
 * 譜表構造の確認画面（画面遷移図の StructureConfirm）
 *
 * 段あたりの小節数のズレは 1 箇所でも以降のページ全体へ波及する（divisi 実データでは
 * 2 段のズレが skipped 561 小節を生んでいた）。訂正できるのはこの「段の小節数」だけに絞る。
 * 他の issue は**位置の提示のみ**とし、直せない項目に入力欄を出さない
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

/** issue をユーザー向けの一行説明にする */
function describe(issue: StructureIssue): string {
  switch (issue.kind) {
    case 'movementCountMismatch':
      return `曲の分割数が食い違います（楽譜 ${issue.omrMovementCount} / 出力 ${issue.musicXmlCount}）`;
    case 'pageCountMismatch':
      return `第${issue.movementIndex + 1}曲のページ数が食い違います（${issue.omrPageCount} / ${issue.xmlPageCount}）`;
    case 'systemCountMismatch':
      return `${issue.pageIndex + 1}ページ目の段数が食い違います（${issue.omrSystemCount} / ${issue.xmlSystemCount}）`;
    case 'systemMeasureCountMismatch':
      return `${issue.pageIndex + 1}ページ ${issue.systemIndex + 1}段目の小節数が食い違います`;
    case 'inconsistentSystemStaffCount':
      return `${issue.pageIndex + 1}ページ目で段ごとの譜表数が不揃いです（${issue.staffCounts.join(', ')}）`;
    case 'pageCorrespondenceMismatch':
      return `ページの対応が取れません（目次 ${issue.bookPageCount} / 実体 ${issue.artifactPageCount}）`;
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
      <h1>譜表構造の確認</h1>
      {issues.length === 0 ? (
        <p>構造の問題は見つかりませんでした。</p>
      ) : (
        <table>
          <caption>検出された構造の問題（{issues.length} 件）</caption>
          <thead>
            <tr>
              <th scope="col">内容</th>
              <th scope="col">小節数の訂正</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((issue) => {
              // 配列添字をキーにしてはいけない。訂正が効いて issue が 1 件消えると
              // 以降の行が繰り上がり、入力中の値が**別の段の行**へ引き継がれてしまう
              // （そのままタブ移動すると、その値が別の段へ書き込まれる）
              const key = isCorrectable(issue)
                ? `system-${issue.pageIndex}-${issue.systemIndex}`
                : `${issue.kind}-${describe(issue)}`;
              if (!isCorrectable(issue)) {
                return (
                  <tr key={key}>
                    <td>{describe(issue)}</td>
                    <td>—</td>
                  </tr>
                );
              }
              const current =
                overrideOf(decisions, issue.pageIndex, issue.systemIndex) ?? issue.xmlMeasureCount;
              return (
                <tr key={key}>
                  <td>
                    {describe(issue)}（楽譜 {issue.omrStackCount} / 出力 {issue.xmlMeasureCount}）
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

      <button type="button" onClick={onNext} disabled={busy}>
        音部記号・調の確認へ
      </button>
    </main>
  );
}
