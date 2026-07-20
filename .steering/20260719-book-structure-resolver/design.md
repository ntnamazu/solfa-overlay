# 設計書

- 作業名: 20260719-book-structure-resolver（Phase 2: 譜表構造の解決）

## アーキテクチャ概要

**方針: 通し小節番号の決定責務を `ScoreModelBuilder` から `BookStructureResolver` へ移す。**

現在は `ScoreModelBuilder` が「OMR の stack 数を累積」して通し小節番号を決めている。この方式は
1 段の検出誤差が以降の全小節に波及する（事前調査で実証）。本作業では、段ごとの小節番号を
**MusicXML の段レイアウトにアンカーした確定値**として `ResolvedStructure` に持たせ、
`ScoreModelBuilder` はそれを引くだけにする。

```mermaid
flowchart LR
    Omr[.omr<br/>book.xml / sheet XML] --> Sheet[OmrSheetParser]
    Mxl[.mxl<br/>MusicXML] --> Mxp[MusicXmlParser<br/>＋段レイアウト抽出]
    Sheet --> Res[BookStructureResolver<br/>detect / resolve]
    Mxp --> Res
    Res -->|StructureIssue[]| Confirm[StructureConfirm<br/>（Phase 4）]
    Confirm -->|StructureDecision[]| Res
    Res -->|ResolvedStructure<br/>段ごとの小節アンカー| Builder[ScoreModelBuilder]
    Mxp --> Builder
    Sheet --> Builder
    Builder --> Model[ScoreModel]
```

## コンポーネント設計

### 1. MusicXmlParser（拡張）

**責務**（追加分）:

- `<print new-page="yes">` / `<print new-system="yes">` から「ページ → 段 → 小節数」のレイアウトを抽出する

**インターフェース**:

```typescript
/** MusicXML が表現する段レイアウトの 1 段分 */
export interface MusicXmlSystemLayout {
  /** MusicXML 内のページ順（0始まり） */
  pageIndex: number;
  /** ページ内の段順（0始まり） */
  systemIndex: number;
  /** この movement 内での 0 始まりの先頭小節番号 */
  firstMeasureIndex: number;
  /** この段に属する小節数 */
  measureCount: number;
}

export interface ParsedMusicXml {
  parts: MusicXmlPart[];
  layout: MusicXmlSystemLayout[]; // ← 追加
}
```

**実装の要点**:

- レイアウトは**小節数が最大のパート**から導出する（ties は最初のパート）。Audiveris 出力では
  パートによって最終小節が 1 つ欠ける実例がある（divisi の P7 は 328、他は 329）ため、
  常に第1パートを使うと最終段の小節数を取り逃がす
- `new-page="yes"` は暗黙に新しい段でもある（ページ先頭は必ず段先頭）
- 先頭小節は明示の `<print>` がなくてもページ 0・段 0 の開始とみなす
- `<print>` を一切持たない MusicXML は「1 ページ・1 段・全小節」を返す（合成フィクスチャが該当）
- `parts` の解析ロジックには手を入れない（既存テストの退行を避ける）

### 2. BookStructureResolver（新規 `src/domain/score/BookStructureResolver.ts`）

**責務**:

- OMR の物理構造（book.xml のページ／movement 分割、sheet XML の段・stack）と MusicXML の段レイアウトを
  突き合わせて構造上の問題を検出する
- 確定構造 `ResolvedStructure`（段ごとの通し小節番号アンカー）を組み立てる

**インターフェース**:

```typescript
export type StructureIssue =
  | { kind: 'movementCountMismatch'; omrMovementCount: number; musicXmlCount: number }
  | { kind: 'pageCountMismatch'; movementIndex: number; omrPageCount: number; xmlPageCount: number }
  | {
      kind: 'systemCountMismatch';
      movementIndex: number;
      pageIndex: number;
      omrSystemCount: number;
      xmlSystemCount: number;
    }
  | {
      kind: 'systemMeasureCountMismatch';
      movementIndex: number;
      pageIndex: number;
      systemIndex: number;
      omrStackCount: number;
      xmlMeasureCount: number;
    }
  | {
      kind: 'fragmentedSystem';
      movementIndex: number;
      pageIndex: number;
      systemIndices: number[];
      staffCounts: number[];
    };

export type StructureDecision =
  /** 段の小節数をユーザー判断で上書きする */
  | { kind: 'systemMeasureCount'; pageIndex: number; systemIndex: number; measureCount: number }
  /** movement（ページ群）に対応づける MusicXML をユーザー判断で上書きする */
  | { kind: 'movementAssignment'; movementIndex: number; musicXmlIndex: number };

export class BookStructureResolver {
  detect(artifacts: OmrArtifacts, bookPages: BookPageRef[]): StructureIssue[];
  resolve(
    artifacts: OmrArtifacts,
    bookPages: BookPageRef[],
    decisions?: StructureDecision[],
  ): ResolvedStructure;
}
```

> 機能設計書の当初シグネチャは `detect(artifacts)` のみだったが、movement とページの対応は
> `book.xml`（`BookPageRef[]`）にしかないため引数を追加する。`OmrArtifacts` を汚さず、
> 既存の `parseBookXml` / `groupMovements` の戻り値をそのまま渡せる形にする。

