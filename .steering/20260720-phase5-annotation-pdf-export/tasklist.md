# タスクリスト

- 作業名: 20260720-phase5-annotation-pdf-export（ロードマップ Phase 5: 階名付与とPDF出力）

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

## フェーズ0: 着手前の実データ計測と設計書の突き合わせ

- [x] 実データ計測（`tmp/probe`。Phase 2・3・4 に続き 4 回連続）
  - [x] 発見1: 1 sheet に複数 Audiveris ページ（Victoria 3 sheet / 4 page）
  - [x] 発見2: 画像寸法は sheet 単位・A4 とは限らない（2480×3507 / 2408×3150）
  - [x] 発見3: 符幹・加線の除外で解決不能 766 → 44 件
  - [x] 発見4: 実データに `do♭` `l♭` が出て pdf-lib 標準フォントが例外を投げる
- [x] `npm run test` を実行し、着手前の全テストがパスすることを確認（基準値: 587 passed / 33 files）
- [x] **[Phase 4 の改善提案1]** 関連する設計書の該当節を洗い出してタスク化されているか確認
  - [x] `docs/functional-design.md` の AnnotationManager / OverlayRenderer / writeExportPdf /
        「注釈配置と衝突回避」/「Editor画面の表示」/「カラーコーディング」
  - [x] `docs/architecture.md` の「修正後のPDF再出力 30秒以内」「ページ単位の遅延描画」
        → 前者は統合テストで実測を確認するタスクをフェーズ10へ追加。後者は Editor が
        テキスト最小表示のため**プレビュー件数を制限する**ことで担保（design.md に記載）
  - [x] `docs/repository-structure.md` の `domain/annotations/` `domain/render/` `writeExportPdf.ts`
- [x] `tmp/probe` を削除する（計測結果は requirements.md に転記済み）

## フェーズ1: 依存と型の整理

- [x] `pdf-lib` を追加（architecture.md の選定どおり ^1.17）
- [x] `src/shared/types/Project.ts` の `PageInfo` に `sourcePageIndex` を追加
      （TSDoc に「`pageIndex` とは一致しない」理由を明記）
      → あわせて `interlinePx` も追加（配置オフセットの基準に必要）
- [x] `src/storage/projectSchema.ts` の `PageInfo` スキーマを更新
      （`SCHEMA_VERSION` は 1 のまま。既存ファイルの `pages` は必ず空配列である旨をコメントに残す）
- [x] `src/shared/types/Annotation.ts` の TSDoc を更新（`anchor` は注釈矩形の左下＝ベースライン）

## フェーズ2: `.omr` からの幾何情報（domain/score）

- [x] `OmrSheetParser` に `OmrSymbol` / `SheetImage` / `SheetGeometry` を追加
- [x] `parseSheetGeometry(xml)` を実装
  - [x] 記号タグの収集（細線も収集し `kind` で残す）
  - [x] **[追加]** 集約要素（`head-chord` / `beam-group` / `staff-barline` 等）は収集しない。
        これらの `<bounds>` は和音や段全体を覆う広い矩形で、障害物にすると譜面の大半が
        「埋まっている」ことになり配置が破綻する
  - [x] `<picture>` / `<scale><interline>` 欠落時は `image: null`
  - [x] ページ順が `parseSheetXml` と一致する
- [x] `BookPageRef` に `sourcePageNumber` を追加（`<sheet><input><number>`。欠落時は sheet 番号）
- [x] `tests/unit/domain/score/OmrSheetParser.test.ts` に追記（22 tests）
  - [x] 記号の収集と kind の保持
  - [x] `image` 欠落時に null
  - [x] `sourcePageNumber` の読み取りと欠落時のフォールバック
  - [x] 同一 sheet の複数ページが同じ元PDFページを指す

## フェーズ3: ページ幾何の組み立て（main/omr）

