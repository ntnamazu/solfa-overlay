import type { ConfirmationItem } from '../../shared/types/Confirmation';
import { UNKNOWN_CLEF } from '../../shared/types/Confirmation';
import type { StaffRef } from '../../shared/types/ScoreModel';

/**
 * 楽譜まわりの内部値を「合唱団員の語彙」へ翻訳する表示名モジュール
 *
 * **UI に出す文字列の正はここ**（用語集ではない）。用語集が持つのは「なぜ『パート』と呼ぶか」
 * のような方針と、音楽用語としての定義であり、文言そのものを両方に書くと必ずズレる
 * （用語集の `G-clef-8vb` は実装に存在しない値であり、二重管理が壊れた実例）。
 *
 * 方針: **内部識別子（`P1` / `TREBLE` / `UNKNOWN`）を画面に出さない**。
 * PRD のセカンダリーペルソナ（非エンジニアの合唱団員）が「説明書なしで最初の1曲を完了できる」
 * ことを要件としており、内部値は大多数には判断不能なノイズになる。
 * 上級者向けの内部値はログ／エクスポート側で担保する
 */

/**
 * 音部記号の内部値 → 表示名
 *
 * `ALTO` と `TENOR` はどちらもハ音記号であり、合唱団員が日常的に出会う記号ではないため
 * **線の位置まで書いて区別できるようにする**（線の位置は `clefTable.ts` の中線定義と整合:
 * ALTO の中線 = C4 → C4 は第3線、TENOR の中線 = A3 → C4 は第4線）。
 *
 * `G_CLEF` / `F_CLEF` は選択肢には出さない別名だが、**検出値としては現れうる**ため表に持つ
 * （Audiveris が `TREBLE` / `BASS` と同義で出す）
 */
const CLEF_LABELS: Readonly<Record<string, string>> = {
  TREBLE: 'ト音記号',
  G_CLEF: 'ト音記号',
  TREBLE_DOWN_8: 'オクターヴ下ト音記号（テノールで頻出）',
  BASS: 'ヘ音記号',
  F_CLEF: 'ヘ音記号',
  ALTO: 'アルト記号（ハ音記号・第3線）',
  TENOR: 'テノール記号（ハ音記号・第4線）',
};

/** 音部記号を検出できなかったときの表示（「楽譜に無い」ではなく「読み取れなかった」） */
const UNKNOWN_CLEF_LABEL = '読み取れませんでした';

/** 表にない内部値のフォールバック。**内部値は画面に出さない**ため kind は含めない */
const UNSUPPORTED_CLEF_LABEL = '未対応の音部記号';

/** 音部記号の内部値（Audiveris の clef kind）を日本語の表示名にする */
export function clefLabel(kind: string): string {
  if (kind === UNKNOWN_CLEF) {
    return UNKNOWN_CLEF_LABEL;
  }
  return CLEF_LABELS[kind] ?? UNSUPPORTED_CLEF_LABEL;
}

/**
 * 音高クロスチェックの対象になる音部記号か
 *
 * `clefTable.headStepOctave` は **`null` のときだけでなく、中線が定義されていない kind でも**
 * `null` を返して検算を打ち切る（`isKnownClefKind` が同じ集合を表す）。したがって
 * 「検算が走っていない」条件は `UNKNOWN` に限らず、**表示名を持たない kind すべて**である。
 * `CLEF_LABELS` の見出し語は `clefTable` の中線定義と 1 対 1 に保つ
 * （ズレると「未対応と表示しつつ確認済み扱い」という食い違いが生まれるため、テストで固定する）
 */
function isCrossCheckable(kind: string): boolean {
  return kind !== UNKNOWN_CLEF && kind in CLEF_LABELS;
}

/** `clefTable` の中線定義と対応することをテストで固定するための一覧 */
export const LABELED_CLEF_KINDS = Object.keys(CLEF_LABELS);

/**
 * `P12` のような MusicXML の part id から連番を取り出す（取れなければ null）
 *
 * `confirmationItems.ts`（domain）が並び順のために持つ同名の関数と同じ規則だが、
 * **共有してはいけない**。renderer は domain を import できず（アーキテクチャ設計書の依存方向）、
 * `shared/` は型と定数のみで実装ロジックを置けない（リポジトリ構造定義書）。
 * この 5 行の重複は、レイヤー境界を守るために意図的に受け入れている
 */
function partNumberOf(partId: string): number | null {
  const matched = /^P(\d+)$/.exec(partId);
  if (matched?.[1] === undefined) {
    return null;
  }
  return Number.parseInt(matched[1], 10);
}

/**
 * パートを「上から N 番目のパート」と呼ぶ
 *
 * `P1`〜`P5` は楽譜の上から順に振られた MusicXML の part id である。**`staffRefs` から
 * 順序を推定してはいけない**: 実データ（o-quam-gloriosum）では 1 ページ目のインチピットが
 * 1 パートだけの段として誤検出され、バスである P4 の `staffRefs` 先頭が `staffIndex 0`
 * になっている。最初に現れた `staffIndex` で並べるとバスが最上段に出る。
 *
 * 「1段目〜4段目」とは書かない。本プロジェクトの「段」はシステム（横 1 行のまとまり）を
 * 指すため、段番号と衝突する
 */
export function partLabel(partId: string | null): string {
  if (partId === null) {
    return 'パート不明';
  }
  const number = partNumberOf(partId);
  return number === null ? partId : `上から${number}番目のパート`;
}

