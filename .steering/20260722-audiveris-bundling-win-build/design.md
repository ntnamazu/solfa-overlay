# 設計書

## アーキテクチャ概要

「配布物への同梱」と「開発時のエンジン供給」を別レイヤーとして扱う（前作業 20260721 の方針を踏襲）。本作業は**配布レイヤー**を新設する。実行モデル（別プロセス起動＋ファイルパス渡し）は不変で、これは AGPL-3.0 のライセンス独立性（mere aggregation）を守る布石でもある。

```
[ビルド時]
  scripts/fetch-resources.ts
    ├─ DL: Audiveris-5.6.1-windows-x86_64.msi（URL固定）
    ├─ verify: SHA-256（92ef67ba…ec687）
    └─ extract: MSI → resources/audiveris/win/（Audiveris.exe + app/ + runtime/=JRE21）
          │
          ▼
  electron-builder（electron-builder.yml, Windows/win 実機 or CI）
    ├─ files: out/**（electron-vite build 済み）
    ├─ extraResources: resources/audiveris/win → <app>/resources/audiveris/win
    └─ target: nsis（未署名）→ dist/*.exe

[実行時]
  app.isPackaged?
    ├─ true（Windows）: process.resourcesPath/audiveris/win/Audiveris.exe を解決
    │                     → new OmrRunner({ audiverisPath })
    └─ false（開発）:    undefined → OmrRunner 既定チェーン
                          （SOLFA_AUDIVERIS_PATH → PATH の audiveris）
```

## コンポーネント設計

### 1. `scripts/fetch-resources.ts`（同梱リソース取得）

**責務**:

- Audiveris Windows MSI をバージョン・SHA-256 固定で取得・検証する。
- MSI を展開し、app-image を `resources/audiveris/win/` へ配置する。

**実装の要点**:

- 定数: `AUDIVERIS_VERSION=5.6.1`、`ASSET='Audiveris-5.6.1-windows-x86_64.msi'`、`URL`（GitHub Releases）、`SHA256='92ef67bafc99fef922b4115af726f09ae8ab8e66305570573e4a2a36096ec687'`。Dockerfile の `.deb` 固定と同じ思想（architecture の「audiveris は完全固定」）。
- ダウンロードは `node:https`（リダイレクト追従）。検証は `node:crypto` の sha256。ネット取得は GitHub 許可済み（devcontainer firewall）。
- 展開はプラットフォーム依存:
  - Windows: `msiexec /a "<msi>" /qn TARGETDIR="<absExtractDir>"`（管理インストール抽出。管理者権限不要）。抽出ツリーから `Audiveris.exe` を再帰探索し、その親（app root）の中身を `resources/audiveris/win/` へ複製する。
  - Linux/macOS: `msiextract`（msitools）があれば使用。無ければ**明確なエラー**（「Windows で実行するか msitools を導入」）で中断。本 devcontainer は msitools を導入できないため、コンテナでは展開まで到達しない（ダウンロード＋検証までは実証可能）。
- 冪等: `resources/audiveris/win/Audiveris.exe` が既にあればスキップ。`--force` で無視して再取得。
- キャッシュ: MSI は `resources/.cache/`（gitignore 対象）に置き、ハッシュ一致なら再ダウンロードしない。
- **純粋 I/O スクリプト**。ロジックは最小限で、副作用（DL・展開・複製）に徹する。tsx で実行。

### 2. `src/main/omr/resolveBundledAudiverisPath.ts`（実行時パス解決・純粋関数）

**責務**:

- パッケージ状態・resourcesPath・platform から同梱 Audiveris 実行ファイルの絶対パスを決める。

**実装の要点**:

- シグネチャ: `resolveBundledAudiverisPath(opts: { isPackaged: boolean; resourcesPath: string; platform: NodeJS.Platform }): string | undefined`。
- `isPackaged=false` → `undefined`（開発時は OmrRunner の既定チェーンに委ねる）。
- `isPackaged=true` かつ `platform==='win32'` → `join(resourcesPath, 'audiveris', 'win', 'Audiveris.exe')`。
- その他 platform（本フェーズでは配布対象外）→ `undefined`（将来 mac/linux 対応時に分岐追加）。コメントで「Windows のみ配布」を明記。
- Electron を import しない（`node:path` のみ）。node テストプロジェクトで単体テスト可能。

