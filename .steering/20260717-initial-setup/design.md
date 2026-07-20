# 設計書

- 作業名: 20260717-initial-setup（初回実装: プロジェクト基盤 + SolfaEngine）
- 対応要求: [requirements.md](requirements.md)

## アーキテクチャ概要

アーキテクチャ設計書の4層構成（UI / 編成 / サービス / データ）のうち、今回は以下の骨格を作る。

```
src/
├── main/       # 編成レイヤー: エントリ + ウィンドウ生成（ハードニング済み）のみ
├── preload/    # contextBridge の骨格（公開APIは最小: アプリバージョン取得）
├── renderer/   # UIレイヤー: React + Home 画面スタブ
├── domain/
│   └── solfa/  # サービスレイヤー: SolfaEngine + syllableTables（純粋TS）
└── shared/
    ├── types/      # Pitch / SolfaDegree / KeyRegion / ScorePosition / ProjectSettings
    └── constants/  # DEFAULT_SETTINGS
```

- ビルドは **electron-vite**（main / preload / renderer の3ターゲットを単一設定で管理）
- Renderer は **React**。ユーザー確認済みの決定であり、architecture.md のフレームワーク表に追記する
- storage / main/ipc / domain/score 等は今回ディレクトリを作らない（空ディレクトリをコミットしない。必要になった作業単位で追加する）

## コンポーネント設計

### 1. プロジェクト基盤（設定ファイル群）

**責務**:

- TypeScript strict / ESLint / Prettier / Vitest / electron-vite / CI の一貫した設定

**実装の要点**:

- tsconfig はベース `tsconfig.json`（strict, noEmit, 共通オプション）+ `tsconfig.node.json`（main/preload/domain/shared/storage 用）+ `tsconfig.web.json`（renderer 用）の3枚構成（electron-vite の慣例に準拠）
- ESLint はフラット設定（`eslint.config.mjs`）。レイヤー境界は `no-restricted-imports` をレイヤーごとの files パターンで定義:
  - `src/domain/**`: `electron`, `node:*`, `../main/*`, `../renderer/*`, `../preload/*`, `../storage/*` を禁止
  - `src/renderer/**`: `electron`, `node:*`, `../main/*`, `../domain/*`, `../storage/*` を禁止（preload は `import type` のみ）
  - `src/storage/**`: `../domain/*`, `../renderer/*`, `../main/*` を禁止
  - 循環は `import/no-cycle`
- Prettier: 2スペース・100文字（開発ガイドライン準拠）。`.prettierrc`（JSON）
- バージョン方針（architecture.md 準拠）: electron はマイナー固定（`~`）、その他は `^`。`package-lock.json` をコミット

### 2. Electron 最小シェル

**責務**:

- アプリの起動・ウィンドウ生成・Renderer の読み込みだけを行う骨格

**実装の要点**:

- `src/main/index.ts`: BrowserWindow 生成。`webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload }` を明示。`shell.openExternal` は使わない
- `src/preload/index.ts` + `api.ts`: `contextBridge.exposeInMainWorld('solfaOverlay', api)`。公開APIは `getAppVersion(): Promise<string>` のみ（型付きIPCの配線パターンを確立するのが目的）
- IPCチャネル名は `src/shared/ipc/channels.ts` に定義（`app:getVersion`）
- `src/renderer/index.html`: `<meta http-equiv="Content-Security-Policy" content="default-src 'self'">`
- Home 画面はアプリ名とバージョン表示のみのスタブ（画面遷移図の `Home` に対応するディレクトリ `screens/Home/` を作る）

### 3. shared 型定義

**責務**:

- 機能設計書「データモデル定義」の TypeScript 化（今回は SolfaEngine が必要とする範囲）

**実装の要点**:

- 機能設計書のエンティティ定義を**そのまま**転記する（独自変更しない）: `Pitch`, `SolfaDegree`, `KeyRegion`, `ScorePosition`, `ProjectSettings`
- `DEFAULT_SETTINGS`: syllableSystem='kodaly', minorBasis='la', diatonicColor=濃赤(#8b0000), chromaticColor=紫(#6a0dad), fontFamily/fontSizePt は仮値（フォント選定は F-4 実装時）

### 4. SolfaEngine

**責務**:

- 調文脈と記譜音高から階名の内部表現（度数＋変位）を計算し、設定に応じて文字列化する

**実装の要点**（機能設計書「アルゴリズム設計 > 階名計算」と1:1対応）:

- `resolveDo(region, basis)`: major または do基準 → 主音。minor × la基準 → 平行長調の主音（主音の短3度上 = レター2つ上 + 半音3つ上として計算）
- `letterDistance(doStep, noteStep)`: `((stepIndex(note) - stepIndex(do) + 7) % 7) + 1`
- `expectedAlterInDoMajor(doPitch, degree)`: NATURAL_SEMITONES + MAJOR_SCALE_OFFSETS + signedDiff12 による期待変位
- `computeDegree(note, region, basis)`: 上記3つの合成
- `toSyllable(degree, settings)`: `syllableTables.ts` の表引き。表にないセル・±2以上の変位は「変位0の音節 + ♯/♭記号」でフォールバック（例: `do♯♯`）
- クラス `SolfaEngine` として公開しつつ、内部関数も named export してテスト可能にする
- 音楽理論上の前提（La基準の do = 平行長調の主音等）はコメントで根拠を残す（開発ガイドライン準拠）

## データフロー

### 階名計算（今回実装分）

```
1. KeyRegion + minorBasis → resolveDo → doPitch（step + alter）
2. doPitch.step と note.step のレター距離 → degree（1〜7）
3. note.alter - expectedAlterInDoMajor(doPitch, degree) → alteration
4. (表示時) SolfaDegree + ProjectSettings → syllableTables → 表示文字列
```

## エラーハンドリング戦略

### カスタムエラークラス

今回は不要（SolfaEngine は全域関数。不正な degree 等は型で防ぐ）。OmrExecutionError / ProjectFileError は該当コンポーネントの実装時に追加する。

### エラーハンドリングパターン

- `expectedAlterInDoMajor` の結果が ±2 を超える理論値になるケースは signedDiff12 の正規化で防ぐ
- 文字列化のフォールバックは例外ではなく通常経路として設計（機能設計書の決定事項）

## テスト戦略

### ユニットテスト（tests/unit/domain/solfa/）

- `SolfaEngine.test.ts`:
  - 全24調の `expectedAlterInDoMajor` を表駆動で検証（結果が各調の調号と一致する性質。機能設計書の検算規定）
  - `computeDegree`: 開発ガイドラインの例（ト長調F♮ → 7/-1、イ短調La基準C → 1/0）+ 長短×La/Do×臨時記号の代表ケース
  - La基準とDo基準の同一音に対する読み替え（イ短調の C/F/G: Do基準 me/le/te ⇔ La基準 do/fa/so）
- `syllableTables.test.ts`:
  - 機能設計書ステップ4の表の全セル（コダーイ式・Tonic sol-fa 略記の両列、変位 -1/0/+1）
  - コダーイ te ⇔ Tonic sol-fa ta の相違点を明示的に検証
  - フォールバック（±2、表に存在しない組合せ）

### 統合テスト

今回はなし（パイプライン回帰は ScoreModelBuilder 実装後に fixtures と併せて導入）。

## 依存ライブラリ

```json
{
  "dependencies": {
    "react": "^19",
    "react-dom": "^19"
  },
  "devDependencies": {
    "electron": "~<最新安定版>",
    "electron-vite": "^4",
    "vite": "^7",
    "typescript": "^5",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@vitejs/plugin-react": "^5",
    "vitest": "^3",
    "@vitest/coverage-v8": "^3",
    "eslint": "^9",
    "typescript-eslint": "^8",
    "eslint-plugin-import": "^2",
    "eslint-plugin-react-hooks": "^5",
    "prettier": "^3",
    "eslint-config-prettier": "^10"
  }
}
```

- pdf-lib / pdfjs-dist / fflate / zod は**今回追加しない**（使用しない依存を先行追加しない。該当コンポーネント実装時に追加）
- いずれもネットワークアクセスを行う実行時依存ではないこと（ローカル完結の担保）をインストール時に確認する

## ディレクトリ構造

```
追加されるファイル:
package.json / package-lock.json
tsconfig.json / tsconfig.node.json / tsconfig.web.json
electron.vite.config.ts
eslint.config.mjs
.prettierrc / .prettierignore
vitest.config.ts
.gitignore（更新）
.github/workflows/ci.yml
src/main/index.ts
src/preload/index.ts, api.ts
src/renderer/index.html, main.tsx, App.tsx, screens/Home/Home.tsx
src/shared/types/{Pitch,SolfaDegree,KeyRegion,ProjectSettings}.ts
src/shared/constants/DEFAULT_SETTINGS.ts
src/shared/ipc/channels.ts
src/domain/solfa/SolfaEngine.ts, syllableTables.ts
tests/unit/domain/solfa/SolfaEngine.test.ts, syllableTables.test.ts
README.md（更新）
docs/architecture.md（React + electron-vite の追記）
```

## 実装の順序

1. プロジェクト基盤（package.json → 依存インストール → 各設定ファイル → .gitignore）
2. shared 型定義・定数
3. domain/solfa（SolfaEngine + syllableTables）+ ユニットテスト ← 基盤検証を最短で回すため先行
4. Electron 最小シェル（main / preload / renderer）
5. CI ワークフロー
6. 品質チェック（test / lint / typecheck / build）
7. ドキュメント更新（architecture.md 追記・README・振り返り）

## セキュリティ考慮事項

- Electron ハードニング3点（nodeIntegration: false / contextIsolation: true / sandbox: true）を初回から設定し、以降変更しない
- Renderer の CSP は `default-src 'self'` で開始（緩和しない）
- ネットワークアクセスを行う実行時依存を追加しない（今回の依存はすべてビルド・開発ツールと React のみ）
- 開発コンテナのファイアウォール（.devcontainer/init-firewall.sh）により registry.npmjs.org 等のみ許可。Electron バイナリ取得等でブロックが発生した場合はユーザーにホワイトリスト追加を依頼する

## パフォーマンス考慮事項

- 今回のスコープに実行時パフォーマンス要件はない（SolfaEngine は O(1) の純関数群）
- 表引き（syllableTables）は Record によるルックアップで実装

## 将来の拡張性

- 音節体系の追加は syllableTables への表追加のみで対応（内部表現は不変。アーキテクチャ設計書の拡張方針）
- `SolfaEngine.computeDegrees(score, keyRegions)` は ScoreModel 実装後に追加（インターフェースは機能設計書で確定済み）
- storage / main/ipc のディレクトリと ESLint 境界ルールは、ProjectStore 実装時に同じパターンで拡張
