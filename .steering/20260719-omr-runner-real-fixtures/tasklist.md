# タスクリスト

- 作業名: 20260719-omr-runner-real-fixtures（OMR実行と実データ検証）

## 🚨 タスク完全完了の原則

**このファイルの全タスクが完了するまで作業を継続すること**

### 必須ルール

- **全てのタスクを`[x]`にすること**
- 「時間の都合により別タスクとして実施予定」は禁止
- 未完了タスク（`[ ]`）を残したまま作業を終了しない

### 実データ依存タスクの扱い

フェーズ5（実データ回帰）はユーザー提供の実 Audiveris 出力（`.omr`/`.mxl`）に依存する。
ファイル未着の間はフェーズ1〜4・6を先行実装し、ファイル着後にフェーズ5を実施する。

---

## フェーズ1: 基盤（依存・型・エラー）

- [x] fflate を dependencies に追加（`npm install fflate` → 0.8.3）
- [x] `src/shared/types/OmrProgress.ts` に `OmrPhase` / `OmrProgress` を定義
- [x] `src/main/omr/errors.ts` に `OmrRunError` / `OmrArchiveError` を定義

## フェーズ2: audiverisCommand.ts（純粋）

- [x] `buildAudiverisArgs(pdfPath, outputDir)` を実装（引数配列・文字列連結しない）
- [x] `buildAudiverisEnv(platform, base)` を実装（headless / GDK_SCALE）
- [x] `parseProgressLine(line)` を実装（phase・sheet 番号の抽出。無関係行は null）
- [x] `tests/unit/main/omr/audiverisCommand.test.ts` を追加（引数・env・進捗パース。12 tests pass）

## フェーズ3: omrArchive.ts（純粋）

- [x] `unzipEntries(bytes)` を実装（fflate `unzipSync`＋パストラバーサル防御）
- [x] `.mxl` 本体 XML 抽出（container.xml 優先・META-INF 除外フォールバック）
- [x] `assembleArtifacts({ omr, movements })` を実装（既存 domain パーサへ委譲）
- [x] `tests/unit/main/omr/omrArchive.test.ts` を追加（合成 zip・`../`拒否・成果物組み立て。12 tests pass）

## フェーズ4: OmrRunner.ts（DI spawner・副作用）

- [x] `SpawnFn` 部分型と `OmrRunner`（constructor で spawn を DI）を実装
- [x] `run(pdfPath, onProgress)` を実装（mkdtemp→spawn→進捗→close→収集→assemble→cleanup）
- [x] 出力ファイル収集（`.omr` と `<name>[.mvtN].mxl` の mvt 昇順）を実装
- [x] `cancel()` を実装（子プロセス kill・run の拒否）
- [x] エラー正規化（非ゼロ終了・spawn error・出力欠落 → `OmrRunError`）
- [x] `tests/unit/main/omr/OmrRunner.test.ts` を追加（擬似プロセスで正常/異常/cancel/進捗。7 tests pass）

## フェーズ5: 実データ回帰（ユーザー提供ファイル着後）

- [x] Victoria 実 `.omr`/`.mxl` を `tests/fixtures/victoria/` に配置（PD・PNG除去のslim版）
- [x] Victoria の実測値を確認（matched 295・notes 808・skipped 1(P3:m45)・クロスチェック不一致0）
- [x] `tests/integration/pipeline/victoria-regression.test.ts` を追加（実測値で固定回帰）
- [x] `tests/fixtures/victoria/README.md` に実測値の根拠・プロトタイプ実測との差分を記録
- [x] divisi 実 `.omr`/`.mxl` を配置（PD＝The Message of the Angels・commit）
- [x] ~~divisi で和音/divisi/多声小節の matched・取り違え0を確認~~（構造誤分割により Phase2 前は
      クリーン検証不可と判明。ユーザー決定でベースライン commit に変更。列稼働84小節は確認済み）
- [x] 既知の限界（ユニゾン共有符頭・列間 x 逆転・グレースノート）を README に記録（Phase2 で観察）
- [x] ~~Audiveris 実ログのサンプル化~~（今回はログ未取得。parseProgressLine は代表パターンで
      単体テスト済み。実ログ調整はホスト実行確認とセットで別途）

## フェーズ6: 品質チェック

- [x] `npm run test`（200 passed / 13 files。うち新規 OMR 系 36 + 実データ回帰 7）

## フェーズ6.5: 実装検証（implementation-validator）反映