- [x] `omrArchive.ts` の sheet 並び計算を共通関数（`sheetXmlsInOrder`）へ切り出す
- [x] `assemblePageGeometry(omr)` を実装（`PageGeometry[]`）
- [x] `tests/unit/main/omr/omrArchive.test.ts` に追記（16 tests）
  - [x] `assembleArtifacts(...).pages` と `assemblePageGeometry(...)` の**長さと順序が一致**する
  - [x] シート XML 欠落時の扱いが `assembleArtifacts` と揃っている
  - [x] 同一 sheet の複数ページが同じ `image` を共有する

## フェーズ4: 座標変換とページ対応（domain/render）

- [x] `src/domain/render/coordinateTransform.ts` を新規作成
  - [x] `toPdfPoint(page, anchor)`（x/y 別スケール・y 反転）
  - [x] `pxPerPt(page)`（フォントサイズ pt → 配置計算用の px）
  - [x] `isTransformable(page)`（退化ページの判定を `buildPageInfos` と共有）
- [x] `src/domain/render/pageInfo.ts` を新規作成
  - [x] `buildPageInfos(sourcePdf, geometry, bookPages)`
  - [x] 回転 90 / 270 での幅高さ入れ替え
  - [x] `sourcePageMissing` / `sheetGeometryMissing` の issue 化（例外にしない）
  - [x] `pageInfoByIndex`（配置と描画が同じ引き方をする）
- [x] `tests/unit/domain/render/coordinateTransform.test.ts`（10 tests）
  - [x] y 反転（上端 0 → heightPt）
  - [x] x と y でスケールが異なる場合
  - [x] 画像寸法 0 などの退化入力で NaN を返さない
- [x] `tests/unit/domain/render/pageInfo.test.ts`（9 tests）
  - [x] 1 sheet 2 ページが同じ `sourcePageIndex` になる
  - [x] PDF ページ不足で issue になり、該当ページが `pages` に出ない
  - [x] 回転 90 で幅高さが入れ替わる（180 では入れ替わらない）

## フェーズ5: 注釈配置（domain/annotations）

- [x] `src/domain/render/fontMetrics.ts` を新規作成（配置と描画で寸法を共有する）
  - [x] `fontFamily` → 標準14フォントの対応表
  - [x] `displayText`（`♯`→`#` / `♭`→`b`。**幅の計測前に通す**）
  - [x] `widthPt` / `ascentPt`（`StandardFontEmbedder.for` の同期メトリクス）
- [x] `tests/unit/domain/render/fontMetrics.test.ts`（12 tests）
  - [x] `♯` `♭` を含む文字列の幅が**例外にならず**測れる
  - [x] 未知の fontFamily が既定（Helvetica）へ落ちる
  - [x] アセンダ高が em 高より小さい
- [x] `src/domain/annotations/placementResolver.ts` を新規作成
  - [x] `THIN_SYMBOL_KINDS`（符幹・加線）
  - [x] 候補位置の梯子 10 段（実測で決めた順序を TSDoc に根拠付きで記す）
  - [x] 一様格子による近傍索引
  - [x] 解決不能時は基本位置を返しつつ `resolved: false`
- [x] `tests/unit/domain/annotations/placementResolver.test.ts`（11 tests）
  - [x] 障害物がなければ基本位置（#0）
  - [x] 符幹とだけ重なる位置は基本位置のまま（細線は障害物ではない）
  - [x] 符頭と重なる場合は次の候補へ移る
  - [x] 配置済み注釈とも重ならない
  - [x] 全候補が塞がると `resolved: false` で基本位置を返す
  - [x] 格子索引の判定結果が総当たりと一致する（索引のバグを検出する）
- [x] `src/domain/annotations/AnnotationManager.ts` を新規作成
  - [x] `regenerate(input)`（id は `solfa-<noteId>`）
  - [x] 手動注釈の保全・`deleted` と `text` の引き継ぎ
  - [x] 孤立注釈の報告
  - [x] `add` / `update` / `remove`（純関数として。UI は Phase 6）
  - [x] `listSkippedMeasures(score)`
