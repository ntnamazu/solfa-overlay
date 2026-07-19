# 要求内容

- 作業名: 20260719-book-structure-resolver（Phase 2: 譜表構造の解決）

## 概要

`BookStructureResolver` を実装し、Audiveris の譜表構造検出のブレ（システムの誤分割・段あたり小節数の
食い違い）を検出・復元して確定構造（`ResolvedStructure`）を出力する。`ScoreModelBuilder` の通し小節番号を
「OMR の stack 数の累積」から「MusicXML の段レイアウトに固定（アンカー）した番号」へ切り替える。

## 背景

### Phase 1 の申し送り

Phase 1（20260719-omr-runner-real-fixtures）で divisi 実フィクスチャ《The Message of the Angels》を
検証した結果、**561 小節が skipped** になり「構造誤分割のため Phase 2 待ち」とベースライン commit した。
当時の推定原因は「声部の段階的入りによる構造誤分割」だった。

### 本作業の事前調査で判明した真因（推定の訂正）

実データを再調査した結果、**skipped の主因は声部の段階的入りではなかった**。定量的に切り分けた事実:

1. **ページ・段の対応は 20 ページすべてで 1:1 に一致している**（OMR 20 ページ / MusicXML 20 ページ、
   各ページの段数も一致）。MusicXML の `<print new-system>` / `<print new-page>` による段レイアウトと
   `.omr` の system 構成は同じ構造を指している。
2. **段あたりの小節数が食い違うのは 20 ページ中わずか 2 か所**（page5 の第2段: XML 7 / OMR 8、
   page10 の第2段: XML 7 / OMR 8）。`.omr` の総 stack 数 331 に対し MusicXML の総小節数は 329。
3. `ScoreModelBuilder` は通し小節番号を **OMR の stack 数の累積**で決めるため、この +1 のズレが
   **以降の全ページに波及**する。実際、mismatch はページ 0〜5 では 0〜1 件なのに対し、
   ドリフトが始まる page 6 以降で急増していた（page 7 以降は 1 段あたり 11〜28 件）。
4. **検証**: 該当 2 段の余剰 stack を除去して再実行すると
   **skipped 561 → 135・matched 604 → 1029・照合音符 1433 → 3500** に改善した（実測）。

つまり Phase 2 で解くべきは「1 段のローカルな不一致を全体に波及させないこと」であり、
BookStructureResolver の中核はそのためのアンカー（段 → 通し小節番号の固定）である。

### 誤分割（fragmented system）について

事前調査で、page 0 / 4 / 6 / 11 / 16 に「同一の stack 境界を共有する連続 system」が存在することも
確認した（例: page 0 は本来 2 段のところ 4 個の system に分断され、譜表 1〜2 / 3〜5 / 6〜8 / 9〜14 に
割れている）。ただし **MusicXML 側もまったく同じ分断を反映して出力されている**ため、小節番号の整合は
崩れておらず、これらのページの mismatch は 0 件だった。したがって本作業では
**検出して StructureConfirm 画面の材料として報告するに留め、自動的な統合（マージ）は行わない**
（マージすると MusicXML 側の段レイアウトと整合しなくなり、かえって破綻するため）。

## 実装対象の機能

### 1. MusicXmlParser の段レイアウト抽出

- `<print new-page="yes">` / `<print new-system="yes">` から、MusicXML が表現する
  「ページ → 段 → 小節数」のレイアウトを抽出する
- 既存の `ParsedMusicXml` に `layout` を追加する（`parts` の解析には影響を与えない）

### 2. BookStructureResolver（新規コンポーネント）

- `detect(artifacts)`: OMR の物理構造（book.xml / sheet XML 由来）と MusicXML の段レイアウトを
  突き合わせ、`StructureIssue[]`（ページ数不一致・段数不一致・段あたり小節数不一致・誤分割の疑い）を返す
- `resolve(artifacts, decisions)`: 検出結果とユーザー判断（`StructureDecision[]`）から
  確定構造 `ResolvedStructure` を組み立てる。既定（decisions 空）は MusicXML レイアウトへのアンカー
- ユーザー判断がない段は MusicXML の小節数を採用し、MusicXML 側にも情報がない場合は OMR の stack 数へ
  フォールバックする（情報が欠けても必ず構造を返す＝部分失敗は全体を失敗にしない）

### 3. ResolvedStructure の拡張

- `ResolvedMovement` に `systems: ResolvedSystem[]` を追加し、各段が
  `pageIndex` / `systemIndex` / `firstMeasureIndex` / `measureCount` を明示的に持つようにする
- 「movement をまたいで通し小節番号を累積する」という既存の意味は維持する

### 4. ScoreModelBuilder のアンカー対応

- 通し小節番号を `structure` の段アンカーから引くように変更する（stack 数の累積をやめる）
- 段の `measureCount` を超える stack は `measureOutOfRange` として当該段内に隔離し、後続段へ波及させない
- `ScoreModel.systems`（`SystemInfo`）はアンカーの値をそのまま反映する

