# 要求内容

## 概要

Solfa Overlay を **v0.1.0 として初回公開リリース**するための準備を行う。アプリの機能実装は変更せず、ライセンスの確定・プロダクト名の正式採用・README の公開向けリニューアル・リリースワークフローの調整といった「配布物としての体裁」を整える。

## 背景

Windows 実機でのインストーラ生成・インストール・動作確認がすべて成功し、一通りの機能が動作する状態になった（2026-07-26 時点）。UI には改善余地が残るが、**実際の利用者（合唱仲間）からのフィードバックを得ることが次の改善の最大の材料**であるため、早期に公開する。

一方で、現状のリポジトリには公開配布のブロッカーが残っている:

1. **アプリ本体のライセンスが未確定**（`package.json` は `UNLICENSED`・`LICENSE` ファイルなし）。AGPL-3.0 の Audiveris を同梱する以上、「本体は別プログラム（mere aggregation）」という主張を成立させるには本体側のライセンス明示が不可欠。`THIRD_PARTY_LICENSES.md` にも TODO として明記済み。
2. **プロダクト名がリポジトリ名と食い違っている**。ユーザーが触れる面（インストーラ・スタートメニュー・アプリ画面）はすべて `Solfa Overlay` だが、リポジトリ名のみ `movable-do-analyzer` のまま。README にも「（仮称）」が残る。
3. **README が開発者向けのみで、利用者向けの入口がない**。何をするアプリか一目で分かる画像がなく、配布物の入手・導入手順も未整備。加えて「実装状況」セクションが Phase 3 時点で止まっており、完成済みの機能が未実装に見える。
4. **リリースワークフローがタグ push で即公開**になっており、リリースノートを書く猶予がない。

## 実装対象の機能

### 1. アプリ本体ライセンスの確定（MIT）

- `LICENSE`（MIT License・著作権者 Nobuhiro Takaichi・2026年）を追加する
- `package.json` の `license` を `MIT` に変更する（`private: true` は npm publish 事故防止のため維持）
- `THIRD_PARTY_LICENSES.md` の「アプリ本体のライセンス — TODO」節を確定版へ書き換え、**本体 MIT／同梱 Audiveris AGPL-3.0（別プログラム）**という関係を明示する
- README にライセンス節を新設する

**MIT を選定した理由**: 本アプリの領域で特許紛争が現実的でないこと、想定貢献者が小規模であること、非エンジニアの利用者にも意味が伝わる簡潔さを優先した。Apache-2.0 の利点（明示的特許グラント・貢献者特許グラント・特許報復条項）は、本プロジェクトの規模では便益がコスト（文章量・NOTICE 運用）を上回らないと判断した。

### 2. プロダクト名「Solfa Overlay」の正式採用

- README・PRD から「（仮称）」を削除する
- 名称決定の根拠（商標調査結果を含む）を `docs/ideas/` に記録する
- GitHub リポジトリ名を `solfa-overlay` へ変更し、`git remote set-url` でローカルの origin を追従させる

**商標調査結果**: J-PlatPat（特許庁）の商標検索で称呼「ソルファ」を第9類（コンピュータソフトウェア）・第42類（ソフトウェアの設計・提供）について確認し、**いずれも該当なし**であることをユーザーが確認済み（2026-07-26）。`Solfa`（tonic sol-fa 由来の音楽用語）・`Overlay`（一般語）はいずれも識別力が弱く、第三者の独占的商標と衝突する可能性が低い。

### 3. README の公開向けリニューアル

- **ヒーロー画像**（Before / After）を冒頭に配置し、「何をするアプリか」を画像1枚で伝える
- 利用者向けの**インストール手順**（GitHub Releases から入手）を新設し、既存の開発者向け手順と分離する
- **SmartScreen 警告の記述を実測に合わせて修正**する（後述）
- **動作要件**（Windows 10/11 64bit・必要ディスク容量）を明記する
- **著作権に関する注意書き**（私的使用の範囲での利用を想定）を追加する
- **「実装状況」セクションを現状（Phase 5 完了・Windows 実機検証済み）に更新**する

**SmartScreen の記述修正が必要な理由**: 現行 README は「青い全画面の警告」と記載しているが、実機検証の結果、**警告画面の背景色は Windows のアクセントカラー設定に追従する**ことが判明した（アクセントカラーを変更し再起動したところ、警告画面の色も変化することを確認済み）。「青」と断定した記述は、赤系の警告を見た利用者に「別の（より危険な）警告では？」という不安を与えるため修正する。

**ヒーロー画像の素材**: `docs/assets/` に配置済みの Before / After 画像を使用する。素材は Anton Bruckner《Christus factus est》WAB 11（1884年作曲・作曲者1896年没）の IMSLP #365527（1929年 Edition Peters 版）で、楽曲・版ともにパブリックドメイン。`docs/development-guidelines.md`「テストデータの著作権ルール」（PD のみコミット可）と同じ基準を満たす。

### 4. リリースワークフローの調整

