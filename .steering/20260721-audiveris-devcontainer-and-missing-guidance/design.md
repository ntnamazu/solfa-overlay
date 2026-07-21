# 設計書

## アーキテクチャ概要

2つの独立したレイヤーへの変更。**#3 はアプリのコード（Main プロセス）**、**#2 は開発環境（devcontainer イメージ）**。両者は疎結合で、`SOLFA_AUDIVERIS_PATH` という 1 本の解決規約だけを共有する。

```
[利用ルートA: 自前調達]                     [利用ルートB: Dev Container]
 ホストに Audiveris を install              .devcontainer/Dockerfile が
 → PATH を通す or SOLFA_AUDIVERIS_PATH       Audiveris 5.6.1 を /opt に展開
   で場所指定                                → /usr/local/bin/audiveris に symlink
        \                                          /
         \                                        /
          ▼            どちらも「PATHで audiveris が引ける」状態
        ┌───────────────────────────────────────────────┐
        │ OmrRunner (#3)                                  │
        │  audiverisPath = 明示 ?? SOLFA_AUDIVERIS_PATH   │
        │                        ?? 'audiveris'           │
        │  spawn 失敗が ENOENT → 行動可能なエラー          │
        └───────────────────────────────────────────────┘
                          │ OmrRunError (kind:'omr')
                          ▼
                 projectHandlers.toIpcError → UI
```

## コンポーネント設計

### 1. OmrRunner のパス解決と不在エラー（#3 / `src/main/omr/`）

**責務**:

- Audiveris 実行ファイルの場所を「明示指定 → 環境変数 → 既定 `'audiveris'`」の優先順で解決する。
- spawn 失敗のうち **ENOENT（エンジン不在）** を他の失敗と区別し、行動可能なメッセージを返す。

**実装の要点**:

- `OmrRunner` コンストラクタの既定値を変更:
  ```ts
  this.audiverisPath =
    deps?.audiverisPath ?? process.env.SOLFA_AUDIVERIS_PATH ?? 'audiveris';
  ```
- 不在検知は **spawn の `error` イベント**と**同期 spawn 例外**の両方で `code === 'ENOENT'` を判定（Node は環境により同期例外／非同期 error イベントのどちらでも ENOENT を出し得るため両対応）。
- メッセージの一元化のため、専用サブクラス `AudiverisNotFoundError extends OmrRunError` を `errors.ts` に追加。`instanceof OmrRunError` を満たすので **`toIpcError` は変更不要**（`kind:'omr'` にマップされる）＝ IPC コントラクト無改変で blast radius 最小。
- メッセージ案（実装時に文言微調整可）:
  > 「Audiveris が見つかりません。Audiveris をインストールして PATH を通すか、環境変数 SOLFA_AUDIVERIS_PATH に実行ファイルのパスを設定してください。手軽に試すには Dev Container での起動もできます（README 参照）。」
- 既存の「Audiveris の起動に失敗しました」「Audiveris が異常終了しました」「キャンセル」経路は温存（ENOENT のみ分岐）。

### 2. devcontainer への Audiveris 5.6.1 同梱（#2 / `.devcontainer/Dockerfile`）

**責務**:

- ビルド時に Audiveris 5.6.1 の Linux 配布物を固定取得・展開し、`audiveris` を PATH に載せる。

**実装の要点**:

- 取得アセット（`gh` で実在確認済み）: `Audiveris-5.6.1-ubuntu22.04-x86_64.deb`
  - URL: `https://github.com/Audiveris/audiveris/releases/download/5.6.1/Audiveris-5.6.1-ubuntu22.04-x86_64.deb`
  - コンテナは Debian 12（node:20）＝ ubuntu22.04 版が glibc 的に整合。展開は依存解決を伴わない `dpkg-deb -x`（ユーザーの検証済み手法）で `/opt` 直下へ。
  - **バージョン・SHA-256 を固定**（`docs/architecture.md` の「audiveris は完全固定」方針）。SHA-256 は実装時にダウンロードして `sha256sum` で確定し Dockerfile に埋め込む。
- jpackage app-image のランチャは `/opt/audiveris/bin/Audiveris`。`ln -s /opt/audiveris/bin/Audiveris /usr/local/bin/audiveris` で PATH 解決名 `audiveris` を用意（既定値のまま動く）。
- **JRE は入れない**（配布物に Java 21 ランタイム同梱）。ヘッドレス AWT に必要な最小ライブラリ（`fontconfig`, `libfreetype6` 等）が未導入なら追加。既存 Dockerfile は Electron 用に多数の X/font ライブラリを導入済みのため差分は最小の想定。
- Dockerfile 既存作法（git-delta を inline download している）に合わせ、Audiveris 導入も 1 つの `RUN` ブロックで inline 記述。ARG でバージョンを変数化。
- **ネットワーク**: `init-firewall.sh` は `postStartCommand`（実行時）であり **docker build 時は非アクティブ**。GitHub からのビルド時取得は成功する。実行時は OMR がローカル処理のためネットワーク不要。

### 3. README のルート説明（#3補助 / `README.md`）

**責務**: 2ルートの手順と `SOLFA_AUDIVERIS_PATH`／SmartScreen 的な注意ではなく「開発時の起動手順」を案内。

## データフロー

### PDF 取り込み時の Audiveris 解決（#3後）