### 5. 回帰テストの更新

- `divisi-regression.test.ts` を「Phase 2 前ベースライン」から「構造解決後の回帰」に更新する
- `victoria-regression.test.ts` の期待値は**変えない**（インチピットによる 2 movement 分割は既に正しく
  扱えており、本変更で退行させないことが要件）

## 受け入れ条件

### MusicXmlParser の段レイアウト抽出

- [x] divisi フィクスチャで 20 ページ・各ページの段ごとの小節数を抽出でき、合計が 329 小節になる
- [x] Victoria の mvt1（インチピット・21 小節）/ mvt2（74 小節）でもレイアウトを抽出できる
- [x] `<print>` を一切持たない MusicXML では「1 ページ・1 段・全小節」を返す（合成フィクスチャが該当）
- [x] 既存の `MusicXmlParser.test.ts` が退行しない

### BookStructureResolver

- [x] `detect()` が divisi フィクスチャで `systemMeasureCountMismatch` を **2 件**（page5・page10 の第2段。
      いずれも omr 8 stack vs xml 7 小節）検出する
- [x] `detect()` が divisi フィクスチャで `inconsistentSystemStaffCount` を page 0 / 4 / 6 / 16 で検出する
      （当初計画の `fragmentedSystem`〈stack 境界の一致による誤分割検出〉は、実データ検証で
      Victoria の正常な段を誤検出し、かつ divisi の page 0 を取りこぼしたため、
      「同一ページ内で段ごとの譜表数が揃っていない」という**判定条件が明確な警告**に置き換えた）
- [x] `detect()` が Victoria フィクスチャで `systemMeasureCountMismatch` を **0 件**とする
- [x] `resolve()` が decisions 空でも必ず全段のアンカーを持つ `ResolvedStructure` を返す
- [x] `StructureDecision`（段の小節数上書き・movement 割当上書き）が `resolve()` の結果に反映される
- [x] 単体テストを `tests/unit/domain/score/BookStructureResolver.test.ts` に追加する

### ScoreModelBuilder のアンカー対応

- [x] 段あたり小節数の食い違いが、その段の中だけに閉じ、後続段の小節番号をずらさない（単体テストで固定）
- [x] 既存の `ScoreModelBuilder.test.ts` / `synthetic-mini.test.ts` が退行しない

### 回帰テスト

- [x] Victoria: matched 295・notes 808・skipped 1（`P3:m45`）・`pitchCrossCheckMismatch` 0 を維持する
- [x] divisi: skipped 561 → **135**、matched 604 → **1029**、照合音符 1433 → **3500** で固定した
- [x] `tests/fixtures/divisi/README.md` を実測値・真因の訂正内容で更新する

## 成功指標

- **定量**: divisi の skipped 小節が 561 → **200 未満**（事前検証の見込み値は 135 前後）
  → **達成（135）**
- **定量**: matched 音符が 1433 → **3000 以上** → **達成（3500）**
- **定量**: Victoria の回帰値が 1 つも変化しない（退行ゼロ）
  → **達成**（`victoria-regression.test.ts` は 1 行も変更せずパス）
- **定性**: 「1 段のローカルな不一致が全体に波及しない」構造になり、以降のフェーズ（階名パイプライン結線）が
  実データ上で意味のある小節番号を前提にできる

## スコープ外

以下はこのフェーズでは実装しません:

- **誤分割 system の自動マージ（統合）**: MusicXML 側も同じ分断で出力されるため、OMR 側だけ統合すると
  整合が崩れる。検出・報告に留める（背景の項を参照）
- **譜表 → パートの再割当**: Audiveris は段ごとにパート id を付け替えることがあり（例: divisi の page 7 で
  第1段が P4〜P8・第2段が P2〜P7）、MusicXML 側も同じ割当で出力される。正しい声部同定には MusicXML の
  パート再スライスが必要で、本フェーズの範囲を超える。既知の限界として記録する
- **StructureConfirm 画面（UI）**: Phase 4 のスコープ。本作業は画面が必要とするデータ（`StructureIssue`）を
  用意するところまで
- **IPC 経由の公開**: Phase 4 のスコープ
- **ユニゾン共有符頭・グレースノートの照合緩和**: 構造が正しくなった後の観察結果として記録し、判断は次フェーズへ

## 参照ドキュメント

- `docs/product-requirements.md` - F-1 の受け入れ条件「誤分割からの復元」
- `docs/functional-design.md` - BookStructureResolver / ScoreModelBuilder の責務とインターフェース
- `docs/glossary.md` - インチピット・BookStructureResolver
- `.steering/20260719-omr-runner-real-fixtures/tasklist.md` - Phase 1 の申し送り
- `tests/fixtures/divisi/README.md` - Phase 2 前ベースラインの根拠
