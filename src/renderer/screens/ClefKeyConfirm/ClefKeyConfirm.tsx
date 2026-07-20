import type { ClefCorrections } from '../../../shared/ipc/contract';
import type { ConfirmationItem } from '../../../shared/types/Confirmation';
import { SELECTABLE_CLEF_KINDS } from '../../../shared/types/Confirmation';
import type { KeyRegion, KeyRegionDecision } from '../../../shared/types/KeyRegion';

/**
 * 音部記号と調の確認画面（画面遷移図の ClefKeyConfirm。機能設計書 F-2）
 *
 * **2 つの表に分ける**。音部記号は譜表の性質、調は小節区間の性質であり、
 * 1 つの表に混ぜると行の意味が定まらない。
 *
 * 音部記号の表は**譜表ごとではなくパート×検出値のグループごと**に 1 行。実データの
 * 誤検出はパート単位で系統的に起きる（divisi の P6 は 35 段が一括で ALTO 誤検出）ため、
 * 288 行を 17 行に畳んでも訂正能力を失わず、受入基準「1曲5分以内」を満たせる。
 *
 * 調の表で旋法を指定できることがこの画面のもう一つの要点。Audiveris は `<key>` に
 * `<mode>` を出さないため、自動検出された調区間は**必ず長調**になる
 */
export interface ClefKeyConfirmProps {
  items: ConfirmationItem[];
  keyRegions: KeyRegion[];
  keyRegionDecisions: KeyRegionDecision[];
  onCorrectClef: (corrections: ClefCorrections) => void;
  onDecideKeyRegions: (decisions: KeyRegionDecision[]) => void;
  onApprove: () => void;
  busy: boolean;
}

/**
 * ユーザーの判断が要る項目（不一致を抱えたまま未訂正の行）
 *
 * 不一致 0 件の項目は誤検出の可能性が低く、訂正を促す必要がない。
 * 全項目を「未確認」として数えると divisi では 17 行すべてが警告になり、
 * 「1曲5分以内」の作業導線が成立しない。
 *
 * この判定は表示上の強調にしか使わないため画面側に置く
 * （`shared/` は型と定数のみ＝実装ロジックを置かない。リポジトリ構造定義書の規約）
 */
function unresolvedItems(items: readonly ConfirmationItem[]): ConfirmationItem[] {
  return items.filter((item) => item.corrected === null && item.mismatchCount > 0);
}

/** 調区間を「主音（旋法）」の読みやすい形にする */
function describeKey(region: KeyRegion): string {
  const accidental = region.tonicAlter > 0 ? '♯' : '♭';
  const tonic = region.tonicStep + accidental.repeat(Math.abs(region.tonicAlter));
  return `${tonic} ${region.mode === 'minor' ? '短調' : '長調'}`;
}

export function ClefKeyConfirm({
  items,
  keyRegions,
  keyRegionDecisions,
  onCorrectClef,
  onDecideKeyRegions,
  onApprove,
  busy,
}: ClefKeyConfirmProps) {
  const unresolved = unresolvedItems(items);

  const correctClef = (item: ConfirmationItem, value: string): void => {
    // 空文字は「訂正しない」を意味する（検出値のまま採用する）
    onCorrectClef({ [item.id]: value === '' ? null : value });
  };

  const decideMode = (region: KeyRegion, value: string): void => {
    const others = keyRegionDecisions.filter(
      (decision) => decision.measureIndex !== region.start.measureIndex,
    );
    onDecideKeyRegions([
      ...others,
      { measureIndex: region.start.measureIndex, mode: value === 'minor' ? 'minor' : 'major' },
    ]);
  };

  return (
    <main>
      <h1>音部記号と調の確認</h1>

      <section>
        <h2>音部記号</h2>
        <p>
          {items.length} 件のうち、確認が必要なもの {unresolved.length} 件
        </p>
        <table>
          <caption>パートごとの音部記号（同じ検出結果の譜表をまとめて訂正します）</caption>
          <thead>
            <tr>
              <th scope="col">パート</th>
              <th scope="col">検出結果</th>
              <th scope="col">対象の段数</th>
              <th scope="col">音高の不一致</th>
              <th scope="col">訂正</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.partId ?? '（不明）'}</td>
                <td>{item.detected}</td>
                <td>{item.staffRefs.length}</td>
                {/* 不一致件数がそのまま誤検出の疑わしさ。0 件の行は触らなくてよい */}
                <td>{item.mismatchCount}</td>
                <td>
                  <select
                    aria-label={`${item.partId ?? '不明なパート'} の音部記号（検出: ${item.detected}）`}
                    value={item.corrected ?? ''}
                    onChange={(event) => {
                      correctClef(item, event.target.value);
                    }}
                    disabled={busy}
                  >
                    <option value="">訂正しない</option>
                    {SELECTABLE_CLEF_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {kind}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>調</h2>
        <p>
          楽譜からは調号しか読み取れないため、自動判定は長調になります。短調の曲は指定してください。
        </p>
        <table>
          <caption>調区間（{keyRegions.length} 件）</caption>
          <thead>
            <tr>
              <th scope="col">開始小節</th>
              <th scope="col">判定</th>
              <th scope="col">出所</th>
              <th scope="col">旋法の指定</th>
            </tr>
          </thead>
          <tbody>
            {keyRegions.map((region) => (
              <tr key={region.id}>
                <td>{region.start.measureIndex + 1}</td>
                <td>{describeKey(region)}</td>
                <td>{region.source === 'user' ? '指定済み' : '自動判定'}</td>
                <td>
                  <select
                    aria-label={`${region.start.measureIndex + 1}小節目からの旋法`}
                    value={region.mode}
                    onChange={(event) => {
                      decideMode(region, event.target.value);
                    }}
                    disabled={busy}
                  >
                    <option value="major">長調</option>
                    <option value="minor">短調</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <button type="button" onClick={onApprove} disabled={busy}>
        確認を完了する
      </button>
      {unresolved.length > 0 && (
        <p role="status">
          音高の不一致が残っている行が {unresolved.length} 件あります。このまま進むこともできます。
        </p>
      )}
    </main>
  );
}