### 3. `src/main/index.ts`（結線）

**責務**:

- 起動時に同梱パスを解決し、`ProjectSession` へ同梱パス付き `OmrRunner` を注入する。

**実装の要点**:

- `resolveBundledAudiverisPath({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, platform: process.platform })` を算出。
- 値があれば `new OmrRunner({ audiverisPath })`、無ければ `undefined` を `new ProjectSession({ runner })` に渡す（`ProjectSession` は `deps?.runner ?? new OmrRunner()` なので undefined でも既存動作）。
- モジュールスコープの `const session` 生成箇所を差し替える。既存の `before-quit` フラッシュ等はそのまま。

### 4. `electron-builder.yml`（パッケージング設定）

**責務**: Windows NSIS インストーラ（未署名）を生成し、Audiveris ＋ライセンスを同梱する。

**実装の要点**:

- `appId` / `productName`（Solfa Overlay）。`directories.output: dist`。
- `files`: `out/**/*`、`package.json`。
- `extraResources`: `from: resources/audiveris/win` → `to: audiveris/win`（解決パスと一致）。`THIRD_PARTY_LICENSES.md` も `to: .` で同梱。
- `win.target: [nsis]`。署名設定は書かない（未署名）。
- `nsis`: `oneClick: false` / `allowToChangeInstallationDirectory: true`（インストール先変更可）。
- アイコンは未指定（既定の Electron アイコン。専用アセットは今フェーズ対象外）。

### 5. `THIRD_PARTY_LICENSES.md`（ライセンス表記）

**責務**: 同梱物のライセンス・入手元・対応ソース・集積の意図を明示する。

**実装の要点**:

- Audiveris 5.6.1（AGPL-3.0）: upstream 固定版ソースへのリンク（無改変・別バイナリ・アームズレングス実行）。
- 同梱ランタイム（jpackage が同梱する OpenJDK 21）: GPLv2 + Classpath Exception。
- アプリ本体との関係（mere aggregation：別プロセス・ファイルパス渡し・リンクなし）を明示。
- アプリ本体のライセンス確定は公開前の別判断（TODO として明記）。

### 6. `.github/workflows/release.yml`（Windows リリースビルド）

**責務**: タグ作成時に Windows インストーラを生成し、GitHub Releases に添付する。

**実装の要点**:

- `on: push: tags: ['v*']`。`runs-on: windows-latest`。
- `npm ci` → `npm run fetch-resources`（MSI DL＋展開）→ `npm run build` → `electron-builder --win --publish onTagOrDraft`（or artifact upload）。
- Windows ランナーなら `msiexec /a` が使えるため、fetch-resources の展開が成立する。

## データフロー

### 配布ビルド（Windows 実機／CI）

```
1. npm ci
2. npm run fetch-resources
   → MSI を DL・SHA-256 検証 → msiexec /a で展開 → resources/audiveris/win/ 配置
3. npm run dist:win（= npm run build && electron-builder --win）
   → out/ を electron-vite build → NSIS で resources 同梱の未署名インストーラを dist/ に生成
4. 配布（GitHub Releases 等）。ユーザーは SmartScreen を [詳細情報]→[実行] で突破して導入
```

### パッケージ実行時の Audiveris 起動

```
1. app 起動 → resolveBundledAudiverisPath で resourcesPath/audiveris/win/Audiveris.exe を解決
2. new OmrRunner({ audiverisPath }) を ProjectSession に注入
3. OMR 実行時、同梱 Audiveris.exe を spawn（既存の実行モデルのまま。同梱 JRE21 で headless）
```

## エラーハンドリング戦略

### カスタムエラークラス

- 新規は作らない。`OmrRunner` の既存 `AudiverisNotFoundError`（ENOENT 分岐）が、万一同梱パスが欠落した場合の案内をそのまま担う。
- `fetch-resources.ts` は通常の `Error` で失敗（SHA-256 不一致・展開ツール不在・app-image 未検出）を throw し、CLI として非 0 終了する。

### エラーハンドリングパターン

- SHA-256 不一致は**即中断**（改ざん・取り違えの検知）。ダウンロード済み一時ファイルは破棄。
- 展開ツール不在（Linux/msitools なし）は、対処法を含むメッセージで中断。

