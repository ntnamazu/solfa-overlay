# 要求内容

- 作業名: 20260718-musicxml-parser（MusicXML パーサ + OmrSheetParser + ScoreModelBuilder）
- 発端: 前回作業（20260717-initial-setup）の「次回への改善提案」で挙げた次作業候補 (1)。
  SolfaEngine の成果（Pitch → SolfaDegree 計算）を最短で繋げられる作業単位として選定

## 概要

Audiveris の出力（MusicXML / .omr sheet XML / book.xml）をパースし、論理情報（音高）と物理情報
（符頭座標）をパート×小節単位で照合して `ScoreModel` を構築するサービスレイヤー（`src/domain/score/`）を
実装する。検証済みプロトタイプ（`tmp/solfa-proto/solfa_proto.py`）の TypeScript 移植が中核。

## 背景

- SolfaEngine（実装済み）は `Pitch` と `KeyRegion` から階名を計算できるが、その入力となる
  `ScoreModel`（照合済み音符列）を作る手段がまだない
- プロトタイプ（Python）で「MusicXML×.omr 照合 → 784音・ミスマッチ0・skipped 5小節」を実証済み。
  アルゴリズムと .omr スキーマの知見は `docs/ideas/solfa-annotation-app.md` と
  `tmp/solfa-proto/solfa_proto.py` に記録されている

## 実装対象の機能

### 1. MusicXmlParser（`src/domain/score/MusicXmlParser.ts`）

- MusicXML（score-partwise の XML 文字列）から、パートごとの小節列・発音音符列
  （step / alter / octave / 和音フラグ / 小節内オフセット）を抽出する
- 調号（fifths / mode）の宣言・変更を小節単位で保持する（KeyRegion 自動生成の材料）
- divisions・backup / forward を処理して小節内オフセット（divisions 基準）を計算する

### 2. OmrSheetParser（`src/domain/score/OmrSheetParser.ts`）

- .omr 内 sheet XML から、ページ → システム → stack（小節の水平範囲）／譜表（part id・音部記号・
  符頭座標列）を抽出する
- book.xml から sheet／ページ列と movement 分割情報を抽出する

### 3. ScoreModelBuilder（`src/domain/score/ScoreModelBuilder.ts`）

- パート×小節ごとに MusicXML の発音音符数と .omr の符頭数を突き合わせ、一致小節は音符を対にし、
  不一致小節は `skipped` として隔離する（他小節へ波及させない）
- .omr の譜表位置（中線=0・下向き正）＋確認済み音部記号から音名を逆算し、MusicXML の音名と
  クロスチェックする（不一致は警告 issue として報告）
- 確認画面（ClefKeyConfirm）でのユーザー修正値（corrected）を音部記号の解決に反映する
- 結果を `ScoreModel`（shared 型）＋ `BuildIssue[]` として返す

### 4. 共有型定義（`src/shared/types/`）

- 機能設計書のエンティティ定義から `ScoreModel` 系（Part / Measure / NoteEvent / PageAnchor /
  StaffRef / SystemInfo）、`ConfirmationState` 系、`ResolvedStructure`（v1 最小形）を転記・定義する

### 5. テストフィクスチャ整備

- Audiveris 出力を模した合成フィクスチャ（MusicXML＋sheet XML＋book.xml）を
  `tests/fixtures/` に整備し、パース→照合のミニパイプライン統合テストを作成する

## 受け入れ条件

### MusicXmlParser

- [x] 複数パート・和音（chord）・休符除外・臨時記号（alter）・調号変更を正しく抽出できる
- [x] backup / forward を含む多声小節でも小節内オフセットが正しい
- [x] 不正な XML はドメインのエラークラスで安全に失敗する

### OmrSheetParser

- [x] プロトタイプが実証した sheet XML 構造（system / stack / part / staff / clef / head+bounds）を
      抽出できる（符頭は x 昇順）
- [x] book.xml の movement-start から movement ごとのページ列を得られる

### ScoreModelBuilder

- [x] 音符数一致の小節は時間順×座標順で対になり、`status: 'matched'` の Measure ができる
- [x] 不一致の小節は `status: 'skipped'` になり、他の小節の照合に影響しない
- [x] 音高クロスチェック不一致が issue として報告される（音符自体は MusicXML の音高で生成）
- [x] 音部記号のユーザー修正がクロスチェックに反映される
      （検証シナリオは TREBLE → BASS に変更。クロスチェックは step 比較のみのため、
      TREBLE → TREBLE_DOWN_8 のような同レター・オクターブ違いの修正は結果に影響しない＝検出限界）
- [x] 複数 movement（誤分割された曲）を通し小節番号で連結できる

### 品質

- [x] `src/domain/` のカバレッジ 90% 以上を維持（vitest.config.ts の閾値。実績 branches 92.97% / statements 99.04% / functions 100% / lines 99.34%）
- [x] lint / typecheck / build がすべてパスする（レイヤー境界: domain は純粋TSのまま）

## 成功指標

- 合成フィクスチャのミニパイプライン（パース→照合）が期待値どおりの
  matched / skipped / issue 数を返す回帰テストとして固定される
- 将来 Victoria フィクスチャ（実 Audiveris 出力）を配置したとき、同じ API で
  784音・ミスマッチ0・skipped 5小節の回帰テストに差し替えられる構造になっている

## スコープ外

以下はこのフェーズでは実装しません:

- BookStructureResolver の誤分割検出・復元候補生成（`detect()` / `resolve()`）。今回は確定構造
  `ResolvedStructure` を入力として受け取る側（ScoreModelBuilder）のみ実装する
- Victoria《O magnum mysterium》実フィクスチャの生成（この開発環境に Audiveris / JRE がなく
  実行不可能。`scripts/generate-fixtures.ts` と併せて OmrRunner 実装時に行う）
- .mxl / .omr（zip）の展開（fflate）とファイル I/O（編成・データレイヤーの担当。domain は
  XML 文字列を受け取る）
- KeyRegion の自動生成・SolfaEngine との結線（調号情報は抽出するが、KeyRegion 化は次作業）
- UI（StructureConfirm / ClefKeyConfirm 画面）と IPC ハンドラ

## 参照ドキュメント

- `docs/functional-design.md` - データモデル定義・コンポーネント設計・小節照合アルゴリズム
- `docs/architecture.md` - レイヤー構成（domain は純粋TS）・テスト戦略
- `docs/repository-structure.md` - 配置規則（domain/score/・tests/fixtures/）
- `docs/ideas/solfa-annotation-app.md` - プロトタイプ検証結果（.omr スキーマの知見）
- `tmp/solfa-proto/solfa_proto.py` - 移植元のプロトタイプ実装