- [x] `tests/unit/domain/annotations/AnnotationManager.test.ts`（22 tests）
  - [x] 階名を持つ音符すべてに注釈が付き、`solfa` が null の音符には付かない
  - [x] 再生成しても手動注釈が消えない
  - [x] `deleted: true` の自動注釈が再生成で復活しない
  - [x] 手動上書き `text` が再生成後も残る
  - [x] 音符が消えた自動注釈が `orphanAnnotation` として報告される
  - [x] 幾何情報のないページは基本位置＋`missingPageGeometry`
  - [x] 同じ入力なら同じ結果（決定的）

## フェーズ6: PDF 合成（domain/render/OverlayRenderer）

- [x] `src/domain/render/OverlayRenderer.ts` を新規作成
  - [x] 元PDFを load して描き足す（版面を変えない）
  - [x] `fontFamily` → 標準14フォントの対応表（`fontMetrics` と共有）
  - [x] `♯`→`#` / `♭`→`b` の置換と、描けない文字の `?` へのフォールバック（報告付き）
  - [x] `#rrggbb` / `#rgb` → `rgb()`。不正値は既定色へフォールバックして報告
  - [x] 変化音は `chromaticColor` ＋ 太字
  - [x] `deleted` / `layer !== 'solfa'` を描かない
  - [x] `PageInfo` のないページの注釈を `pageInfoMissing` として報告
  - [x] **[追加]** 描く文字が決まらない孤立注釈を `missingText` として報告
        （無言で描画を飛ばすと「注釈が消えた」ように見えるため）
- [x] `tests/unit/domain/render/OverlayRenderer.test.ts`（19 tests）
  - [x] 出力PDFのページ数・寸法が元PDFと一致する
  - [x] 注釈が期待するページへ描かれる／参照先ページが無ければ報告される
  - [x] `do♭` を含む注釈でも例外にならず、`characterSubstituted` が報告される
  - [x] 不正な色指定でも落ちず報告される
  - [x] `deleted` の注釈が描かれない
  - [x] 幹音と変化音で描画結果が変わる

## フェーズ7: 書き出し（storage）

- [x] `src/storage/writeExportPdf.ts` を新規作成（原子的書き込み・`ExportFileOps` の DI）
- [x] `tests/unit/storage/writeExportPdf.test.ts`（6 tests）
  - [x] 正常書き出しと内容一致
  - [x] 既存ファイルの上書き
  - [x] リネーム失敗時に一時ファイルが残らず `ProjectFileError('io')` になる
  - [x] 失敗しても既存の出力ファイルを壊さない

## フェーズ8: 編成と IPC（main / preload）

- [x] `ProjectSession` に `geometry` と `pages` の組み立てを追加
      （`adopt` の「全フィールドを一度に差し替える」不変条件に合わせ `pageIssues` も一括で渡す）
- [x] `ProjectSession.analyze()` に注釈生成を組み込む
- [x] `ProjectSession.exportPdf(outPath)` を追加（承認前は例外）
- [x] `SessionSnapshot` / `ProjectSnapshot` に `annotationIssues` / `pageIssues` を追加
- [x] **[追加]** 元PDF が読めない場合を例外ではなく `sourcePdfUnreadable` の報告に変更
      → 例外にすると**プロジェクトを開けなくなる**。確認画面で積み上げた判断は
      プロジェクトファイルに残っており、それを見られなくする理由がない
      （`buildPageInfos` の他の失敗経路と反応を揃えた）
- [x] `shared/ipc/channels.ts` / `contract.ts` に `dialogSaveExportPdf` / `projectExportPdf` と
      `ExportSummary` を追加
- [x] `main/ipc/projectHandlers.ts` に `exportPdf` を追加
- [x] `main/index.ts` にチャネル登録と保存ダイアログを追加（`pickSavePath` を共通化）
- [x] `preload/api.ts` / `index.ts` を拡充
- [x] `tests/unit/main/ProjectSession.test.ts` に追記（49 tests）
  - [x] 解析で注釈が生成される
  - [x] **Audiveris 4 ページ → 元PDF 3 ページの対応**（発見1 の回帰）
  - [x] 承認前の `exportPdf` が失敗する／訂正で承認が外れたら再び失敗する
  - [x] 承認後は出力PDFのページ数が元PDFと一致する
  - [x] 訂正で再解析しても注釈 id が変わらない
  - [x] 元PDF が読めなくてもプロジェクトは開ける
