# 設計書

## アーキテクチャ概要

**本タスクはアプリケーションコードを変更しない**。`src/` 配下への変更は行わず、配布物としての体裁を整えるドキュメント・メタデータ・CI 設定のみを対象とする。

変更対象を「関心」で分けると次の4群になる:

```
┌─ ライセンス群 ──────────────────────────────┐
│  LICENSE (新規)                              │
│  package.json (license フィールド)           │
│  THIRD_PARTY_LICENSES.md (TODO 節の確定)     │
└──────────────────────────────────────────────┘
┌─ 名称群 ────────────────────────────────────┐
│  README.md (H1 の「（仮称）」削除)           │
│  docs/product-requirements.md (同上)         │
│  docs/ideas/naming-and-trademark.md (新規)   │
│  GitHub リポジトリ名 + git remote (手動)     │
└──────────────────────────────────────────────┘
┌─ 公開面群 ──────────────────────────────────┐
│  README.md (全面再構成)                      │
│  docs/assets/*.png (リネーム)                │
└──────────────────────────────────────────────┘
┌─ リリース運用群 ────────────────────────────┐
│  .github/workflows/release.yml (draft: true) │
└──────────────────────────────────────────────┘
```

## コンポーネント設計

### 1. LICENSE（MIT）

**責務**:

- アプリ本体の利用条件を法的に確定させる
- 同梱 Audiveris（AGPL-3.0）との関係において「本体は別個のプログラム」という主張の前提を与える

**実装の要点**:

- OSI 公式の MIT License 原文をそのまま使用し、独自の文言追加をしない（改変すると「MIT である」と主張できなくなる）
- 著作権表記は `Copyright (c) 2026 Nobuhiro Takaichi`
- ファイル名は拡張子なしの `LICENSE`（GitHub がライセンス種別を自動判定する慣習に従う）

### 2. THIRD_PARTY_LICENSES.md（TODO 節の確定）

**責務**:

- 同梱物（Audiveris = AGPL-3.0 / JRE = GPLv2+CE）と本体（MIT）のライセンス関係を1か所で説明する

**実装の要点**:

- 71 行目以降の「アプリ本体（Solfa Overlay）のライセンス — TODO（公開リリース前に確定）」節を**確定版に差し替える**。TODO という語をファイルから消す
- 記述すべき内容:
  - 本体は MIT（`LICENSE` 参照）
  - 同梱 Audiveris は AGPL-3.0 で、**別個のプログラム**として同梱される（既存の「mere aggregation」節へ内部リンク）
  - **配布物（インストーラ）全体を再配布する場合は、同梱 Audiveris 部分について AGPL-3.0 の条件に従う必要がある**旨を明記する。本体が MIT であることは、同梱物の条件を緩めるものではない
- 既存の「対応ソースの提供」「mere aggregation」節は変更しない（すでに要件を満たしている）

### 3. README.md（全面再構成）

**責務**:

- 初見の人に「何をするアプリか」を画像1枚で伝える
- 非エンジニアの利用者を、入手から起動まで離脱させずに導く
- 開発者向け情報を維持しつつ、利用者向け情報と混ざらないよう分離する

**新しい見出し構成**:

```markdown
# Solfa Overlay                          ← 「（仮称）」を削除

（1〜2文の説明）
[ヒーロー画像: Before → After]          ← 新規
（画像キャプション: 出典・PD である旨）

## できること                             ← 新規（箇条書き3点）
## 動作要件                               ← 新規
## インストール                           ← 新規（利用者向け）
### SmartScreen の警告が出た場合          ← 既存節を移設・修正
## 使い方                                 ← 新規（3ステップの概要）
## 実装状況                               ← 既存（内容を現状へ更新）
## 楽譜の著作権について                   ← 新規
## ライセンス                             ← 新規
## 開発者向け情報                         ← 既存の開発系節をこの下へ集約
### 開発環境セットアップ
### OMR エンジン（Audiveris）の用意
### 配布版のビルド（Windows）
## ドキュメント                           ← 既存（末尾へ移動）
```

**実装の要点**:

