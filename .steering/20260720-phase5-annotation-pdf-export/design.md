# 設計

- 作業名: 20260720-phase5-annotation-pdf-export

## 全体方針

機能設計書のコンポーネント分割（`AnnotationManager` / `OverlayRenderer` / `writeExportPdf`）に従い、
**domain は純粋・storage が I/O・main が編成**という既存の依存方向を崩さない。
pdf-lib は純JSのため domain から使ってよい（機能設計書「OverlayRenderer の依存関係: pdf-lib」）が、
**ファイルは読まない**。元PDFのバイト列は編成レイヤーが渡す。

処理の流れ:

```
.omr ──parseSheetGeometry──> PageGeometry[]（記号の矩形・画像寸法）
元PDF ─buildPageInfos──────> PageInfo[]（Audiveris page → 元PDFページ、px→pt スケール）
ScoreModel（階名入り）─────> AnnotationManager.regenerate ──> Annotation[] ＋ 配置警告
Annotation[] ＋ 元PDF ─────> OverlayRenderer.render ────────> PDFバイト列
PDFバイト列 ───────────────> writeExportPdf ────────────────> 注釈付きPDF
```

## 1. `.omr` からの幾何情報の取り出し

### 型（`domain/score/OmrSheetParser.ts` に追加）

```typescript
/** 注釈配置で避ける記号 1 つ（座標は .omr の 300dpi 画像ピクセル） */
export interface OmrSymbol {
  /** sheet XML の要素名（'stem' | 'head' | 'beam' | 'alter' ...）。除外判断に使う */
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** sheet 単位の画像情報（**同一 sheet の全ページが共有する**。要求 発見2） */
export interface SheetImage {
  widthPx: number;
  heightPx: number;
  /** 譜線間隔。フォントサイズ・オフセットの基準（Victoria 17 / divisi 16） */
  interlinePx: number;
}

export interface SheetGeometry {
  /** `<picture>` か `<scale><interline>` が欠けていれば null（幾何情報なしとして扱う） */
  image: SheetImage | null;
  /** sheet 内のページ順。`parseSheetXml(...).pages` と同じ順・同じ長さ */
  pages: { symbols: OmrSymbol[] }[];
}

export function parseSheetGeometry(xml: string): SheetGeometry;
```

**設計判断: `OmrPageContent` を拡張しない。**
記号矩形は照合（`ScoreModelBuilder`）には一切不要で、既存の型に足すと 20 箇所以上の
テストフィクスチャが本題と無関係なデータを抱えることになる。`bookPages` と同じく
**編成レイヤーが別途持つ第2の成果物**として扱う（`ProjectSession.LoadedOmr` に追加）。

**設計判断: 細線も収集して kind で残す。**
除外は配置側（`placementResolver`）の判断であり、パーサは事実だけを返す。
こうすると「符幹は障害物ではない」という設計意図がテストで直接検証できる。

### ページ順の担保（`main/omr/omrArchive.ts`）

`assembleArtifacts` と同じ sheet 並び（`sheet#N` の N 昇順）で走る `assemblePageGeometry(omr)`
を追加する。**並び順の計算は共通関数へ切り出し**、片方だけ変わって `pages` と `geometry` が
静かにずれる事故を構造的に防ぐ（`structureAnchors` を共有したのと同じ手当て）。

## 2. 元PDFページとの対応（`PageInfo` の実値化）

### `BookPageRef` の拡張

book.xml の `<sheet><input><number>` を読み、`sourcePageNumber`（1始まり）を持たせる。
属性が無い古い book.xml では **sheet 番号で代替**する（1 sheet = 1 ページの通常ケースでは一致する）。

### `PageInfo` の拡張（`shared/types/Project.ts`）

```typescript
export interface PageInfo {
  /** Audiveris のページ添字（= PageAnchor.pageIndex）。0始まり */
  pageIndex: number;
  /** 元PDF のページ添字。0始まり。**pageIndex とは一致しない**（要求 発見1） */
  sourcePageIndex: number;
  widthPt: number;
  heightPt: number;
  omrImageWidthPx: number;
  omrImageHeightPx: number;
}
```

`sourcePageIndex` の追加でスキーマは変わるが **`SCHEMA_VERSION` は 1 のまま**にする。
Phase 4 までに保存され得る `.solfaproj` の `pages` は必ず空配列であり
（`PageInfo` は Phase 5 で埋めると型に明記されていた）、要素の形が変わっても
既存ファイルの読み込みは壊れない。Zod スキーマだけ更新する。

### `domain/render/pageInfo.ts`

