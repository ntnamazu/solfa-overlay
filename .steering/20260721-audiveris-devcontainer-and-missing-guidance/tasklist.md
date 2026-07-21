# タスクリスト

## 🚨 タスク完全完了の原則

**このファイルの全タスクが完了するまで作業を継続すること**

### 必須ルール

- **全てのタスクを`[x]`にすること**
- 「時間の都合により別タスクとして実施予定」は禁止
- 「実装が複雑すぎるため後回し」は禁止
- 未完了タスク（`[ ]`）を残したまま作業を終了しない

### タスクスキップが許可される唯一のケース

- 実装方針の変更により、機能自体が不要になった
- アーキテクチャ変更により、別の実装方法に置き換わった
- 依存関係の変更により、タスクが実行不可能になった

スキップ時は必ず理由を明記: `- [x] ~~タスク名~~（実装方針変更により不要: 技術的理由）`

---

## フェーズ1: Audiveris 不在の親切なエラーハンドリング（#3・コード）

- [x] `errors.ts` に `AudiverisNotFoundError extends OmrRunError` を追加
  - [x] クラス定義（`name` 設定・`cause` 対応）とドキュメントコメント
- [x] `OmrRunner.ts` のパス解決を変更
  - [x] 既定値を `deps?.audiverisPath ?? process.env.SOLFA_AUDIVERIS_PATH ?? 'audiveris'` に
  - [x] コメントで解決優先順位と意図を明記
- [x] `OmrRunner.ts` に ENOENT 分岐を追加
  - [x] ENOENT 判定ヘルパ（`code === 'ENOENT'`）
  - [x] 同期 spawn 例外（`catch`）で ENOENT → `AudiverisNotFoundError`
  - [x] 非同期 `error` イベントで ENOENT → `AudiverisNotFoundError`、それ以外は従来の `OmrRunError`
  - [x] 行動可能メッセージ（インストール／`SOLFA_AUDIVERIS_PATH`／Dev Container に言及）
- [x] ユニットテスト追加（spawn を DI で差し替え）
  - [x] `SOLFA_AUDIVERIS_PATH` 設定時に spawn の command が env 値になる
  - [x] 明示 `audiverisPath` が env より優先される
  - [x] 非同期 ENOENT → `AudiverisNotFoundError` かつメッセージに必要語を含む
  - [x] 同期 ENOENT → `AudiverisNotFoundError`
  - [x] 非 ENOENT の `error` → 従来メッセージ（温存）を確認

## フェーズ2: devcontainer への Audiveris 5.6.1 同梱（#2・開発環境）

- [x] Audiveris 5.6.1 ubuntu22.04 .deb の SHA-256 を確定（download して `sha256sum`）
  - 確定値: `3f05c33fe65a5fced51718bdafde9ed989528b882cf3297d4c72b588ef04a656`（68MB）
- [x] `.devcontainer/Dockerfile` に導入ブロックを追加
  - [x] `ARG AUDIVERIS_VERSION=5.6.1`（バージョン変数化）
  - [x] download（URL 固定）＋ SHA-256 検証
  - [x] `dpkg-deb -x` で `/opt/audiveris` へ展開
  - [x] `/usr/local/bin/audiveris` → `/opt/audiveris/bin/Audiveris` の symlink
  - [x] ~~ヘッドレス AWT 用ライブラリの追加~~（不要と実証: 既存の Electron 用ライブラリ群で headless 実行が成立。現行コンテナで `-help` 起動と実 PDF の OMR 成功を確認済み）
  - [x] ダウンロード成果物の後始末（`rm`）
- [x] 現行コンテナで download→extract→symlink を素振りし起動を先行確認
  - `-help` 起動 OK（同梱 OpenJDK 21.0.7 / Tesseract 5.3.1 / amd64、Audiveris 5.6.1）
  - **実 PDF（`tmp/IMSLP19716-...pdf`）で OMR 成功を実証**: `.omr`＋`.mxl`(mvt1/mvt2) を出力＝当初の失敗シナリオが成功に変わることを確認

## フェーズ3: ドキュメント（README）

