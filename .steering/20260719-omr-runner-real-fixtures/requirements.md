# 要求内容

## 概要

OMR エンジン（Audiveris）をヘッドレス子プロセスとして実行し、その成果物（`.omr` / `.mxl`）を
展開・パースして `OmrArtifacts` を組み立てる **OmrRunner** を実装する。あわせて、合成フィクスチャ
だけで検証されている ScoreModelBuilder の照合コアを、**実 Audiveris 出力による回帰テスト**で
実データ検証する（ロードマップ Phase 1「OMR 実行と実データ検証」）。

## 背景

- ScoreModelBuilder の列対付けアルゴリズムは合成フィクスチャ（synthetic-mini）でしか検証されて
  おらず、実 Audiveris 出力（`.omr`/`.mxl`）は未通過。前作業（chord-column-pairing）の申し送りで
  「移植元プロトタイプの実測値を過信しない／実データで確かめる」ことが次作業として決定済み。
- OmrRunner はメインフロー（PDF → OMR → 照合 → 階名 → PDF）の入口で、これが無いと実データを
  取り込む経路が存在しない。機能設計書・アーキテクチャ設計書ともに実装が前提のコンポーネント。
- プロトタイプ `tmp/solfa-proto/solfa_proto.py` が実 `.omr`/`.mxl` の zip 構造・命名規則
  （`book.xml`、`sheet#N/sheet#N.xml`、`<name>.mvtN.mxl`）を実証済みで、設計の土台になる。

## 実装対象の機能

### 1. OmrRunner（Audiveris ヘッドレス実行）

- Audiveris を **引数配列で** 子プロセス起動（シェル文字列連結を禁止＝コマンドインジェクション防止）。
  子プロセス起動は**差し替え可能（DI）**にし、Audiveris 非搭載環境でも周辺ロジックを自動テストできる。
- `run(pdfPath, onProgress): Promise<OmrArtifacts>` と `cancel(): void` を提供する。
- 進捗（`OmrProgress`）をコールバックで通知する（ページ/シート単位）。UI スレッドをブロックしない非同期。
- 生成された `.omr`（book zip）と `.mxl`（movement ごと）を展開・パースして `OmrArtifacts` を組み立てる。

### 2. `.omr` / `.mxl` の展開（zip）と成果物組み立て

- fflate による zip 展開。**パストラバーサル（`../` を含むエントリ名）を拒否**する。
- `.omr` から `book.xml` と `sheet#N/sheet#N.xml` を取り出し、既存パーサ（parseBookXml / parseSheetXml）
  でページ列を構築する。
- `.mxl`（movement 単位・`<name>.mvtN.mxl` の昇順、単一 movement は `<name>.mxl`）から MusicXML を
  取り出し parseMusicXml でパースして `OmrArtifacts.movements` を構築する。

### 3. 実 Audiveris 出力による回帰テスト

- **Victoria《O magnum mysterium》**（パブリックドメイン）の実 `.omr`/`.mxl` をフィクスチャとして同梱し、
  展開→照合の通し回帰を固定する（プロトタイプ実測: 784音・クロスチェック不一致0・skipped 5小節を基準に、
  実出力で再現される実測値を正とする）。
- **divisi 曲（SSAATTBB・1段2パート同居）** の実 `.omr`/`.mxl` で、列対付けアルゴリズムが
  和音・オクターブ重複 divisi・多声で正しく対付けされることを実データで実証する。

## 受け入れ条件

### OmrRunner

- [x] `buildAudiverisArgs` が引数配列を返し、ユーザー入力（PDF パス）を配列要素として渡す（文字列連結しない）
- [x] `run()` が DI した spawner 経由で子プロセスを起動し、正常終了後に `OmrArtifacts` を解決する
- [x] `run()` が Audiveris の非ゼロ終了・spawn 失敗を捕捉し、`OmrRunError`（予期されるエラー）に変換する
- [x] `cancel()` が実行中の子プロセスに kill を送り、`run()` の Promise がキャンセルとして拒否される
- [x] 進捗パーサが代表的な Audiveris ログ行から `OmrProgress`（phase・sheet 番号）を抽出する
- [x] zip 展開がパストラバーサル（`../` エントリ）を `OmrArchiveError` で拒否する
- [x] `assembleArtifacts` が実 `.omr`＋`.mxl` バイト列から `OmrArtifacts`（movements・pages）を組み立てる

### 実データ回帰

- [x] Victoria 実フィクスチャで assembleArtifacts→ScoreModelBuilder.build が通り、matched 295小節・
      808音・skipped 1小節（P3:m45）・クロスチェック不一致0 を固定回帰（README に根拠記録）
- [x] divisi 実フィクスチャで検証 → **構造誤分割により Phase2 前はクリーン検証不可**と判明。
      ユーザー決定でベースライン commit に変更。列対付けが稼働する小節（84）を確認、現状値を固定
- [x] 既知の限界（ユニゾン共有符頭・列間 x 逆転・グレースノート）を divisi README に記録
      （個別現象の切り分けは構造が正しくなる Phase2 以降で実施する旨も明記）

## 成功指標

- 合成フィクスチャではなく**実 Audiveris 出力**で ScoreModelBuilder が期待どおり動くこと（Phase 1 のゲート）
- OmrRunner の周辺ロジック（引数構築・進捗パース・zip 展開・成果物組み立て）が Audiveris 非搭載の
  コンテナ内で自動テストされ、CI で回帰されること

## スコープ外

以下はこのフェーズでは実装しません:

- **本物 Audiveris の実起動確認**: コンテナに Audiveris/JRE 非搭載のためホスト実機での手動確認とする
  （GUI 起動確認と同じ申し送り扱い）
- **BookStructureResolver**（movement 誤分割の検出・復元）: ロードマップ Phase 2。回帰テストでは
  synthetic-mini 統合テストと同じ `resolveStructure` ヘルパー相当で確定構造を与える
- **IPC 配線**（OmrRunner を Renderer へ公開）・進捗の UI 表示: ロードマップ Phase 4
- **ユニゾン共有符頭の照合緩和**: 実出力を観察して要否を判断する段階（今回は現状挙動の記録まで）
- **著作権曲を commit すること**: 現代の著作権 divisi 曲を題材にする場合、その `.omr`/`.mxl` は
  リポジトリに commit しない（`.gitignore` 除外）。commit する回帰フィクスチャは PD 曲に限る

## 参照ドキュメント

- `docs/product-requirements.md` - F-1（楽譜PDFの読み込みとOMR実行）
- `docs/functional-design.md` - OmrRunner / ScoreModelBuilder / 小節照合 / 信頼性・セキュリティ要件
- `docs/architecture.md` - Audiveris ヘッドレス実行・fflate・子プロセス安全性・回帰テスト方針
- `docs/repository-structure.md` - `src/main/omr/OmrRunner.ts` の配置
- `tmp/solfa-proto/solfa_proto.py` - 実 `.omr`/`.mxl` の構造・命名規則の実証