```typescript
export interface PageInfoIssue {
  kind: 'sourcePageMissing' | 'sheetGeometryMissing';
  pageIndex: number;
  sourcePageIndex?: number;
}

export interface PageInfoResult {
  pages: PageInfo[];
  issues: PageInfoIssue[];
}

export function buildPageInfos(
  sourcePdf: Uint8Array,
  geometry: readonly PageGeometry[],
  bookPages: readonly BookPageRef[],
): Promise<PageInfoResult>;
```

- pdf-lib の `PDFDocument.load` でページ寸法を取る。**`/Rotate` が 90 / 270 の場合は
  幅と高さを入れ替える**（`getSize()` は回転前の MediaBox を返すため、そのまま使うと
  横向きスキャンで縦横が入れ替わった座標に描いてしまう）
- 参照先の PDF ページが存在しない・幾何情報が無いページは **issue にして該当ページを飛ばす**
  （例外にしない。1 ページの欠落で出力全体を落とさない＝部分失敗で作業を止めない原則）

## 3. 注釈の配置（`domain/annotations/placementResolver.ts`）

### 障害物と細線

```typescript
/** 重なっても判読を妨げない細い線（要求 発見3。除外で解決不能が 766 → 44 件） */
export const THIN_SYMBOL_KINDS: ReadonlySet<string> = new Set(['stem', 'ledger']);
```

### 候補位置の梯子（実測で決めた 10 段）

符頭中心 x・符頭上端 y を基準に、`interlinePx` 単位で並べる:

| #   | 位置          | 意図                                      |
| --- | ------------- | ----------------------------------------- |
| 0   | 直上          | 基本位置（Victoria 89.2% / divisi 61.1%） |
| 1   | さらに 1 段上 | 直上が埋まっている                        |
| 2   | 直下          | 上が詰まっている（低音部で多い）          |
| 3   | さらに 1 段下 |                                           |
| 4   | 左斜め上      | 横にずらす                                |
| 5   | 右斜め上      |                                           |
| 6   | 2 段上        | 密集段                                    |
| 7   | 2 段下        |                                           |
| 8   | 左斜め下      |                                           |
| 9   | 右斜め下      |                                           |

どれも空かなければ **基本位置（#0）に置き、`placementUnresolved` として報告**する
（機能設計書「アルゴリズム設計」ステップ4）。

### 探索の効率化

障害物と配置済み注釈は**一様格子（セル = interline × 4）に索引**する。
ページあたり障害物 930・注釈 283 の実測に対し、素朴な総当たりは
5,000 注釈の性能要件（アーキテクチャ設計書）に対して余裕がない。

### 文字寸法は近似せず実メトリクスを使う（`domain/render/fontMetrics.ts`）

当初は `text.length × fontPx × 0.55` の近似を予定していたが、**pdf-lib の
`StandardFontEmbedder.for(fontName)` が同期で正確なメトリクスを返す**ことが分かったため
近似をやめる。配置と描画が同じ関数で寸法を測れば、「配置は収まると判断したのに
描画すると重なる」という食い違いが原理的に起きない。

```typescript
export interface TextMetrics {
  /** 描画に使う実際の文字列（♯ ♭ の置換済み） */
  displayText(text: string): string;
  widthPt(text: string, fontSizePt: number): number;
  /** アセンダ高。階名の音節は小文字のみでディセンダを持たない */
  ascentPt(fontSizePt: number): number;
}

export function standardFontMetrics(fontFamily: string, bold: boolean): TextMetrics;
```

- 高さは em 全体ではなく**アセンダ高**（`heightOfFontAtSize(size, { descender: false })`）。
  em 全体で判定すると divisi の解決不能が 25 → 54 件に倍増する（要求 発見3 の副産物）
- **`♯` `♭` の置換をここに置く**。`widthOfTextAtSize` は描画前でも WinAnsi の
  エンコードを行うため、置換しないと**幅の計測時点で例外になる**（計測で実証済み）。
  置換を計測と描画の共通の入口に置くことで、両者が必ず同じ文字列を扱う
- `StandardFontEmbedder.for` は同期のため、`analyze()` を非同期化せずに済む
  （非同期化すると IPC ハンドラの同期・非同期の切り分けまで波及する）

## 4. `domain/annotations/AnnotationManager.ts`

```typescript
export interface RegenerateInput {
  score: ScoreModel;
  geometry: readonly PageGeometry[];
  settings: ProjectSettings;
  /** 既存の注釈（手動注釈・削除フラグの引き継ぎ元） */
  existing: readonly Annotation[];
}

export interface RegenerateResult {
  annotations: Annotation[];
  issues: AnnotationIssue[];
}

export type AnnotationIssue =
  | { kind: 'placementUnresolved'; annotationId: string; pageIndex: number }
  | { kind: 'missingPageGeometry'; pageIndex: number }
  | { kind: 'orphanAnnotation'; annotationId: string };
```

