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
- `index.ts`: エントリポイント（ウィンドウ生成・ライフサイクル）
- `ipc/`: IPCハンドラ（チャネルごとに1ファイル。domain/storage への委譲のみ行う）
- `omr/OmrRunner.ts`: Audiveris のヘッドレス実行・進捗通知・キャンセル

**命名規則**:
- クラスは PascalCase、IPCハンドラは `handle[Domain][Action].ts`（例: `handleProjectOpen.ts`）

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
- `screens/`: 画面単位のコンポーネント（`Home/`, `OmrProgress/`, `StructureConfirm/`, `ClefKeyConfirm/`, `Editor/`, `Export/`）
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
- `score/`: `ScoreModelBuilder.ts`, `MusicXmlParser.ts`, `OmrSheetParser.ts`, `BookStructureResolver.ts`（誤分割復元）
- `solfa/`: `SolfaEngine.ts`, `syllableTables.ts`（コダーイ式/Tonic sol-fa の文字列化表）
- `annotations/`: `AnnotationManager.ts`, `placementResolver.ts`（衝突回避）
- `render/`: `OverlayRenderer.ts`, `coordinateTransform.ts`（.omr px → PDF pt）

**命名規則**:
- クラスファイルは PascalCase、関数・テーブルファイルは camelCase

**依存関係**:
- 依存可能: `shared/`
- 依存禁止: `main/`, `renderer/`, `preload/`, `storage/`、Electron API

### src/storage/ (データレイヤー)

**役割**: `.solfaproj`（zip）の保存・読込・世代バックアップ・スキーマ検証、アプリ設定の永続化、出力PDF（注釈付きPDF）の原子的書き出し

**配置ファイル**:
- `ProjectStore.ts`: 保存・読込・自動保存・原子的書き込み
- `projectSchema.ts`: Zod スキーマ（project.json の検証）
- `backupRotation.ts`: .bak 3世代管理
- `AppSettingsStore.ts`: アプリ設定（楽譜由来データを含まない）
- `writeExportPdf.ts`: 注釈付きPDFの原子的書き出し（OverlayRenderer が生成したバイト列を IPCハンドラ経由で受け取る）

**依存関係**:
- 依存可能: `shared/`
- 依存禁止: `domain/`, `renderer/`, `main/`（呼び出される側に徹する）

### src/shared/

**役割**: 全レイヤーが参照する型定義・定数。**実装ロジックは置かない**

**配置ファイル**:
- `types/`: 機能設計書のエンティティ定義（`Project.ts`, `ScoreModel.ts`, `Annotation.ts`, `KeyRegion.ts` 等）
- `constants/`: 既定値（`DEFAULT_SETTINGS.ts` 等）
- `ipc/`: IPCチャネル名とペイロード型（Main/preload/Renderer で共有）

**ルール**: 本当に複数レイヤーで使うもののみ。単一レイヤー専用の型はそのレイヤー内に置く

### tests/ (テストディレクトリ)

#### unit/

**役割**: domain/・storage/ の純粋ロジックのユニットテスト

**構造**:
```
tests/unit/
├── domain/
│   └── solfa/
│       └── SolfaEngine.test.ts   # src と同構造をミラー
└── storage/
    └── backupRotation.test.ts    # storage も同様にミラー
```

**命名規則**: `[テスト対象ファイル名].test.ts`

#### integration/

**役割**: パイプライン全体の回帰テスト（アーキテクチャ設計書のテスト戦略に対応）

**構造**:
```
tests/integration/
├── pipeline/
│   └── victoria-regression.test.ts  # 784音・ミスマッチ0・skipped 5小節を期待値とする
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
└── victoria-o-magnum/
    ├── source.pdf         # IMSLP #19716（パブリックドメイン）
    ├── score.mxl          # Audiveris 出力（固定バージョンで生成）
    ├── score.omr
    └── expected/          # 期待値（annotations 等）
```

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
- `audiveris/`: Audiveris 一式（バージョン固定。更新は回帰手順必須）
- `jre/<platform>/`: OS別の同梱JRE
- `fonts/`: 階名描画用フォント（小サイズ判読性で選定したもの。再配布可能なライセンスに限る）

