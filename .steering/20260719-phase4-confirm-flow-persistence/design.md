# 設計書

- 作業名: 20260719-phase4-confirm-flow-persistence

## アーキテクチャ概要

既存のレイヤー構成（アーキテクチャ設計書「依存方向」）をそのまま使う。本フェーズで初めて
**編成レイヤー（`main/ipc/`）とデータレイヤー（`storage/`）が実体を持つ**。

```
Renderer（画面4つ）
  │ 型付きIPC（preload）
  ▼
編成レイヤー  main/ipc/*.ts ＋ main/ProjectSession.ts
  ├─► サービス  domain/  BookStructureResolver / ScoreModelBuilder
  │                     KeyRegionBuilder / SolfaEngine / confirmationItems
  ├─► サービス  main/omr/OmrRunner（Audiveris 実行。既存）
  └─► データ    storage/ ProjectStore / projectSchema / projectArchive / backupRotation
```

**セッション状態は Main が正**とする。Renderer は IPC の戻り値を表示するだけで、
`Project` の可変状態を持たない（アーキテクチャ設計書「プロジェクトの編集状態はIPC越しにMainが正とする」）。

## コンポーネント設計

### 1. `domain/score/confirmationItems.ts`（新規・純関数）

**責務**:

- 確定構造・照合結果から `ConfirmationItem[]` を生成する
- **パート×検出音部記号でグルーピング**し、確認画面の行数を実用的な量に畳む
- グループごとにクロスチェック不一致件数を集計し、多い順に並べる

**実装の要点**:

- 実測（`requirements.md` 計測2）で divisi は譜表 288・グループ 17。**グルーピングは必須**
- グループキーは `partId` と `clefKind`。`clefKind` が null（未検出）のグループも作る
  （Victoria 1・divisi 7 譜表が該当し、これらは訂正の第一候補になる）
- 並び順は「不一致件数の降順 → partId → detected」。**決定的**にする（テストで固定するため）
- `clipRect` はそのグループの代表譜表（先頭）の符頭座標から近似する。
  `.omr` は譜表そのものの矩形を持たない（`OmrStaff` は `partId` / `staffId` / `clefKind` / `heads`）ため、
  正確な音部記号の矩形は取れない。画像表示を入れる Phase 5 で精緻化する前提の近似値とする

**`ConfirmationItem` の型変更（機能設計書からの変更）**:

```typescript
export interface ConfirmationItem {
  id: string; // 'clef-P6-ALTO' 形式（決定的）
  kind: 'clef';
  partId: string | null;
  detected: string; // Audiveris の kind 表記。未検出は 'UNKNOWN'
  corrected: string | null;
  staffRefs: StaffRef[]; // このグループに属する全譜表（訂正は全てに適用）
  clipRect: PageAnchor & { width: number; height: number };
  mismatchCount: number; // 並び順と警告表示の材料
}
```

**変更理由（2点）**:

1. `staffRef`（単数）→ `staffRefs`（複数）: グルーピングの単位を型で表す。
   これがないと「1 行の訂正を 35 段へ適用する」という意図が UI 側の暗黙知になる
2. `kind` を `'clef'` に絞る: 元の型は `'clef' | 'keySignature' | 'systemStructure'` だったが、
   **調号は `KeyRegionDecision`、構造は `StructureDecision` が担う**ため後2者を消費する実装が存在しない。
   死んだ判別子を残すと、将来「keySignature 項目を作れば効く」と誤読される。
   訂正の入口を 1 概念 1 型に対応させる

### 2. `domain/solfa/KeyRegionBuilder.ts`（拡張）

**責務（追加）**:

- `KeyRegionDecision[]` を受け取り、自動生成した調文脈へユーザー訂正を反映する

```typescript
/** 確認画面（ClefKeyConfirm）での調文脈の訂正（shared/types/KeyRegion.ts） */
export interface KeyRegionDecision {
  /** 訂正対象の KeyRegion の開始通し小節番号 */
  measureIndex: number;
  /** 調号の上書き（-7〜+7）。省略時は自動検出値を採用 */
  fifths?: number;
  /** 旋法の上書き。省略時は自動検出値（＝Audiveris 由来では常に major） */
  mode?: 'major' | 'minor';
}

build(artifacts, structure, decisions?: readonly KeyRegionDecision[]): KeyRegionBuildResult
```

