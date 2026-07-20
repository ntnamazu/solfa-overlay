# タスクリスト

- 作業名: 20260719-phase4-confirm-flow-persistence（ロードマップ Phase 4: 確認フローと永続化）

## 🚨 タスク完全完了の原則

**このファイルの全タスクが完了するまで作業を継続すること**

### 必須ルール

- **全てのタスクを`[x]`にすること**
- 「時間の都合により別タスクとして実施予定」は禁止
- 未完了タスク（`[ ]`）を残したまま作業を終了しない

### タスクスキップが許可される唯一のケース

実装方針・アーキテクチャ・依存関係の変更により技術的にタスクが不要／実行不可能になった場合のみ。
スキップ時は `- [x] ~~タスク名~~（理由）` の形式で理由を明記する。

---

## フェーズ0: 着手前の実データ計測と退行検知の基準取り

- [x] 実データで確認訂正の効果を計測（`tmp/probe`。設計の主要分岐を着手前に確定させる）
  - [x] 音部記号グループ数: Victoria 5 / divisi 17（譜表は 36 / 288）
  - [x] ALTO→TREBLE 訂正の効果: `pitchCrossCheckMismatch` 569 → 111（P6 402→0・P4 38→0）
- [x] `npm run test` を実行し、着手前の全テストがパスすることを確認（基準値: 350 passed / 18 files）
- [x] `tmp/probe` を削除する（計測結果は requirements.md に転記済み）

## フェーズ1: 依存ライブラリと型の整理

- [x] `zod` / `@testing-library/react` / `@testing-library/dom` / `jsdom` を追加
- [x] `vitest.config.ts` に renderer 用の jsdom 環境を追加（unit/integration は node のまま）
      → vitest 4 の `projects` で node / renderer の 2 プロジェクト構成にした
- [x] `tsconfig.web.json` に renderer テストを含める（`tsconfig.node.json` からは exclude）
- [x] `src/shared/types/StructureDecision.ts` を新規作成（`domain/score/BookStructureResolver.ts` から移設）
  - [x] `BookStructureResolver` / 既存テストの import を更新（`export type` で再エクスポート）
- [x] `src/shared/types/KeyRegion.ts` に `KeyRegionDecision` を追加
- [x] `src/shared/types/Annotation.ts` を新規作成（Phase 5 で使用。永続化スキーマのため型のみ先行）
- [x] `src/shared/types/Project.ts` を新規作成（`Project` / `PageInfo`）
- [x] `src/shared/types/Confirmation.ts` を変更
  - [x] `staffRef` → `staffRefs: StaffRef[]`
  - [x] `kind` を `'clef'` に限定（調号は KeyRegionDecision・構造は StructureDecision が担う旨を TSDoc に明記）
  - [x] `partId` / `mismatchCount` / `UNKNOWN_CLEF` を追加
- [x] `ScoreModelBuilder.collectClefCorrections` を `staffRefs` に追随させる
- [x] 既存テスト（`ScoreModelBuilder.test.ts` 等）の `ConfirmationItem` 生成を更新し、退行がないことを確認
      （350 passed 維持・typecheck クリーン）

## フェーズ2: 確認項目の生成（domain）

- [x] **[追加]** `BuildIssue.pitchCrossCheckMismatch` に `staffRef` を追加
      （partId だけでは P6 の ALTO 35 段と TREBLE 8 段を区別できず、不一致件数を
      正しいグループへ帰属できないため。Editor の不一致ジャンプ先にもなる）
- [x] `src/domain/score/confirmationItems.ts` を新規作成
  - [x] パート×検出音部記号でのグルーピング（`clefKind` null は `'UNKNOWN'` として1グループ）
  - [x] `BuildIssue.pitchCrossCheckMismatch` のグループ別集計
  - [x] 並び順「不一致件数の降順 → partId → detected」（決定的であること）
  - [x] `clipRect` を代表譜表の符頭座標から近似（TSDoc に近似である旨と精緻化時期を明記）
  - [x] `id` は `clef-<partId>-<detected>` 形式
  - [x] **[追加]** `mergeCorrections()`（再解析後も修正値を id で引き継ぐ。
        これがないと「訂正→再解析→訂正が消える」ループになる）
