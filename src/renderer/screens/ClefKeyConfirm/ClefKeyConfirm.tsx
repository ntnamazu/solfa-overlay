import type { ClefCorrections } from '../../../shared/ipc/contract';
import type { ConfirmationItem } from '../../../shared/types/Confirmation';
import { SELECTABLE_CLEF_KINDS } from '../../../shared/types/Confirmation';
import type { KeyRegion, KeyRegionDecision } from '../../../shared/types/KeyRegion';
import {
  clefCheckStatus,
  clefCheckStatusLabel,
  clefLabel,
  countAllSystems,
  countSystems,
  mismatchLabel,
  needsAttention,
  partLabel,
  staffCoverageLabel,
} from '../../labels/scoreLabels';

/**
 * 音部記号と調の確認画面（画面遷移図の ClefKeyConfirm。機能設計書 F-2）
 *
 * **2 つの表に分ける**。音部記号はパートの性質、調は小節区間の性質であり、
 * 1 つの表に混ぜると行の意味が定まらない。
 *
 * 音部記号の表は**1 パートにつき 1 行ではなくパート×検出値のグループごと**に 1 行。実データの
 * 誤検出はパート単位で系統的に起きる（divisi の P6 は 35 段が一括で ALTO 誤検出）ため、
 * 288 譜表を 17 行に畳んでも訂正能力を失わず、受入基準「1曲5分以内」を満たせる。
 *
 * 調の表で旋法を指定できることがこの画面のもう一つの要点。Audiveris は `<key>` に
 * `<mode>` を出さないため、自動検出された調区間は**必ず長調**になる。
 *
 * **画面には内部識別子を出さない**（`P1` / `TREBLE` / `UNKNOWN`）。翻訳は
 * `labels/scoreLabels.ts` が一手に引き受け、この画面は並べ方だけを持つ
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
 * ユーザーの判断が要る項目
 *
 * 「不一致が出た行」と「そもそも検算できていない行（未検査）」の両方を数える。
 * 未検査を除くと、**検算していないことが『問題なし』として画面に出てしまう**。
 * 一方で不一致 0 件の行や訂正済みの行まで数えると divisi では 17 行すべてが警告になり、
 * 「1曲5分以内」の作業導線が成立しない。
 *
 * この判定は表示上の強調にしか使わないため UI レイヤーに置く
 * （`shared/` は型と定数のみ＝実装ロジックを置かない。リポジトリ構造定義書の規約）
 */
function unresolvedItems(items: readonly ConfirmationItem[]): ConfirmationItem[] {
  return items.filter((item) => needsAttention(clefCheckStatus(item)));
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
  // 段数の分母は 1 項目では出ない（項目はパート×検出値のグループのため）
  const totalSystems = countAllSystems(items);

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
      <p>
        楽譜の左端の記号が正しく読み取れているかを確かめ、違っていたら選び直してください。短調の曲は「調」の表で短調を選んでください。
      </p>

      <section>
        <h2>音部記号</h2>
        {/*
          「どこを見ればよいか」まで言い切る。件数だけでは次の行動が決まらない。

          `role="status"` は**条件付きにしない**。ライブリージョンは内容が変わる前から DOM に
          存在していないと読み上げられないため、最後の 1 行を訂正した瞬間に領域ごと消すと
          「すべて確認できています」が読み上げられない
        */}
        <p role="status">
          {items.length === 0
            ? '確認する音部記号が見つかりませんでした。楽譜の読み取りに失敗している可能性があります。'
            : unresolved.length === 0
              ? `${items.length} 行すべて確認できています。このまま進めて大丈夫です。`
              : `⚠ が付いた ${unresolved.length} 行だけ確認すれば大丈夫です（全 ${items.length} 行）。`}
        </p>
        <table>
          <caption>
            パートごとの音部記号。1 行を直すと、その行の段すべてにまとめて反映されます
          </caption>
          <thead>
            <tr>
              <th scope="col">パート</th>
              <th scope="col">読み取った記号</th>
              <th scope="col">状態</th>
              <th scope="col">この行が及ぶ範囲</th>
              <th scope="col">音の食い違い</th>
              <th scope="col">正しい記号を選ぶ</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const status = clefCheckStatus(item);
              const detectedLabel = clefLabel(item.detected);
              return (
                <tr key={item.id}>
                  <td>{partLabel(item.partId)}</td>
                  <td>{detectedLabel}</td>
                  {/* ⚠ 付きの状態がそのままバッジを兼ねる（色に頼らずに注意を引く） */}
                  <td>{clefCheckStatusLabel(status)}</td>
                  {/* 分子も段（システム）で数える。譜表数で数えると分母を超えうる */}
                  <td>{staffCoverageLabel(countSystems(item.staffRefs), totalSystems)}</td>
                  {/* 分母は出さない。0 件は「—」にして、目が要確認の行へ向くようにする */}
                  <td>{mismatchLabel(item.mismatchCount)}</td>
                  <td>
                    <select
                      aria-label={`${partLabel(item.partId)}の音部記号（読み取り: ${detectedLabel}）`}
                      value={item.corrected ?? ''}
                      onChange={(event) => {
                        correctClef(item, event.target.value);
                      }}
                      disabled={busy}
                    >
                      <option value="">読み取ったままにする</option>
                      {SELECTABLE_CLEF_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {clefLabel(kind)}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {/* 未検査の 0 件は「問題なし」ではない。理由を書かないと訂正の動機が伝わらない */}
        {items.some((item) => clefCheckStatus(item) === 'unchecked') && (
          <p>
            「⚠
            未検査」の行は、記号そのものを読み取れなかったため確かめようがない状態です。楽譜を見て選ぶと、そこから照合できるようになります。
          </p>
        )}
      </section>

      <section>
        <h2>調</h2>
        <p>
          楽譜からは調号しか読み取れないため、自動判定は長調になります。短調の曲は指定してください。
        </p>
        <table>
          <caption>調の区切り（{keyRegions.length} 件）</caption>
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
        <p>確認していない行が {unresolved.length} 行ありますが、このまま進むこともできます。</p>
      )}
    </main>
  );
}
