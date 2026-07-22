# タスクリスト

## 🚨 タスク完全完了の原則

**このファイルの全タスクが完了するまで作業を継続すること**

### 必須ルール

- **全てのタスクを`[x]`にすること**
- 「時間の都合により別タスクとして実施予定」は禁止
- 「実装が複雑すぎるため後回し」は禁止
- 未完了タスク（`[ ]`）を残したまま作業を終了しない

### タスクスキップが許可される唯一のケース

以下の技術的理由に該当する場合のみスキップ可能:

- 実装方針の変更により、機能自体が不要になった
- アーキテクチャ変更により、別の実装方法に置き換わった
- 依存関係の変更により、タスクが実行不可能になった

スキップ時は必ず理由を明記:

```markdown
- [x] ~~タスク名~~（実装方針変更により不要: 具体的な技術的理由）
```

---

## フェーズ1: 依存追加と下地整備

- [x] `electron-builder` を devDependency に追加（`npm install -D electron-builder`）
- [x] `tsx` を devDependency に追加（`.ts` スクリプト実行用）
- [x] `package.json` に scripts を追加
  - [x] `fetch-resources`: `tsx scripts/fetch-resources.ts`
  - [x] `dist:win`: `npm run build && electron-builder --win`
- [x] `tsconfig.node.json` の include に `scripts/**/*` を追加（型検査対象へ）
- [x] `.gitignore` に `resources/.cache/` を追加（MSI キャッシュ）
- [x] lint/typecheck が壊れていないことを確認（下地のみで）

## フェーズ2: 実行時パス解決とOmrRunner結線

- [x] `src/main/omr/resolveBundledAudiverisPath.ts` を作成（純粋関数）
  - [x] シグネチャ `{ isPackaged, resourcesPath, platform } → string | undefined`
  - [x] 非パッケージ → `undefined`
  - [x] パッケージ＋win32 → `<resourcesPath>/audiveris/win/Audiveris.exe`
  - [x] その他 platform → `undefined`（Windows のみ配布のコメント）
- [x] `tests/unit/main/omr/resolveBundledAudiverisPath.test.ts` を作成
  - [x] 3 ケース（非パッケージ / win32 / 非対象 platform）を検証
- [x] `src/main/index.ts` を変更し、同梱パス付き `OmrRunner` を `ProjectSession` へ注入
  - [x] `resolveBundledAudiverisPath` と `OmrRunner` を import
  - [x] `new ProjectSession({ runner })`（パスがあれば注入・無ければ undefined）

## フェーズ3: 同梱リソース取得スクリプト

- [x] `scripts/fetch-resources.ts` を作成
  - [x] 定数（version / asset / URL / SHA-256）を固定
  - [x] `node:https` でダウンロード（リダイレクト追従）＋`resources/.cache/` キャッシュ
  - [x] `node:crypto` で SHA-256 検証（不一致は中断）
  - [x] 展開: Windows は `msiexec /a`、Linux/mac は `msiextract`（無ければ案内して中断）
  - [x] app-image から `Audiveris.exe` を探し `resources/audiveris/win/` へ複製
  - [x] 冪等（既存ならスキップ）＋`--force` オプション
- [x] コンテナ内で DL＋SHA-256 検証部を実証（展開はツール不在で中断する挙動を確認。DL＋SHA-256 OK・キャッシュ再利用 OK・展開はツール不在で exit 1 中断を確認）

## フェーズ4: パッケージング・CI設定

- [x] `electron-builder.yml` を作成
  - [x] `appId`/`productName`/`directories.output`
  - [x] `files`（既定包含＋dev用除外・`resources/**` は asar 二重同梱回避で除外）
  - [x] `extraResources`（`resources/audiveris/win` → `audiveris/win`、`THIRD_PARTY_LICENSES.md`）
  - [x] `win.target: [nsis]`（未署名）＋`nsis` 設定
- [x] `.github/workflows/release.yml` を作成（`windows-latest`・タグ契機・fetch→build→builder）

## フェーズ5: ライセンス・README

- [x] `THIRD_PARTY_LICENSES.md` を作成
  - [x] Audiveris（AGPL-3.0）表記・対応ソース・アームズレングス実行
  - [x] 同梱 JRE（OpenJDK / GPLv2+Classpath Exception）表記
  - [x] mere aggregation の明示＋アプリ本体ライセンスは公開前確定の TODO
- [x] `README.md` を更新
  - [x] Windows ビルド手順（fetch-resources → dist:win）
  - [x] SmartScreen 突破手順（`[詳細情報]→[実行]`・未署名の理由）

## フェーズ6: 品質チェックと修正

- [x] すべてのテストが通ることを確認
  - [x] `npm test`（45ファイル・767テスト green。新規 resolveBundledAudiverisPath 3件含む）
- [x] リントエラーがないことを確認
  - [x] `npm run lint`（エラーなし）
- [x] 型エラーがないことを確認
  - [x] `npm run typecheck`（エラーなし）
- [x] ビルドが成功することを確認
  - [x] `npm run build`（成功）

## フェーズ7: ドキュメント更新・振り返り

- [x] `README.md` の実装状況チェックリストを更新（配布ビルド着手を反映）
- [x] `docs/repository-structure.md` に本作業で確定した事実（Windows MSI 同梱・JRE 二重同梱回避・`.cache`・release.yml の現状スコープ）を反映＋`docs/ideas/audiveris-bundling-license.md` のステータスを実装済みへ更新＋（検証指摘を受け）`docs/architecture.md` にも現状スコープを注記
- [x] 実装後の振り返り（このファイルの下部に記録）