- [x] `tests/unit/main/ipc/projectHandlers.test.ts` に追記（16 tests・委譲・エラー分類）

## フェーズ9: Editor 画面（renderer）

- [x] `src/renderer/screens/Editor/Editor.tsx` を新規作成
- [x] **[追加]** `ProjectSnapshot.preview`（階名プレビュー）を Main 側で組み立てる
      → Renderer は domain を import できない（ESLint で強制）ため、度数＋変位から
      表示文字列を導けない。App.tsx の「解析結果は Main が返したものを Renderer 側で
      組み立て直さない」方針とも一致する。件数は Main 側で上限を掛ける
- [x] `App.tsx` に `editor` 画面と遷移・`exportPdf` の結線を追加
- [x] `ClefKeyConfirm` の承認後に Editor へ遷移するようにする
      （保存に失敗しても承認は済んでいるため進み、失敗理由は表示し続ける）
- [x] `tests/unit/renderer/Editor.test.tsx`（16 tests）
  - [x] 承認前は出力ボタンが無効で理由が表示される
  - [x] 階名プレビュー・スキップ小節・配置警告・孤立注釈・`unmatchedCorrections` が表示される
  - [x] 出力成功で保存先と件数が表示される
  - [x] 出力失敗で理由が表示される（**何が表示されるかまで検証**。Phase 4 の改善提案2）
  - [x] 問題がなければ該当見出しを出さない
- [x] `tests/unit/renderer/App.test.tsx` に Editor への遷移・出力の結線を追記（82 tests）

## フェーズ10: 実データ統合テスト

- [x] **先に** 既存の victoria / divisi / solfa-pipeline / confirmation-effect 回帰を実行し、
      期待値が変わらないことを確認（725 passed / 41 files で全て緑）
- [x] `tests/integration/pipeline/annotation-placement.test.ts` を新規作成（12 tests）
  - [x] 注釈数 Victoria 808 / divisi 3500
  - [x] 解決不能 Victoria 0 件 / **divisi 29 件**（0.8%。厳密値で固定）
  - [x] ~~基本位置の採用率~~（`candidateIndex` は `Annotation` に残らないため統合テストからは
        観測できない。細線除外の効き目は解決不能件数で捕捉でき、
        「符幹だけなら基本位置のまま」は単体テストが直接検証している）
  - [x] 同一ページ内で注釈どうしが重ならない
  - [x] Audiveris ページ → 元PDFページの対応（Victoria `[0,0,1,2]` / divisi 1:1）
- [x] `tests/integration/export/export-pdf.test.ts` を新規作成（9 tests）
  - [x] Victoria: Audiveris page 0・1 が元PDF page 0 に描かれる（発見1 の回帰）
  - [x] divisi: 20 ページが 1:1 で対応し、描画先を失う注釈がない
  - [x] 出力PDFのページ数・寸法が元PDFと一致する
  - [x] divisi（`do♭` ×3 / `ti♯` ×1）で例外にならず置換が報告される（発見4 の回帰）
  - [x] 注釈が PDF ページの範囲内に収まる
  - [x] divisi（3500注釈・20ページ）の出力が 30 秒以内に終わる
        （architecture.md「修正後のPDF再出力 30秒以内」）
- [x] `tests/integration/export/reopen-and-export.test.ts` を新規作成（3 tests）
  - [x] 保存 → 読込 → **OMR 再実行なしで** PDF 出力まで到達できる
  - [x] 確認画面での訂正が出力まで効く（訂正で承認が外れることも確認）
  - [x] ページ寸法が保存・読込を往復しても同じ値になる

## フェーズ11: 品質チェック