```
1. importPdf → OmrRunner.run → execAudiveris
2. audiverisPath を解決（明示 ?? SOLFA_AUDIVERIS_PATH ?? 'audiveris'）
3. spawn 実行
   3a. 成功 → 従来どおり進捗通知・成果物収集
   3b. ENOENT → AudiverisNotFoundError（行動可能メッセージ）
   3c. その他 error / 非0終了 → 従来の OmrRunError
4. エラーは projectHandlers.toIpcError で kind:'omr' に整形され UI へ
```

## エラーハンドリング戦略

### カスタムエラークラス

- `AudiverisNotFoundError extends OmrRunError`（`src/main/omr/errors.ts`）。
  - `OmrRunError` を継承するため既存の `toIpcError` 分岐（`instanceof OmrRunError`）で自動的に `kind:'omr'` に乗る。新 IPC kind は追加しない。

### エラーハンドリングパターン

- ENOENT の判定は `(error as NodeJS.ErrnoException).code === 'ENOENT'`。同期 spawn 例外（`try/catch`）と非同期 `error` イベントの両方で同じ判定関数を通す。

## テスト戦略

### ユニットテスト（`tests/` の既存 OmrRunner テストに追加）

- **パス解決**: `SOLFA_AUDIVERIS_PATH` を設定した状態で `new OmrRunner()` を作り、注入した spawn が受け取る command が環境変数値になることを検証。明示 `audiverisPath` が最優先されることも検証。
- **ENOENT → 行動可能メッセージ**: spawn スタブが `error` イベントで `{ code: 'ENOENT' }` を emit → `run` が `AudiverisNotFoundError` で reject し、メッセージにインストール/`SOLFA_AUDIVERIS_PATH`/Dev Container の語が含まれること。
- **同期 ENOENT**: spawn スタブが同期で `{ code:'ENOENT' }` を throw → 同じく `AudiverisNotFoundError`。
- **非 ENOENT 温存**: `error` イベントで別 code → 従来の「Audiveris の実行でエラーが発生しました」。
- モック方針は `docs/development-guidelines.md` に従い spawn（子プロセス）を DI で差し替え。

### 統合テスト

- 既存のフィクスチャ回帰（Victoria/divisi）には影響しない（Audiveris 本体は実行しない方針は不変）。#3 は spawn 層のみの変更で照合ロジックに触れない。

### #2 の検証（手動・コンテナ再ビルドが必要）

- Dockerfile 変更はユニットテスト対象外。検証は次の手動手順:
  1. コンテナ再ビルド（Dev Containers: Rebuild Container）。
  2. コンテナ内で `audiveris -help` 等が起動する（同梱 JRE で動く）。
  3. `npm run dev` で実 PDF を読み込み OMR 成功を確認。
- 可能なら実装時に**現行コンテナでインストール手順を素振り**し（ビルド時と同じ download→extract→symlink を手で実行）、`audiveris` が起動するところまで先行確認する（ネットワーク到達性に依存）。結果は振り返りに記録。

## 依存ライブラリ

新規の npm 依存追加なし。devcontainer に OS レベルで Audiveris 5.6.1（＋同梱 JRE21）を追加するのみ。

## ディレクトリ構造

```
.devcontainer/
  Dockerfile            # 変更: Audiveris 5.6.1 の取得・展開・symlink を追加
src/main/omr/
  errors.ts             # 変更: AudiverisNotFoundError 追加
  OmrRunner.ts          # 変更: パス解決に env 追加 / ENOENT 分岐
tests/
  (既存 OmrRunner テスト) # 変更: パス解決・ENOENT ケース追加
README.md               # 変更: 2ルート手順と SOLFA_AUDIVERIS_PATH
```

## 実装の順序

1. #3 コード（errors.ts → OmrRunner.ts）＋ユニットテスト（コンテナ非依存で完結・回帰で守れる）。
2. #2 Dockerfile（SHA-256 確定→固定記述）。可能なら現行コンテナで素振り検証。
3. README 更新。
4. 品質チェック（test/lint/typecheck/build）。

## セキュリティ考慮事項

- Audiveris 取得は **URL＋SHA-256 固定**で改ざん検知（供給元固定）。
- spawn は従来どおり引数配列・`shell:false` を維持（ユーザー入力をシェルに渡さない。`docs/functional-design.md` の子プロセス安全性方針）。
- `SOLFA_AUDIVERIS_PATH` はローカル開発者が自分で設定する信頼済み値。値はコマンド名／パスとしてそのまま spawn に渡す（引数配列の command 位置）。楽譜由来データの外部送信には一切関与しない。

## パフォーマンス考慮事項

- devcontainer イメージサイズが Audiveris＋同梱 JRE 分（数百MB）増える。開発イメージのため許容（配布物サイズとは無関係）。
- #3 はエラー経路のみの分岐で通常実行に影響なし。

## 将来の拡張性

- `SOLFA_AUDIVERIS_PATH` による解決入口は、将来の配布物同梱（`process.resourcesPath` 配下の Audiveris を指す）でも再利用でき、`app.isPackaged` 分岐で同じ `OmrRunner` に渡せる。
- `AudiverisNotFoundError` を足がかりに、将来 UI 側で専用の導線パネルを出す拡張も容易（今回はスコープ外）。
