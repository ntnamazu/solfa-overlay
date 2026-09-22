# 設計書

## アーキテクチャ概要

Main 側（IPC・セッション・永続化・PDF 描画）は実装済みのため、**Renderer に切り替え UI を足して既存の `setSettings` 経路へつなぐ**だけの変更とする。

```
Editor
  └─ SolfaNotationSettings（新規・表示専用の部品）
        │ onChange({ ...settings, syllableSystem | minorBasis })
        ▼
App.changeSettings ── api.setSettings ──▶ [IPC project:setSettings]（既存）
        ▲                                        │
        │ ProjectSnapshot                        ▼
        └──────────────────────────── ProjectSession.setSettings（既存）
                                          ├─ analyze(): computeDegrees(minorBasis)
                                          │            regenerateAnnotations（手動注釈を保全）
                                          │            buildPreview(syllableSystem)
                                          └─ scheduleAutoSave()（保存先が決まっていれば）
```

選択状態は **`snapshot.project.settings` から直接描く**（Renderer 側に設定の状態を持たない）。App の既存方針「解析結果は常に Main が返した最新のものを保持し、Renderer 側で組み立て直さない」に合わせる。

## コンポーネント設計

### 1. `SolfaNotationSettings`（`src/renderer/screens/Editor/SolfaNotationSettings.tsx`・新規）

**責務**:

- 音節体系と短調の基準を、それぞれラジオボタンの組（`fieldset` ＋ `legend`）で表示する
- 選ばれた値を現在の設定へ重ねた `ProjectSettings` 全体を `onChange` で返す

**インターフェース**:

```typescript
interface SolfaNotationSettingsProps {
  settings: ProjectSettings;
  onChange: (settings: ProjectSettings) => void;
  disabled: boolean;
}
```

**実装の要点**:

- 制御コンポーネントにする（`checked` は `settings` から決める）。IPC が失敗したら、Main が返した設定のまま描き直されるので、選択状態が勝手に戻る
- `onChange` は現在と違う値を選んだときだけ呼ぶ（ラジオボタンは選択済みの項目を再度押しても `change` が発火しないため、特別な処理は要らない）
- `setSettings` は `ProjectSettings` 全体を受け取る契約であるため、色・フォント等の他の項目は現在値をそのまま渡す
- 表示文字列は `src/renderer/labels/scoreLabels.ts` に置く（開発ガイドライン「表示文字列の実体は scoreLabels.ts に置く」）

**画面の文言**:

| 箇所 | 文言 |
| --- | --- |
| 見出し（`h2`） | 階名の表記 |
| 区画の説明 | 切り替えると、階名プレビューとこれから出力するPDFに反映されます。 |
| 音節体系の `legend` | 書き方 |
| 音節体系の選択肢 | コダーイ式（do re mi fa so la ti） / Tonic sol-fa 略記（d r m f s l t） |
| 短調の基準の `legend` | 短調の読み方 |
| 短調の基準の選択肢 | La基準（短調の主音を la と読む） / Do基準（短調の主音を do と読む） |
| 短調の基準の補足 | Do基準は、確認画面で短調を選んだ区間に効きます。短調の曲は、確認画面の「調」の表で短調を選んでください。 |

- 選択肢に**実際の音節の例**を添える。「コダーイ式」「Tonic sol-fa」という名前を知らなくても、見れば自分の団の書き方を選べる
- Do基準の補足は必須とする。Audiveris は長短を出力せず、自動判定の調区間はすべて長調になる（機能設計書「実データの制約」）。長短を指定しないまま Do基準へ切り替えても**階名は何も変わらない**。補足がないと「切り替えが効かない」と受け取られる

### 2. `scoreLabels.ts`（既存・追記）

**責務**: 上記の選択肢の表示文字列を、内部値との対応表として持つ

**実装の要点**:

- 内部値の型（`SyllableSystem` / `MinorBasis`）の全値を網羅する形にし、値の追加漏れを型で検出する
  （`Record<SyllableSystem, string>` のように、型の全メンバーをキーに要求する）
- 並び順は画面の表示順とする（既定値を先頭に置く）

### 3. `Editor`（既存・変更）

