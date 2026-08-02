# 要求内容

## 概要

`main` への push で CI の `npm run test` が失敗した。`tests/unit/main/ProjectSession.test.ts` の自動保存テストが Vitest の既定タイムアウト 5000ms を超えたことが原因。テストを高速化し、あわせて CI ランナーの速度差に耐える余裕を持たせる。

## 背景

### 失敗の事実

- 失敗ジョブ: [Actions run 30739264558 / job 91473599493](https://github.com/ntnamazu/solfa-overlay/actions/runs/30739264558/job/91473599493)
- 失敗ステップ: `Run npm run test`
- エラー: `Test timed out in 5000ms.`
- 失敗テスト: `tests/unit/main/ProjectSession.test.ts:264`「保存先が決まっていれば訂正のたびに自動保存する」

### 原因（ローカル実測）

| 項目                          | 実測値                  |
| ----------------------------- | ----------------------- |
| `ProjectSession.test.ts` 全体 | **36.8 秒** / 49 テスト |
| ほぼ全テストに共通する下駄    | 約 **700ms**            |
| 失敗テスト（264 行）          | **3085ms**              |
| `assembleArtifacts()` 1 回    | 約 **400ms**            |

`assembleArtifacts()`（`.omr` / `.mxl` の zip 展開と XML パース）が約 400ms かかる。これが 2 か所で効いている。

1. **`FakeRunner.run()` が呼ばれるたびに `assembleArtifacts(RAW)` を実行**（`tests/unit/main/ProjectSession.test.ts:40`）
   - 入力 `RAW` はモジュール定数で不変、かつ `assembleArtifacts` は副作用のない純粋関数（`src/main/omr/omrArchive.ts:11`）
   - つまり **49 回すべてが同じ入力から同じ結果を作り直しているだけ**の重複計算
2. **`ProjectSession.open()` が内部で `assembleArtifacts()` を呼ぶ**（`src/main/ProjectSession.ts:190`）
   - こちらは「保存済み成果物から解析をやり直す」という**本番仕様**であり削れない（`src/main/ProjectSession.ts:181-183`）
   - 失敗テストの `waitUntil` がこの重い `open()` をポーリングで繰り返し呼んでいる（同 251-259 行）

ローカルで 3085ms のテストが、ローカルより遅い GitHub Actions の ubuntu-latest で 5000ms を超えた。**プロダクションコードのバグではなく、テストの構成に起因する失敗**である。

## 実装対象の機能

### 1. `FakeRunner` が組み立てる成果物の再利用（案 A）

- `assembleArtifacts(RAW)` をモジュール読み込み時に 1 回だけ実行し、`FakeRunner.run()` は同じ結果を返す
- 共有したオブジェクトがテスト間で書き換えられないことを保証する

### 2. 自動保存テストのポーリング軽量化（案 B）

- `waitUntil` の条件から重い `ProjectSession.open()` を外す
- 自動保存の発生は**世代バックアップ `song.solfaproj.bak1` の出現**で検知する（`src/storage/backupRotation.ts` のローテーション仕様）
- 保存内容の検証は、検知後に `open()` を **1 回だけ**呼んで行う

### 3. テストタイムアウトの明示（案 C）

- `vitest.config.ts` にテストタイムアウトを明示し、CI ランナーの速度差ぶんの余裕を持たせる
- 既定値 5000ms の暗黙依存をやめ、意図した値としてドキュメント化する

## 受け入れ条件

### `FakeRunner` の成果物再利用

- [x] `assembleArtifacts` の呼び出しがテスト実行あたり 1 回になっている
- [x] 共有オブジェクトが凍結され、破壊的変更が起きていないことが保証されている（deep freeze 状態で 49 テスト全通過）
- [x] `ProjectSession.test.ts` の 49 テストがすべて通る

### 自動保存テストのポーリング軽量化

- [x] 「保存先が決まっていれば訂正のたびに自動保存する」で `open()` の呼び出しが 1 回以下になっている（ポーリングは `readdir` のみ、`open` は検証時の 1 回）
- [x] 「自動保存が実際に起きたこと」と「保存内容が正しいこと」の両方を引き続き検証している

### テストタイムアウトの明示

- [x] `vitest.config.ts` に `testTimeout` が明示され、値の根拠がコメントされている
- [x] node / renderer 双方のプロジェクトに設定が効いていることを確認済み（実挙動で検証）

### 全体

- [x] `npm run test` / `npm run lint` / `npm run typecheck` / `npm run build` がすべて通る
- [x] テストケースの削除・検証内容の弱体化を伴わない（テスト件数 49 → 49・全体 835 → 835。自動保存を意図的に壊すと当該テストが失敗することも確認）

## 成功指標

- [ ] ~~`tests/unit/main/ProjectSession.test.ts` 全体: **36.8 秒 → 10 秒未満**~~
      … **未達成（21.3 秒 / 約 42% 短縮）**。残る主因はスコープ外と宣言したプロダクション側（`assemblePageGeometry` によるシート XML の二重パース。別タスクとして Issue #1 に起票）。詳細は tasklist.md の振り返りを参照
- [x] 失敗していたテスト単体: **3085ms → 1 秒台** … 達成（**1318ms**）
- [x] CI の `npm run test` がグリーンで完走する … ローカルで全 835 テスト通過を確認（CI 実機での確認は push 後）

## スコープ外

以下はこのフェーズでは実施しません:

- `assembleArtifacts()` / `ProjectSession.open()` そのもののプロダクション側の性能改善（本番の体感性能は現状問題になっていない）
- 他テストファイルの網羅的な性能監査（今回は失敗原因に直結する範囲に絞る）
- CI ワークフローの構成変更（並列化・キャッシュ戦略など）
- `actions/checkout@v4` / `actions/setup-node@v4` の Node.js 20 非推奨警告への対応（CI ログに出ているが、今回の失敗とは無関係のため別タスク）

## 参照ドキュメント

- `docs/development-guidelines.md` - 「テスト戦略」（ユニットテストの責務分担、Audiveris をテストで実行しない方針）
- `docs/architecture.md` - 「バックアップ戦略」
- `tests/unit/main/ProjectSession.test.ts:16-21` - 本テストファイルの検証対象の定義
