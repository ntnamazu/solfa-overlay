# リポジトリ構造定義書 (Repository Structure Document)

- 作成日: 2026-07-13
- 前提ドキュメント: [PRD](product-requirements.md) / [機能設計書](functional-design.md) / [アーキテクチャ設計書](architecture.md)

## プロジェクト構造

```
project-root/
├── src/
│   ├── main/              # Electron Main プロセス（エントリ・IPC・OMR実行）
│   ├── preload/           # contextBridge による型付きIPC APIの公開
│   ├── renderer/          # UIレイヤー（画面・注釈オーバーレイ表示）
│   ├── domain/            # サービスレイヤー（純粋TSのドメインロジック）
│   ├── storage/           # データレイヤー（プロジェクトファイル永続化）
│   └── shared/            # 共通型定義・定数（全レイヤーから参照可）
├── tests/
│   ├── unit/              # ユニットテスト（src と同構造）
│   ├── integration/       # 統合テスト（パイプライン回帰）
│   ├── e2e/               # E2Eテスト（Playwright）
│   └── fixtures/          # テスト用固定データ（検証済み題材のOMR成果物等）
├── resources/             # 同梱バイナリ・アセット（ビルド時に extraResources へ）
│   ├── audiveris/         # Audiveris 一式
│   ├── jre/               # 同梱JRE（OS別）
│   └── fonts/             # 階名描画用フォント
├── docs/                  # プロジェクトドキュメント（6つの永続ドキュメント）
│   └── ideas/             # 着想メモ（PRD前の入力）
├── scripts/               # ビルド・開発補助スクリプト
├── .github/
│   └── workflows/         # CI/CD定義（品質チェック・リリースパッケージング）
├── .steering/             # 作業単位の計画ドキュメント（Git管理・履歴として保持）
├── .claude/               # Claude Code 設定（commands/skills/agents）
├── README.md              # プロジェクト概要・セットアップ手順の入口
├── LICENSE                # 本アプリ自体のライセンス
├── THIRD_PARTY_LICENSES.md # 同梱物（Audiveris/JRE/フォント）のライセンス全文と入手元
├── package.json
├── tsconfig.json          # ＋プロセス別の tsconfig.*.json
├── electron-builder.yml   # パッケージング設定
├── .prettierrc            # コードフォーマット設定（JSON）
└── vitest.config.ts       # ほかツール設定は [ツール名].config.ts
```

## ディレクトリ詳細

### src/main/ (Electron Main プロセス)

**役割**: アプリのエントリポイント、ウィンドウ管理、IPCハンドラ登録、Audiveris 子プロセスの実行制御

**配置ファイル**:

- `index.ts`: エントリポイント（ウィンドウ生成・ライフサイクル・IPCハンドラ登録・ダイアログ）
- `ProjectSession.ts`: 解析パイプラインの編成（構造解決 → 照合 → 確認項目 → 調文脈 → 階名 → 注釈）と
  ユーザー判断の保持・自動保存の予約・PDF 出力。判断ロジックは持たず、順序と状態だけを担う
- `errors.ts`: 編成レイヤーの操作エラー（`ConfirmationRequiredError`）。
  IPC 越しに例外を投げるとクラス情報が失われるため、`toIpcError` が種別へ翻訳できるよう型で表す
- `ipc/projectHandlers.ts`: セッション操作を `IpcResult` へ変換するハンドラ群。
  Electron の `ipcMain` に依存しない純粋な関数として作り、登録だけを `index.ts` が行う
  （Electron を起動せずにエラー分類を単体テストできるようにするため）
- `omr/OmrRunner.ts`: Audiveris のヘッドレス実行・進捗通知・キャンセル
- `omr/omrArchive.ts`: `.omr` / `.mxl` の展開と `OmrArtifacts` 組み立て

**命名規則**:

- クラスは PascalCase。IPCハンドラは操作単位の関数を 1 モジュールにまとめる
  （当初計画の `handle[Domain][Action].ts`（1チャネル1ファイル）は、ハンドラの実体が
  「セッションへの委譲＋結果変換」の 2〜3 行しかなくファイル分割の利得がないため取りやめた）

**依存関係**:

- 依存可能: `domain/`, `storage/`, `shared/`
- 依存禁止: `renderer/`（通知は IPC イベント経由）

### src/preload/

**役割**: contextBridge で Renderer に公開する型付き API の定義（セキュリティ境界）

**配置ファイル**:

- `index.ts`: 公開APIの組み立て
- `api.ts`: 公開APIの型定義（renderer から `import type` で参照）

**依存関係**:

- 依存可能: `shared/`（型のみ）
- 依存禁止: `domain/`, `storage/` の実体（IPC呼び出しに限定）

### src/renderer/ (UIレイヤー)

**役割**: 画面表示、ユーザー入力の受付、編集操作の発行（機能設計書の画面遷移を実装）

**配置ファイル**:

- `screens/`: 画面単位のコンポーネント（`Home/`, `OmrProgress/`, `StructureConfirm/`, `ClefKeyConfirm/`, `Editor/`）
  - `Export/` は作らない。出力は「保存先を選ぶ → 書き出す → 結果を見る」という一過性の操作でしかなく、
    画面にすると Editor と同じ内容を二重に描くことになる（機能設計書の画面遷移図を参照）
- `components/`: 画面横断の再利用コンポーネント
- `viewer/`: PDF.js によるページ描画と注釈オーバーレイ表示
- `state/`: UI状態管理（プロジェクトの編集状態はIPC越しにMainが正とする）

**命名規則**:

- コンポーネントは PascalCase（例: `SkippedMeasureList.tsx`）
- 画面ディレクトリは画面遷移図の状態名と一致させる

**依存関係**:

- 依存可能: `preload/api.ts`（型のみ）、`shared/`（型・定数のみ）
- 依存禁止: `main/`, `domain/`, `storage/`、Node.js API 全般

### src/domain/ (サービスレイヤー)

**役割**: OMR成果物の照合・階名計算・注釈管理・PDF合成というドメインロジック。**Electron 非依存の純粋 TypeScript** に保ち、ユニットテスト容易性を担保する

**配置ファイル**:

- `score/`: `ScoreModelBuilder.ts`, `MusicXmlParser.ts`, `OmrSheetParser.ts`, `BookStructureResolver.ts`（段ごとの小節番号アンカーの確定）, `structureAnchors.ts`（確定構造から通し小節番号の基準値を求める純粋関数。照合と調文脈生成が共有する）
- `solfa/`: `SolfaEngine.ts`, `syllableTables.ts`（コダーイ式/Tonic sol-fa の文字列化表）, `KeyRegionBuilder.ts`（調号から調文脈を自動生成）, `keyTable.ts`（調号→主音の対応表）
- `annotations/`: `AnnotationManager.ts`（注釈の生成・編集と手動修正の保全）, `placementResolver.ts`（衝突回避。候補位置の梯子と一様格子による近傍索引）
- `render/`: `OverlayRenderer.ts`（注釈付きPDFのバイト列生成）, `coordinateTransform.ts`（.omr px → PDF pt。y 軸反転と軸ごとの縮尺）, `pageInfo.ts`（Audiveris ページと元PDFページの対応づけ）, `fontMetrics.ts`（標準14フォントの寸法計測と描けない文字の置換。**配置と描画が同じ関数で測る**ための共通の入口）

**命名規則**:

- クラスファイルは PascalCase、関数・テーブルファイルは camelCase

**依存関係**:

- 依存可能: `shared/`
- 依存禁止: `main/`, `renderer/`, `preload/`, `storage/`、Electron API

### src/storage/ (データレイヤー)

**役割**: `.solfaproj`（zip）の保存・読込・世代バックアップ・スキーマ検証、アプリ設定の永続化、出力PDF（注釈付きPDF）の原子的書き出し