- `.github/workflows/release.yml` の `softprops/action-gh-release` に `draft: true` を追加し、タグ push 時に**下書き**の Release が作られるようにする（リリースノートを整えてから公開できる）

### 5. 公開用素材・調査資料の整理

- `docs/assets/` の画像ファイル名を `overlaid-*`（標準的な綴り）へ統一する
- `docs/repository-structure.md` の `docs/` 節に `assets/` を追記する

**補足**: 商標調査の根拠資料（J-PlatPat の一覧印刷 PDF）は、ユーザーが役目を終えたと判断して削除済み。調査の条件と結果は `docs/ideas/naming-and-trademark.md` にテキストとして記録する（J-PlatPat の検索結果は同じ条件で再現できるため、原本の保全は必須ではない）。

## 受け入れ条件

### アプリ本体ライセンスの確定

- [ ] リポジトリルートに `LICENSE`（MIT 全文）が存在する
- [ ] `package.json` の `license` が `"MIT"` である
- [ ] `THIRD_PARTY_LICENSES.md` に TODO の記述が残っていない
- [ ] `THIRD_PARTY_LICENSES.md` に「本体 MIT／同梱 Audiveris AGPL-3.0（別プログラム）」の関係が記述されている
- [ ] README にライセンス節があり、`LICENSE` と `THIRD_PARTY_LICENSES.md` の双方へリンクしている

### プロダクト名の正式採用

- [ ] `README.md`・`docs/product-requirements.md` に「（仮称）」の記述が残っていない
- [ ] 名称決定と商標調査の根拠が `docs/ideas/` に記録されている
- [ ] GitHub リポジトリ名が `solfa-overlay` に変更され、`git remote -v` の origin が新 URL を指している

### README のリニューアル

- [ ] README 冒頭に Before / After のヒーロー画像が表示され、出典（IMSLP #365527・作曲者名・PD である旨）がキャプションに明記されている
- [ ] 利用者向けインストール手順が、開発者向けセットアップ手順と明確に分離されている
- [ ] SmartScreen 節に「警告画面の色は Windows のアクセントカラー設定により異なる」旨の注記がある
- [ ] 動作要件（対応 OS・必要ディスク容量）が記載されている
- [ ] 私的使用の範囲での利用を想定する旨の注意書きがある
- [ ] 「実装状況」セクションのチェック状態が現在の実装（Phase 5 完了）と一致している

### リリースワークフローの調整

- [ ] `.github/workflows/release.yml` に `draft: true` が設定されている

### 公開用素材・調査資料の整理

- [ ] `docs/assets/` の画像が `overlaid-before-example.png` / `overlaid-after-example.png` にリネームされ、README から正しく参照されている
- [ ] `docs/repository-structure.md` の `docs/` 節に `assets/` が記載されている

### 全体品質

- [ ] `npm run test` がパスする
- [ ] `npm run lint` がパスする
- [ ] `npm run typecheck` がパスする
- [ ] `npm run build` が成功する

## 成功指標

- 公開リポジトリを初見の人が **README 冒頭の画像だけで「何をするアプリか」を理解できる**
- 非エンジニアの合唱団員が、README の手順のみでインストールから起動まで到達できる（SmartScreen 警告で離脱しない）
- AGPL-3.0 コンポーネントを同梱した配布物として、ライセンス上の説明責任を果たせる状態になっている

## スコープ外

以下はこのフェーズでは実施しません:

- **バージョン番号の 1.0.0 への引き上げ** — SemVer のメジャー 0 は「初期開発中・変更されうる」を意味する。UI に既知の改善余地があり、確認 UI のフローや出力仕様に破壊的変更を加える見込みがあるため、`0.1.0` のまま公開する。1.0.0 は UI・出力仕様を安定させる意思が固まった時点で検討する
- **コード署名の導入** — 未署名のまま配布し、README の手順で補う（`docs/ideas/audiveris-bundling-license.md`「5.5」の方針を継続）
- **macOS / Linux 向けビルド** — Windows のみを配布対象とする現行方針を維持する
- **UI の改善** — 公開後に利用者から得たフィードバックを踏まえて別タスクで実施する
- **アプリ内へのライセンス表示 UI の追加** — `THIRD_PARTY_LICENSES.md` の同梱（実装済み）で当面の説明責任は果たせるため、今回は追加しない
- **タグ push とリリース公開そのもの** — 準備完了後にユーザーが判断して実行する（本タスクは準備までを対象とし、実行手順は tasklist に手順として記載する）

## 参照ドキュメント

- `docs/product-requirements.md` - プロダクト要求定義書（プロダクト名・コンセプト）
- `docs/repository-structure.md` - リポジトリ構造定義書（`resources/` のライセンス方針・`docs/` 構成）
- `docs/development-guidelines.md` - 開発ガイドライン（Git 運用・テストデータの著作権ルール）
- `docs/ideas/audiveris-bundling-license.md` - AGPL-3.0 同梱の判断根拠・公開配布時のチェックリスト・コード署名の実務メモ
- `THIRD_PARTY_LICENSES.md` - 同梱コンポーネントのライセンス表記