**実装の要点**:

- **純粋関数として実装する**（I/O・zip 展開なし）。呼び出し側がパース済みの値を渡す。
  既存の `MusicXmlParser` / `OmrSheetParser` と同じ方針
- **movement 割当の既定**: `groupMovements(bookPages)` の i 番目のページ群に
  `musicXmlIndex = min(i, movements.length - 1)`（.mxl が足りない場合は末尾に寄せる。
  現行 `realFixtureHelpers` の挙動を踏襲）。数が食い違えば `movementCountMismatch` を報告
- **段の対応づけは序数**: movement の k 番目の OMR ページ ↔ MusicXML レイアウトの k 番目のページ、
  その中の j 番目の OMR 段 ↔ j 番目の XML 段。事前調査で divisi 20 ページすべてが 1:1 対応することを確認済み
- **小節数の決定順**: `systemMeasureCount` の decision → XML レイアウトの `measureCount` →
  OMR の `stacks.length`（フォールバック）。**必ず値が決まる**ため、情報が欠けても構造を返せる
- **movement をまたぐ累積**: 従来どおり MusicXML の論理小節数（パート間の最大値）で累積する。
  XML がない場合のみ段アンカーの累積値を使う（Victoria の 2 movement の番号付けを維持するため）
- **fragmentedSystem の検出**: 同一ページ内の**連続する** OMR 段のうち、stack 数が等しく
  stack 境界（left/right）が許容差内で一致し、かつ譜表集合が重複しないものを 1 グループとして報告する。
  先頭段はインデント（`indented`）で左端が異なるため、**先頭 stack の left は比較から除外**する。
  検出のみで統合はしない（requirements.md「スコープ外」参照）

### 3. ResolvedStructure（拡張 `src/shared/types/ResolvedStructure.ts`）

```typescript
/** 段（システム）1 つ分の確定小節割当 */
export interface ResolvedSystem {
  /** 曲全体のページ順（0始まり） */
  pageIndex: number;
  /** ページ内の段番号（0始まり） */
  systemIndex: number;
  /** この段の先頭小節の通し小節番号 */
  firstMeasureIndex: number;
  /** この段が担当する論理小節数 */
  measureCount: number;
}

export interface ResolvedMovement {
  musicXmlIndex: number;
  pageIndices: number[];
  /** 段ごとの確定小節割当（ページ順・段順） */
  systems: ResolvedSystem[];
}
```

`pageIndices` は StructureConfirm の表示材料として残す（どのページがどの movement に属するか）。
照合の駆動には `systems` を使う。

### 4. ScoreModelBuilder（変更）

**変更点**:

- ページ走査（`for pageIndex of movement.pageIndices` → `for system of page.systems`）をやめ、
  **`movement.systems`（確定アンカー）を走査**する
- `movementCursor += system.stacks.length` の累積を撤廃する
- 通し小節番号 `globalMeasureIndex = resolvedSystem.firstMeasureIndex + stackIndex`
- `stackIndex >= resolvedSystem.measureCount` の stack は `measureOutOfRange` として報告し、
  **その段の中で捨てる**（後続段の番号には影響しない）
- `SystemInfo.measureCount` は確定アンカーの値を入れる（従来は OMR の stack 数）
- MusicXML のローカル小節番号は `globalMeasureIndex - movementFirstMeasureIndex` で引く

**変更しない点**:

- `matchStack`（列対付け）・音高クロスチェック・skipped 隔離の方針は一切触らない。
  Phase 1 で実データ検証済みのため、退行させない

## データフロー

### 実フィクスチャ回帰（realFixtureHelpers）

```
1. assembleArtifacts({ omr, movements })            → OmrArtifacts（pages / movements）
2. unzipEntries(omr).get('book.xml') → parseBookXml → BookPageRef[]
3. new BookStructureResolver().detect(artifacts, bookPages)   → StructureIssue[]（要約に含める）
4. new BookStructureResolver().resolve(artifacts, bookPages)  → ResolvedStructure（decisions なし＝既定）
5. new ScoreModelBuilder().build(artifacts, structure, noCorrections) → BuildResult
```

### 将来の確認フロー（Phase 4 で結線）

```
1. detect() の StructureIssue[] を StructureConfirm 画面に表示
2. ユーザーが段の小節数・movement 割当を修正 → StructureDecision[]
3. resolve(artifacts, bookPages, decisions) → 確定構造
4. ScoreModelBuilder.build(...)
```

## エラーハンドリング戦略

### カスタムエラークラス

**新規追加しない。** 構造上の問題は例外ではなく `StructureIssue[]` として返す
（機能設計書「部分失敗は全体を失敗にしない」／`BuildIssue` と同じ方針）。

### エラーハンドリングパターン

