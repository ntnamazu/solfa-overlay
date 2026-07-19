# 設計書

- 作業名: 20260718-musicxml-parser
- 対応要求: [requirements.md](requirements.md)

## アーキテクチャ概要

サービスレイヤー（`src/domain/score/`）に閉じた純粋TSの実装。ファイル I/O・zip 展開は行わず、
XML **文字列**を入力に取る（呼び出し側の編成レイヤーが将来 fflate で展開して渡す）。

```
 (編成レイヤー: 将来の OmrRunner / IPC ハンドラ)
        │  XML文字列（MusicXML・sheet XML・book.xml）
        ▼
┌──────────────────────── src/domain/score/ ────────────────────────┐
│ xmlTree.ts          fast-xml-parser(preserveOrder) の出力を        │
│                     ElementTree 風の XmlElement に変換する共通基盤  │
│    │                                                              │
│    ├─ MusicXmlParser.ts   → ParsedMusicXml（論理: パート×小節×音符）│
│    ├─ OmrSheetParser.ts   → OmrPageContent / BookPageRef（物理）   │
│    │                                                              │
│    └─ ScoreModelBuilder.ts                                        │
│         入力: OmrArtifacts + ResolvedStructure + ConfirmationState │
│         処理: 小節照合・音高クロスチェック（clefTable.ts を参照）     │
│         出力: BuildResult { score: ScoreModel, issues: BuildIssue[] }│
└───────────────────────────────────────────────────────────────────┘
        ▼
   ScoreModel（src/shared/types/ScoreModel.ts）→ 次作業で SolfaEngine へ
```

## コンポーネント設計

### 1. xmlTree.ts（XML パース共通基盤）

**責務**:
- fast-xml-parser（`preserveOrder: true`）の出力を、子要素の文書順を保った
  `XmlElement { name, attrs, children, text }` ツリーへ変換する
- `find / findAll / findText / attr` 等の最小限のヘルパー（Python ElementTree 相当の使い勝手）

**実装の要点**:
- `preserveOrder` が必須（MusicXML の `note` / `backup` / `forward` の出現順がオフセット計算に
  不可欠。既定モードは同名タグでグルーピングされ順序が失われる）
- パース失敗（不正XML）は `ScoreParseError` に変換する

### 2. MusicXmlParser.ts

**責務**: score-partwise の MusicXML 文字列 → `ParsedMusicXml`

```typescript
interface ParsedMusicXml { parts: MusicXmlPart[] }
interface MusicXmlPart { id: string; name: string; measures: MusicXmlMeasure[] }
interface MusicXmlMeasure {
  index: number;                     // この MusicXML（movement）内の 0 始まり
  key: MusicXmlKey | null;           // この小節で宣言された調号（宣言がなければ null）
  notes: MusicXmlNote[];             // 発音音符のみ（休符除外）。譜面順
}
interface MusicXmlKey { fifths: number; mode: 'major' | 'minor' | null }
interface MusicXmlNote {
  pitch: Pitch;                      // shared/types/Pitch
  isChordTone: boolean;              // <chord/> 付き（直前音と同時発音）
  offset: number;                    // 小節内オフセット（divisions 基準）
  staff: number | null;              // <staff>（多譜表パート用。合唱では通常 null）
}
```

**実装の要点**:
- `part-list/score-part` から id→name を取る（`part-name` 欠落時は id をそのまま名前に）
- divisions は `attributes/divisions` で更新され以降の小節へ持続する
- オフセット計算: カーソル方式。`note` は duration 分進める（`<chord/>` は直前音と同オフセット・
  カーソルを進めない。grace は duration なし=0）。`backup`/`forward` はカーソルを戻す/進める
- 休符（`<rest/>` または `pitch` なし）は notes に含めないが duration でカーソルは進める
- `alter` は小数があり得るため `Math.trunc(parseFloat(...))` で整数化（プロトタイプと同じ）
- `score-timewise` はサポート外として `ScoreParseError` にする（Audiveris は partwise を出力）

### 3. OmrSheetParser.ts

**責務**: sheet XML / book.xml の文字列 → 物理構造

```typescript
// sheet XML（1ファイルに複数ページがあり得る）
function parseSheetXml(xml: string): OmrSheetContent;   // { pages: OmrPageContent[] }
interface OmrPageContent { systems: OmrSystem[] }
interface OmrSystem { stacks: OmrStack[]; staves: OmrStaff[] }
interface OmrStack { left: number; right: number }       // 小節の水平範囲（300dpi px）
interface OmrStaff {
  partId: string;                    // 'P' + part@id（= MusicXML の part id = logical-id）
  staffId: string;
  clefKind: string | null;           // システム内で最初に現れた clef の kind（Audiveris 表記）
  heads: OmrHead[];                  // x 昇順
}
interface OmrHead { pitch: number; x: number; y: number; w: number; h: number }

// book.xml
function parseBookXml(xml: string): BookPageRef[];
interface BookPageRef { sheetNumber: number; pageIndexInSheet: number; movementStart: boolean }
function groupMovements(pages: BookPageRef[]): BookPageRef[][];  // 先頭ページは暗黙に movement 開始
```

