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

## フェーズ1: Editor の区画の並び替え（#17）

- [x] 楽譜プレビュー区画（と直前の「階名の表記」）を Editor の最後へ移し、確認画面へ戻るボタンをプレビューより上に置く
- [x] Editor の区画の並び順のテストを更新する（プレビューが最後・一覧と PDF出力がプレビューより上）

## フェーズ2: 型と domain

- [x] `AnnotationEdit` 型を `shared/types/Annotation.ts` に追加する
- [x] `fromPreviewPoint` を `coordinateTransform` に追加し、テストする
- [x] `AnnotationEditError` を `domain/annotations/errors.ts` に追加する
- [x] `manualAnchorAt` と `applyAnnotationEdit` を実装する
- [x] `manualAnchorAt` / `applyAnnotationEdit` のユニットテストを書く
- [x] `ScorePreviewAnnotation` に `origin` / `textOverridden` を足し、`buildScorePreview` とテストを更新する

## フェーズ3: セッションと IPC

- [ ] `ProjectSession.editAnnotation` を実装する（id 生成の差し替え口を含む）
- [ ] `ProjectSession.editAnnotation` のテストを書く（プレビュー反映・承認維持・再解析後の保全・保存→再読み込み）
- [ ] IPC チャネル・契約・ハンドラ・preload・Main の登録を追加する
- [ ] `projectHandlers.editAnnotation` のテストを書く

## フェーズ4: Renderer

- [ ] `ScorePage` / `ScoreViewer` に選択・位置指定（`onPick`）と選択表示を足す
- [ ] `ScoreViewer` のテストを追加する（注釈を押す・空いた位置を押す・重ねるものが無いページ）
- [ ] `AnnotationEditPanel` を実装する
- [ ] `Editor` にパネルと選択状態・削除の取り消しを結線し、案内文を更新する
- [ ] `Editor` のテストを追加する（追加・書き換え・削除・自動に戻す・元に戻す・処理中）
- [ ] `App` に `editAnnotation` を結線し、テストを追加する

## フェーズ5: 統合テスト

- [ ] 手動注釈の追加・自動注釈の削除を保存→再読み込み→出力で確認する統合テストを追加する

## フェーズ6: 品質チェックと修正

- [ ] すべてのテストが通ることを確認
  - [ ] `npm test`
- [ ] リントエラーがないことを確認
  - [ ] `npm run lint`
- [ ] 型エラーがないことを確認
  - [ ] `npm run typecheck`
- [ ] ビルドが成功することを確認
  - [ ] `npm run build`

## フェーズ7: ドキュメント更新

- [ ] 機能設計書（Editor の表示・区画の並び・注釈編集の操作フロー・AnnotationManager の IF）を更新する
- [ ] README の機能説明を更新する（必要に応じて）
- [ ] 実装後の振り返り（このファイルの下部に記録）

---

## 実装後の振り返り

### 実装完了日

{YYYY-MM-DD}

### 計画と実績の差分

### 学んだこと

### 次回への改善提案
