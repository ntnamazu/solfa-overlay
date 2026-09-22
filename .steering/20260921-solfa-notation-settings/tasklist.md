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

- [x] `develop` から `feature/solfa-notation-settings` を切る

## フェーズ1: 既存経路の振る舞いをテストで固定する

- [x] `ProjectSession`: 音節体系を切り替えるとプレビューの階名が Tonic sol-fa 略記になる
- [x] `ProjectSession`: 設定を保存して開き直すと維持される
- [x] `ProjectSession`: 切り替えても手動注釈・削除フラグ・手動の文字上書きが保全される
- [x] `OverlayRenderer`: 音節体系に応じた文字列で `drawText` される

## フェーズ2: 表示文字列

- [x] `scoreLabels.ts` に音節体系・短調の基準の選択肢を追加する
- [x] `scoreLabels.test.ts` に網羅性と並び順のテストを追加する

## フェーズ3: 切り替え UI

- [x] `SolfaNotationSettings.tsx` を作る
- [x] `SolfaNotationSettings.test.tsx` を作る
- [x] `Editor.tsx` に区画を組み込み、`onChangeSettings` を追加する
- [x] `Editor.test.tsx` に区画の位置と受け渡しのテストを追加する

## フェーズ4: App の配線

- [x] `App.tsx` に `changeSettings` を追加し、Editor へ渡す（成功時に `exportSummary` を消す）
- [x] `App.test.tsx` に切り替え・出力結果の消去・失敗表示のテストを追加する

## フェーズ5: 品質チェックと修正

- [x] `npm test`（862 tests passed）
- [x] `npm run lint`（エラーなし）
- [x] `npm run typecheck`（エラーなし）
- [x] `npm run build`（成功）
- [x] 実装検証（implementation-validator）の指摘に対応する（総合スコア5/5、指摘事項なし）

## フェーズ6: ドキュメント更新

- [x] `docs/functional-design.md`「Editor画面の表示」に「階名の表記」区画を追記する
- [x] `README.md`「実装状況」を更新する
- [x] 実装後の振り返り（このファイルの下部に記録）

---

## 実装後の振り返り

### 実装完了日

2026-09-22

### 計画と実績の差分

**計画と異なった点**:

- なし。design.md の設計・画面文言・データフロー・テスト戦略のとおりに実装済みだった。「検討したが採らなかった案」の代替案もいずれも採用されていない
- 開発コンテナ稼働に関わる Docker Desktop のクラッシュにより、フェーズ1〜4（実装コード・テスト本体）まで完了した状態で作業が一度中断した。復旧後、`git status` と `.steering/20260921-solfa-notation-settings/` の既存ファイルから状況を復元し、フェーズ5（品質チェック）以降から再開した

**新たに必要になったタスク**:

- なし

### 学んだこと

**技術的な学び**:

- Main側（IPC・セッション・永続化・PDF描画）が実装済みの状態で画面のみを足す作業では、既存の `correctClef` / `decideKeyRegions` と同じ形（`setBusy` → IPC → `accept`）に揃えるだけで、エラーハンドリングやカスタムエラークラスの追加が一切不要になる
- 制御コンポーネント（選択状態を Renderer 側の state に持たず `settings` prop から直接描く）にすることで、IPC失敗時の「選択状態が元に戻る」挙動を追加コードなしで実現できた

**プロセス上の改善点**:

- ステアリングファイル（requirements.md / design.md / tasklist.md）が事前に十分詳細に作られていたため、作業中断後も `git status` の差分とファイル内容の突き合わせだけで、迷わず正確に状況を復元できた。中断・再開が起きうる開発環境では、この詳細さが特に効く

### 次回への改善提案

- PRを作成する際は `develop` 向けのため、development-guidelines.md のタスク管理ルールに従い `Closes #7` ではなく `Refs #7` と明記する（implementation-validatorの指摘）
