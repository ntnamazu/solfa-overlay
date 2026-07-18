# 要求内容

- 作成日: 2026-07-17
- 作業名: 20260717-initial-setup（初回実装: プロジェクト基盤 + SolfaEngine）

## 概要

空のリポジトリ（ドキュメントのみ）に対し、Electron + TypeScript プロジェクトの基盤一式を構築し、最初のドメインコンポーネントとして SolfaEngine（階名計算コア）を表駆動ユニットテスト付きで実装する。

## 背景

永続ドキュメント6点（PRD / 機能設計書 / アーキテクチャ設計書 / リポジトリ構造定義書 / 開発ガイドライン / 用語集）が承認済みとなり、実装フェーズに入る。最初の作業として、以降のすべての機能実装の土台となるプロジェクト基盤と、外部依存ゼロで検証可能な純粋ドメインロジック（SolfaEngine）を選定した。

ユーザーとの確認により以下を決定済み:

- **スコープ**: 基盤 + SolfaEngine（ScoreModelBuilder 等の他ドメインは次回以降）
- **UIスタック**: React + electron-vite（決定に伴い architecture.md へ追記する）

## 実装対象の機能

### 1. プロジェクト基盤

- package.json（dev / build / test / lint / typecheck / format スクリプト）と依存一式
- TypeScript strict 設定（プロセス別 tsconfig）、electron-vite ビルド設定
- ESLint（フラット設定。レイヤー境界の `no-restricted-imports` と `import/no-cycle` を機械的に強制）+ Prettier
- Vitest 設定（tests/unit・tests/integration を対象）
- .gitignore の整備（dist / out / .steering / resources 同梱物 / *.solfaproj 等）
- CI ワークフロー（.github/workflows/ci.yml: lint → typecheck → test）

### 2. Electron 最小シェル

- Main プロセス（ハードニング設定: `nodeIntegration: false` / `contextIsolation: true` / `sandbox: true`）
- preload（contextBridge による型付きAPIの骨格）
- Renderer（React。CSP `default-src 'self'`、Home 画面のスタブ）

### 3. shared 型定義・定数

- 機能設計書のエンティティ定義のうち、SolfaEngine が必要とする型: `Pitch`, `SolfaDegree`, `KeyRegion`, `ScorePosition`, `ProjectSettings`
- `DEFAULT_SETTINGS`（コダーイ式 / La基準 / 濃赤・紫）

### 4. SolfaEngine（階名計算コア）

- `computeDegree`: 調文脈 + 記譜音高 → 度数＋変位（機能設計書のステップ1〜3）
- `toSyllable`: 度数＋変位 + 設定 → 表示文字列（コダーイ式 / Tonic sol-fa 略記の全表 + フォールバック）
- `syllableTables.ts` に文字列化表を分離

## 受け入れ条件

### プロジェクト基盤

- [ ] `npm run lint` / `npm run typecheck` / `npm run test` / `npm run build` がすべて成功する
- [ ] ESLint がレイヤー境界違反（例: domain → storage の import）を検出できる
- [ ] TypeScript は strict モードで、`any` を使用していない

### Electron 最小シェル

- [ ] `npm run build` で main / preload / renderer の3バンドルが生成される
- [ ] Main のウィンドウ生成コードにハードニング3点（nodeIntegration/contextIsolation/sandbox）が明示されている
- [ ] Renderer の index.html に CSP（`default-src 'self'`）が設定されている

### SolfaEngine

- [ ] 全24調（長調12・短調12 × 実用的な異名同音）について、`expectedAlterInDoMajor` が調号と一致することを表駆動テストで検証している
- [ ] 長調 / 短調 × La基準 / Do基準の組合せで正しい度数＋変位を返す（例: ト長調のF♮ → {degree: 7, alteration: -1}、イ短調La基準のC → {degree: 1, alteration: 0}）
- [ ] コダーイ式・Tonic sol-fa 略記の文字列化表（機能設計書ステップ4の表）を全セル網羅でテストしている
- [ ] 表にない変位（重変化等）は変位記号付き文字列でフォールバック表示される
- [ ] ユニットテストのカバレッジが solfa コアロジックで90%以上

## 成功指標

- 次回以降の機能実装（ScoreModelBuilder / 確認画面UI 等）が、この基盤の上に追加のセットアップなしで着手できる状態になること
- SolfaEngine が機能設計書のアルゴリズム定義と1:1で対応し、テストで裏付けられていること

## スコープ外

以下はこのフェーズでは実装しません:

- OmrRunner / Audiveris 統合（同梱リソース取得スクリプト含む）
- MusicXML / .omr パーサ、ScoreModelBuilder、BookStructureResolver
- AnnotationManager / OverlayRenderer / ProjectStore / writeExportPdf
- 確認画面・Editor 等の実UI（Home スタブのみ）
- `SolfaEngine.computeDegrees(score, keyRegions)`（ScoreModel 型が未実装のため。`computeDegree` 単音版と `toSyllable` までを実装）
- E2Eテスト（Playwright）と release.yml
- 楽譜由来データを扱う処理全般

## 参照ドキュメント

- `docs/product-requirements.md` - F-3（移動ド階名の計算）
- `docs/functional-design.md` - アルゴリズム設計「階名計算」・データモデル定義
- `docs/architecture.md` - テクノロジースタック・プロセス構成・依存方向
- `docs/repository-structure.md` - ディレクトリ構造・命名規則・除外設定
- `docs/development-guidelines.md` - コーディング規約・テスト戦略
- `docs/glossary.md` - 用語の英語表記