**配置ファイル**:

- `ProjectStore.ts`: 保存・読込・原子的書き込み・世代退避の実行
- `projectArchive.ts`: `.solfaproj`（zip）の構成と読み書き
- `projectSchema.ts`: Zod スキーマ（project.json の検証）と版数判定・マイグレーション経路
- `zipArchive.ts`: zip の安全な読み書き。**パストラバーサル拒否をここに集約する**
  （`.omr` / `.mxl` と `.solfaproj` はどちらも外部入力であり、片方だけ防御が強化されて
  もう片方が取り残される事故を構造的に防ぐ。`main/omr/omrArchive.ts` もこれを使う）
- `backupRotation.ts`: .bak 3世代管理（操作列を組み立てる純粋関数。副作用は ProjectStore 側）
- `errors.ts`: `ProjectFileError`（`zip` / `schema` / `version` / `io` で回復手段を分ける）
- `AppSettingsStore.ts`: アプリ設定（楽譜由来データを含まない）
- `writeExportPdf.ts`: 注釈付きPDFの原子的書き出し（OverlayRenderer が生成したバイト列を IPCハンドラ経由で受け取る）

**依存関係**:

- 依存可能: `shared/`
- 依存禁止: `domain/`, `renderer/`, `main/`（呼び出される側に徹する）

### src/shared/

**役割**: 全レイヤーが参照する型定義・定数。**実装ロジックは置かない**

**配置ファイル**:

- `types/`: 機能設計書のエンティティ定義（`Project.ts`, `ScoreModel.ts`, `Annotation.ts`, `KeyRegion.ts`,
  `Confirmation.ts`, `StructureDecision.ts`, `OmrRawArtifacts.ts` 等）
- `types/Issues.ts`: 解析が検出した問題（`StructureIssue` / `BuildIssue` / `KeyRegionIssue` /
  `PageInfoIssue` / `AnnotationIssue` / `RenderIssue`）。
  **domain ではなく shared に置く**: 確認画面・Editor へ IPC で送る表示用データであり
  `ipc/contract.ts` が型として参照するため。shared は domain へ依存できない（ESLint で強制）。
  domain 側は `export type` で再エクスポートし、利用側の import 先は変えていない
- `constants/`: 既定値（`DEFAULT_SETTINGS.ts` 等）
- `ipc/`: IPCチャネル名とペイロード型（Main/preload/Renderer で共有）

**ルール**: 本当に複数レイヤーで使うもののみ。単一レイヤー専用の型はそのレイヤー内に置く

### tests/ (テストディレクトリ)

#### unit/

**役割**: domain/・storage/・main/ の純粋ロジックのユニットテストと、renderer の画面テスト

**構造**:

```
tests/
├── setup/renderer.ts             # jsdom 環境の共通セットアップ（明示的な cleanup）
├── unit/
│   ├── domain/
│   │   ├── score/                # src と同構造をミラー
│   │   └── solfa/
│   ├── storage/                  # storage も同様にミラー
│   ├── main/
│   │   ├── ProjectSession.test.ts
│   │   ├── ipc/projectHandlers.test.ts
│   │   └── omr/
│   └── renderer/                 # 画面コンポーネント（jsdom）。拡張子は .test.tsx
│       ├── fixtures.ts           # 画面テスト用の最小データ
│       ├── App.test.tsx
│       └── [画面名].test.tsx
└── integration/
    ├── pipeline/                 # パース→照合→階名の実データ回帰
    └── project-file/             # .solfaproj の保存→読込の往復
```

**命名規則**: `[テスト対象ファイル名].test.ts`（画面は `.test.tsx`）

**環境の分離**: `vitest.config.ts` の `projects` で node / renderer を分ける。
renderer だけが jsdom を必要とし、node 側に持ち込むと純粋ロジックのテストが遅くなるため

#### integration/

**役割**: パイプライン全体の回帰テスト（アーキテクチャ設計書のテスト戦略に対応）