**注意**: 大容量バイナリ（Audiveris/JRE）はリポジトリにコミットせず、ビルド時ダウンロードスクリプト（`scripts/fetch-resources.ts`。取得先のバージョン・ハッシュ固定で再現性を担保）で取得する。Git LFS は採用しない（ストレージ・帯域の無料枠制約と clone コスト増を避ける）

**ライセンス表記**: 同梱物のライセンス全文と入手元をルートの `THIRD_PARTY_LICENSES.md` に集約し、配布物（インストーラ）にも同梱する。Audiveris は AGPL-3.0 のため、別プロセス実行（ファイルパス渡しのみ）の構成を維持したうえで、公開リリース前に同梱・再配布の条件を確認することを必須とする（JRE・フォントも同様に表記する）

### scripts/

**配置ファイル**:
- `fetch-resources.ts`: Audiveris/JRE の取得・配置（バージョン・ハッシュ固定）
- `generate-fixtures.ts`: フィクスチャの再生成（Audiveris 更新時のみ実行）

## ファイル配置規則

### ソースファイル

| ファイル種別 | 配置先 | 命名規則 | 例 |
|------------|--------|---------|-----|
| ドメインクラス | src/domain/[機能]/ | PascalCase | `SolfaEngine.ts` |
| 純関数・テーブル | src/domain/[機能]/ | camelCase | `placementResolver.ts` |
| 画面コンポーネント | src/renderer/screens/[画面名]/ | PascalCase | `Editor/AnnotationLayer.tsx` |
| IPCハンドラ | src/main/ipc/ | handle + 対象 + 動詞 | `handleProjectSave.ts` |
| 型定義 | src/shared/types/ | PascalCase | `KeyRegion.ts` |
| 定数 | src/shared/constants/ | UPPER_SNAKE_CASE | `DEFAULT_SETTINGS.ts` |

### テストファイル

| テスト種別 | 配置先 | 命名規則 | 例 |
|-----------|--------|---------|-----|
| ユニットテスト | tests/unit/（srcをミラー） | [対象].test.ts | `SolfaEngine.test.ts` |
| 統合テスト | tests/integration/[機能]/ | [シナリオ].test.ts | `victoria-regression.test.ts` |
| E2Eテスト | tests/e2e/[シナリオ]/ | [フロー].test.ts | `export-pdf.test.ts` |

### 設定ファイル

| ファイル種別 | 配置先 | 命名規則 |
|------------|--------|---------|
| ツール設定 | プロジェクトルート | `[ツール名].config.ts`（`vitest.config.ts` 等） |
| Prettier 設定 | プロジェクトルート | `.prettierrc`（JSON。ロジック不要のため dotfile 形式を採用） |
| Electron ビルド設定 | プロジェクトルート | `electron-builder.yml` |
| TypeScript 設定 | プロジェクトルート | `tsconfig.json`（＋プロセス別の `tsconfig.*.json`） |
| CI/CD ワークフロー | .github/workflows/ | `[目的].yml`（`ci.yml`, `release.yml`） |

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
    └── release.yml          # タグ作成時: fetch-resources.ts → electron-builder で3OSのインストーラを生成し GitHub Releases に添付
```

**注意**: ビルド成果物（インストーラ）はリポジトリにコミットせず、GitHub Releases で配布する。PR検証用の一時成果物は Actions アーティファクト（保持期限つき）を使う

## 除外設定

### .gitignore

- `node_modules/`
- `dist/` / `out/`（ビルド成果物）
- `resources/audiveris/` / `resources/jre/`（`scripts/fetch-resources.ts` で取得するためコミットしない）
- `*.log`
- `.DS_Store`
- `*.solfaproj` / `*.solfaproj.bak*`（手元の検証用プロジェクトファイル。著作権のある楽譜を含み得るため必ず除外）

### .prettierignore / ESLint ignore

- `dist/` / `out/`
- `node_modules/`
- `coverage/`
- `resources/`
- `tests/fixtures/`（生成物のため整形対象外）