**機能設計書のシグネチャ `regenerate(score, degrees)` から変えた理由**:

1. `degrees` は不要。`applyDegrees` 済みの `ScoreModel` が `note.solfa` を持つ
   （Phase 3 が「AnnotationManager のために用意した」と明記している）
2. 配置に `geometry`（記号矩形）と `settings`（音節体系・フォントサイズ）が要る
3. 手動注釈の保全には既存注釈列が要る

**注釈 id**: `solfa-<noteId>`。再生成しても同じ音符には同じ id が付くため、
`deleted` と手動上書き `text` が id だけで引き継げる（`mergeCorrections` と同じ考え方）。

**保全の規則**:

- `origin: 'manual'` の注釈はそのまま残す
- 自動注釈は毎回作り直すが、既存同 id の `deleted` と `text` を引き継ぐ
- 対応する音符が消えた自動注釈は捨てず、`noteId` を保ったまま `orphanAnnotation` として報告する
  （機能設計書「照合できない場合は孤立注釈として修正UIに提示する」）

## 5. `domain/render/coordinateTransform.ts`

```typescript
export interface PagePlacement {
  /** 元PDF のページ添字 */
  sourcePageIndex: number;
  /** ベースライン座標（PDF ポイント・左下原点） */
  x: number;
  y: number;
  fontSizePt: number;
}

export function toPdfPlacement(page: PageInfo, anchor: PageAnchor, fontPx: number): PagePlacement;
```

- `sx = widthPt / omrImageWidthPx`、`sy = heightPt / omrImageHeightPx` を**別々に**求める
  （元PDFと .omr 画像のアスペクト比が一致する保証がない。実測でも divisi は A4 でない）
- PDF は左下原点のため `y_pt = heightPt - y_px * sy`
- `Annotation.anchor` は注釈矩形の**左下**（＝描画ベースライン）とする。
  `drawText` の y がベースラインであることに合わせ、変換を 1 か所に閉じる

## 6. `domain/render/OverlayRenderer.ts`

```typescript
export interface RenderInput {
  sourcePdf: Uint8Array;
  project: Project;
}

export interface RenderResult {
  bytes: Uint8Array;
  issues: RenderIssue[];
}

export type RenderIssue =
  | { kind: 'pageInfoMissing'; pageIndex: number }
  | { kind: 'characterSubstituted'; from: string; to: string; count: number }
  | { kind: 'invalidColor'; value: string };
```

**機能設計書の `render(project)` から変えた理由**: `Project.sourcePdf` は
プロジェクト内の**相対パス文字列**であり、domain はファイルを読めない。バイト列を受け取る。

- **元PDFを load して描き足すだけ**にする（`PDFDocument.load` → `drawText` → `save`）。
  新規ドキュメントへコピーすると版面・フォント・しおりが失われる
- フォント: `fontFamily` → 標準14フォント（`sans-serif`→Helvetica /
  `serif`→TimesRoman / `monospace`→Courier / 既定 Helvetica）。
  埋め込みフォントは同梱ファイルが要るためスコープ外。**対応表は `fontMetrics` と共有**する
  （配置と描画で別のフォントを使うと寸法が合わない）
- **文字の置換（要求 発見4）**: `fontMetrics.displayText` を通した文字列だけを描く。
  置換が起きた注釈は `characterSubstituted` として報告し、**無言で化けさせない**
- 色: `#rrggbb` を `rgb()` へ。読めない値は既定色へフォールバックして報告
- `deleted: true` と `layer !== 'solfa'` は描かない
- 変化音（`alteration !== 0`）は `chromaticColor` ＋ 太字系フォント（Helvetica-Bold 等）。
  モノクロ印刷でも書体差で区別できるようにする（機能設計書「カラーコーディング」）

## 7. `storage/writeExportPdf.ts`

```typescript
export interface ExportFileOps {
  rename(from: string, to: string): Promise<void>;
}

export function writeExportPdf(
  outPath: string,
  pdfBytes: Uint8Array,
  deps?: { fileOps?: ExportFileOps },
): Promise<void>;
```

`ProjectStore.save` と同じ原子的書き込み（**保存先と同じディレクトリ**の一時ファイル → リネーム）。
失敗時は一時ファイルを消して `ProjectFileError(reason: 'io')` にする。
`FileOps` を注入できるのも同じ理由（リネーム失敗の経路が実FSでは再現しづらい）。

世代バックアップは**行わない**。出力PDFは中間成果物であり、プロジェクトファイルと違って
失われても `.solfaproj` から再生成できる。

## 8. 編成（`main/ProjectSession.ts`）

- `LoadedOmr` に `geometry: PageGeometry[]` を追加
- `importPdf` / `open` の直後に `buildPageInfos` を呼び `project.pages` を埋める
  （元PDFの読み直しが要らないよう、`sourcePdf` は既に保持している）