| 状況                                                    | 扱い                                                                                            |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| MusicXML の段レイアウトが取れない                       | `stacks.length` にフォールバックし、issue も出さない（`<print>` なしは正常）                    |
| ページ数・段数が食い違う                                | `pageCountMismatch` / `systemCountMismatch` を報告し、対応がつく範囲だけアンカーする            |
| 段あたり小節数が食い違う                                | `systemMeasureCountMismatch` を報告。小節数は XML 側を採用（余剰 stack は `measureOutOfRange`） |
| `.mxl` が movement 数より少ない                         | `movementCountMismatch` を報告し、末尾 movement に寄せる（現行踏襲）                            |
| `ResolvedStructure` が存在しないページ／MusicXML を指す | 既存どおり `throw new Error`（呼び出し側の契約違反）                                            |

## テスト戦略

### ユニットテスト

- `tests/unit/domain/score/MusicXmlParser.test.ts`（追記）
  - `new-system` / `new-page` からレイアウトを抽出する
  - `<print>` なし → 1 ページ・1 段・全小節
  - 小節数が最大のパートからレイアウトを導出する（パートごとに小節数が違うケース）
- `tests/unit/domain/score/BookStructureResolver.test.ts`（新規）
  - `detect`: 段あたり小節数の不一致・ページ数不一致・段数不一致・movement 数不一致を検出する
  - `detect`: 誤分割（同一 stack 境界を共有する連続段）を検出する／正常な段では検出しない
  - `resolve`: 既定で XML レイアウトにアンカーし、`firstMeasureIndex` が連続する
  - `resolve`: XML レイアウトがない段は `stacks.length` にフォールバックする
  - `resolve`: `systemMeasureCount` / `movementAssignment` の decision が反映される
  - `resolve`: 複数 movement で通し小節番号が累積する
- `tests/unit/domain/score/ScoreModelBuilder.test.ts`（追記）
  - 段の `measureCount` を超える stack が `measureOutOfRange` になり、**後続段の小節番号がずれない**
  - `SystemInfo.measureCount` がアンカー値になる

### 統合テスト

- `tests/integration/pipeline/synthetic-mini.test.ts`: `resolveStructure` ヘルパーを
  `BookStructureResolver` に置き換えても既存の期待値が変わらないこと
- `tests/integration/pipeline/victoria-regression.test.ts`: **期待値を一切変えずにパスすること**（退行検知）
- `tests/integration/pipeline/divisi-regression.test.ts`: 構造解決後の実測値へ更新。
  併せて `detect()` が返す issue の件数も固定する

## 依存ライブラリ

**追加なし。**

## ディレクトリ構造

```
src/
├── domain/score/
│   ├── BookStructureResolver.ts       # 新規
│   ├── MusicXmlParser.ts              # 変更（layout 抽出）
│   └── ScoreModelBuilder.ts           # 変更（アンカー参照）
└── shared/types/
    └── ResolvedStructure.ts           # 変更（ResolvedSystem 追加）

tests/
├── unit/domain/score/
│   ├── BookStructureResolver.test.ts  # 新規
│   ├── MusicXmlParser.test.ts         # 追記
│   └── ScoreModelBuilder.test.ts      # 追記
├── integration/pipeline/
│   ├── realFixtureHelpers.ts          # 変更（Resolver 経由）
│   ├── synthetic-mini.test.ts         # 変更（Resolver 経由）
│   ├── victoria-regression.test.ts    # 期待値据え置き（退行検知）
│   └── divisi-regression.test.ts      # 期待値更新
└── fixtures/divisi/README.md          # 更新（真因の訂正・新実測値）
```

## 実装の順序

1. `MusicXmlParser` に段レイアウト抽出を追加（単体テスト）
2. `ResolvedStructure` に `ResolvedSystem` を追加
3. `BookStructureResolver` を実装（単体テスト）
4. `ScoreModelBuilder` をアンカー参照に変更（単体テスト追記）
5. `realFixtureHelpers` / `synthetic-mini` を Resolver 経由に置き換え
6. Victoria 回帰で退行がないことを確認 → divisi 回帰の期待値を実測で更新
7. 品質チェック（test / coverage / lint / typecheck / build）
8. ドキュメント更新・振り返り

> 手順 6 の順序は重要。**先に Victoria（退行検知）を通してから** divisi の期待値を更新する。
> 逆にすると「壊れた実装に期待値を合わせる」事故が起きる。

## セキュリティ考慮事項

- 本作業で追加するのはすべて純粋関数（domain 層）であり、ファイル I/O・子プロセス・ネットワークは扱わない
- 入力はすでにパース済みの構造体のみ。zip パストラバーサル等の防御は `omrArchive`（実装済み）が担う

## パフォーマンス考慮事項

- `detect` / `resolve` はページ数 × 段数の線形走査（実データで 20 ページ・最大 12 段）。無視できる
- 誤分割検出は同一ページ内の連続段の比較のみ（O(段数)）。総当たりは行わない

## 将来の拡張性

- `StructureDecision` に「段の統合」「譜表 → パート再割当」を追加できる形にしておく
  （`resolve` は decisions を種別ごとに解釈するため、種別追加が既存挙動を壊さない）
- `StructureIssue` はすべて位置情報（movementIndex / pageIndex / systemIndex）を持つため、
  StructureConfirm 画面がそのままハイライト位置として使える