**構造**:

```
tests/integration/
├── pipeline/
│   ├── synthetic-mini.test.ts       # 合成フィクスチャの通し回帰（パース→照合）
│   ├── realFixtureHelpers.ts        # 実 .omr/.mxl → 照合まで走らせる共有ヘルパー
│   ├── victoria-regression.test.ts  # 実 Audiveris: matched295・808音・不一致0・skipped1
│   ├── divisi-regression.test.ts    # SSAATTBB divisi: 構造解決後 matched1029・3500音・skipped135
│   └── solfa-pipeline.test.ts       # 階名まで通す一気通貫回帰（KeyRegion・階名分布の固定）
└── project-file/
    └── save-load-roundtrip.test.ts
```

#### e2e/

**役割**: Playwright による Electron アプリの操作シナリオ

**構造**:

```
tests/e2e/
├── first-project/         # 新規プロジェクト→確認→修正→出力
├── clef-correction/       # オクターブ下ト音記号の修正と再計算
└── modulation/            # 転調指定と手動注釈の保全
```

#### fixtures/

**役割**: テスト用固定データ。**パブリックドメイン楽譜のみ**を置く（著作権のある楽譜はコミット禁止）

```
tests/fixtures/
├── synthetic-mini/       # 手作りの最小データ（パーサ通し回帰用）
├── victoria/             # Victoria《O magnum mysterium》= PD（実 Audiveris 5.6.1 出力）
│   ├── IMSLP19716.omr        # book 出力（PNG 除去の slim 版）
│   ├── IMSLP19716.mvt1.mxl   # movement 1（インチピット）
│   ├── IMSLP19716.mvt2.mxl   # movement 2（本体 SATB）
│   └── README.md             # 実測値の根拠・プロトタイプ実測との差分
└── divisi/               # The Message of the Angels（Reed, 1919）= PD
    ├── IMSLP175782.omr       # book 出力（slim 版・20ページ8パート）
    ├── IMSLP175782.mxl       # 単一 movement
    └── README.md             # 実測値の根拠・真因（小節番号ドリフト）と残る限界の記録
```

> Audiveris 出力（`.omr`/`.mxl`）は zip。`.omr` 内の生画像（`BINARY.png`）はリポジトリ肥大化
> 防止のため除去した slim 版を置く（パーサが読むのは XML のみで回帰結果に影響しない）。

### docs/ (ドキュメントディレクトリ)

**配置ドキュメント**:

- `product-requirements.md`: プロダクト要求定義書
- `functional-design.md`: 機能設計書
- `architecture.md`: アーキテクチャ設計書
- `repository-structure.md`: リポジトリ構造定義書(本ドキュメント)
- `development-guidelines.md`: 開発ガイドライン
- `glossary.md`: 用語集
- `ideas/`: PRD以前の着想メモ（`solfa-annotation-app.md`）

### resources/ (同梱リソース)

**役割**: 実行時に必要なバイナリ・アセット。electron-builder の extraResources として同梱

**配置ファイル**:

- `audiveris/<platform>/`: Audiveris 一式（バージョン固定。更新は回帰手順必須）。Windows は `audiveris/win/`（`Audiveris.exe`＋`app/`＋`runtime/`）
- `jre/<platform>/`: OS別の同梱JRE（**Windows では未使用**）
- `fonts/`: 階名描画用フォント（小サイズ判読性で選定したもの。再配布可能なライセンスに限る）

**注意**: 大容量バイナリ（Audiveris/JRE）はリポジトリにコミットせず、ビルド時ダウンロードスクリプト（`scripts/fetch-resources.ts`。取得先のバージョン・ハッシュ固定で再現性を担保）で取得する。Git LFS は採用しない（ストレージ・帯域の無料枠制約と clone コスト増を避ける）。ダウンロード物（MSI 等）は `resources/.cache/`（gitignore 対象）にキャッシュする

