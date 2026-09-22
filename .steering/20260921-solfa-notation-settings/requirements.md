# 要求内容

対象 Issue: [#7 階名の表記（音節体系・短調の基準）を画面から切り替えられるようにする](https://github.com/ntnamazu/solfa-overlay/issues/7)

## 概要

階名の表記（音節体系: コダーイ式 / Tonic sol-fa 略記、短調の基準: La基準 / Do基準）を Editor 画面から切り替えられるようにする（PRD F-3 の残り）。

## 背景

PRD F-3 は「短調は La基準をデフォルトとし、設定で Do基準に切替できる」「音節体系はコダーイ式をデフォルトとし、設定で Tonic sol-fa 略記に切替できる」と定めている。

着手時点の実装状況を調べた結果は次のとおり。**画面以外はすべて実装済み**である。

| 層 | 状況 | 根拠 |
| --- | --- | --- |
| 型・既定値 | 実装済み | `src/shared/types/ProjectSettings.ts` / `src/shared/constants/DEFAULT_SETTINGS.ts` |
| 階名計算・文字列化 | 実装済み | `SolfaEngine.computeDegrees(…, minorBasis)` / `syllableTables.syllableFor(…, syllableSystem)` |
| 永続化 | 実装済み | `src/storage/projectSchema.ts` の `projectSettingsSchema` |
| IPC | 実装済み | `project:setSettings`（`src/shared/ipc/channels.ts`・`contract.ts`・`preload/index.ts`・`main/index.ts`） |
| セッション | 実装済み | `ProjectSession.setSettings` が解析をやり直し、自動保存を予約する。承認は取り消さない |
| PDF 出力 | 実装済み | `OverlayRenderer.textFor` が `settings.syllableSystem` で文字列化する |
| **画面** | **未実装** | `App.tsx` が `api.setSettings` を呼んでいない。Editor に切り替えの UI がない |

このため実質的に `DEFAULT_SETTINGS`（コダーイ式 / La基準）に固定されており、README の「実装状況」でも未対応として明記している。

## 実装対象の機能

### 1. 階名の表記を切り替える UI（Editor）

- Editor に「階名の表記」区画を追加し、音節体系と短調の基準をそれぞれ選べるようにする
- 選んだ時点で Main へ送り、階名を再計算する。階名プレビューが切り替え後の表記で描き直される
- Do基準が効くのは「短調」と指定した調区間だけである（Audiveris は長短を出力せず、自動判定は常に長調になるため。機能設計書「実データの制約」）。この点を画面で案内する

### 2. App の配線

- Editor からの設定変更を `api.setSettings` へ渡し、返ってきたスナップショットで画面を更新する
- 失敗したら既存の経路（`accept`）で理由を表示する

### 3. README の「実装状況」の更新

- 「階名表記の切り替えUI」を実装済みにする

## 受け入れ条件

Issue #7 の受け入れ条件（案）を、本作業で検証する形に書き直したもの。

### 階名の表記を切り替える UI

- [ ] Editor から音節体系（コダーイ式 / Tonic sol-fa 略記）を切り替えられる
- [ ] Editor から短調の基準（La基準 / Do基準）を切り替えられる
- [ ] 現在の設定が選択状態として表示される（プロジェクトを開き直しても一致する）
- [ ] 処理中（`busy`）は切り替えられない
- [ ] 画面の文言が開発ガイドライン「UIテキスト規約」に従い、内部識別子（`kodaly` / `tonicSolfa` / `la` / `do`）を出さない

### 反映と保存

- [ ] 切り替えると、Editor の階名プレビューが切り替え後の表記になる
- [ ] 切り替えると、出力PDFの階名が切り替え後の表記になる
- [ ] 設定はプロジェクトに保存され、開き直しても維持される
- [ ] 切り替えても、手動注釈（`origin: 'manual'`）・削除フラグ・手動の文字上書きが失われない
  （Issue では「#5 の実装後」としているが、保全の仕組みは `regenerateAnnotations` に実装済みのため、#5 を待たずにセッション層のテストで固定する）
- [ ] 切り替えても承認（`completedAt`）は取り消されない（既存の仕様。機能設計書「制約」）

## 成功指標

- 合唱団員が説明書なしで、自分の団の流儀（例: La基準のコダーイ式）に合わせた階名付き楽譜を出力できる
- 既存テストがすべて通り、追加したテストで上記の受け入れ条件が機械的に検証される

## スコープ外

以下は本作業では実装しない。

- **アプリ設定としての既定値**（新規プロジェクトの初期値を利用者ごとに変える機能）。アーキテクチャ設計書が「アプリ設定（デフォルト音節体系・色・フォント等）」を OS のアプリデータに置くと定めているが、`AppSettingsStore` は未実装であり、Issue #7 の範囲はプロジェクト単位の切り替えである
- **配色・フォントの設定 UI**（PRD F-8「表示カスタマイズ」の範囲）
- **階名プレビューの全曲表示**（楽譜プレビューは #4 の範囲）
- **注釈の手動編集 UI**（#5 の範囲）

## 参照ドキュメント

- `docs/product-requirements.md` - F-3「移動ド階名の計算」
- `docs/functional-design.md` - 「データモデル定義」（`ProjectSettings`）・「実データの制約」・「Editor画面の表示」・「画面に出す語彙の方針」
- `docs/development-guidelines.md` - 「UIテキスト規約」・「タスク管理」
- `docs/glossary.md` - 「La基準 / Do基準」・「音節体系」