- [x] `tests/unit/domain/score/confirmationItems.test.ts` を新規作成（18 tests）
  - [x] 同一パート・同一 clef の複数譜表が 1 グループに畳まれる
  - [x] 同一パートでも clef が違えば別グループになる
  - [x] `clefKind` 未検出の譜表がグループになる
  - [x] 不一致件数の多いグループが先頭に来る
  - [x] 並び順が決定的（入力順を変えても同じ結果）
  - [x] 符頭のない譜表で `clipRect` が破綻しない
  - [x] 不一致が発生した譜表のグループにだけ加算される
  - [x] `mergeCorrections` の引き継ぎ・消失時の落ち方

## フェーズ3: 調文脈のユーザー訂正（domain）

- [x] **[追加]** `keyTable.fifthsForTonic()`（`tonicForFifths` の逆写像）
      → `KeyRegion` は調号ではなく主音を持つため、旋法だけを訂正して
      「調号を保ったまま平行調へ移す」には元の調号の復元が必要だった
- [x] `KeyRegionBuilder.build()` に `decisions` 引数を追加
  - [x] 自動生成後に訂正を適用（生成中に混ぜない）
  - [x] `fifths` / `mode` の上書きと `source: 'user'`
  - [x] 隣接する同一調の区間をマージ（先頭側を残す・曲頭区間を保護）
  - [x] 既存区間に一致しない decision を `unmatchedKeyDecision` として報告
  - [x] 範囲外 `fifths` の decision を `unsupportedKeySignature` として報告
- [x] `KeyRegionIssue.keySignatureConflict` を `keyByPart`（fifths＋mode）へ変更
  - [x] 食い違い判定を fifths と mode の両方で行う
  - [x] 既存テスト・`realFixtureHelpers` の追随
  - [x] **既存テストが誤った仕様を固定していた**: 「同じ fifths で長短が同数なら長調を採る」が
        `issues: []` を期待していた（＝旋法の食い違いを無言処理する挙動をテストが追認）。
        期待値を反転し、旋法の食い違いを報告する形にした。Phase 3 の [必須] 指摘と同じ類型
- [x] `tests/unit/domain/solfa/KeyRegionBuilder.test.ts` に追記（41 tests）
  - [x] `mode: 'minor'` 指定で該当区間が短調になり `source` が `'user'` になる
  - [x] `fifths` 上書きで主音が変わる
  - [x] 訂正で隣接区間が同じ調になったらマージされ区間数が減る
  - [x] 曲頭区間を訂正してもマージで消えない
  - [x] 未一致 decision が例外にならず報告される
  - [x] 範囲外 fifths の decision が報告され無視される
  - [x] mode だけが食い違う調号が `keySignatureConflict` として報告される
- [x] `tests/unit/domain/solfa/keyTable.test.ts` に `fifthsForTonic` の逆写像テストを追加（全15調×長短）

## フェーズ4: 永続化（storage）

- [x] `src/storage/errors.ts`（`ProjectFileError`）
- [x] `src/storage/projectArchive.ts`
  - [x] fflate による `.solfaproj` の読み書き
  - [x] 展開時のパストラバーサル拒否
  - [x] `omr/score.omr` ＋ `omr/score[.N].mxl` の格納・復元
- [x] `src/storage/projectSchema.ts`
  - [x] `SCHEMA_VERSION = 1` と Zod スキーマ（`Project` 全体）
  - [x] `parseProject(unknown)`（`schema` / `version` のエラー分類）
  - [x] マイグレーション経路（v1 は恒等。分岐を用意する）
- [x] `src/storage/backupRotation.ts`
  - [x] `.bak1..3` の世代ローテーション（**古い番号から降順に**動かす）
- [x] `src/storage/ProjectStore.ts`
  - [x] `create()` / `readSourcePdf(path)` / `save(path, project, sourcePdf, omr)` / `load(path)`
    - 計画では `create(sourcePdfPath)` だったが引数を廃した。`sourcePdf` はプロジェクト内の
      固定相対パス（`source.pdf`）であり、取り込み元の絶対パスを持つとファイルを移動・共有した
      先の環境で無効な参照になるため。元PDF の読み込みは `readSourcePdf` に分離した
  - [x] 同ディレクトリの一時ファイル → `rename` による原子的書き込み
  - [x] 保存前の世代バックアップ