**実装の要点**:

- 訂正は**自動生成が終わった後**に適用する。生成中に混ぜると多数決の母数が汚れる
- 訂正した区間は `source: 'user'` にする（転調点 UI が auto/user を色分けするため）
- **隣接区間のマージが必須**: 訂正で前後が同じ調になると、転調していないのに区間が 2 つ並び、
  F-6 の転調点 UI が存在しない転調点を描く。これは Phase 3 のコードレビュー修正1
  （曲頭既定の重複）とまったく同じ defect の別経路であり、同じ轍を踏まない
- マージ時は**先頭側の区間を残す**（開始位置が早い方が正）。曲頭区間は必ず残す
- 既存区間に一致しない `measureIndex` の decision は**例外にせず** `unmatchedKeyDecision` として
  報告する。新規区間の挿入は F-6（Phase 6）の担当であり、本フェーズの責務ではない
- 範囲外 `fifths` の decision も同様に報告して無視する

**`KeyRegionIssue.keySignatureConflict` の型変更（記録済み負債の解消）**:

`fifthsByPart: Record<string, number>` は旋法を表現できず、パート間で `mode` だけが違う場合に
無言で多数決処理されていた（Phase 3 で「Phase 4 で検討」と記録）。
本フェーズで mode をユーザーが指定できるようにする以上、報告側も mode を持つべきなので
`keyByPart: Record<string, { fifths: number; mode: 'major' | 'minor' }>` へ変更し、
食い違い判定も fifths と mode の両方で行う。

### 3. `storage/`（新規・データレイヤー）

| ファイル            | 責務                                                               |
| ------------------- | ------------------------------------------------------------------ |
| `ProjectStore.ts`   | `create` / `save` / `load`。原子的書き込みと世代バックアップの編成 |
| `projectSchema.ts`  | `project.json` の Zod スキーマと `SCHEMA_VERSION`                  |
| `projectArchive.ts` | fflate による `.solfaproj`（zip）の読み書き。パストラバーサル拒否  |
| `backupRotation.ts` | `.bak1..3` の世代ローテーション（純粋な操作列の計算＋適用）        |
| `errors.ts`         | `ProjectFileError`（`'zip' \| 'schema' \| 'version' \| 'io'`）     |

**実装の要点**:

- **原子性**: 同ディレクトリの一時ファイル（`.solfaproj.tmp-<乱数>`）へ書いてから `rename`。
  別ディレクトリ（`/tmp`）だとクロスデバイスで `rename` が失敗するため必ず同ディレクトリに置く
- **世代バックアップ**: 保存直前の本体を `.bak1` へ落とし、既存 `.bak1→.bak2→.bak2→.bak3` を
  ずらす。**若い番号から先に処理すると上書きで消える**ため、**古い番号から降順に**動かす。
  この順序性が `backupRotation.ts` を独立ファイルに切り出す理由（純粋関数として単体テストする）
- **`schemaVersion`**: 読込時に `> SCHEMA_VERSION` なら `cause: 'version'` で失敗させ、
  **ファイルには一切書き込まない**（アーキテクチャ設計書「データを壊さない」）。
  `< SCHEMA_VERSION` はマイグレーション経路を用意する（v1 のみのため現状は恒等変換だが、
  分岐と単体テストは置いておく）
- **Zod で `unknown` から絞る**: 開発ガイドライン「外部データは `unknown` で受けて Zod で絞る」。
  プロジェクトファイルは他人から受け取り得る外部入力である
- **domain へ依存しない**: `StructureDecision` / `KeyRegionDecision` は `shared/types/` へ移す
  （現状 `StructureDecision` は `domain/score/BookStructureResolver.ts` にある）。
  storage が domain を import すると ESLint のレイヤー境界違反になるため、型の置き場所を正す

**`.solfaproj` の中身**（機能設計書「ファイル構造」準拠）:

```
project.json     Project エンティティ
source.pdf       取り込んだ元PDF
omr/score.omr    Audiveris 出力（book.xml を内包）
omr/score.mxl    movement 0
omr/score.N.mxl  movement N（複数 movement 曲。Victoria は 2 つ）
```