**Windows の JRE 二重同梱回避**: Windows 版 Audiveris の配布物（`Audiveris-5.6.1-windows-x86_64.msi`）は jpackage 製で Java ランタイムを内包する。そのため Windows では `resources/jre/` を別立てせず、Audiveris 同梱の `runtime/` をそのまま使う（`scripts/fetch-resources.ts` が MSI を SHA-256 固定で取得・展開して `resources/audiveris/win/` に配置）

**ライセンス表記**: 同梱物のライセンス全文と入手元をルートの `THIRD_PARTY_LICENSES.md` に集約し、配布物（インストーラ）にも同梱する。Audiveris は AGPL-3.0 のため、別プロセス実行（ファイルパス渡しのみ）の構成を維持したうえで、公開リリース前に同梱・再配布の条件を確認することを必須とする（JRE・フォントも同様に表記する）

### scripts/

**配置ファイル**:

- `fetch-resources.ts`: Audiveris/JRE の取得・配置（バージョン・ハッシュ固定）
- `generate-fixtures.ts`: フィクスチャの再生成（Audiveris 更新時のみ実行）

## ファイル配置規則

### ソースファイル

| ファイル種別       | 配置先                         | 命名規則             | 例                           |
| ------------------ | ------------------------------ | -------------------- | ---------------------------- |
| ドメインクラス     | src/domain/[機能]/             | PascalCase           | `SolfaEngine.ts`             |
| 純関数・テーブル   | src/domain/[機能]/             | camelCase            | `placementResolver.ts`       |
| 画面コンポーネント | src/renderer/screens/[画面名]/ | PascalCase           | `Editor/AnnotationLayer.tsx` |
| IPCハンドラ        | src/main/ipc/                  | handle + 対象 + 動詞 | `handleProjectSave.ts`       |
| 型定義             | src/shared/types/              | PascalCase           | `KeyRegion.ts`               |
| 定数               | src/shared/constants/          | UPPER_SNAKE_CASE     | `DEFAULT_SETTINGS.ts`        |

### テストファイル

| テスト種別     | 配置先                     | 命名規則           | 例                            |
| -------------- | -------------------------- | ------------------ | ----------------------------- |
| ユニットテスト | tests/unit/（srcをミラー） | [対象].test.ts     | `SolfaEngine.test.ts`         |
| 統合テスト     | tests/integration/[機能]/  | [シナリオ].test.ts | `victoria-regression.test.ts` |
| E2Eテスト      | tests/e2e/[シナリオ]/      | [フロー].test.ts   | `export-pdf.test.ts`          |

### 設定ファイル

| ファイル種別        | 配置先             | 命名規則                                                     |
| ------------------- | ------------------ | ------------------------------------------------------------ |
| ツール設定          | プロジェクトルート | `[ツール名].config.ts`（`vitest.config.ts` 等）              |
| Prettier 設定       | プロジェクトルート | `.prettierrc`（JSON。ロジック不要のため dotfile 形式を採用） |
| Electron ビルド設定 | プロジェクトルート | `electron-builder.yml`                                       |
| TypeScript 設定     | プロジェクトルート | `tsconfig.json`（＋プロセス別の `tsconfig.*.json`）          |
| CI/CD ワークフロー  | .github/workflows/ | `[目的].yml`（`ci.yml`, `release.yml`）                      |

## 命名規則

### ディレクトリ名

- **レイヤー・分類ディレクトリ**: 複数形、kebab-case（例: `screens/`, `annotations/`, `constants/`）
- **機能ディレクトリ**: 単数形、kebab-case（例: `score/`, `solfa/`, `first-project/`）

### ファイル名

- **クラスファイル**: PascalCase（例: `ScoreModelBuilder.ts`）
- **関数ファイル**: camelCase。主エクスポートが単一の処理なら動詞始まり（例: `writeExportPdf.ts`）、関連する純関数・対応表をまとめたモジュールなら名詞（例: `coordinateTransform.ts`, `syllableTables.ts`, `backupRotation.ts`）
- **定数ファイル**: UPPER_SNAKE_CASE（例: `DEFAULT_SETTINGS.ts`）