**実装の要点**:
- プロトタイプ実証済みのスキーマに準拠: `sheet > page > system > (stack | part > staff)`、
  inter 要素は system 配下を再帰走査して `clef`（staff, kind）と `head`（staff, pitch, bounds）を拾う
- `bounds` を持たない head は無視（プロトタイプと同じ）
- 段中の音部記号変更は v1 では非対応（最初の clef を採用。プロトタイプと同じ制約）

### 4. clefTable.ts（音部記号 → 譜表中線の音）

```typescript
const CLEF_MIDDLE_LINE: Record<string, { stepIndex: number; octave: number }>;
// TREBLE / G_CLEF → B4, TREBLE_DOWN_8 → B3, BASS / F_CLEF → D3, ALTO → C4, TENOR → A3
function headStepOctave(headPitch: number, clefKind: string | null):
  { step: PitchStep; octave: number } | null;   // 未知の clef は null（チェック不能）
```

- Audiveris の符頭 pitch は「中線=0・下向き正」（音高とは逆方向）— 実装箇所にコメントで残す

### 5. ScoreModelBuilder.ts

**責務**: 照合と `ScoreModel` 構築（機能設計書「小節照合」の移植）

```typescript
interface OmrArtifacts {
  movements: { musicXml: ParsedMusicXml }[];  // movement ごとの MusicXML（曲順）
  pages: OmrPageContent[];                    // 曲全体のページ順
}
interface BuildResult { score: ScoreModel; issues: BuildIssue[] }
type BuildIssue =
  | { kind: 'measureCountMismatch'; partId; measureIndex; omrCount; xmlCount; pageIndex; systemIndex }
  | { kind: 'pitchCrossCheckMismatch'; noteId; partId; measureIndex; expectedStep; omrStep }
  | { kind: 'unknownClef'; pageIndex; systemIndex; staffIndex; partId; clefKind }
  | { kind: 'partNotFound'; partId; pageIndex; systemIndex }
  | { kind: 'measureOutOfRange'; partId; pageIndex; systemIndex; measureIndex };

class ScoreModelBuilder {
  build(artifacts: OmrArtifacts, structure: ResolvedStructure,
        confirmation: ConfirmationState): BuildResult;
}
```

**照合アルゴリズム**（プロトタイプ `process_movement` の移植＋通し小節番号化）:
1. movement ごとに movement 内小節カーソル=0 から開始。`ResolvedStructure.movements[].pageIndices`
   の順にページ→システムを走査
2. システムごとに: 各譜表の有効 clef = 確認画面の corrected（あれば）→ なければ検出値。
   corrected は Audiveris kind 表記（例: 'TREBLE_DOWN_8'）で保持する
3. stack（小節）ごとに: 符頭中心 x が [left, right) に入る head 列と、対応する MusicXML 小節の
   発音音符列の数を比較。一致→順に対にして NoteEvent 化＋クロスチェック。不一致→ skipped
4. 同一 partId が複数譜表にまたがるシステム（鍵盤等）は、MusicXML 音符を `staff` 番号で
   譜表ごとに分けてから照合（プロトタイプ未対応の拡張。合唱 v1 では通常1譜表=1パート）
5. システム走査後にカーソル += stacks 数。movement 間は通し小節番号（曲頭からの累積）に変換
6. NoteEvent.id は決定的に採番: `{partId}:m{通し小節}:n{小節内連番}`（OMR 再実行時の注釈
   引き継ぎ照合を安定させるため）

**Measure の生成規則**:
- 処理した「パート×小節」ごとに 1 つ生成（matched / skipped）。`ScoreModel.measures` は
  partId → 通し小節番号順に整列
- `ScoreModel.systems` は SystemInfo（pageIndex / systemIndex / firstMeasureIndex / measureCount）
- `ScoreModel.parts` の staves は走査中に出現した StaffRef を収集

### 6. 共有型定義（src/shared/types/）

- `ScoreModel.ts`: ScoreModel / Part / Measure / NoteEvent / PageAnchor / SystemInfo / StaffRef
  （機能設計書のエンティティ定義を転記。SystemInfo は上記の最小形で定義）
- `Confirmation.ts`: ConfirmationState / ConfirmationItem（転記。corrected の clef は
  Audiveris kind 表記で保持する旨をコメント）
- `ResolvedStructure.ts`: v1 最小形（movement → musicXmlIndex + pageIndices）。
  BookStructureResolver 実装時に拡張する

## エラーハンドリング戦略

```typescript
/** OMR 成果物のパース失敗（予期されるエラー。UIで「認識結果を読み込めない」として扱う） */
class ScoreParseError extends Error {
  constructor(message: string, public readonly source: 'musicxml' | 'sheet' | 'book') { ... }
}
```