- **画像は縦に2枚並べる**（Before → After）。楽譜は横長のため、横並びにすると各画像が半幅になり階名が読めなくなる
- 画像は `<p align="center">` + `<img src="docs/assets/...">` で配置し、直下に `<em>` でキャプションを置く（GitHub Markdown では画像キャプション記法がないため HTML を使う）
- キャプションには **作曲者名・曲名・IMSLP 番号・パブリックドメインである旨**を記載する。素材は Anton Bruckner《Christus factus est》WAB 11、IMSLP #365527
- **SmartScreen 節の修正点**（実測に基づく）:
  - 「青い全画面の警告」→ 色を断定しない表現に変更し、「**表示色は Windows のアクセントカラー設定に追従するため、青とは限らない（赤系などになる場合がある）**」旨の注記を添える
  - 警告が出る条件が **Mark of the Web（ダウンロードしたファイルに付く識別情報）**であることに触れ、「ダウンロードした .exe では警告が出るのが正常」だと理解できるようにする
  - 実機で確認した文言「Windows によって PC が保護されました」を引用し、この文言なら**未知アプリに対する保護であってウイルス検出ではない**ことを明示する
- **実装状況の更新**: 現行 README は Phase 3 時点で止まっている。`.steering/` の完了実績（Phase 4 確認フロー、Phase 5 階名付与と PDF 出力、Audiveris 同梱・Windows ビルド）を反映し、実際に完了している項目を `[x]` にする
- **動作要件**: Windows 10/11（64bit）。ディスク容量は Audiveris＋JRE 同梱のため実測値を記載する（`dist/` の生成物とインストール後のサイズを確認して記述）
- **楽譜の著作権について**: 適法に入手した楽譜を私的使用の範囲で扱うことを想定する旨。ローカル完結（外部送信なし）という設計上の性質も併記する

### 4. docs/ideas/naming-and-trademark.md（新規）

**責務**:

- プロダクト名を `Solfa Overlay` に確定した経緯と、商標調査の結果を記録として残す

**実装の要点**:

- `docs/ideas/` の他メモと同じ体裁（記録日・ステータス・位置づけ）に揃える
- 記録内容: 旧リポジトリ名 `movable-do-analyzer` との食い違い、`Solfa Overlay` を選んだ理由（コンセプト「元の版面へのオーバーレイ」と一致・"analyzer" は機能を誤って表す）、J-PlatPat での調査条件（称呼「ソルファ」／第9類・第42類）と結果（該当なし・2026-07-26 確認）、識別力が弱い語の組み合わせであるという評価
- **調査根拠 PDF は保全しない**（ユーザーが削除済み）。J-PlatPat は同じ検索条件で結果を再現できるため、**検索条件と実施日をメモに残すことで追試可能性を担保する**方針とする

### 5. .github/workflows/release.yml

**責務**:

- タグ push 時に、**下書き状態**の GitHub Release を作る

**実装の要点**:

- `softprops/action-gh-release@v2` の `with:` に `draft: true` を追加するのみ
- `files: dist/*.exe` は変更しない。下書きでもアセットは添付される
- 下書きにする理由をコメントで残す（リリースノートを整えてから公開するため）

## データフロー

### リリース実行の流れ（準備完了後）

```
1. develop → main へマージ（リリース可能な状態にする）
2. package.json の version（0.1.0）とタグ名（v0.1.0）の一致を確認
3. git tag v0.1.0 && git push origin v0.1.0
4. release.yml が windows-latest で起動
   → npm ci → npm run fetch-resources → npm run dist:win
5. dist/*.exe が「下書きの」GitHub Release に添付される
6. GitHub 上でリリースノートを記述
7. 「Publish release」で公開
```

**注意**: 手順 3 以降は公開行為にあたるため、準備完了後にユーザーの判断で実行する。

## エラーハンドリング戦略

コード変更を伴わないため、アプリケーションのエラーハンドリングに変更はない。

ドキュメント作業上の失敗リスクと対策:

| リスク | 対策 |
| --- | --- |
| README の画像パスが GitHub 上で壊れる | リポジトリルートからの相対パス（`docs/assets/...`）で記述する。絶対 URL は使わない（リポジトリ名変更で壊れるため） |
| リポジトリ名変更で既存の clone が壊れる | GitHub のリダイレクトが効くが、`git remote set-url` で明示的に追従させる |
| 画像リネームと README 参照の不整合 | リネーム → README 記述の順で行い、最後に `grep` でパス整合を確認する |