**責務の追加**: 「階名の表記」区画を「概要」と「階名プレビュー」の間に置く

**実装の要点**:

- props に `onChangeSettings: (settings: ProjectSettings) => void` を追加する
- `disabled` には既存の `busy` を渡す（出力中・再解析中に重ねて操作させない）
- 表記の区画をプレビューの直前に置く。切り替えた結果がすぐ下で見える

### 4. `App`（既存・変更）

**責務の追加**: `changeSettings` で `api.setSettings` を呼ぶ

**実装の要点**:

- 既存の `correctClef` / `decideKeyRegions` と同じ形（`setBusy` → IPC → `accept`）にする
- **成功したら `exportSummary` を消す**。直前の出力結果（「〜に N 件の階名を出力しました」）を残すと、そのPDFが切り替え後の表記だと誤解される。出力済みのファイルは切り替え前の表記のままである

## 検討したが採らなかった案

| 案 | 採らなかった理由 |
| --- | --- |
| 設定を独立した画面（またはダイアログ）にする | 切り替えの結果を確かめる場所は Editor の階名プレビューである。画面を分けると「切り替える → 戻って見る」の往復が生じる。項目も 2 つしかない |
| 確認画面（ClefKeyConfirm）に置く | 確認画面は「読み取り結果が正しいか」を判断する場所であり、表記の好みとは性質が違う。また表記を変えても承認は取り消さない仕様であり、承認の前に置く理由がない |
| `select`（ドロップダウン）で選ばせる | 選択肢が 2 つずつしかない。ラジオボタンなら開かずに全選択肢と現在値が見える |
| 「適用」ボタンを押して反映する | 再解析は 1 曲数百 ms で終わる（`ProjectSession` のコメントの実測）。選んだ時点で反映すれば、未適用の選択状態を Renderer に持たずに済む（Main が返した設定だけを描けばよい） |
| Renderer 側で表示文字列だけ差し替える（再解析しない） | Renderer は domain（`syllableTables`）へ依存できない（ESLint で強制）。短調の基準は度数の計算そのものを変えるため、文字列の差し替えでは済まない |
| Main 側で `setSettings` の引数を Zod で検証する | 既存の IPC ハンドラはいずれも Renderer からの引数を検証していない（Renderer は自前のコードで、`contextIsolation` / `sandbox` で隔離済み）。本作業だけ方針を変えると不揃いになる。値はラジオボタンの固定の選択肢からしか作られない |
| アプリ設定として既定値を保存する（新規プロジェクトに引き継ぐ） | Issue #7 の範囲外（requirements.md「スコープ外」）。`AppSettingsStore` は未実装で、保存先・スキーマの設計が別途要る |

## データフロー

### 音節体系を Tonic sol-fa 略記に切り替える

```
1. Editor で「Tonic sol-fa 略記」を選ぶ
2. SolfaNotationSettings が onChange({ ...settings, syllableSystem: 'tonicSolfa' }) を呼ぶ
3. App.changeSettings が busy を立て、api.setSettings を呼ぶ
4. ProjectSession.setSettings が解析をやり直す（注釈は既存を引き継いで再生成・プレビューは新表記）
5. 保存先が決まっていれば自動保存を予約する（300ms のデバウンス）
6. App がスナップショットを受け取り、Editor を描き直す（プレビューが d r m … になる）。exportSummary を消す
7. 利用者が「注釈付きPDFを出力」を押すと、OverlayRenderer が新表記で描く
```

### 失敗したとき

```
1. api.setSettings が { ok: false } を返す
2. App.accept がエラーメッセージを表示する。スナップショットは更新しない
3. SolfaNotationSettings は古い設定のまま描かれる（選択状態が元に戻る）
```

## エラーハンドリング戦略

### カスタムエラークラス

追加しない。`setSettings` の失敗は既存の `IpcResult` の経路（`toIpcError` → `accept`）で表示する。

### エラーハンドリングパターン

- 画面遷移を伴わない失敗なので、App の `withError` が画面上部に理由を出す（既存の訂正操作と同じ）
- 保存先が未確定（承認時に保存先の選択をキャンセルした場合）のときは自動保存されない。これは既存の訂正操作と同じ挙動であり、承認時に「保存先が選択されなかったため保存していません。」と表示済みである

