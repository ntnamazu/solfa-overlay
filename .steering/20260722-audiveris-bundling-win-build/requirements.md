# 要求内容

## 概要

配布版アプリに Audiveris（＋同梱 JRE）を同梱し、**署名なしの Windows 用実行ファイル（`.exe` インストーラ）をビルドできる**状態にする。ユーザーは追加インストールなしに 1 個のアプリで OMR まで動かせるようになる。

## 背景

- PRD のコア価値は「ツールチェーンを自分で組めない人にインストール不要の 1 個のアプリを届ける」こと。その実現には Audiveris を配布物へ同梱する必要がある。
- 現状、開発時の Audiveris 供給（自前調達 or devcontainer 同梱）は整備済みだが、**配布物への同梱と実行ファイルのビルド（electron-builder）は未着手**（`scripts/fetch-resources.ts` も electron-builder も未導入。`app.isPackaged` 分岐も未実装）。
- 壁打ちメモ `docs/ideas/audiveris-bundling-license.md` の方針に沿って進める。特に**署名は当面しない**（自分＋合唱仲間スケール）。README に SmartScreen 突破手順を明記して補う。

## 実装対象の機能

### 1. 同梱リソース取得スクリプト（`scripts/fetch-resources.ts`）

- Windows 版 Audiveris（`Audiveris-5.6.1-windows-x86_64.msi`）を**バージョン・SHA-256 固定**でダウンロードして検証する。
- MSI を展開し、jpackage app-image（`Audiveris.exe`＋`app/`＋`runtime/`＝同梱 JRE21）を `resources/audiveris/win/` へ配置する。
- 冪等（既に配置済みならスキップ、`--force` で再取得）。

### 2. 実行時パス解決（`app.isPackaged` 分岐）

- パッケージ実行時は `process.resourcesPath/audiveris/win/Audiveris.exe` を解決し、`OmrRunner` にその絶対パスを渡す。
- 開発時（非パッケージ）は既存の解決チェーン（`SOLFA_AUDIVERIS_PATH` → PATH の `audiveris`）を維持する。
- 解決ロジックは Electron 非依存の純粋関数に切り出し、ユニットテスト可能にする。

### 3. electron-builder による Windows ビルド

- `electron-builder` を devDependency に追加し、`electron-builder.yml` を用意する。
- `extraResources` で `resources/audiveris/win/` を同梱し、Windows NSIS インストーラ（未署名）を生成する。
- `package.json` に取得・ビルド用スクリプト（`fetch-resources` / `dist:win`）を追加する。
- タグ作成時に Windows インストーラを生成する `release.yml` を追加する（Windows ランナー）。

### 4. ライセンス表記（AGPL-3.0 対応）

- `THIRD_PARTY_LICENSES.md` を作成し、Audiveris（AGPL-3.0）と同梱 JRE（OpenJDK / GPLv2+Classpath Exception）の表記・入手元・対応ソース提供方法・mere aggregation の明示を記載する。
- 配布物（インストーラ）にも同梱する。

### 5. README のビルド／SmartScreen 手順

- Windows 実行ファイルのビルド手順（`fetch-resources` → `dist:win`）を追記する。
- **署名しない前提**で、SmartScreen の青い警告を `[詳細情報]→[実行]` で突破する手順を明記する。

## 受け入れ条件

### 同梱リソース取得スクリプト

- [ ] バージョン・URL・SHA-256 が定数で固定されている（5.6.1 / `92ef67ba…ec687`）。
- [ ] ダウンロード後に SHA-256 を検証し、不一致なら中断する。
- [ ] `resources/audiveris/win/` に app-image を配置する（既存なら冪等にスキップ、`--force` で再取得）。
- [ ] `npm run fetch-resources` で起動できる（tsx 経由）。

### 実行時パス解決

- [ ] `app.isPackaged=true`・Windows で `<resourcesPath>/audiveris/win/Audiveris.exe` を返す。
- [ ] 非パッケージ時は `undefined`（既存の解決チェーンに委ねる）。
- [ ] 純粋関数として単体テストが green。
- [ ] `index.ts` から `ProjectSession` へ同梱パス付き `OmrRunner` を結線している。

### electron-builder による Windows ビルド

- [ ] `electron-builder.yml` が Windows NSIS ターゲット・未署名・`extraResources` 同梱を定義している。
- [ ] `extraResources` の配置先（`audiveris/win`）とパス解決が一致している。
- [ ] `package.json` に `fetch-resources` / `dist:win` スクリプトがある。
- [ ] `.github/workflows/release.yml` が Windows ランナーでインストーラを生成する。

### ライセンス表記

- [ ] `THIRD_PARTY_LICENSES.md` に Audiveris（AGPL-3.0）と同梱 JRE の表記がある。
- [ ] 対応ソース（固定版 upstream へのリンク）と mere aggregation の意図が明記されている。
- [ ] 配布物に同梱される（electron-builder `files`/`extraResources`）。

### README

- [ ] Windows ビルド手順が記載されている。
- [ ] SmartScreen 突破手順（`[詳細情報]→[実行]`）が記載されている。

## 成功指標

- devcontainer（Linux）で `npm test` / `npm run lint` / `npm run typecheck` / `npm run build` がすべて green。
- `fetch-resources` のダウンロード＋SHA-256 検証部がコンテナ内で実証できる（展開は Windows/msitools 前提のため案内で担保）。
- Windows 実機で `npm run fetch-resources` → `npm run dist:win` により未署名 `.exe` が生成できる設計が整っている（実ビルド検証はユーザーの Windows 環境）。

## スコープ外

以下はこのフェーズでは実装しません:

- **macOS / Linux 向け配布ビルド**（ユーザー要望により Windows のみ）。
- **コード署名・公証**（壁打ちメモの方針どおり当面しない。README の SmartScreen 手順で補う）。
- **アプリ本体（Solfa Overlay 自体）のライセンス確定**（公開リリース前の別判断。ここでは同梱物のライセンス表記のみ扱う）。
- **`resources/jre/` の別立て**（Windows MSI が jpackage 製で JRE を同梱するため二重同梱は不要）。
- devcontainer 内での electron-builder 実ビルド／MSI 実展開（Linux から Windows インストーラは生成不可・MSI 展開ツールも入れられないため設計と手順で担保）。

## 参照ドキュメント

- `docs/ideas/audiveris-bundling-license.md` - 壁打ちメモ（本作業の直接の入力・方針の根拠）
- `docs/architecture.md` - 技術スタック（electron-builder / extraResources / 同梱 JRE）
- `docs/repository-structure.md` - `resources/`・`scripts/fetch-resources.ts`・`release.yml`・`THIRD_PARTY_LICENSES.md` の正式定義
- `docs/product-requirements.md` - コア価値（インストール不要の 1 アプリ配布）
- `src/main/omr/OmrRunner.ts` / `src/main/ProjectSession.ts` - 結線先