- [x] `tests/unit/storage/projectArchive.test.ts`（往復・パストラバーサル拒否）
- [x] `tests/unit/storage/projectSchema.test.ts`（正常・不正・版数超過・欠落）
- [x] `tests/unit/storage/backupRotation.test.ts`（降順処理・世代上限3・初回保存）
- [x] `tests/unit/storage/ProjectStore.test.ts`（往復・原子性・エラー分類）

## フェーズ5: 実データ統合テスト（先に既存回帰を通す）

- [x] **先に** victoria / divisi / solfa-pipeline の既存回帰を実行し、期待値が変わらないことを確認
- [x] `tests/integration/pipeline/confirmation-effect.test.ts` を新規作成
  - [x] 確認項目グループ数: Victoria 5 / divisi 17
  - [x] ALTO→TREBLE 訂正で `pitchCrossCheckMismatch` 569 → 111
  - [x] P6 402 → 0 / P4 38 → 0
  - [x] 1 グループの訂正が全譜表（P6 は 35 段）へ適用される
  - [x] `mode: 'minor'` 指定で La 基準と Do 基準の階名が食い違う（制約の解消を固定）
- [x] `tests/integration/project-file/save-load-roundtrip.test.ts` を新規作成
  - [x] 実フィクスチャを含む `.solfaproj` の保存 → 読込で `Project` が一致
  - [x] 読込後に **OMR 再実行なしで** 階名まで到達できる
  - [x] 確認状態・decisions が復元され、訂正後の照合結果が再現される

## フェーズ6: 編成レイヤー（main）

- [x] `src/main/ProjectSession.ts` を新規作成
  - [x] `OmrArtifacts` と `Project` の保持
  - [x] `analyze()`（構造解決 → 照合 → 確認項目生成 → 調文脈 → 階名）
  - [x] 訂正の適用（`structureDecisions` / `confirmation` / `keyRegionDecisions`）
- [x] `src/shared/ipc/channels.ts` / `contract.ts` を拡充
- [x] `src/main/ipc/` のハンドラ群（プロジェクト作成・保存・読込・OMR 実行/キャンセル・訂正・承認）
- [x] `src/main/index.ts` でハンドラを登録し、進捗イベントを `webContents.send` で流す
- [x] `tests/unit/main/ProjectSession.test.ts`（解析パイプラインの編成・訂正の反映）
- [x] **[追加]** `StructureIssue` / `BuildIssue` / `KeyRegionIssue` / `AdoptedKey` を
      `shared/types/Issues.ts` へ移設（domain 側は `export type` で再エクスポート）
      → 確認画面へ IPC で送る表示用データであり `shared/ipc/contract.ts` が型として参照する。
      shared は domain へ依存できない（ESLint で強制）ため、移さないと契約が書けなかった。
      Phase 1 の `StructureDecision` 移設と同じ理由づけ
- [x] **[追加]** `OmrRunner.run()` の戻り値に生バイト列 `raw` を追加
      → プロジェクトファイルへ同梱するのに必要だが、一時ディレクトリは run 終了時に消えるため
      ここで返さないと二度と取得できない
- [x] **[追加]** `IpcResult` / `IpcError` による失敗の値返し
      → IPC 越しの例外はクラス情報が失われ、`version`（アプリ更新）と `zip`（バックアップから開く）で
      回復手段を出し分けられなくなるため
- [x] **[追加]** `tests/unit/main/ipc/projectHandlers.test.ts`（エラー分類・委譲）

## フェーズ7: UIレイヤー（preload / renderer）