## テスト戦略

### ユニットテスト

- `SolfaNotationSettings`（新規 `tests/unit/renderer/SolfaNotationSettings.test.tsx`）
  - 現在の設定が選択状態で表示される（表駆動: 4 通りの組合せ）
  - 別の選択肢を選ぶと、その項目だけを変えた設定全体で `onChange` が呼ばれる（表駆動: 2 軸 × 2 値）
  - `disabled` のときは選べない
  - Do基準の補足が表示される
  - 内部識別子（`kodaly` 等）が画面に出ない
- `scoreLabels`（既存テストに追記）
  - 選択肢が内部値の全値を網羅し、既定値が先頭にある
- `Editor`（既存テストに追記）
  - 「階名の表記」区画が階名プレビューより前にあり、選択が `onChangeSettings` に渡る
- `App`（既存テストに追記）
  - Editor で表記を切り替えると `api.setSettings` を呼び、返ってきたスナップショットで描き直す
  - 切り替えると直前の出力結果の表示が消える
  - 失敗したら理由を表示する
- `ProjectSession`（既存テストに追記）
  - 音節体系を切り替えるとプレビューの階名が Tonic sol-fa 略記になる
  - 設定を保存して開き直すと維持される
  - 切り替えても手動注釈・削除フラグ・手動の文字上書きが保全される（プロジェクトファイルに注釈を仕込んで開き、`setSettings` する）
- `OverlayRenderer`（既存テストに追記）
  - 音節体系に応じた文字列で `drawText` される（`PDFPage.prototype.drawText` を監視する）

### 統合テスト

追加しない。音節体系・短調基準ごとの階名は `tests/integration/pipeline/solfa-pipeline.test.ts` が実フィクスチャで検証済みであり、本作業はその結果を画面から選べるようにするだけである。

## 依存ライブラリ

追加しない。

## ディレクトリ構造

```
src/renderer/
├── App.tsx                                    # 変更: changeSettings を追加
├── labels/scoreLabels.ts                      # 変更: 表記の選択肢の表示文字列
└── screens/Editor/
    ├── Editor.tsx                             # 変更: 区画の追加・props の追加
    └── SolfaNotationSettings.tsx              # 新規
tests/unit/
├── renderer/
│   ├── App.test.tsx                           # 変更
│   ├── Editor.test.tsx                        # 変更
│   ├── SolfaNotationSettings.test.tsx         # 新規
│   └── labels/scoreLabels.test.ts             # 変更
├── main/ProjectSession.test.ts                # 変更
└── domain/render/OverlayRenderer.test.ts      # 変更
docs/functional-design.md                      # 変更: Editor画面の表示に区画を追記
README.md                                      # 変更: 実装状況
```

## 実装の順序

1. 既存経路の振る舞いをテストで固定する（ProjectSession・OverlayRenderer）。Main 側に不足があればここで見つかる
2. 表示文字列（scoreLabels）
3. `SolfaNotationSettings` 部品
4. Editor への組み込み
5. App の配線
6. ドキュメント（機能設計書・README）

## セキュリティ考慮事項

- 楽譜由来データの外部送信・新規ネットワークアクセスを追加しない
- Electron のハードニング設定・CSP を変更しない
- IPC の面は増やさない（既存の `project:setSettings` を使う）

## パフォーマンス考慮事項

- 切り替えのたびに解析を頭から流し直す（`ProjectSession` の既存方針。1 曲数百 ms）。機能設計書の「再計算は影響を受ける KeyRegion 範囲に限定する」とは食い違うが、既存の訂正操作もすべて同じ方針で実装されており、本作業で変えない
- 自動保存は既存のデバウンスで 1 回にまとまる。連続して切り替えても保存が詰まらない

## 将来の拡張性

- 配色・フォントの設定（F-8）も同じ `setSettings` 経路に載る。`SolfaNotationSettings` と同じ形の部品を並べればよい
- アプリ設定としての既定値（`AppSettingsStore`）を作る場合は、`ProjectStore.create` が `DEFAULT_SETTINGS` の代わりにアプリ設定を受け取る形にする