- パース失敗（不正XML・必須要素欠落）→ `ScoreParseError` を投げる（呼び出し側が UI エラー化）
- 照合の不一致・範囲外・未知 clef は**例外にせず** `BuildIssue` として蓄積し、部分結果を返す
  （機能設計書「部分失敗は全体を失敗にしない」）

## テスト戦略

### ユニットテスト（tests/unit/domain/score/）
- `xmlTree.test.ts`: 属性・文書順・テキスト・エンティティ・不正XMLのエラー化
- `MusicXmlParser.test.ts`: 複数パート／和音／休符除外／alter／調号変更／divisions／
  backup・forward のオフセット／grace／part-name 欠落／不正XML
- `OmrSheetParser.test.ts`: sheet 構造抽出（x 昇順ソート・bounds 欠落 head 無視・最初の clef 採用）、
  book.xml の movement 分割（movement-start / 先頭ページ暗黙開始）
- `clefTable.test.ts`: 全 clef の中線定義と逆算（プロトタイプ CLEF_MIDDLE と同値）・未知 clef
- `ScoreModelBuilder.test.ts`: matched 対付け／skipped 隔離／クロスチェック不一致／clef 修正反映
  （テノール G→G-8vb で不一致が解消するシナリオ）／複数 movement 通し番号／多譜表パート分割

### 統合テスト（tests/integration/pipeline/）
- `synthetic-mini.test.ts`: 合成フィクスチャ（ファイル読込は node:fs = テスト側でOK）で
  「XML文字列 → パース → 照合 → ScoreModel」を通し、matched/skipped/issue 数と代表音符の
  座標・音高を固定する回帰テスト

### フィクスチャ（tests/fixtures/synthetic-mini/）
- `score.musicxml`（2パート×4小節: 和音・休符・臨時記号・意図的な音符数不一致1小節を含む）
- `sheet1.xml`（1ページ・2システム×2譜表・stack 各2）/ `book.xml`（1 sheet・1ページ）
- README.md にフィクスチャの意図（どの小節が何を検証するか）を記載

## 依存ライブラリ

```json
{ "dependencies": { "fast-xml-parser": "^5" } }
```

- 選定理由: TS/JS に標準の XML パーサがなく（Node に DOMParser なし）、プロトタイプの
  ElementTree に相当する基盤が必要。fast-xml-parser は純JSでネットワークアクセスなし
  （「ネットワークアクセスを行う依存を追加しない」規約に適合）
- バージョン検討の経緯: v4 は依存1個（strnum）だが XMLBuilder に moderate の既知脆弱性
  （GHSA-gh4j-gqv2-49f6。パーサ側は非該当）があり npm audit に警告が残るため、修正済みの v5 を採用。
  v5 の transitive 依存6個はすべて同一メンテナのモジュール分割で、ネットワーク・fs・child_process への
  アクセスがないことを grep で確認済み
- `preserveOrder: true` で文書順を保持し、xmlTree.ts で扱いやすい形に変換して使う
- architecture.md の依存関係管理表へ追記する（フェーズ最後のドキュメント更新）

## ディレクトリ構造

```
src/domain/score/
├── xmlTree.ts            # XML→XmlElement 変換＋走査ヘルパー
├── errors.ts             # ScoreParseError
├── MusicXmlParser.ts
├── OmrSheetParser.ts
├── clefTable.ts
└── ScoreModelBuilder.ts
src/shared/types/
├── ScoreModel.ts
├── Confirmation.ts
└── ResolvedStructure.ts
tests/unit/domain/score/  # 上記のミラー
tests/integration/pipeline/synthetic-mini.test.ts
tests/fixtures/synthetic-mini/{score.musicxml, sheet1.xml, book.xml, README.md}
```

## 実装の順序

1. fast-xml-parser 追加 → shared 型定義 → xmlTree.ts（基盤から）
2. MusicXmlParser → OmrSheetParser（+ clefTable）→ ScoreModelBuilder（依存順）
3. 各コンポーネントのユニットテストは実装直後に書く（カバレッジ90%維持）
4. 合成フィクスチャ＋統合テスト → 品質チェック → ドキュメント更新

## セキュリティ考慮事項

- 入力 XML はローカルの Audiveris 出力のみだが、fast-xml-parser は DTD の外部実体解決を行わない
  （XXE 耐性）。ネットワークアクセスを行うコードパスは追加しない
- domain の純粋性維持（node:* / Electron import 禁止は ESLint が強制）

## パフォーマンス考慮事項

- 5,000音規模で全処理が一括ループでも十分高速（プロトタイプは Python で数秒）。
  照合は システム→譜表→stack の線形走査で O(音符数)

## 将来の拡張性

- BookStructureResolver 実装時: `ResolvedStructure` に譜表→パート再割当・システム統合の
  表現を追加し、ScoreModelBuilder は確定構造への追従のみで対応できる形にしておく
- Victoria 実フィクスチャ導入時: `synthetic-mini.test.ts` と同じ構図で
  `victoria-regression.test.ts`（784音・ミスマッチ0・skipped 5小節）を追加する