## フェーズ8: 実装検証の指摘対応（implementation-validator）

- [x] 問題1（推奨）: `electron-builder.yml` の `files` 除外に `THIRD_PARTY_LICENSES.md` を追加（extraResources との二重同梱を回避）
- [x] 問題2（推奨）: `scripts/fetch-resources.ts` の純粋ロジックにテスト追加
  - [x] `sha256` / `findDirContaining` を export＋直接起動ガード（import.meta.url 判定）で import 時に main を走らせない
  - [x] `tests/unit/scripts/fetch-resources.test.ts`（4ケース）を追加
- [x] 提案1（低）: 冪等判定を `.fetch-complete` マーカーへ変更（コピー中断時の壊れた配置の誤認を防止）
- [x] 提案2（低）: `docs/architecture.md:37` に「現状 Windows のみ実装」を注記

---

## 実装後の振り返り

### 実装完了日

2026-07-22

### 計画と実績の差分

**計画と異なった点**:

- Windows Audiveris の配布物は `.msi`（jpackage 製）だった。Linux の `.deb`（`dpkg-deb -x` で展開）と異なり、展開に `msiexec /a`（Windows）または `msiextract`（msitools）が必要。本 devcontainer は firewall で apt が使えず msitools を導入できないため、**コンテナでは展開まで到達しない**（ダウンロード＋SHA-256 検証までを実証し、展開は Windows 実機／CI に委ねる設計に確定）。
- `.ts` スクリプト（repository-structure が規定）を実行するため `tsx` を devDependency に追加した（当初計画どおり）。
- 実装検証（implementation-validator）の指摘を受け、フェーズ8として 4 点を追加対応（`THIRD_PARTY_LICENSES.md` の二重同梱回避・fetch-resources 純粋ロジックのテスト化・冪等マーカー・architecture.md 注記）。

**新たに必要になったタスク**:

- `scripts/fetch-resources.ts` の直接起動ガード（`import.meta.url` 判定）。テストから import しても `main()`（＝ダウンロード）が走らないようにするため、テスト追加とセットで必要になった。
- `.gitignore` / repository-structure への `resources/.cache/`（MSI キャッシュ）の追記。

**技術的理由でスキップしたタスク**:

- なし（全タスク完了）。ただし「electron-builder による実 `.exe` 生成」と「MSI の実展開」は、Linux コンテナでは wine/msitools 不在のため**実行不能**であり、design.md の時点でスコープ外（Windows 実機／CI 委譲）と明記済み。回避ではなく前提。

### 学んだこと

**技術的な学び**:

- Audiveris 5.6.1 の Windows 配布は `Audiveris-5.6.1-windows-x86_64.msi`（SHA-256: `92ef67ba…ec687`、約66MB）。jpackage app-image はランチャ `Audiveris.exe` を app root 直下に置き、`app/`（jar）と `runtime/`（同梱 OpenJDK21）が同階層。Linux `.deb` の `bin/Audiveris` とレイアウトが異なる。
- Windows MSI は JRE を内包するため、`resources/jre/` の別立ては不要（二重同梱回避）。`resources/audiveris/win/runtime/` をそのまま使う。
- 前作業（20260721）の申し送りどおり、`OmrRunner` の `audiverisPath` DI と `AudiverisNotFoundError` をそのまま再利用でき、`app.isPackaged` 分岐（`resolveBundledAudiverisPath`）を純粋関数で足すだけで差分が最小になった。
- electron-builder の `files` は既定で `**/*` を包含するため、`resources/**` を除外しないと extraResources と asar で二重同梱になる。`THIRD_PARTY_LICENSES.md` も同様（検証で発見）。
- devcontainer の firewall は GitHub と npm registry を許可（GitHub Releases の DL 実行時 OK）。apt ミラーは不許可。

**プロセス上の改善点**:

- 「配布物への同梱」と「開発時のエンジン供給」を別レイヤーとして requirements で切り分ける前作業の方針を踏襲し、既存 docs と矛盾なく追加できた。
- 設計前に GitHub API で実アセット名・MSI の SHA-256・展開レイアウトを調べたことで、`.deb` と `.msi` の差（展開手段）を計画段階で織り込めた。
- implementation-validator の指摘（二重同梱・テスト不足）は妥当で、フェーズ8として即対応できた。純粋ロジックの export＋実行ガードはテスト容易性の定石。

### 次回への改善提案

- **Windows 実機での実ビルド検証が残タスク**: `npm run fetch-resources` → `npm run dist:win` を通し、(1) MSI 展開が想定レイアウト（`Audiveris.exe`＋`runtime/`）で成立するか、(2) 生成 `.exe` サイズが architecture の 800MB 目標内か、(3) SmartScreen 手順（[詳細情報]→[実行]）の実地、(4) パッケージ実行で同梱 Audiveris が起動し OMR が通るか、を確認する。想定と MSI レイアウトがずれた場合は `LAUNCHER_NAME`／`extraResources` の `from`／`resolveBundledAudiverisPath` の 3 点を合わせて調整する。
- mac/linux 配布を足すときは `resolveBundledAudiverisPath` の platform 分岐＋`fetch-resources` の OS 別アセット・展開手段＋electron-builder のターゲット追加で拡張（`resources/audiveris/<platform>/` の構造を先取り済み）。
- 署名導入時は electron-builder の win 署名設定（Azure Trusted Signing 等）を後付け（壁打ちメモ 5.5）。