## 依存関係のルール

### レイヤー間の依存

```
renderer (UI)
    ↓ 型付きIPCのみ（preload/api.ts の型を import type）
main (IPC/プロセス制御)
    ↓ (OK)
domain (サービス)      storage (データ)
    ↓ (OK)                ↓ (OK)
shared (型・定数)      shared (型・定数)
```

**禁止される依存**:

- `domain/` → `main/`・`renderer/`・`storage/`・Electron API (❌ domainは純粋TSを維持)
- `storage/` → `domain/`・`renderer/` (❌)
- `renderer/` → Node.js API・`main/` 実体 (❌ セキュリティ境界の維持)

### モジュール間の依存

- 循環依存禁止。共有が必要な型は `shared/types/` に抽出する
- ESLint の import ルール（`import/no-cycle`、レイヤー境界の `no-restricted-imports`）で機械的に強制する

## スケーリング戦略

### 機能の追加

1. **小規模機能**: 既存の機能ディレクトリ内に配置（例: 音節体系の追加 → `solfa/syllableTables.ts` に表を追加）
2. **中規模機能**: domain 配下に機能ディレクトリを新設（例: v2 和音役割 → `src/domain/chords/ChordAnalyzer.ts`。SolfaEngine から独立させる）
3. **画面の追加**: `renderer/screens/` に画面遷移図の状態名でディレクトリを新設

### ファイルサイズの管理

- 1ファイル: 300行以下を推奨
- 300-500行: リファクタリングを検討
- 500行以上: 分割を強く推奨（例: `SolfaEngine` から文字列化を `syllableTables.ts` に分離済みの構成を維持）

## 特殊ディレクトリ

### .steering/ (ステアリングファイル)

**役割**: 作業指示ごとの「今回何をするか」の記録（steeringスキルが使用）

**構造**:

```
.steering/
└── [YYYYMMDD]-[task-name]/
    ├── requirements.md
    ├── design.md
    └── tasklist.md
```

**命名規則**: `20260713-add-solfa-engine` 形式

**Git管理**: コミットして履歴として保持する。作業中の判断理由・トラブルシュートの知見（環境特有の問題と検証済みの不採用案など）が将来の作業の参照資料になるため。ただし著作権のある楽譜データや秘密情報は含めないこと

### .claude/ (Claude Code設定)

```
.claude/
├── commands/                # スラッシュコマンド
├── skills/                  # スキル（本ドキュメント群の作成・更新に使用）
└── agents/                  # サブエージェント定義
```

### .github/ (CI/CD設定)

**役割**: GitHub Actions のワークフロー定義

```
.github/
└── workflows/
    ├── ci.yml               # push/PRごと: lint → typecheck → test（開発ガイドライン「品質自動化」に対応。E2E は develop/main への PR のみ）
    └── release.yml          # タグ作成時: fetch-resources.ts → electron-builder でインストーラを生成し GitHub Releases に添付（現状 Windows 未署名のみ。mac/linux は将来対応）
```

**注意**: ビルド成果物（インストーラ）はリポジトリにコミットせず、GitHub Releases で配布する。PR検証用の一時成果物は Actions アーティファクト（保持期限つき）を使う

## 除外設定

### .gitignore

- `node_modules/`
- `dist/` / `out/`（ビルド成果物）
- `resources/audiveris/` / `resources/jre/` / `resources/.cache/`（`scripts/fetch-resources.ts` で取得・キャッシュするためコミットしない）
- `*.log`
- `.DS_Store`
- `*.solfaproj` / `*.solfaproj.bak*`（手元の検証用プロジェクトファイル。著作権のある楽譜を含み得るため必ず除外）

### .prettierignore / ESLint ignore

- `dist/` / `out/`
- `node_modules/`
- `coverage/`
- `resources/`
- `tests/fixtures/`（生成物のため整形対象外）
