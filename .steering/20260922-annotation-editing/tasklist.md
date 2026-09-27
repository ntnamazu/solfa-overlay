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

- [x] `develop` から `feature/annotation-editing` を切る

## フェーズ1: domain

- [x] `coordinateTransform`: `fromPreviewPoint` を追加＋テスト
- [x] `scorePreview`: `anchorFromPreviewPoint`（候補ページの選択・範囲外の拒否）を追加＋テスト
- [x] `AnnotationManager`: `normalizeAnnotationText` / `applyAnnotationEdit` を追加＋テスト
- [x] `ScorePreviewAnnotation` に `origin` / `overridden` を追加し、`buildScorePreview` で埋める＋テスト

## フェーズ2: 編成レイヤー

- [x] `AnnotationEdit` 型と IPC `project:editAnnotation`（channels / contract / projectHandlers / main/index.ts / preload）
- [x] `ProjectSession.editAnnotation`（id 生成の注入・承認を無効化しない・自動保存）
- [x] `ProjectSession.test.ts`（追加位置の往復・承認維持・保存と再読込・再計算後の保全・出力PDFへの反映・不正な編集の拒否）
- [x] `projectHandlers.test.ts` に `editAnnotation` を追加する

## フェーズ3: 画面

- [x] `Editor.tsx`: 区画の並び替え（#17。楽譜プレビューを最後へ、戻るボタンを PDF 出力の直後へ）
- [x] `Editor.test.tsx`: 区画の並び順のテストを更新する（#17）
- [x] `viewer/AnnotationEditForm.tsx` を作る
- [x] `ScorePage.tsx`: 編集時の SVG・クリック座標の変換・注釈のクリック・追加位置の印・フォームの配置
- [x] `ScoreViewer.tsx`: `editable` / `onEditAnnotation` と編集対象の状態
- [x] `ScoreViewer.test.tsx` に編集のテストを追加する
- [x] `Editor.tsx`: 「楽譜の上で階名を直す」切り替え・削除した階名の一覧・概要の件数・案内文
- [x] `Editor.test.tsx` に編集導線のテストを追加する
- [x] `App.tsx` / `App.test.tsx`: `editAnnotation` の配線と出力結果の破棄

## フェーズ4: 品質チェックと修正

- [x] `npm test`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] 実装検証（implementation-validator）の指摘に対応する（総合 4.6/5・必須 0 件。推奨: requirements.md の受け入れ条件を更新、ファイルサイズは次回の課題として振り返りに記録。提案: remove が冪等である旨のコメントを追加。Editor の useMemo 化・フォーム単体テストは既存スタイルに合わせ見送り）

## フェーズ5: ドキュメント更新

- [x] `docs/functional-design.md`（AnnotationManager の編集 API・Editor画面の表示・Phase 6 の表・区画の並び）を更新する
- [x] `docs/architecture.md` / `docs/repository-structure.md` / `docs/glossary.md` を必要に応じて更新する（repository-structure: `AnnotationEditForm`、glossary: 手動上書きと id の接頭辞。architecture は依存方向・技術構成に変化がないため変更なし）
- [x] `README.md`「実装状況」を更新する
- [x] 実装後の振り返り（このファイルの下部に記録）

---

## 実装後の振り返り

### 実装完了日

2026-09-22

### 計画と実績の差分

**計画と異なった点**:

- `AnnotationEditCommand` の `add` は、完成した `Annotation` ではなく `{ id, anchor, text }` を受け取る形にした。
  文字の正規化（前後の空白・空の拒否）と id の重複検査を `applyAnnotationEdit` の 1 か所に集めるため
- 「削除した階名」の行の名前を「N 小節目の階名」から「N 小節目・M 番目の音符の階名」にした。同じ小節で複数削除すると行が区別できないため
- 概要の「注釈」の件数から削除したものを除いた（計画時に追加した判断。削除しても数が減らないと効いたか分からない）

**新たに必要になった作業**:

- 開発環境: コンテナの `node_modules` が Windows ホストでインストールされたもので、Linux 用の rollup / esbuild のネイティブバイナリが無かった。
  ホストの環境を壊さないよう `node_modules` は変更せず、scratchpad に Linux 用パッケージを入れて `NODE_PATH` で解決させた。
  esbuild は 0.25.12（ルート）と 0.28.1（vite 同梱）が同じプロセスで動くため、`ESBUILD_BINARY_PATH` に
  `--service=<版>` を見てバイナリを振り分けるラッパーを指定した（esbuild の JS 側はサービス起動時に自分の版を引数で渡す）

**実装検証（implementation-validator）**: 総合 4.6/5、必須の指摘 0 件。推奨・提案への対応は フェーズ4 のタスクに記録

### 学んだこと

**技術的な学び**:

- 「画面の座標 → アンカー」の逆変換を、順方向（`toPreviewPoint`）と同じ縮尺の関数で書き、実データで「押した位置＝描かれる位置」を往復テストすると、
  出力PDFとのずれを構造で防げる（#4 の「同じ関数を通す」方針の延長）
- 既存の `regenerateAnnotations` が手動修正を id で引き継ぐ作りだったため、「注釈レイヤーを書き換えて流し直す」だけで
  保存・再計算後の保全が追加実装なしで成立した。Phase 5 で API を先に用意しておいた効果
- React で props の変化に応じて state を捨てるときは、effect ではなく描画中に前回値と比べる形にすると、閉じる前の 1 フレームが描かれない

**プロセス上の改善点**:

- ついで対応（#17）を先に片付けてから本題（#5）の画面を足すと、並び順のテストを 1 回の更新で済ませられた

### 次回への改善提案

- 実機での目視確認（クリック位置と文字の位置が合うか、入力欄の出る位置、SVG 上のクリック判定）はコンテナではできないため、
  ホストでユーザーが確認した（2026-09-27。結果は問題なし）。今後も同種の変更で確認したい点:
  - スキップ小節の枠の中を押して追加 → 出力PDFで同じ位置に出るか
  - 8pt の小さな階名を押しやすいか（押しにくければ、`<text>` の周りに透明な当たり判定の矩形を足す）
  - ページ右端付近での入力欄のはみ出し
- 検証で指摘されたファイルサイズ: `ProjectSession.ts`（700 行）・`scorePreview.ts`・`AnnotationManager.ts`・`ScorePage.tsx`・`Editor.tsx` が 300 行を超えた。
  #6（転調点UI）で `ProjectSession` の「差し替えて解析し直す」系メソッドの切り出しと、Editor の一覧区画のコンポーネント分割を検討する
- 見送った提案: Editor の索引構築の `useMemo` 化（Editor 全体でメモ化していないスタイルに合わせた）、`AnnotationEditForm` 単体のテスト（`ScoreViewer.test.tsx` で網羅）
- スコープ外にしたもの: 注釈の移動（ドラッグ）、手動注釈の変化音指定、汎用の Undo。利用者の声を見て Issue 化する
- #8（「適用されなかった訂正」の内部識別子）は今回扱っていない。Editor に手を入れる次の機会に
- PR は `develop` 向けのため `Refs #5` / `Refs #17` と書く
