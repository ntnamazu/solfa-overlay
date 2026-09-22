# タスクリスト

## 🚨 タスク完全完了の原則

**このファイルの全タスクが完了するまで作業を継続すること**

### 必須ルール

- **全てのタスクを`[x]`にすること**
- 「時間の都合により別タスクとして実施予定」は禁止
- 「実装が複雑すぎるため後回し」は禁止
- 未完了タスク（`[ ]`）を残したまま作業を終了しない

### タスクスキップが許可される唯一のケース

以下の技術的理由に該当する場合のみスキップ可能:

- 実装方針の変更により、機能自体が不要になった
- アーキテクチャ変更により、別の実装方法に置き換わった
- 依存関係の変更により、タスクが実行不可能になった

スキップ時は必ず理由を明記:

```markdown
- [x] ~~タスク名~~（実装方針変更により不要: 具体的な技術的理由）
```

---

## 前提: 作業ブランチ

- [x] `develop` から `feature/score-preview` を切る

## フェーズ1: domain（プレビュー用データ）

- [x] `shared/types/ScorePreview.ts` を作る
- [x] `OmrSheetParser`: `OmrStaff.extent`（譜線の縦範囲）を読む＋テスト
- [x] `coordinateTransform`: `toPreviewPoint` を追加＋テスト
- [x] `annotationContent.ts` を切り出し、`OverlayRenderer` から使う＋テスト
- [x] `scorePreview.ts`: `buildScorePreview` を実装する
  - [x] 注釈（元PDFページへの集約・非表示・文字の置換・変化音）
  - [x] スキップ小節の矩形（stack あり／なし／譜表範囲なし）
  - [x] 配置警告のマーカー
- [x] `scorePreview.test.ts` を作る

## フェーズ2: 編成レイヤー

- [x] `ProjectSnapshot` / `SessionSnapshot` に `scorePreview` を追加し、`analyze` で構築する
- [x] `ProjectSession.sourcePdfBytes` を追加する
- [x] IPC `project:getSourcePdf`（channels / contract / projectHandlers / main/index.ts / preload）
- [x] `ProjectSession.test.ts` / `projectHandlers` のテストを追加する

## フェーズ3: 実データの統合テスト

- [x] `tests/integration/pipeline/score-preview.test.ts`（Victoria / divisi: 注釈数＝drawnCount・スキップ小節の位置・元PDFページ数・divisi 1 秒未満）

## フェーズ4: PDF.js の導入

- [x] `pdfjs-dist` を devDependencies に追加する
- [x] `electron.vite.config.ts` に `servePdfjsAssets` プラグインを追加する（build: emitFile / serve: middleware）
- [x] `renderer/vite-env.d.ts` を追加する
- [x] `renderer/viewer/pdfDocument.ts`（動的 import・worker・wasmUrl・standardFontDataUrl）

## フェーズ5: 画面

- [x] `renderer/viewer/useNearViewport.ts`
- [x] `renderer/viewer/ScorePage.tsx`（canvas＋SVG オーバーレイ）
- [x] `renderer/viewer/ScoreViewer.tsx`（読み込み状態・エラー・ジャンプ）
- [x] `ScoreViewer.test.tsx` を作る
- [x] `Editor.tsx` に楽譜プレビュー区画・一覧のボタン化・文字プレビューの畳み込み
- [x] `Editor.test.tsx` を更新する
- [x] `App.tsx` で元PDFを取得して Editor へ渡す
- [x] `App.test.tsx` / `fixtures.ts` を更新する

## フェーズ6: 品質チェックと修正

