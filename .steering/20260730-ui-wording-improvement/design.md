# 設計書

## アーキテクチャ概要

UI レイヤー（`src/renderer/`）中心の変更である。「アプリの語彙 → 合唱団員の語彙」の翻訳は表示の関心事であり、ドメインモデル（`Part` / `StaffRef`）には手を入れない（メモ 5.2: すでにモデルにある正しい名前を画面に出すだけの作業）。

例外はサービスレイヤーの `confirmationItems.ts` の**並び順**である。これは表示の都合ではなく「確認項目という概念の既定の順序」を決めるものであり、生成側に置いたままにする（Renderer が毎回並べ直すと、Main が保存する `project.json` の並びと画面の並びが食い違う）。

```
src/shared/types/Confirmation.ts   … UNKNOWN_CLEF / SELECTABLE_CLEF_KINDS（型と定数のみ・変更なし）
        ↑                                   ↑
src/domain/score/confirmationItems.ts   src/renderer/labels/scoreLabels.ts  ← 新設
  並び順を楽譜順（partId 自然順）へ         内部値 → 日本語表示名・状態判定
        ↑                                   ↑
src/main/ProjectSession.ts              src/renderer/screens/*/*.tsx
  （呼び出しは変更なし）                   ClefKeyConfirm / StructureConfirm / 他3画面
```

## コンポーネント設計

### 1. `src/renderer/labels/scoreLabels.ts`（新設）

**責務**:

- 音部記号の内部値 → 日本語表示名の変換（`clefLabel`）
- `partId` → 「上から N 番目のパート」の変換（`partLabel`）
- 音部記号の確認状態の判定（`clefCheckStatus`）とその表示名（`clefCheckStatusLabel`）
- 件数の書式（`mismatchLabel`・`staffCoverageLabel`）

**実装の要点**:

- **配置**: `src/renderer/labels/`。UI に出す文字列は UI レイヤーの関心事であり、`shared/` は「型と定数のみ＝実装ロジックを置かない」（リポジトリ構造定義書の規約）ため置けない。`components/` はコンポーネント用なので、純関数＋対応表を置く分類ディレクトリを新設する（ディレクトリ名は複数形 kebab-case、ファイル名は名詞の camelCase＝`syllableTables.ts` と同じ規約）
- **表にない内部値でも内部値を画面に出さない**。`clefLabel` のフォールバックは「未対応の音部記号」。上級者向けの内部値はログ／エクスポート側で担保する（メモ 6.1）
- `G_CLEF` / `F_CLEF` も表に入れる。選択肢には出さないが、Audiveris が `TREBLE` / `BASS` と同義で出すため**検出値としては現れうる**
- `partLabel` は `partId` の数値部分を読む。`P4` の `staffRefs` 先頭が `staffIndex 0` になる実データ（メモ 4.2 の `o-quam-gloriosum`）があるため、**`staffRefs` から順序を推定してはいけない**
- 状態判定は 4 値。メモ 8.4 の 3 状態に「訂正済み」を加える。訂正後は再解析で `mismatchCount` が計算し直されるが、その値にかかわらず**ユーザーが判断を下した行**であり、確認を促す対象ではない（既存の挙動を保つ）

```ts
export type ClefCheckStatus = 'corrected' | 'confirmed' | 'needsCheck' | 'unchecked';
```

| 状態         | 条件                                | 表示     | 確認が必要 |
| ------------ | ----------------------------------- | -------- | ---------- |
| `corrected`  | `corrected !== null`                | 訂正済み | いいえ     |
| `unchecked`  | 検出値が `UNKNOWN_CLEF`             | ⚠ 未検査 | **はい**   |
| `needsCheck` | 検出値あり ＋ `mismatchCount > 0`   | ⚠ 要確認 | **はい**   |
| `confirmed`  | 検出値あり ＋ `mismatchCount === 0` | 確認済み | いいえ     |

判定順序は `corrected` → `unchecked` → `needsCheck` → `confirmed`。`unchecked` を `mismatchCount` より先に見るのが要点で、逆にすると「検算していないのに 0 件だから確認済み」という現状の誤りを再生産する。

### 2. `src/domain/score/confirmationItems.ts`（変更）

**責務**（変更部分のみ）:

- 並び順を「不一致件数の降順 → partId 昇順 → 検出値昇順」から「**partId 自然順 → 検出値昇順**」へ変更する
- `mergeCorrections` から並び凍結ロジックを削除し、訂正値の引き継ぎのみにする

**実装の要点**:

- 自然順は `partId` の数値部分を数値として比較する。`localeCompare` のままだと `P10 < P2` になる（メモ 4.2）
- 数値部分を持たない `partId` 同士は `localeCompare` にフォールバックし、決定性を保つ
- 並びが入力順に依存しない性質（再解析で行が入れ替わらない）は維持する。楽譜順は不一致件数に依存しないため、**むしろ現状より強い決定性**になる
- 凍結ロジックの削除でコードが減る。「訂正した行が目の前から消える」問題は、並びが件数に依存しなくなることで**原因ごと消える**（メモ 施策 6）

### 3. `ClefKeyConfirm.tsx`（変更）

**責務**（変更部分のみ）: 内部値を出さず、状態と波及範囲を明示する。

**表の構成**:

| 列           | 変更前            | 変更後                                    |
| ------------ | ----------------- | ----------------------------------------- |
| パート       | `P6`              | 上から6番目のパート                       |
| 検出結果     | `ALTO`            | アルト記号（ハ音記号・第3線）             |
| 状態         | （なし）          | ⚠ 要確認 / ⚠ 未検査 / 確認済み / 訂正済み |
| 対象の段     | `35`              | 全 43 段のうち 35 段                      |
| 音高の不一致 | `0` / `402`       | `—` / `402 音`                            |
| 訂正         | `TREBLE` の選択肢 | 「ト音記号」の選択肢                      |

- **全段数の算出**: 全 `items` の `staffRefs` から `(pageIndex, systemIndex)` の異なり数を数える。`ConfirmationItem` はパート×検出値のグループなので、全項目を横断しないと曲全体の段数が出ない
- **バッジ**: CSS を持たないアプリのため、色ではなく文字（`⚠`）とセマンティクスで表す。状態列のテキスト自体がバッジを兼ねる。アクセシビリティ上も色単独で意味を伝えないほうがよい
- **サマリ文**: 「⚠ が付いた N 行だけ確認すれば大丈夫です」と、どこを見ればよいかまで言い切る（メモ 6.3）。0 件なら「N 行すべて確認できています。このまま進めて大丈夫です。」
- **aria-label**: `${partLabel(partId)}の音部記号（読み取り: ${clefLabel(detected)}）`。読み上げにも内部値を出さない
- **`partNumberOf` の重複**: `confirmationItems.ts`（domain）が並び順のために持つ同じ規則の関数と共有しない。renderer は domain を import できず、`shared/` は型と定数のみで実装ロジックを置けないため、レイヤー境界を守る代償としてこの 5 行だけ重複を受け入れる（両方の TSDoc に理由を残す）

### 4. `StructureConfirm.tsx`（変更）

**責務**（変更部分のみ）: 訂正できるものと報告のみのものを分け、何をすればよいかを書く。

```
h1  楽譜の構成の確認
p   （今すべきこと 1 文）
section「訂正が必要な項目」   … systemMeasureCountMismatch のみ。入力欄あり
details「自動で処理した内容」 … その他の issue。既定で折りたたむ
button 音部記号と調の確認へ
```

- 訂正できる項目が 0 件のときは「訂正が必要な項目はありません。このまま次へ進めます。」と**言い切る**
- `details` の要約には件数を出す（「自動で処理した内容（3 件）」）。開かなくても規模が分かる
- `describe()` の文言から「譜表」「システム」を除く。`inconsistentSystemStaffCount` はインチピットに言及した説明文に置き換える

### 5. 全画面の「今すべきこと」1 文（Home / OmrProgress / Editor）

`h1` の直後に `<p>` を 1 つ置くだけの変更。共通コンポーネント化はしない（要素 1 つの抽象化は読み手の往復を増やすだけで、共通なのは**書き方のルール**であってマークアップではない）。ルールは用語集ではなく本設計書と各画面のコメントに残す。

## データフロー

### 確認画面の 1 行が描かれるまで

```
1. ProjectSession が buildConfirmationItems → mergeCorrections で items を作る
   （並びは partId 自然順に固定。訂正値だけが前回から引き継がれる）
2. IPC でスナップショットが Renderer へ渡る
3. ClefKeyConfirm が items 全体から全段数を求める
4. 各行で clefCheckStatus(item) を求め、partLabel / clefLabel / mismatchLabel で文字列化する
5. 状態が needsCheck / unchecked の行の件数をサマリ文に出す
```

### 未検査の行が訂正されたとき

```
1. ユーザーが「ト音記号」を選ぶ → onCorrectClef({ 'clef-P1-UNKNOWN': 'TREBLE' })
2. ProjectSession が確認状態を更新し、パイプラインを頭から流し直す
3. ScoreModelBuilder が corrections で staff.clefKind を上書きする
   → headStepOctave が null を返さなくなり、クロスチェックが実際に走る
4. 再生成された item は corrected !== null なので status は corrected
   （id は 'clef-P1-UNKNOWN' のままなので同じ行に戻る）
```

## エラーハンドリング戦略

新しいエラークラスは追加しない。本作業は表示層の変更であり、失敗しうる I/O を持たない。