`assembleArtifacts({ omr, movements })` が `.omr` バイト列と `.mxl` バイト列群を取るため、
**この 2 つを保存しておけば再パースで `OmrArtifacts` が完全に再現できる**（OMR 再実行が不要）。

### 4. `main/`（編成レイヤー）

| ファイル                        | 責務                                                                   |
| ------------------------------- | ---------------------------------------------------------------------- |
| `ProjectSession.ts`             | 開いているプロジェクトと `OmrArtifacts` の保持。解析パイプラインの編成 |
| `ipc/handleProjectCreate.ts` 他 | IPC ハンドラ（domain / storage への委譲のみ）                          |

**`ProjectSession` が編成する解析パイプライン**（domain の呼び出し順を 1 箇所に集約する）:

```
1. BookStructureResolver.detect / resolve(artifacts, bookPages, structureDecisions)
2. ScoreModelBuilder.build(artifacts, structure, confirmation)
3. buildConfirmationItems(artifacts, structure, buildIssues)   ← 確認画面の材料
4. KeyRegionBuilder.build(artifacts, structure, keyRegionDecisions)
5. SolfaEngine.computeDegrees / applyDegrees
```

**要点**: 3 は 2 の結果（不一致件数）を必要とし、2 は確認結果を必要とする。
つまり**初回は空の確認状態で 2 を回して材料を作り、ユーザーの訂正後に 2 から回し直す**。
この「確認 → 再構築」のループが本フェーズの中核であり、`ProjectSession.analyze()` に閉じる。

**進捗通知**: `OmrProgress` は戻り値では返せないため `webContents.send` のイベントで流す
（依存方向の「サービス → Renderer は NG」に抵触しないよう、送るのは編成レイヤー）。

### 5. `renderer/screens/`（UIレイヤー）

画面遷移は `App.tsx` の判別可能な状態（`{ name: 'home' } | { name: 'omrProgress' } | ...`）で持つ。
ルータライブラリは導入しない（画面 4 つ・遷移が一方向のため過剰）。

- **Home**: PDF を開く／既存プロジェクトを開く。ファイル選択は Main の `dialog` を IPC 経由で呼ぶ
- **OmrProgress**: 進捗イベントの購読とキャンセル
- **StructureConfirm**: `StructureIssue[]` の一覧。段の小節数を上書きできる
- **ClefKeyConfirm**: 2 つの表
  - 音部記号グループ表（`ConfirmationItem[]`。不一致件数の多い順・訂正ドロップダウン）
  - 調文脈表（`KeyRegion[]`。調号と**長短**のドロップダウン）
  - 「承認して階名を生成」で `completedAt` を確定

**機能設計書の ClefKeyConfirm 表からの変更**: 元は「譜表ごとに1行（音部記号と調号を同じ行に）」
だったが、**調は譜表ではなく調文脈（小節区間）の属性**である。divisi では譜表 288 に対し
調文脈は 8 しかなく、譜表ごとに調号を並べると同じ情報が 36 倍に重複する。
**音部記号＝パート×検出値のグループ表、調＝調文脈の表**という 2 表構成に改める。

## データフロー

### 新規プロジェクト（PDF → 確認 → 階名）

```
1. Home: PDF を選択 → project:createFromPdf
2. Main: ProjectStore.create（元PDF を取り込む） → OmrRunner.run（進捗を send）
3. Main: 成果物の生バイト列を Project へ保存し、assembleArtifacts で OmrArtifacts 化
4. Main: analyze()（空の確認状態）→ StructureIssue / ConfirmationItem / KeyRegion を返す
5. StructureConfirm: 段の小節数を訂正 → structureDecisions を更新 → analyze 再実行
6. ClefKeyConfirm: 音部記号グループと調（長短）を訂正 → analyze 再実行 → 承認
7. Main: completedAt をセットして保存（自動保存）
```

### 既存プロジェクトを開く（OMR 再実行なし）