## テスト戦略

### 既存テストへの影響

- `tests/unit/renderer/App.test.tsx` は `'Solfa Overlay'` という見出しを期待している（3 箇所）。**本タスクでアプリ内の表示名は変更しないため、影響はない**
- ドキュメント・CI 設定の変更はテスト対象外

### 検証方法

- `npm run test` / `npm run lint` / `npm run typecheck` / `npm run build` の 4 点がパスすること（`package.json` を編集するため、パースエラーの検出を兼ねる）
- README の画像表示・リンク切れは、GitHub 上でのプレビューにより目視確認する（ローカルの Markdown プレビューでは相対パスの解決が異なる場合があるため）
- `release.yml` の YAML 構文は、変更後に GitHub Actions のワークフロー構文エラーが出ないことをタグ push 時に確認する

## 依存ライブラリ

新規追加なし。

## ディレクトリ構造

```
（新規）
LICENSE
docs/ideas/naming-and-trademark.md

（変更）
README.md                                     ← 全面再構成
package.json                                  ← license: UNLICENSED → MIT
THIRD_PARTY_LICENSES.md                       ← TODO 節を確定版へ
docs/product-requirements.md                  ← 「（仮称）」削除
docs/repository-structure.md                  ← docs/assets/ を追記
.github/workflows/release.yml                 ← draft: true

（リネーム）
docs/assets/overlayed-before-example.png → overlaid-before-example.png
docs/assets/overlayed-after-example.png  → overlaid-after-example.png
```

## 実装の順序

1. **ライセンス群を先に確定する** — 公開の前提条件であり、他の作業（README のライセンス節）が依存するため
2. **素材整理**（画像リネーム・PDF 移動）— README 執筆時にパスが確定している必要があるため
3. **名称の正式採用** — README 再構成の中で H1 を書き換えるため、README 作業の直前に行う
4. **README の再構成** — 上記すべての成果物を参照する集約点であるため最後に近い位置
5. **release.yml の調整** — 他と独立しているため順序は自由だが、まとめて確認できるよう README の後に置く
6. **品質チェック** — すべての変更後に実施
7. **リポジトリ名変更**（GitHub 側の手動操作）— ローカルの変更をすべて push できる状態にしてから行う

## セキュリティ考慮事項

- **未署名バイナリの配布**という性質は変わらない。README で「なぜ未署名か」「警告が出るのは正常か」を説明することで、利用者が**警告を無条件に無視する習慣**を身につけないよう配慮する。具体的には「信頼できる入手経路（本リポジトリの Releases）から取得したことを確認したうえで実行する」という条件を明示する
- ライセンス関連の記述で、**本体が MIT であることを理由に同梱 Audiveris の AGPL 条件が緩むと誤読されない**よう、再配布時の義務を明記する

## パフォーマンス考慮事項

- ヒーロー画像は合計約 1MB（543KB + 470KB）。GitHub の README 表示および `git clone` の負担として許容範囲。`electron-builder.yml` の `files` に `'!docs/**'` があるため、**配布インストーラのサイズには影響しない**
- 画像は PNG を維持する（楽譜の細い譜線は JPEG 圧縮でノイズが出るため）

## 将来の拡張性

- **1.0.0 への引き上げ**: 利用者フィードバックを踏まえた UI 改善が一巡し、確認 UI のフローと出力仕様を安定させる意思が固まった時点で検討する
- **コード署名**: 配布規模が拡大した場合、Azure Trusted Signing（個人受付の可否は要確認）または個人 OV 証明書を検討する（`docs/ideas/audiveris-bundling-license.md` 5.5）
- **macOS / Linux 配布**: `release.yml` を OS matrix 化し、`fetch-resources.ts` に各 OS の Audiveris 取得を追加する
- **アプリ内ライセンス表示**: 配布規模が拡大した場合、アプリ内から `THIRD_PARTY_LICENSES.md` を閲覧できる UI を追加する