- [x] `npm test`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run build`（worker・wasm・standard_fonts が `out/renderer` に出ていること、`index.html` の CSP が `default-src 'self'` のままであること）
- [x] 実装検証（implementation-validator）の指摘に対応する（総合 4.8/5。必須指摘のライセンス表記・README・tasklist は検証中に対応済み。提案のリサイズ追従と OverlayRenderer.ts の NUL バイトも対応）

## フェーズ7: ドキュメント更新

- [x] `docs/functional-design.md`「Editor画面の表示」を更新する
- [x] `docs/architecture.md`（pdfjs-dist の置き場所・資産配布・依存管理）を更新する
- [x] `docs/repository-structure.md`（`viewer/` の中身）を必要に応じて更新する
- [x] `THIRD_PARTY_LICENSES.md` に pdf.js と同梱資産のライセンスを追記する
- [x] `README.md`「実装状況」を更新する
- [x] 実装後の振り返り（このファイルの下部に記録）

---

## 実装後の振り返り

### 実装完了日

2026-09-22

### 計画と実績の差分

**計画と異なった点**:

- `ProjectSnapshot.scorePreview` は `ScorePreviewPage[]` ではなく `{ style, pages }` にした。書体名・色を Renderer がそのまま CSS に渡すと、
  未知の書体名や解釈できない色で出力PDF（既定値へ落とす）と画面の見た目がずれるため、**見た目も Main で正規化して渡す**形にした
  （`fontMetrics.genericFontFamily` と `annotationContent.normalizeHexColor` を追加し、OverlayRenderer と共有）
- `pdfjs-dist` v6 の `PDFDocumentProxy` には `destroy()` がなく、解放は読み込みタスク（`loadingTask.destroy()`）側にあった
- `LiberationSans-*`（GPLv2＋フォント例外）は同梱しないことにした（計画では OFL と誤認していた）。埋め込みのない Helvetica / Arial は
  `useSystemFonts: true` で OS のフォントで代替する
- App の元PDF取得は、当初の「取得済みかどうかを effect の依存に含める」形だと、状態を更新した瞬間に cleanup が走って結果を捨てる不具合があった。
  取得済みのプロジェクト id を ref で持つ形に直した（取得前に Editor を離れた・失敗した場合は次の機会に取り直す）

**新たに必要になったタスク**:

- `App` に `loadPdf` の注入口を追加（画面テストで PDF.js を動かさずに「表示できた」経路を検証するため）
- 検証の提案対応: `ScorePage` のリサイズ追従（`ResizeObserver`）、`OverlayRenderer.ts` に直接埋め込まれていた NUL バイトを `\u0000` エスケープへ置換
  （develop 由来。git がファイルをバイナリ扱いし差分レビューができなかった。実行時の値は同じ）

### 学んだこと

**技術的な学び**:

- pdfjs v6 はスキャンPDFに多い JBIG2 / JPEG2000 のデコーダを `wasmUrl` から読む（未指定だと画像が描けない）。`cMapUrl` を渡さない場合は
  `useWorkerFetch` が false になり、資産はメインスレッドの `fetchData` 経由（http は fetch、file:// は XHR）で読まれる。
  file:// で動く配布版でも同一オリジンの資産で完結する設計になっている
- SVG の `<text x y>` は pdf-lib の `drawText` と同じ「左端＋ベースライン」基準なので、`viewBox` をページのポイント寸法にそろえるだけで
  出力PDFと同じ座標系で重ねられる
- 出力PDFとプレビューの一致は「同じ関数を通す」＋「実データで件数一致を固定する」の 2 段で担保できた（Victoria 808 / divisi 3500）

**プロセス上の改善点**:

- 依存を追加するときは、同梱される資産のライセンスを計画時点で個別ファイルまで確認する（Liberation を OFL と誤認していた）

### 次回への改善提案

- 実機での目視確認は、コンテナの Electron が Windows 用バイナリのため作業中はできなかった。ホスト（`npm run dev`）と
  Windows インストーラでユーザーが確認した結果（2026-09-22）:
  - スキャンPDFも描画される（表示まで体感 1〜2 秒）。出力PDFとの階名の位置は目視で一致。スクロールの反応も問題なし
  - スキップ小節の一覧が楽譜プレビュー（全ページ分の縦長）の下にあり、PDF出力ボタンも同様に埋もれる。
    プレビューを画面の最後に移す改善を #17 として起票した（P2-low。#5 の前にやると効率がよい）
  - ページ幅いっぱいの表示で横に大きく、全体の確認には縦スクロールが多い。MVP としては許容（表示倍率は今後の課題）
- #5（注釈編集）では `ScorePreviewAnnotation.id`（= 注釈 id）を SVG 要素のクリックから引いて編集対象にできる
- #6（転調点）では `ScorePreviewPage` にマーカー配列を足し、同じ SVG レイヤーへ描く
- PR は `develop` 向けのため `Refs #4` と書く