```
1. Home: .solfaproj を選択 → project:open
2. storage: zip 展開 → Zod 検証 → Project
3. Main: omr/ の生バイト列から assembleArtifacts → OmrArtifacts 復元
4. Main: 保存済みの decisions / confirmation で analyze() → 訂正済みの状態が復元される
```

## エラーハンドリング戦略

### カスタムエラークラス

```typescript
class ProjectFileError extends Error {
  constructor(message: string, readonly cause: 'zip' | 'schema' | 'version' | 'io') { ... }
}
```

開発ガイドラインの例に一致させる（`cause` の種別は用語集の定義が正）。

### エラーハンドリングパターン

機能設計書「エラーハンドリング」の分類表に従い、**部分失敗は全体を失敗にしない**を維持する。

| 事象                                        | 扱い                                                          |
| ------------------------------------------- | ------------------------------------------------------------- |
| 調号・構造・照合の不整合                    | issue として返す（既存方針を継承）                            |
| `KeyRegionDecision` が既存区間に一致しない  | `unmatchedKeyDecision` issue（例外にしない）                  |
| zip 破損・スキーマ不正・未知の版数          | `ProjectFileError`。**ファイルを書き換えない**                |
| 保存失敗                                    | `ProjectFileError('io')`。UI は編集継続＋警告（分類表どおり） |
| `ResolvedStructure` と `artifacts` の不整合 | 例外（**呼び出し側の契約違反**。既存の分類を維持）            |

**Phase 3 の学びの適用**: 「同じ入力を取るコンポーネントは、同じ不正入力への反応も揃える」。
`KeyRegionBuilder` に decisions を足すにあたり、**不正な decision を例外にしない**方針は
`BookStructureResolver.resolve(decisions)` が不正な decision を黙って無視する既存挙動と揃える
（どちらも「ユーザー入力由来」であり、契約違反ではない）。

## テスト戦略

### ユニットテスト

- `confirmationItems`: グルーピング・並び順の決定性・未検出 clef・`clipRect` 近似
- `KeyRegionBuilder`（追加分）: mode/fifths 上書き・`source: 'user'`・隣接マージ・
  未一致 decision の報告・範囲外 fifths の decision・曲頭区間の保護
- `projectSchema`: 正常/不正/版数超過/欠落フィールド
- `backupRotation`: **降順処理**の検証（若い番号から動かすと消えることを回帰で固定）
- `projectArchive`: zip 往復・パストラバーサル拒否
- `ProjectStore`: 原子的書き込み・保存/読込往復・エラー分類
- 画面 4 つ: jsdom + Testing Library（描画内容・操作で発火する IPC 呼び出し）

### 統合テスト

- `tests/integration/pipeline/confirmation-effect.test.ts`（新規）:
  **実データで確認訂正の効果を固定**する
  - ALTO→TREBLE の訂正で `pitchCrossCheckMismatch` 569 → 111
  - P6 402 → 0 / P4 38 → 0
  - グループ数 divisi 17・Victoria 5
  - `mode: 'minor'` 指定で **La 基準と Do 基準の階名が食い違う**
    （Phase 3 で「一致する」と固定した制約が解消することの証明）
- `tests/integration/project-file/save-load-roundtrip.test.ts`（新規）:
  実フィクスチャを含む `.solfaproj` の保存 → 読込 → **OMR 再実行なしで階名まで到達**

**退行検知の順序（Phase 2・3 で有効だった手順を踏襲）**: 新規実測値を固定する**前に**
victoria / divisi / solfa-pipeline の既存回帰を通し、期待値が 1 つも変わらないことを確認する。

**Phase 3 のテストの扱い**: 「La 基準と Do 基準で階名が一致する」テストは**残す**。
これは**自動生成の調文脈**の性質を固定したものであり、ユーザー指定で解消するのは別の話。
「自動では一致する（＝自動判別できない）／ユーザー指定すれば食い違う（＝訂正が効く）」の
2 本を並べることで、制約と解消手段の両方が回帰で守られる。

## 依存ライブラリ

```json
{
  "dependencies": { "zod": "^4" },
  "devDependencies": {
    "@testing-library/react": "^16",
    "@testing-library/dom": "^10",
    "jsdom": "^27"
  }
}
```

