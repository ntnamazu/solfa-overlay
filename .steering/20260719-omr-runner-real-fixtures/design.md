# 設計書

## アーキテクチャ概要

OmrRunner を「**純粋ロジック（テスト容易）**」と「**副作用（子プロセス・ファイル I/O）**」に分離する。
副作用の中核である Audiveris 起動は関数として **DI（差し替え可能）** にし、コンテナ内でも周辺ロジック
全体を自動テストできるようにする。

```
src/main/omr/
  OmrRunner.ts        … オーケストレーション（run/cancel）。spawner を DI で受け取る（副作用の入口）
  audiverisCommand.ts … 純粋: buildAudiverisArgs / buildAudiverisEnv / parseProgressLine
  omrArchive.ts       … 純粋: unzipEntries（fflate＋パストラバーサル防御）/ assembleArtifacts
  errors.ts           … OmrRunError / OmrArchiveError（予期されるエラー）

src/shared/types/
  OmrProgress.ts      … 進捗イベント型（Main→Renderer 共有を見据え shared に置く）

処理の流れ:
  run(pdf, onProgress)
    └─ spawn(audiveris, buildAudiverisArgs(pdf, outDir), { env })   ← DI された spawner
         stdout 行 → parseProgressLine → onProgress(OmrProgress)
       close(code=0)
         └─ 出力ディレクトリから .omr / .mxl を収集 → readFile(bytes)
              └─ assembleArtifacts({ omr, movements }) → OmrArtifacts
                   └─ unzipEntries → parseBookXml / parseSheetXml / parseMusicXml（既存 domain パーサ）
```

## コンポーネント設計

### 1. omrArchive.ts（純粋・zip 展開と成果物組み立て）

**責務**:

- `unzipEntries(bytes: Uint8Array): Map<string, Uint8Array>` — fflate の `unzipSync` で展開。
  エントリ名を正規化し、絶対パス・`..` セグメントを含むものは `OmrArchiveError` で拒否（パストラバーサル防御）。
- `assembleArtifacts(input: { omr: Uint8Array; movements: Uint8Array[] }): OmrArtifacts`
  - `.omr` を展開し `book.xml`（存在すれば movement 順の材料）と `sheet#N/sheet#N.xml` を抽出。
    sheet 番号昇順・ファイル内ページ順に `parseSheetXml` してページ列（`OmrPageContent[]`）を連結。
  - 各 `.mxl`（movement 順）を展開し、`META-INF` 以外の `.xml`（container.xml が指す rootfile、無ければ
    最初の非 META XML）を `parseMusicXml` して `movements[].musicXml` を構築。

**実装の要点**:

- fflate（`unzipSync`）は純 JS で Node/ブラウザ非依存 → domain 層と同じ純粋性を保てる（fs・child_process 不使用）。
- `.mxl` は OPC（zip）で、`META-INF/container.xml` の `<rootfile full-path=...>` が本体 XML を指す。
  container を優先し、無ければ `META-INF` を除く最初の `.xml` にフォールバック（プロトタイプと同方針）。
- テキスト復号は UTF-8（`TextDecoder`）。BOM は除去する。

### 2. audiverisCommand.ts（純粋・コマンドと進捗）

**責務**:

- `buildAudiverisArgs(pdfPath, outputDir): string[]` —
  `['-batch', '-save', '-export', '-output', outputDir, '--', pdfPath]`（引数配列。文字列連結しない）。
- `buildAudiverisEnv(platform, base): NodeJS.ProcessEnv` — ヘッドレス実行のための環境変数を付与
  （`JAVA_TOOL_OPTIONS` に `-Djava.awt.headless=true`、Linux では `GDK_SCALE=1`）。
- `parseProgressLine(line): OmrProgress | null` — Audiveris のログ行から phase と sheet 番号を抽出。

**実装の要点**:

- 進捗パターンは Audiveris のログ書式に依存する。**実 Audiveris のログを取得してフィクスチャ化**し、
  そのサンプル行でパーサを回帰する（取得できない行は現状 null 返し＝進捗欠落に留め、クラッシュさせない）。
- `-save` は `.omr`（book）保存、`-export` は MusicXML 書き出し。両方指定で本設計の 2 出力が揃う。

### 3. OmrRunner.ts（オーケストレーション・副作用の入口）

**責務**:

- `constructor(deps?: { spawn?: SpawnFn; audiverisPath?: string })` — spawn を DI（既定は node:child_process の spawn）。
- `run(pdfPath, onProgress): Promise<OmrArtifacts>` — 一時出力ディレクトリを作成し Audiveris を起動、
  stdout を行分割して `parseProgressLine`→`onProgress`、正常終了後に出力を読み `assembleArtifacts`。
- `cancel(): void` — 実行中の子プロセスへ kill。`run()` は「キャンセル」で拒否する。

**実装の要点**:

- 出力先は OS の一時ディレクトリ配下（`fs.mkdtemp`）。処理後にクリーンアップ。
- 非ゼロ終了・spawn の `error` イベント・出力ファイル欠落はすべて `OmrRunError` に正規化して reject
  （機能設計書「部分失敗は全体を失敗にしない」＝例外ではなく予期されるエラーとして扱う）。
- `SpawnFn` は node:child_process の `spawn` シグネチャの最小部分型として定義し、テストで擬似プロセス
  （EventEmitter＋stdout ストリーム）を注入して close/error/キャンセルを検証する。

## データフロー