- `analyze()` の末尾に注釈生成を追加。`project.annotations` を更新し、
  `AnnotationIssue[]` を `lastIssues` と同じ形でスナップショットに載せる
- `exportPdf(outPath)` を追加:
  - `confirmation.completedAt === null` なら例外（F-2 のゲート）
  - `OverlayRenderer.render` → `writeExportPdf`
  - 戻り値に `RenderIssue[]` と配置警告件数を含める

## 9. IPC と Editor 画面

### チャネル追加

| チャネル               | 内容                                    |
| ---------------------- | --------------------------------------- |
| `dialog:saveExportPdf` | 出力先の選択（キャンセルは null）       |
| `project:exportPdf`    | `(outPath) => IpcResult<ExportSummary>` |

```typescript
export interface ExportSummary {
  outPath: string;
  annotationCount: number;
  /** 配置を解決できなかった注釈の数（人手調整の目安） */
  unresolvedPlacements: number;
  renderIssues: RenderIssue[];
}
```

### `Editor` 画面（`src/renderer/screens/Editor/Editor.tsx`）

Phase 5 は**テキストによる最小表示**に留める（PDF.js キャンバスは Phase 6）。表示項目:

| 項目                 | 内容                                                      |
| -------------------- | --------------------------------------------------------- |
| 概要                 | パート数・小節数・音符数・注釈数                          |
| 階名プレビュー       | パート×小節の階名列（先頭数十小節。ページ送りは持たない） |
| スキップ小節一覧     | `listSkippedMeasures` の結果                              |
| 配置警告             | `placementUnresolved` の件数と該当ページ                  |
| 適用されなかった訂正 | `unmatchedCorrections`（Phase 4 からの申し送り③を解消）   |
| PDF出力ボタン        | 承認前は無効化し、理由を併記                              |
| 確認画面へ戻る       | 画面遷移図どおり ClefKeyConfirm へ                        |

**`Export` 画面は作らない。** 画面遷移図には Export が独立してあるが、実体は
「保存先ダイアログ → 書き出し → 結果表示」の一過性の操作であり、状態を持つ画面にすると
Editor と同じ内容を二重に描くことになる。出力結果は Editor 内に表示する。
（機能設計書の画面遷移図を実装に合わせて更新する）

## テスト方針

| 対象                       | 種別           | 主な観点                                                    |
| -------------------------- | -------------- | ----------------------------------------------------------- |
| `parseSheetGeometry`       | 単体           | 記号収集・image 欠落時 null・ページ順                       |
| `buildPageInfos`           | 単体           | sheet→PDFページ対応・回転90/270・ページ不足の issue 化      |
| `placementResolver`        | 単体           | 梯子の順序・細線の除外・解決不能・格子索引が総当たりと一致  |
| `AnnotationManager`        | 単体           | 手動保全・deleted 引き継ぎ・孤立注釈・id 安定性             |
| `coordinateTransform`      | 単体           | y 反転・x/y 別スケール・境界値                              |
| `OverlayRenderer`          | 単体           | ページ数と寸法の保存・♯♭ 置換・色・deleted 除外             |
| `writeExportPdf`           | 単体           | 原子性・上書き・失敗時に残骸なし（`FileOps` で失敗注入）    |
| `ProjectSession.exportPdf` | 単体           | 承認ゲート・委譲                                            |
| 実データ通し               | 統合           | Victoria / divisi で注釈数・解決不能数・出力PDFのページ寸法 |
| `Editor`                   | コンポーネント | 承認前の無効化・各一覧の表示・出力成功/失敗の表示           |

**元PDFのフィクスチャが無い問題**: `tests/fixtures/` には `.omr` と `.mxl` しか無い
（PD楽譜のPDF本体は数十MBでリポジトリに入れていない）。統合テストでは
**pdf-lib で実測どおりの寸法（Victoria 595.2×841.7pt / divisi 577.9×756pt）の
空PDFを生成**して元PDFの代わりにする。検証したいのは px→pt の線形変換と
ページ対応であり、版面の中身には依存しない。

## リスクと対策

| リスク                                          | 対策                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| Audiveris ページと元PDFページの対応を取り違える | 実データ 2 曲（4→3 と 20→20）で対応を統合テストに固定              |
| 文字幅の近似で隣接注釈がわずかに重なる          | 近似であることを明記し、幅に安全係数を持たせる                     |
| 5,000 注釈で配置探索が遅い                      | 格子索引。divisi 3,500 注釈の実行時間を統合テストで確認            |
| 標準フォントで描けない文字で出力が全滅する      | 置換経路を必ず通し、divisi（`do♭` を含む）を統合テストの対象にする |
