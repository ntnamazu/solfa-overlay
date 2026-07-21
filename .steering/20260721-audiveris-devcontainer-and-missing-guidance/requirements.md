# 要求内容

## 概要

開発時に OMR エンジン（Audiveris）が使える状態を整える。具体的には (#2) devcontainer に Audiveris 5.6.1 を同梱してコンテナ内でも一気通貫を回せるようにし、(#3) Audiveris が見つからないときに「何をすれば直るか」が分かる親切なエラーへ改善する。

## 背景

`npm run dev` で GUI を起動し PDF を読ませたところ「Audiveris の実行でエラーが発生しました」で失敗した。原因は **devcontainer に Audiveris も JRE も未搭載**で、`OmrRunner` が `spawn('audiveris', …)` を叩いた際に **ENOENT（コマンド不在）** が発生し、それが `child.on('error')` で汎用メッセージに丸められて UI に出ていたこと。

ユーザーの利用モデルは次の2ルートで、どちらも「実行時に Audiveris が使える状態」を作る等価な手段:

- **基本**: Audiveris/JRE を自前で調達（インストールして PATH を通す or 場所を指定）してから `npm run dev`
- **面倒なら**: devcontainer 方式で立ち上げれば、自前調達と同じ効果が得られる

そのうえで、どちらのルートでも「入れ忘れ・パス未設定」を親切に案内する安全網（#3）を用意する。#3 はアプリのコード、#2 は開発環境の整備でレイヤーが異なり、独立して実装・検証できる。

> 補足: 本作業は **開発時（dev-time）の OMR エンジン供給**の話であり、**配布物（packaged app）への同梱**（`scripts/fetch-resources.ts` による `resources/` への配置。architecture / repository-structure が定義）とは別レイヤー。将来の配布同梱とは競合せず、むしろ #3 の仕組み（パス解決・不在案内）は配布時にも再利用できる。

## 実装対象の機能

### 1. Audiveris 不在の親切なエラーハンドリング（#3）

- `OmrRunner` の Audiveris 実行ファイル解決に環境変数 `SOLFA_AUDIVERIS_PATH` の上書きを追加する（自前調達・devcontainer どちらのルートでも同じ入口で場所を指定できる）。
- `spawn` の失敗が **ENOENT（＝エンジン不在）**のときは、汎用文言ではなく「Audiveris が見つからない。インストールして PATH を通すか `SOLFA_AUDIVERIS_PATH` で指定するか、Dev Container を使う」旨の**行動可能なメッセージ**を返す。
- ENOENT 以外の spawn 失敗・異常終了は従来どおり扱う（誤診断しない）。

### 2. devcontainer への Audiveris 5.6.1 同梱（#2）

- `.devcontainer/Dockerfile` に、Audiveris **5.6.1**（テストフィクスチャと同一版）の Linux 配布物を**バージョン・SHA-256 固定**で取得・展開し、`audiveris` として PATH から実行できるようにする処理を追加する。
- 配布物は jpackage 製で **JRE21 を同梱**しているため、別途 JRE はインストールしない。
- コンテナ再ビルド後、`npm run dev` で実 PDF を読み込み OMR が成功することを確認できる状態にする。

### 3. 利用方法のドキュメント化

- README に「基本＝自前調達／面倒なら Dev Container」の2ルートと、それぞれの手順・`SOLFA_AUDIVERIS_PATH` の使い方を明記する。

## 受け入れ条件

### Audiveris 不在の親切なエラーハンドリング（#3）

- [ ] `audiverisPath` 明示指定なしのとき、`SOLFA_AUDIVERIS_PATH`（設定時）→ `'audiveris'`（既定）の順で解決される
- [ ] spawn が ENOENT で失敗した場合、インストール／`SOLFA_AUDIVERIS_PATH`／Dev Container に言及した行動可能なメッセージが `kind:'omr'` として UI に届く
- [ ] ENOENT 以外のエラー・異常終了時のメッセージは従来の挙動を維持する
- [ ] 上記をユニットテスト（spawn を DI で差し替え）で検証している

### devcontainer への Audiveris 5.6.1 同梱（#2）

- [ ] Dockerfile が Audiveris 5.6.1 を URL＋SHA-256 固定で取得・展開する
- [ ] コンテナ内シェルで `audiveris` がヘッドレス実行可能（`audiveris -help` 等が起動する）
- [ ] 別途 JRE を入れていない（同梱ランタイムで動く）
- [ ] コンテナ再ビルド後、実 PDF（`tmp/IMSLP19716-...pdf`）で `npm run dev` の OMR が成功する（手動検証・手順を README/振り返りに記録）

### ドキュメント化

- [ ] README に2ルートの手順と `SOLFA_AUDIVERIS_PATH` の説明がある

## 成功指標

- 当初再現した「Audiveris の実行でエラーが発生しました」が、(a) devcontainer 再ビルドで**成功**に変わる、または (b) 未設定時に**行動可能な案内**に変わる、のいずれかで解消する。
- 既存テスト・lint・typecheck・build がすべて green を維持する。

## スコープ外

以下はこのフェーズでは実装しません:

- 配布物（packaged app）への Audiveris/JRE 同梱（`scripts/fetch-resources.ts` / electron-builder 設定）。別フェーズ。
- コード署名・公証（`docs/ideas/audiveris-bundling-license.md` 参照）。
- Audiveris のバージョン更新に伴うフィクスチャ再生成（5.6.1 固定を維持）。
- macOS/Windows のホスト向けインストール手順の網羅（README に要点のみ）。
- UI 側に専用の「エンジン未検出」パネル等の新規 UI を追加すること（今回はメッセージ改善に留める）。

## 参照ドキュメント

- `docs/product-requirements.md` - プロダクト要求定義書
- `docs/functional-design.md` - 機能設計書（F-1 OmrRunner）
- `docs/architecture.md` - アーキテクチャ設計書（ヘッドレス実行・依存管理）
- `docs/repository-structure.md` - リポジトリ構造定義書（resources/・同梱方針）
- `docs/development-guidelines.md` - 開発ガイドライン（テスト・モック方針）
- `docs/ideas/audiveris-bundling-license.md` - 同梱配布・ライセンス・署名メモ