- [x] implementation-validator 実施（総合 4.8/5・重大問題なし）
- [x] [推奨] `.mxl` 未出力時の OmrRunError パスの単体テスト追加
- [x] [推奨] `OmrPhase.starting` を spawn 直後に 1 回発行（型を実態に合わせる・進捗テスト更新）
- [x] [推奨] container.xml を 'musicxml' source でパースする理由をコメント明記
- [x] [提案] `run()` の多重起動ガード（既に実行中なら OmrRunError）＋テスト追加
- [x] [提案] divisi の pitchCrossCheckMismatch 内訳検証は Phase2 対応（divisi README に明記済み）
- [x] `npm run test:coverage`（domain: statements 99.09% / branches 93.65% / functions 100% / lines 99.37%）
- [x] `npm run lint`（クリーン）
- [x] `npm run typecheck`（node/web 両構成パス）
- [x] `npm run build`（electron-vite build 成功）

## フェーズ7: ドキュメント更新・振り返り

- [x] `docs/functional-design.md` の OmrRunner を実装に合わせて更新（構成・進捗型・エラー・DI・申し送り）
      ＋小節照合の実データ限界・回帰期待値を更新
- [x] `docs/architecture.md` の統合テスト期待値を実測値へ更新＋申し送り（本物 Audiveris はホスト手動）
- [x] `docs/development-guidelines.md` / `docs/repository-structure.md` の回帰期待値・フィクスチャ構成を更新
- [x] requirements.md の受け入れ条件を実績反映
- [x] 実装後の振り返り（このファイルの下部に記録）

---

## 実装後の振り返り

### 実装完了日

2026-07-19

### 計画と実績の差分

**計画と異なった点**:

- **divisi の受け入れ条件を変更**: 「和音/divisi 小節が matched・取り違え0」を狙ったが、実データ検証で
  この曲が声部の段階的入りによる**構造誤分割**を含み、BookStructureResolver（Phase2）なしでは
  クリーンに照合できないと判明。ユーザー決定で「Phase2 前ベースラインとして commit・現状値を固定」に変更。
- **回帰の期待値がプロトタイプ実測と乖離**: Victoria は 784音/skipped5 ではなく 808音/skipped1
  （Audiveris 5.6.1 ＋列対付けアルゴリズムの差）。プロトタイプ値を基準にせず実フィクスチャ実測を正とした。
- フィクスチャは PNG 除去の slim 版を commit（Victoria 724KB→315KB、divisi 5.1MB→2.4MB）。

**新たに必要になったタスク**:

- `realFixtureHelpers.ts`（実 .omr/.mxl → 照合の共有ヘルパー）の切り出し（2 回帰テストの重複排除）。
- ドキュメント4点（functional-design/architecture/development-guidelines/repository-structure）の
  期待値・フィクスチャ構成・OmrRunner 仕様の同期更新。

**技術的理由でスキップしたタスク**:

- 「divisi で取り違え0を確認」は構造誤分割により Phase2 前は検証不能 → ベースライン固定に置換。
- 「Audiveris 実ログでの進捗パーサ調整」はログ未取得のため代表パターンでの単体テストに留め、
  実ログ調整をホスト起動確認とセットで別途扱いに。

### 学んだこと

**技術的な学び**:

- **純粋/副作用の分離＋DI が効いた**: spawn を差し替え可能にし、コマンド組み立て・zip 展開・
  進捗パース・成果物組み立てをすべて純粋関数に寄せたことで、Audiveris 非搭載のコンテナでも
  正常/異常/キャンセル/進捗を含め自動テストできた（擬似 spawn が出力先へ実 zip を書き出す方式）。
- **実データは合成フィクスチャが隠す前提を暴く**: Victoria は完全ホモフォニーで和音列が0＝列対付けを
  一切 exercise しない。「Victoria で検証」は照合パイプラインの検証であって列対付けの検証ではなかった。
  列対付けを実データで exercise するのは divisi（84小節）だが、そこは構造誤分割が先に効く。
- **ScoreModelBuilder の構造前提の限界を特定**: 「全パートが全システムに存在」前提で通し小節番号を
  累積するため、声部の段階的入りで小節番号が全体ずれする。これは BookStructureResolver（Phase2）の
  具体的な要件として明確化できた（誤分割の実例が手に入った）。

**プロセス上の改善点**:

- **必要ファイルを早期にリクエスト**したことで、ユーザーの Audiveris 実行と実装を並行できた。
- 用語（spawn / DI）が伝わらなかった際に**具体例で言い換えて再質問**し、意思決定を止めなかった。
- 実データの想定外結果（divisi 大量 skip）を**握りつぶさずユーザーに提示して方針決定**した
  （ベースライン commit）。負の結果を Phase2 の具体的目標に転化できた。

### 次回への改善提案

- **次作業の最有力候補は BookStructureResolver（Phase2）**。divisi フィクスチャが具体的な回帰対象と
  改善目標（skipped 561→減）を提供済み。誤分割検出→復元後、divisi-regression の期待値を更新する。
- Audiveris 実行を伴う作業では、次回から**stdout/stderr ログもキャプチャして提供**してもらうと
  `parseProgressLine` を実ログで回帰できる（今回は未取得）。
- 実機での本物 Audiveris 起動確認（OmrRunner の E2E）はホスト手動の申し送りとして継続。