/**
 * 楽譜が持つパート名を優先しつつ、無ければ「上から N 番目のパート」にする
 *
 * `MusicXmlParser` は `<part-name>` が無い楽譜で名前に `partId` をそのまま入れる
 * （`parts.push({ id, name: partNames.get(id) ?? id })`）。それを素通しすると画面に
 * `P1` が出るため、**`partId` と同じ名前は名前が無いものとして扱う**
 */
export function partDisplayName(partId: string | null, name: string | undefined): string {
  if (name === undefined || name === '' || name === partId) {
    return partLabel(partId);
  }
  return name;
}

/**
 * 音部記号の確認状態
 *
 * **`unchecked`（未検査）が第 3 の状態として要る**のが要点。検算に使える音部記号が無い行は
 * `clefTable.headStepOctave` が `null` を返すため**クロスチェック自体が走っておらず**、
 * `mismatchCount` は 0 のまま据え置かれる。これを「確認済み」と同じ 0 として見せると、
 * 「検算して問題が無かった」と「検算していないので何も分かっていない」が画面上で区別できない
 */
export type ClefCheckStatus = 'corrected' | 'unchecked' | 'needsCheck' | 'confirmed';

/**
 * 確認項目の状態を判定する
 *
 * `unchecked` を `mismatchCount` より先に見るのが要点。順序を逆にすると
 * 「検算していないのに 0 件だから確認済み」という食い違いを再生産する。
 * 判定に使うのは「検出値が `UNKNOWN` か」ではなく「**検算できる音部記号か**」であり、
 * Audiveris が未対応の記号（合唱譜では稀だが打楽器記号等）を返した場合も未検査になる。
 *
 * 訂正済みの行は、再解析で `mismatchCount` が計算し直された結果にかかわらず
 * 確認を促さない。ユーザーが既に判断を下した行だからである
 */
export function clefCheckStatus(item: ConfirmationItem): ClefCheckStatus {
  if (item.corrected !== null) {
    return 'corrected';
  }
  if (!isCrossCheckable(item.detected)) {
    return 'unchecked';
  }
  return item.mismatchCount > 0 ? 'needsCheck' : 'confirmed';
}

/** 状態の表示名。⚠ は色に頼らずに注意を引くためのバッジを兼ねる */
const CLEF_CHECK_STATUS_LABELS: Readonly<Record<ClefCheckStatus, string>> = {
  corrected: '訂正済み',
  unchecked: '⚠ 未検査',
  needsCheck: '⚠ 要確認',
  confirmed: '確認済み',
};

export function clefCheckStatusLabel(status: ClefCheckStatus): string {
  return CLEF_CHECK_STATUS_LABELS[status];
}

/**
 * ユーザーの確認が必要な状態か
 *
 * 未検査を算入するのが現状との違い。「読み取れませんでした。何でしたか？」と尋ねるのは
 * 煩わしさではなく親切として受け取られる（PRD の 2 つのペルソナはいずれも
 * 「楽譜をちゃんと読みたい人」であり、音部記号は両者に共通する関心事）。
 * ユーザーが選べばクロスチェックが実際に走るようになるため、訂正には具体的な効果がある
 */
export function needsAttention(status: ClefCheckStatus): boolean {
  return status === 'needsCheck' || status === 'unchecked';
}

/**
 * 音高クロスチェックの不一致件数の表示
 *
 * **分母は出さない**。ユーザーは自分のパートの規模を既に持っており、3 でも 8 でも行動は
 * 「音部記号を確認する」で変わらない。むしろ「0.7% なら無視でよい」と読ませてはいけない
 * （音部記号の誤検出は件数の大小と危険度が比例しない）。
 * 0 件は数字を出さず「—」にして、目が要確認の行へ向くようにする
 */
export function mismatchLabel(count: number): string {
  return count === 0 ? '—' : `${count} 音`;
}

/**
 * 1 行の訂正が何段に効くかの表示
 *
 * 「35」だけでは多いのか少ないのか判断できない。曲全体の段数を分母に置くと
 * 「ほぼ全段」なのか「一部だけ」なのかが一目で分かる（前者はパート単位の系統的誤検出、
 * 後者は局所的な検出漏れという見立てにつながる）
 */
export function staffCoverageLabel(count: number, total: number): string {
  // 全段数が求まらないとき（確認項目が空）は分母を偽らず、段数だけを出す
  return total === 0 ? `${count} 段` : `全 ${total} 段のうち ${count} 段`;
}

/**
 * 譜表参照が覆う段（システム）の数
 *
 * 段は `(pageIndex, systemIndex)` で一意に決まる。**`staffRefs.length` を段数として使っては
 * いけない**: 1 パートが 1 段に複数の譜表を持つ場合（大譜表のピアノ伴奏など）に譜表数が段数を
 * 上回り、「全 20 段のうち 40 段」という表示になる。分子と分母は必ず同じ単位で数える
 */
export function countSystems(staffRefs: readonly StaffRef[]): number {
  const systems = new Set<string>();
  for (const ref of staffRefs) {
    systems.add(`${ref.pageIndex}:${ref.systemIndex}`);
  }
  return systems.size;
}

/**
 * 確認項目の集合が覆う曲全体の段数
 *
 * `ConfirmationItem` はパート×検出値のグループなので、1 項目だけでは曲全体の段数が出ない
 */
export function countAllSystems(items: readonly ConfirmationItem[]): number {
  return countSystems(items.flatMap((item) => item.staffRefs));
}