- [x] README に「開発時の Audiveris 供給」節を追加
  - [x] ルートA: 自前調達（install→PATH or `SOLFA_AUDIVERIS_PATH`）
  - [x] ルートB: Dev Container（再ビルドで同梱済み）
  - [x] 不在時に出る案内メッセージへの言及

## フェーズ4: 品質チェックと修正

- [x] すべてのテストが通ることを確認
  - [x] `npm test`（44ファイル・764テスト green）
- [x] リントエラーがないことを確認
  - [x] `npm run lint`（エラーなし）
- [x] 型エラーがないことを確認
  - [x] `npm run typecheck`（エラーなし）
- [x] ビルドが成功することを確認
  - [x] `npm run build`（成功）

## フェーズ5: ドキュメント更新・振り返り

- [x] `docs/architecture.md` の申し送り（「本物の Audiveris 起動を伴う E2E はコンテナでは不可」）を、#2 で状況が変わる点として更新（コンテナ同梱済みでコンテナ内一気通貫が可能になった旨へ改訂）
- [x] 実装後の振り返り（このファイルの下部に記録）
- [x] `#2` のコンテナ再ビルド手動検証手順をユーザーへ案内（ユーザーが再ビルド実行）

---

## 実装後の振り返り

### 実装完了日

2026-07-21

### 計画と実績の差分

**計画と異なった点**:

- ヘッドレス AWT 用の追加ライブラリ（`fontconfig`/`libfreetype6` 等）は **不要**だった。既存の Electron 用ライブラリ群で Audiveris の headless 実行が成立することを現行コンテナで実証したため、Dockerfile へのライブラリ追加は行わなかった（tasklist に技術的理由を明記してスキップ）。
- #2 の検証は「コンテナ再ビルドが必要な手動確認」と計画していたが、**現行コンテナ内で download→extract→symlink を素振りし、実 PDF の OMR 成功まで先行実証**できた。これにより Dockerfile のロジック妥当性を再ビルド前に確認済み。

**新たに必要になったタスク**:

- `docs/architecture.md` の申し送り文（「本物の Audiveris 起動を伴う E2E はコンテナでは不可」）の改訂。#2 でコンテナに同梱したため事実が変わり、放置すると誤情報になるため更新した。

**技術的理由でスキップしたタスク**:

- ヘッドレス AWT 用ライブラリ追加（不要と実証。既存ライブラリで headless 実行が成立）。

### 学んだこと

**技術的な学び**:

- Audiveris 5.6.1 の Linux `.deb` は jpackage app-image で、`/opt/audiveris` 配下のみに OpenJDK 21.0.7 ランタイム＋Tesseract 5.3.1 を同梱。`dpkg-deb -x`（依存解決なし）で展開でき、`/usr` に触れないため symlink 衝突がない。
- 当該 PDF（O Magnum Mysterium）は **2 movement** として認識され `.mvt1/.mvt2.mxl` を出力（Victoria フィクスチャと同一曲・同一構造）。`OmrRunner.collectOutputs` の movement 昇順収集の前提と一致。
- `AudiverisNotFoundError extends OmrRunError` により、既存 `toIpcError` の `instanceof OmrRunError` 分岐を無改変のまま `kind:'omr'` に乗せられた（IPC コントラクト非改変で UX 改善）。

**プロセス上の改善点**:

- 「配布物への同梱」と「開発時のエンジン供給」を別レイヤーとして requirements で明示的に切り分けたことで、既存 docs（fetch-resources 前提）と矛盾せず追加できた。

### 次回への改善提案

- 配布フェーズ（`scripts/fetch-resources.ts` / electron-builder）着手時は、本作業の `SOLFA_AUDIVERIS_PATH` 解決と `AudiverisNotFoundError` をそのまま再利用し、`app.isPackaged` 分岐で `process.resourcesPath` 配下を指す形にすると差分が最小になる。
- Audiveris のバージョン更新時は、Dockerfile の `ARG AUDIVERIS_VERSION`／`ARG AUDIVERIS_SHA256` とフィクスチャ再生成をセットで扱う（`docs/architecture.md` の完全固定方針）。