### run（正常系）

```
1. mkdtemp(outputDir)
2. spawn(audiverisPath, buildAudiverisArgs(pdf, outputDir), { env: buildAudiverisEnv(...) })
3. child.stdout を行単位で購読 → parseProgressLine → onProgress
4. 'close'(code=0)
5. outputDir を走査し <name>.omr と <name>[.mvtN].mxl を収集（mvt 昇順）
6. readFile → assembleArtifacts({ omr, movements }) → OmrArtifacts を resolve
7. finally: outputDir を削除
```

### 実データ回帰（テスト）

```
1. tests/fixtures/victoria/ の .omr / .mxl バイト列を読む
2. assembleArtifacts → OmrArtifacts
3. resolveStructure 相当で ResolvedStructure を与える
4. ScoreModelBuilder().build → matched / skipped / issues を固定値で assert
```

## エラーハンドリング戦略

### カスタムエラークラス（src/main/omr/errors.ts）

- `OmrRunError`（Audiveris 起動・実行・出力収集の失敗。`cause` を保持）
- `OmrArchiveError`（zip 展開失敗・パストラバーサル・必須エントリ欠落）

いずれも「予期されるエラー」。上位（IPC ハンドラ, Phase 4）が捕捉して UI エラーへ変換する前提。
domain の `ScoreParseError` は assembleArtifacts 内のパースで送出され得るため、そのまま伝播させる。

## テスト戦略

### ユニットテスト（tests/unit/main/omr/）

- `audiverisCommand.test.ts`: 引数配列の形・env のヘッドレス設定・進捗パース（代表ログ行→OmrProgress、
  無関係行→null）
- `omrArchive.test.ts`: 手製の最小 zip（fflate `zipSync`）で unzipEntries を検証、`../` エントリの拒否、
  assembleArtifacts が book/sheet/mxl から OmrArtifacts を組む（合成データ）
- `OmrRunner.test.ts`: 擬似 spawner で正常終了→artifacts 解決、非ゼロ終了→OmrRunError、
  spawn error→OmrRunError、cancel→kill 呼び出しと拒否、stdout 行→onProgress 通知

### 統合テスト（tests/integration/pipeline/）

- `victoria-regression.test.ts`: 実 `.omr`/`.mxl` → assembleArtifacts → ScoreModelBuilder で
  matched/skipped/issue を固定値回帰（実測値ベース）
- `divisi-regression.test.ts`: 実 `.omr`/`.mxl` → 和音/divisi/多声小節が matched・取り違え0を確認
  （PD 曲を commit。著作権曲の場合はローカル限定検証としフィクスチャは commit しない）

## 依存ライブラリ

```json
{
  "dependencies": {
    "fflate": "最新安定版"
  }
}
```

- アーキテクチャ設計書で選定済み（`.omr` / `.solfaproj` の zip 読み書き）。今回が初導入。

## ディレクトリ構造

```
src/
  main/omr/
    OmrRunner.ts
    audiverisCommand.ts
    omrArchive.ts
    errors.ts
  shared/types/
    OmrProgress.ts
tests/
  unit/main/omr/
    audiverisCommand.test.ts
    omrArchive.test.ts
    OmrRunner.test.ts
  integration/pipeline/
    victoria-regression.test.ts
    divisi-regression.test.ts   （PD 曲のときのみ commit）
  fixtures/
    victoria/   … 実 .omr / .mxl（PD）＋ README（実測値の根拠）
    divisi/     … 実 .omr / .mxl（PD のときのみ）＋ README
```

## 実装の順序

1. fflate 導入 + `OmrProgress` 型 + `errors.ts`
2. `audiverisCommand.ts`（純粋）＋ ユニットテスト
3. `omrArchive.ts`（純粋）＋ ユニットテスト（合成 zip）
4. `OmrRunner.ts`（DI spawner）＋ ユニットテスト（擬似プロセス）
5. 実フィクスチャ受領後: フィクスチャ配置 + 実測値確認 + 回帰テスト（Victoria → divisi）
6. ドキュメント更新（functional-design の OmrRunner / architecture の申し送り）

## セキュリティ考慮事項

- **子プロセス**: Audiveris へはファイルパスを **引数配列** で渡す（シェル文字列連結禁止）。`shell: false`。
- **zip 展開**: `.omr`/`.mxl` のエントリ名から絶対パス・`..` を拒否（パストラバーサル防御）。展開先は
  一時ディレクトリに限定し、書き出しは必要最小限（本設計は基本メモリ上で展開し disk への書き戻しをしない）。
- **著作権**: 著作権のある楽譜由来データ（現代曲の `.omr`/`.mxl`/MusicXML）はリポジトリに commit しない。

## パフォーマンス考慮事項

- OMR 実処理は Audiveris に律速。アプリ側はページ/シート単位の進捗通知とキャンセルで体感を担保する
  （機能設計書・アーキテクチャの性能方針）。
- zip 展開はメモリ上（fflate 同期 API）。v1 の対象規模（数〜十数ページ）では十分。

## 将来の拡張性

- **OMR エンジン差し替え**: `SpawnFn` の DI と OmrRunner のインターフェース化により、Audiveris 以外
  （oemer 等）を将来差し替え可能（アーキテクチャの拡張方針）。`.omr` 相当の座標出力が前提。
- **進捗の精緻化**: parseProgressLine を実ログで育てることで、UI（OmrProgress 画面, Phase 4）の
  表示品質を上げられる。