- [x] `src/preload/api.ts` / `index.ts` を拡充（進捗イベントの購読を含む）
- [x] `src/renderer/App.tsx` に画面遷移状態を実装
- [x] `src/renderer/screens/Home/Home.tsx` を本実装（PDF を開く／プロジェクトを開く）
- [x] `src/renderer/screens/OmrProgress/OmrProgress.tsx`（進捗・キャンセル）
- [x] `src/renderer/screens/StructureConfirm/StructureConfirm.tsx`（issue 一覧・小節数の上書き）
- [x] `src/renderer/screens/ClefKeyConfirm/ClefKeyConfirm.tsx`（音部記号グループ表＋調文脈表・承認）
- [x] 各画面のコンポーネントテスト（jsdom）
  - [x] `tests/unit/renderer/Home.test.tsx`
  - [x] `tests/unit/renderer/OmrProgress.test.tsx`
  - [x] `tests/unit/renderer/StructureConfirm.test.tsx`
  - [x] `tests/unit/renderer/ClefKeyConfirm.test.tsx`
  - [x] `tests/unit/renderer/App.test.tsx`（画面遷移）

## フェーズ8: 品質チェック

- [x] `npm run test`
- [x] `npm run test:coverage`（domain のしきい値を維持）
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npx prettier --check .`（Phase 3 で未整形が記録済みのため本フェーズで解消する）

## フェーズ9: 実装検証（implementation-validator）反映

- [x] `implementation-validator` サブエージェントで検証
  - [x] 観点に「同じ入力を取るコンポーネント同士で、不正入力への反応が揃っているか」を明示的に含める
        （Phase 3 の [必須] 指摘の類型）
- [x] 指摘への対応
- [x] 修正後の再確認（test / lint / typecheck）

## フェーズ10: ドキュメント更新・振り返り

- [x] `docs/functional-design.md` を更新
  - [x] `ConfirmationItem` の型変更（`staffRefs` 化・`kind` の限定）と理由
  - [x] ClefKeyConfirm を 2 表構成（音部記号グループ／調文脈）に改める理由と実測値
  - [x] `KeyRegionDecision` と `KeyRegionBuilder` の decisions 対応
  - [x] `ProjectStore` のインターフェース確定
- [x] `docs/architecture.md` を更新
  - [x] テスト戦略にコンポーネントテスト（jsdom）を追加
  - [x] 統合テストの期待値に確認訂正の効果（569 → 111）を追加
- [x] `docs/repository-structure.md` に新規ファイルを追加
- [x] `docs/glossary.md` の確認項目・調文脈まわりを実装に合わせて確認・更新
- [x] `tests/fixtures/*/README.md` に確認訂正の実測値を追記
- [x] requirements.md の受け入れ条件を実績反映
- [x] 実装後の振り返り（このファイルの下部に記録）

---

## フェーズ11: コードレビュー指摘の反映（/code-review）

実装完了・全テスト緑の状態から `/code-review` を実行し、10 件の指摘を全て修正した。
**うち 7 件は既存テストが 1 件も捕まえていなかった**。

### データが壊れる・消える（グループA）

- [x] `StructureConfirm` の行キーが配列添字だった
      → issue が 1 件解消すると入力中の値が**別の段の行へ引き継がれ、そのまま書き込まれる**。
      `system-<pageIndex>-<systemIndex>` に変更
- [x] `open()` / `importPdf()` が状態を段階代入していた
      → 途中で throw すると「新しい PDF ＋ 古いプロジェクト」が残り、次の保存で
      元のファイルへ別プロジェクトの PDF を書き込む。`adopt()` で一括差し替えに変更
- [x] 終了時に保留中の自動保存が消えていた
      → タイマーを `unref` しているうえ flush が未結線。`before-quit` で書き切るよう結線し、
      `ProjectSession` をモジュールスコープへ移した
- [x] 保存が直列化されていなかった
      → 進行中の保存と明示保存が重なると世代ローテーションが二重に走る。`saveChain` で直列化

### 今回の受入基準を壊していた（グループB）

- [x] `zipSync` が Main プロセスを止めていた
      → 自動保存を足したことで訂正のたびに数十MBの deflate が同期実行される状態に。
      アーキテクチャ設計書の「自動保存 = UI非ブロック」に違反していた。
      `zipEntriesAsync` を追加し、圧縮済みの PDF / `.omr` / `.mxl` は `level: 0` で再圧縮しない
- [x] 訂正のたびに確認表の行が並び替わっていた
      → 訂正が効くと不一致 0 件になり、今直した行が末尾へ落ちる。`mergeCorrections` が
      並び順も引き継ぐようにした（17 行に畳んだ設計の前提そのものが崩れていた）
- [x] `completeConfirmation` が issue を空配列で返していた
      → 承認後に確認画面が「問題は見つかりませんでした」と偽表示する。`lastIssues` を保持

### 軽微（グループC）

- [x] `unresolvedItems()` が `shared/` にあった（リポジトリ構造定義書「実装ロジックは置かない」違反）
      → `ClefKeyConfirm` へ移動
- [x] `schemaVersion` の下限が未検証・保存時に正規化していなかった
- [x] キャンセル失敗時に `canceling` が解除されず、ボタンが永久に無効化されていた

### 検証

全ての修正に回帰テストを付け、**修正を戻すとテストが落ちることを確認した**。
その過程で自分が書いたテスト 2 件が偽物（`cleanup()` で state がリセットされる／
存在しないプロパティを `?? 4` で握りつぶす）だったことも判明し、作り直した。

実績: 562 → **587 テスト**（33 ファイル）。lint / typecheck / build / prettier / カバレッジ全てクリーン。

---

## 実装後の振り返り

### 実装完了日

2026-07-19

### 実績サマリ

| 項目                                | 着手前                        | 完了時                                            |
| ----------------------------------- | ----------------------------- | ------------------------------------------------- |
| テスト数                            | 350（18 ファイル）            | **562**（32 ファイル）                            |
| カバレッジ（domain + storage）      | —                             | statements 98.4% / branches 95.3%（しきい値 90%） |
| lint / typecheck / build / prettier | prettier に未整形 83 ファイル | すべてクリーン                                    |

### 計画と実績の差分

**計画どおりだったこと**

- 着手前の実データ計測（`tmp/probe`）が UI 設計の主要分岐を決めた。Phase 2・3 に続き 3 回連続で有効。
  計測値（288→17 行、569→111）が**そのまま統合テストの期待値**になり、実装後に 1 つも修正が要らなかった
- 「domain・統合テストを先に、UI を最後に」の実装順序。UI 着手時点で解析側の値が確定していたため、
  画面テストは表示と結線だけに集中できた

**計画になかった追加（いずれも実装中に必要性が判明）**

| 追加                                             | 理由                                                                                                                                                     |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/types/Issues.ts` への issue 型の移設     | 確認画面へ IPC で送る表示用データであり `ipc/contract.ts` が参照する。shared は domain へ依存できない（ESLint で強制）ため、移さないと契約が書けなかった |
| `OmrRunner.run()` の戻り値に生バイト列 `raw`     | プロジェクトへ同梱するのに必要だが、一時ディレクトリは run 終了時に消えるため、ここで返さないと二度と取得できない                                        |
| `IpcResult` / `IpcError` による失敗の値返し      | IPC 越しの例外はクラス情報が失われ、`version`（アプリ更新）と `zip`（バックアップから開く）で回復手段を出し分けられない                                  |
| `mergeCorrections()` / `fifthsForTonic()`        | それぞれ「訂正→再解析→訂正が消える」ループの防止、旋法だけの訂正で調号を復元するため                                                                     |
| `SELECTABLE_CLEF_KINDS` と domain との整合テスト | 選択肢と domain の音部記号表が食い違うと「選べるのに解釈されない値」が生まれる                                                                           |

**計画から変えたこと**

- `ProjectStore.create(sourcePdfPath)` → `create()`。`sourcePdf` はプロジェクト内の固定相対パスであり、
  取り込み元の絶対パスを持つとファイルを移動・共有した先で無効な参照になるため
- IPC ハンドラの「1チャネル1ファイル」（`handleProjectOpen.ts` 等）を取りやめ、
  `ipc/projectHandlers.ts` に集約。ハンドラの実体が「委譲＋結果変換」の 2〜3 行しかなく分割の利得がない
- ClefKeyConfirm を単一テーブル → **2 表構成**（音部記号グループ／調区間）。
  音部記号は譜表の性質、調は小節区間の性質であり、混ぜると行の意味が定まらない

### 学んだこと

**1. 「実測が設計を決める」が 3 フェーズ連続で当たった**

着手前に `tmp/probe` で 288 行 vs 17 行を出していなければ、機能設計書どおりの「譜表ごとに 1 行」で
実装し、divisi で 288 行の使い物にならない画面を作ってから作り直していた。
設計判断の分岐点では**実装前に実データの分布を見る**を今後も既定の手順にする。

**2. ドキュメントの前提そのものが誤っていることがある**

本フェーズの動機は「Audiveris が mode を出さないため La 基準の移動ドが自動では効かない」だったが、
実装検証で**これが誤りだった**ことが判明した。La 基準は do を平行長調の主音に置くため、
自動判定の「常に長調」のままで既に正しい。効くのは Do 基準である。
機能設計書・fixtures の README・本 requirements.md をすべて訂正した。
**動機として書かれている前提も、実装で触れた時点で検算する**。

**3. テストが弱いと自分のバグを見逃す**

「保存に失敗したら理由を示す」の画面テストを、当初は「確認画面に留まること」だけ検証する形で書いた。
これでは通ってしまうが、実際には**確認画面はエラーを一切描画していなかった**（`errorMessage` は
Home にしか渡していなかった）。「何が表示されるか」まで書いたところで初めて欠陥が露出した。
Phase 3 の「テストが誤った仕様を固定する」と根は同じで、**アサーションが緩いテストは
バグを隠す**という一般則として扱う。

**4. 検証エージェントは「動くこと」の先を見つける**

実装完了・全テスト緑・lint/typecheck クリーンの状態から、`implementation-validator` が
**必須 1 件・推奨 3 件**の実質的な欠陥を出した。特に以下は自力では気づけていなかった:

- 自動保存が未実装（設計書に明記されているのに、承認時の 1 回しか保存していなかった）。
  このフェーズの動機そのものが「訂正の消失を防ぐ」だったのに、その穴が残っていた
- 承認後に訂正しても `completedAt` が戻らない（未確認の内容が承認済みとして保存され得る）
- `save` で本体を bak1 へ退避した後に最終リネームが失敗すると**保存先からファイルが消える**

3 つとも「テストは全部通るが、設計として間違っている」類型だった。

**5. 再現できない失敗経路には DI の継ぎ目を入れる**

上記の「退避後の最終リネーム失敗」は、実ファイルシステムでは狙って再現できなかった
（保存先をディレクトリで塞いでも、ローテーションが先にそれを退避してしまう）。
`OmrRunner` の `SpawnFn` と同じ形で `FileOps` を注入可能にして初めて回帰テストが書けた。
**書いたテストが修正前に落ちることを確認した**（落ちなければ、そのテストは何も守っていない）。

### 次回への改善提案

1. **「設計書に書いてあるのに実装していない」を検出する手順を持つ**
   自動保存の未実装は、`docs/architecture.md` の「プロジェクト自動保存: デバウンス 300ms」と
   実装を突き合わせれば気づけた。tasklist にタスクとして起こしていなかったのが原因。
   次回はステアリング作成時に**関連する設計書の該当節を洗い出してタスク化**する
2. **画面テストのアサーションは「何が表示されるか」まで書く**
   「その画面に留まる」「例外が出ない」だけのテストは欠陥を隠す
3. **失敗経路のテストは、修正を戻して落ちることを必ず確認する**
4. **`tmp/probe` による着手前計測を正式な手順にする**（3 フェーズ連続で有効）
5. **Phase 5 への申し送り**
   - `PageInfo` は空配列のまま。オーバーレイ描画に着手する時点で実値が要る
   - `ConfirmationItem.clipRect` は符頭のバウンディングボックスからの近似で、切り抜き画像の表示は未実装
   - `unmatchedCorrections` は `ProjectSession` が返すが、画面はまだ表示していない
   - `AppSettingsStore.ts` / `writeExportPdf.ts` は未作成（repository-structure.md に予定として記載）