- [x] `npm run test`（**749 passed / 44 files**）
- [x] `npm run test:coverage`（statements 98.53% / branches 95.49% / functions 97.11%。しきい値 90%）
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npx prettier --check .`

## フェーズ12: 実装検証（implementation-validator）反映

- [x] `implementation-validator` サブエージェントで検証
  - [x] 観点に「設計書に書いてあるのに実装していない項目がないか」を明示的に含める
        （Phase 4 の改善提案1）→ 設計書との未実装ギャップは**検出されなかった**
  - [x] 観点に「同じ入力を取るコンポーネント同士で、不正入力への反応が揃っているか」を含める
        → ページ寸法が取れない場合の 4 コンポーネントの反応は一貫していると評価された
  - [x] 観点に「アサーションが緩く欠陥を隠しているテストがないか」を含める
        → 明確な問題は検出されなかった
- [x] 指摘への対応（推奨 2 件）
  - [x] **[必須級]** `parseBookXml` が book.xml の `<sheet>` を文書順のまま返していた
        → `buildPageInfos` は `parseBookXml` の結果と `assemblePageGeometry` の結果を
        **配列添字で 1 対 1 に対応づける**が、後者は必ず sheet 番号昇順。book.xml の
        文書順が番号順と違うと、あるシートの画像寸法と別のシートの元PDFページ番号が
        結び付き、注釈が誤ったページへ誤った縮尺で描かれる（例外にも issue にもならない）。
        `omrArchive.sheetXmlsInOrder` が防いでいたのと**同型の事故**が、book.xml 側だけ
        未対策で残っていた。sheet 番号昇順へ並べ直し、回帰テストを追加。
        **ソートを外すとテストが落ちることを確認済み**
  - [x] 承認前の PDF 出力が汎用 `Error` で `unexpected` に丸められていた
        → `ConfirmationRequiredError`（`src/main/errors.ts`）と
        `IpcErrorKind: 'confirmationRequired'` を追加。回復手段（確認画面へ戻る）を
        種別で出し分けられるようにした
  - [x] **既存テストが古い仕様を固定していた**: 「承認前の PDF 出力は unexpected」を
        期待していた（＝分類できていない状態をテストが追認）。Phase 3・4 と同じ類型
  - [x] Editor 画面まわりの設計書の記述更新（フェーズ13 で実施）
- [x] 修正後の再確認（test 752 passed / lint / typecheck / prettier すべてクリア）

## フェーズ13: ドキュメント更新・振り返り

- [x] `docs/functional-design.md` を更新
  - [x] `PageInfo` の `sourcePageIndex` / `interlinePx` と、Audiveris ページ ≠ PDFページである実測
  - [x] `AnnotationManager` / `OverlayRenderer` のシグネチャ確定と変更理由
  - [x] 「注釈配置と衝突回避」に細線除外・集約要素の除外・候補 10 段・格子索引・実測値を反映
  - [x] 画面遷移図から Export 画面を外す（理由を明記）
  - [x] カラーコーディングに `♯`/`♭` の ASCII 置換を追記
  - [x] Editor 画面の表示を「Phase 5 の実装（テキスト最小表示）」と
        「Phase 6 で追加（PDF.js キャンバス等）」に分けて記述（実装検証の提案1）
- [x] `docs/architecture.md` を更新（統合テストの期待値に Phase 5 の実測を追加）
- [x] `docs/repository-structure.md` に新規ファイルを追加（`render/` の 4 ファイル・
      `main/errors.ts`・`Issues.ts` の追加型・`Export/` を作らない判断）
- [x] `docs/glossary.md` の「衝突回避配置」を実装（細線除外・10 段・実測値）に合わせて更新
- [x] `tests/fixtures/*/README.md` に Phase 5 の実測値を追記
      （ページ対応表・画像寸法・注釈数・配置不能件数・非ASCII音節）
- [x] requirements.md の受け入れ条件を実績反映
- [x] 実装後の振り返り（このファイルの下部に記録）

---

## 実装後の振り返り

### 実装完了日

2026-07-20

### 実績サマリ

| 項目                                | 着手前                                                    | 完了時                                              |
| ----------------------------------- | --------------------------------------------------------- | --------------------------------------------------- |
| テスト数                            | 587（33 ファイル）                                        | **752**（44 ファイル）                              |
| カバレッジ（domain + storage）      | statements 98.4%                                          | statements 98.53% / branches 95.49%（しきい値 90%） |
| lint / typecheck / build / prettier | クリーン                                                  | クリーン                                            |
| 未実装コンポーネント                | 3（AnnotationManager / OverlayRenderer / writeExportPdf） | **0**                                               |

**ロードマップ上の「リリース」の到達点**: PDF 入力 → 階名付き PDF 出力が
GUI の画面遷移（Home → OMR → 構造確認 → 音部記号・調確認 → Editor → 出力）で一気通貫した。

### 計画と実績の差分

**計画どおりだったこと**

- 着手前の実データ計測（`tmp/probe`）。Phase 2・3・4 に続き **4 回連続で有効**で、
  今回は 4 つの発見がいずれも設計を変えた。計測しなければ 4 つとも実装後の事故になっていた
- 「domain・統合テストを先に、UI を最後に」の実装順序

**計画になかった追加（いずれも実装中・検証中に必要性が判明）**

| 追加                                            | 理由                                                                                                                                                                                                                                                |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain/render/fontMetrics.ts`                  | 当初は文字幅を `length × fontPx × 0.55` で近似する予定だったが、`StandardFontEmbedder.for` が**同期で正確なメトリクスを返す**と分かり近似をやめた。配置と描画が同じ関数で測るため「配置は収まると判断したのに描画では重なる」バグが原理的に起きない |
| `ProjectSnapshot.preview`                       | Renderer は domain を import できない（ESLint で強制）ため、度数＋変位から表示文字列を導けない。Main 側で文字列まで確定させて渡す                                                                                                                   |
| `PageInfo.interlinePx`                          | 配置オフセットの基準に必要。`.omr` の幾何情報を持ち回らずに済む                                                                                                                                                                                     |
| `main/errors.ts`（`ConfirmationRequiredError`） | 承認前の出力が汎用 `Error` で `unexpected` に丸められ、「確認画面へ戻る」という回復手段を種別で案内できなかった                                                                                                                                     |
| `sourcePdfUnreadable` への降格                  | 元PDF が読めないときに例外を投げると**プロジェクトを開けなくなる**。確認画面で積み上げた判断は残っており、見られなくする理由がない                                                                                                                  |
| `RenderIssue.missingText`                       | 描く文字が決まらない孤立注釈を無言で飛ばすと「注釈が消えた」ように見える                                                                                                                                                                            |

**計画から変えたこと**

- `OmrPageContent` に記号矩形を足すのをやめ、`parseSheetGeometry` として**別の成果物**にした。
  記号矩形は照合に一切不要で、既存の型に足すと 20 箇所以上のテストフィクスチャが
  本題と無関係なデータを抱えることになる
- `Export` 画面を作らない。実体が一過性の操作でしかなく、画面にすると Editor と同じ内容を二重に描く
- 統合テストの「基本位置の採用率」の固定を取りやめた。`candidateIndex` は `Annotation` に
  残らないため観測できない。細線除外の効き目は**配置不能件数**（29 件 vs 123 件）で捕捉でき、
  「符幹だけなら基本位置のまま」は単体テストが直接検証している

### 学んだこと

**1. 「実測が設計を決める」が 4 フェーズ連続で当たり、今回は 1 フェーズで 4 件出た**

いずれも机上の設計をそのまま実装していたら実データで初めて壊れていた:

| 発見                                   | 実装していたら起きたこと                                                    |
| -------------------------------------- | --------------------------------------------------------------------------- |
| 1 sheet に複数 Audiveris ページ        | Victoria の 2 ページ目以降の注釈が**丸ごと別ページ**へ。page 3 は存在しない |
| 画像寸法は sheet 単位・A4 とは限らない | divisi で縮尺が狂い、注釈が版面からずれる                                   |
| 符幹が衝突相手の 8 割                  | Victoria の注釈の 57% が符頭の真上から追い出される                          |
| 実データに `do♭` `l♭` が出る           | **特定の楽譜だけ PDF 出力が丸ごと失敗する**（部分的な劣化ではない）         |

特に 4 番目は、`widthOfTextAtSize`（描画前の**幅計測**）ですら例外を投げるため、
置換を計測の手前に置く必要があった。probe 自身がこの例外で落ちて教えてくれた。

**2. 計測条件が実装と違うと、計測値が嘘になる**

最初の probe は注釈の高さを `interline × 1.2 = 20px` と置いて測り、
「符幹除外で配置不能 766 → 44 件」という結果を得た。しかし既定の `fontSizePt = 8` は
300dpi で **33.3px** で、プロトタイプの `FONT_PX = 33` とも一致する。実寸で測り直すと
数字が大きく変わった（設計どおりの場合の配置不能が 21.9% → 3.5%）。
**判断（細線を除外する）は変わらなかったが、requirements.md に書いた期待値は書き直しになった。**
計測は「実装が使う値」で行う。既存のプロトタイプがあるならその定数を先に確認する。

**3. 「配列添字で対応づける」構造は、両側の並び順を同じ関数で決めないと壊れる**

`omrArchive` では `assembleArtifacts` と `assemblePageGeometry` が
`sheetXmlsInOrder` という**唯一のシート順の定義**を共有するようにして事故を防いだ。
ところが実装検証で、`parseBookXml`（book.xml 側）だけが文書順のままだと指摘された。
**同じ型の防御を思いついていながら、防御対象を 1 つ取りこぼしていた。**
「この配列とこの配列を添字で対応づける」と書いた時点で、
**両側の並び順を決めている場所を数える**のを手順にする。

**4. テストが古い仕様を固定する事象が 3 フェーズ連続で起きた**

今回は「承認前の PDF 出力は `unexpected` として返る」を期待するテストを自分で書いていた。
これは**分類できていない状態をテストが追認していた**もので、`ConfirmationRequiredError` を
入れるまで誰も違和感を持たない。Phase 3（MusicXML 欠落時の扱い）・Phase 4（旋法の食い違い）と
同じ根。**「このテストが守っているのは仕様か、それとも現状か」を書いた直後に自問する。**

**5. 検証エージェントは「テストが全部緑」の先を見つける（2 フェーズ連続）**

752 テスト緑・lint/typecheck/build/prettier クリーンの状態から、
`implementation-validator` が**設計自身が警戒していた事故と同型の穴**（学び 3）を指摘した。
今回は「設計書に書いてあるのに実装していない項目」は 0 件で、Phase 4 の改善提案1
（設計書の該当節を洗い出してタスク化する）が実際に効いたと言える。

### 次回への改善提案

1. **`tmp/probe` の計測条件を実装の定数から引く**
   今回は自分で置いた仮の値で測り、実寸で測り直すことになった。
   probe の時点で `DEFAULT_SETTINGS` 等の実定数を import して使う
2. **「配列添字での対応づけ」を書いたら、両側の並び順の決定箇所を数える**（学び 3）
3. **書いたテストに対し「守っているのは仕様か現状か」を自問する**（学び 4）
4. **既存プロトタイプ（`tmp/solfa-proto/`）を設計の入力として先に読む**
   今回 `overlay_pdf.py` から「フォントサイズ 33px」「sheet 番号を使う」という
   2 つの重要な裏付けが得られたが、読んだのは probe を 1 周してからだった
5. **Phase 6 への申し送り**
   - `ConfirmationItem.clipRect` は符頭のバウンディングボックスからの近似のままで、
     切り抜き画像の表示は未実装（Phase 4 からの継続）
   - Editor はテキスト最小表示。PDF.js キャンバス・スキップ小節の黄ハイライト・
     転調点マーカー・注釈の手動編集 UI が未実装（F-5 / F-6）
   - `AnnotationManager` の `add` / `update` / `remove` は実装・テスト済みだが**画面から未接続**
   - `AppSettingsStore.ts` は未作成（repository-structure.md に予定として記載）
   - 埋め込みフォントによる `♯` `♭` の字形描画は未対応（現状は `#` / `b` へ置換）
   - `KeyRegion.start.offset` は無視されたまま（小節途中の転調指定を実装する時点で
     `NoteEvent` にオフセットを持たせるか判断が必要）