## テスト戦略

### ユニットテスト

- `tests/unit/main/omr/resolveBundledAudiverisPath.test.ts`:
  - 非パッケージ → `undefined`
  - パッケージ＋win32 → `<resourcesPath>/audiveris/win/Audiveris.exe`
  - パッケージ＋darwin/linux → `undefined`（配布対象外）

### 統合テスト

- 新規の自動統合テストは追加しない（electron-builder の実ビルド・MSI 展開は Linux コンテナで実行不能。実ビルド検証は Windows 実機に委ねる）。
- 代替として fetch-resources の**ダウンロード＋SHA-256 検証**をコンテナ内で 1 回実証する（手動確認）。

## 依存ライブラリ

```json
{
  "devDependencies": {
    "electron-builder": "^26",
    "tsx": "^4"
  }
}
```

- `electron-builder`: Windows NSIS パッケージング（architecture 記載のパッケージャ）。
- `tsx`: `.ts` スクリプト（`fetch-resources.ts`）の実行ランナー（repository-structure が `.ts` を規定するため）。

## ディレクトリ構造

```
project-root/
├── scripts/
│   └── fetch-resources.ts        # 新規: Audiveris(win) 取得・展開
├── src/main/
│   ├── index.ts                  # 変更: 同梱パス解決を結線
│   └── omr/
│       └── resolveBundledAudiverisPath.ts  # 新規: 純粋なパス解決
├── tests/unit/main/omr/
│   └── resolveBundledAudiverisPath.test.ts # 新規
├── resources/                    # 生成物は gitignore（audiveris/win, .cache）
├── .github/workflows/
│   └── release.yml               # 新規: Windows リリースビルド
├── electron-builder.yml          # 新規: パッケージング設定
├── THIRD_PARTY_LICENSES.md       # 新規: 同梱物ライセンス
├── package.json                  # 変更: scripts / devDependencies
├── tsconfig.node.json            # 変更: scripts/**/* を型検査対象へ
├── .gitignore                    # 変更: resources/.cache/ を追加
└── README.md                     # 変更: ビルド手順 / SmartScreen
```

## 実装の順序

1. 依存追加（electron-builder / tsx）と package.json スクリプト・tsconfig・gitignore の下地。
2. `resolveBundledAudiverisPath.ts` ＋テスト、`index.ts` 結線。
3. `scripts/fetch-resources.ts`。
4. `electron-builder.yml` / `release.yml`。
5. `THIRD_PARTY_LICENSES.md` / README。
6. 品質チェック（test / lint / typecheck / build）＋ fetch-resources の DL 検証実証。
7. ドキュメント更新（実装状況・architecture 申し送り）と振り返り。

## セキュリティ考慮事項

- 取得物は**バージョン・SHA-256 固定**で改ざん検知（供給網リスクの低減）。取得元は GitHub Releases のみ。
- 実行モデルは引数配列 spawn のまま（シェル連結なし）。同梱後もこの境界を崩さない。
- 楽譜由来データの外部送信禁止に抵触しない（fetch-resources はビルド時のみ・楽譜を扱わない）。

## パフォーマンス考慮事項

- 同梱サイズ: Audiveris＋JRE で数百 MB。Electron と合わせても architecture の 800MB 目標内を想定（実測はユーザーの Windows ビルドで確認）。
- MSI は `resources/.cache/` にキャッシュし、再ビルド時の再ダウンロードを避ける。

## セキュリティ・ライセンス上の遵守（AGPL-3.0）

- 無改変・別バイナリ・アームズレングス実行（ファイルパス渡し）を維持（結合著作物化の回避）。
- AGPL-3.0 表記・対応ソース・mere aggregation を `THIRD_PARTY_LICENSES.md` に集約し配布物へ同梱。

## 将来の拡張性

- mac/linux 配布を将来追加する場合: `resolveBundledAudiverisPath` に platform 分岐を足し、`fetch-resources` に OS 別アセット（.dmg/.deb）と展開手段を追加、electron-builder に mac/linux ターゲットを足すだけで拡張できる（`resources/audiveris/<platform>/` の構造を先取りしている）。
- 署名導入時: electron-builder の win 署名設定（Azure Trusted Signing 等）を後付けする（壁打ちメモ 5.5 の手順）。