- `zod`: アーキテクチャ設計書で選定済み（`project.json` の検証）。本フェーズが初の利用
- Testing Library / jsdom: **本 devcontainer では GUI を起動できない**ため、画面を
  自動検証する唯一の手段。アーキテクチャ設計書のテスト戦略に「コンポーネントテスト」を追記する
- fflate は既存（`.omr` 展開で使用中）。`.solfaproj` の圧縮にも使う

**セキュリティ規約の確認**: 追加ライブラリはいずれもネットワークアクセスを行わない
（開発ガイドライン「楽譜由来データの外部送信禁止」の観点でブロッカーなし）。

## ディレクトリ構造

```
src/
├── shared/
│   ├── types/
│   │   ├── Project.ts            (新規) Project / PageInfo
│   │   ├── Annotation.ts         (新規) Annotation（Phase 5 で使用。永続化のため型だけ先行）
│   │   ├── StructureDecision.ts  (新規) domain から移設
│   │   ├── Confirmation.ts       (変更) staffRefs 化・kind を 'clef' に限定
│   │   └── KeyRegion.ts          (変更) KeyRegionDecision を追加
│   └── ipc/{channels,contract}.ts (変更) チャネル拡充
├── domain/
│   ├── score/confirmationItems.ts (新規)
│   └── solfa/KeyRegionBuilder.ts  (変更) decisions 対応・issue 型の変更
├── storage/                        (新規) 上表の5ファイル＋errors.ts
├── main/
│   ├── ProjectSession.ts          (新規)
│   ├── ipc/                       (新規) ハンドラ群
│   └── index.ts                   (変更) ハンドラ登録
├── preload/{api,index}.ts          (変更)
└── renderer/
    ├── App.tsx                    (変更) 画面遷移
    └── screens/{Home,OmrProgress,StructureConfirm,ClefKeyConfirm}/
```

## 実装の順序

1. **退行検知の基準取り**（着手前の全テスト実行）
2. **型の整理**（shared/types。以降すべての土台）
3. **domain**: `confirmationItems` → `KeyRegionBuilder` 拡張（純粋・テストが速い）
4. **storage**: archive → schema → backupRotation → ProjectStore
5. **統合テスト**: 確認訂正の効果・保存往復（**実データで設計判断を検証**）
6. **main**: ProjectSession → IPC ハンドラ
7. **preload / renderer**: API → 画面 4 つ
8. 品質チェック → 実装検証 → ドキュメント更新

**3 と 5 を先に置く理由**: 本フェーズの価値（不一致 80% 減・La 基準の実現）は domain 層で
決まる。UI より先に実データで効果を確定させ、UI は確定した materials を並べるだけにする。

## セキュリティ考慮事項

- `.solfaproj` の zip 展開でパストラバーサル（`../`）を拒否する（既存 `unzipEntries` と同方針）
- `project.json` は Zod で検証してから型として扱う（`any` を使わない）
- 追加ライブラリにネットワークアクセスなし
- Electron ハードニング（`nodeIntegration: false` / `contextIsolation: true` / `sandbox: true`）と
  CSP（`default-src 'self'`）を変更しない
- ファイル選択ダイアログは Main 側で開き、Renderer にパス文字列以外を渡さない

## パフォーマンス考慮事項

- 自動保存は 300ms デバウンス（アーキテクチャ設計書と同値）
- 確認画面の再解析（`analyze()`）は訂正のたびに全体を回すが、対象は最大 20 ページ・
  3500 音符で、実測では 1 回 1 秒未満（既存回帰テストの実行時間から）。
  **範囲限定の再計算は Phase 5・6 の再計算要件で導入する**（`applyDegrees` は既にマージ意味論で
  範囲限定に対応済み）

## 将来の拡張性

- `KeyRegionDecision` は F-6（転調点の新規指定）で「新規区間の挿入」を足せる形にしておく
  （現状は既存区間への一致のみ。挿入は issue で拒否しており、拡張点が明示されている）
- `Project` は `annotations` フィールドを持たせて永続化するため、Phase 5 の
  AnnotationManager 実装時にスキーマ変更（＝版数の増分）が不要になる
- `ConfirmationItem.kind` は将来別種の確認項目が実在するようになった時点で判別子を戻せる