**防御的に扱う入力**:

- `partId === null`（構造未確定）: 「パート不明」と表示し、操作は可能なままにする（既存挙動を維持）
- 表にない音部記号の内部値: 「未対応の音部記号」と表示し、例外にしない（部分失敗を全体失敗にしない原則）
- `staffRefs` が空: 全段数の分母が 0 になるため、「全 0 段のうち…」を出さず段数のみ表示する経路を持つ

## テスト戦略

### ユニットテスト

- `tests/unit/renderer/labels/scoreLabels.test.ts`（新規）
  - 音部記号 6 種＋別名 2 種の変換
  - 未知の内部値でフォールバックし、内部値を漏らさないこと
  - `partLabel`: `P1` / `P12` / `null` / 非 `P` 形式
  - `clefCheckStatus`: 4 値の判定と、`unchecked` が `mismatchCount 0` に優先すること
  - `mismatchLabel`: 0 件が「—」／単位付き
  - `staffCoverageLabel`: 分母付きの書式
- `tests/unit/domain/score/confirmationItems.test.ts`（更新）
  - `P2` が `P10` より前に来る（自然順）
  - 不一致件数が並び順に影響しないこと
  - `mergeCorrections` が訂正値のみ引き継ぎ、並びは常に楽譜順であること
- `tests/unit/renderer/ClefKeyConfirm.test.tsx`（更新）
  - 内部識別子が画面に現れないこと（回帰の要）
  - 未検査行が確認対象に算入されること
  - 段数・不一致件数の書式
- `tests/unit/renderer/StructureConfirm.test.tsx`（更新）
  - 訂正可能／報告のみの分離
  - インチピットへの言及
  - 「譜表」「システム」が現れないこと
- `tests/unit/renderer/{Home,OmrProgress,Editor}.test.tsx`（更新）
  - `h1` 直下の 1 文の存在

### 統合テスト

既存の `tests/integration/pipeline/confirmation-effect.test.ts` が並び順に依存していないかを確認する。依存していれば、楽譜順を前提とする形へ更新する（実データでの訂正効果 569 → 111 件という**検証内容そのものは変えない**）。

## 依存ライブラリ

追加なし。

## ディレクトリ構造

```
src/renderer/
├── labels/
│   └── scoreLabels.ts          # 新規
└── screens/
    ├── ClefKeyConfirm/ClefKeyConfirm.tsx   # 変更
    ├── StructureConfirm/StructureConfirm.tsx # 変更
    ├── Home/Home.tsx                        # 変更（1文追加）
    ├── OmrProgress/OmrProgress.tsx          # 変更（1文追加）
    └── Editor/Editor.tsx                    # 変更（1文追加）

src/domain/score/confirmationItems.ts        # 変更（並び順）

tests/unit/renderer/labels/scoreLabels.test.ts # 新規
tests/unit/renderer/*.test.tsx                 # 更新
tests/unit/domain/score/confirmationItems.test.ts # 更新

docs/glossary.md                 # 更新（8.1〜8.5）
docs/functional-design.md        # 更新（並び順・画面表示）
docs/repository-structure.md     # 更新（labels/ の追記）
docs/ideas/ui-wording-improvement.md # ステータス更新
```

## 実装の順序

1. 表示名モジュールとそのテスト（他の変更が依存するため最初）
2. 並び順の変更とテスト更新（ドメイン側。UI から独立して検証できる）
3. ClefKeyConfirm の作り直しとテスト更新
4. StructureConfirm の再構成とテスト更新
5. 残り 3 画面の 1 文追加
6. 品質チェック（test / lint / typecheck）
7. 永続ドキュメントの更新

## セキュリティ考慮事項

- 表示文字列の変更のみで、外部入力の扱いは変わらない。React が既定でエスケープするため、`partId` 等がそのまま描画されても XSS にはならない
- ローカル完結の原則に影響なし（外部送信を伴う変更はない）

## パフォーマンス考慮事項

- 全段数の算出は全 `items` の `staffRefs` を走査する。divisi 実データで 288 譜表＝ 288 要素であり、描画ごとに走査しても問題にならない規模。メモ化は行わない（複雑さに見合わない）

## 将来の拡張性

- **切り抜き画像表示**（メモ 10）が入ったとき、`clefLabel` は画像の代替テキストとしてそのまま使える。文字による説明は本来「目で照合する」ことの代替なので、画像が入っても消えるわけではない
- **パート名のユーザー命名**が入ったとき、変更点は `partLabel` の実装 1 箇所に閉じる（呼び出し側は変えない）
- **2 段譜・ピアノ伴奏**を扱うことになったとき、見直すのは UI 用語だけでよい。`Part`（論理）と `StaffRef`（物理）はモデル上分かれたままである（メモ 5.1）
