# タスクリスト

- 作業名: 20260717-initial-setup（初回実装: プロジェクト基盤 + SolfaEngine）

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

## フェーズ1: プロジェクト基盤

- [x] package.json を作成（name/scripts: dev, build, test, test:coverage, lint, typecheck, format）
- [x] 依存パッケージをインストール（react, react-dom / electron, electron-vite, vite, typescript, vitest, eslint 一式, prettier）
  - [x] ネットワークブロック発生時はユーザーにホワイトリスト追加を依頼（ブロック発生せず。Electron バイナリは GitHub IP レンジ許可で取得できた）
  - [x] 実行時依存にネットワークアクセスを行うものがないことを確認（dependencies は react / react-dom のみ）
  - 備考: electron-vite 5 が vite ^7 までのため vite@^7 / @vitejs/plugin-react@^5 に固定。TypeScript は 6 が入ったため architecture.md 準拠の ^5.9 に変更。electron は ~41.7.1（マイナー固定）
- [x] tsconfig.json（strict ベース）/ tsconfig.node.json / tsconfig.web.json を作成
- [x] electron.vite.config.ts を作成（main / preload / renderer の3ターゲット。sandbox 対応のため preload は CJS 出力）
- [x] eslint.config.mjs を作成（レイヤー境界は @typescript-eslint/no-restricted-imports（renderer→preload は allowTypeImports）+ import/no-cycle）
- [x] .prettierrc / .prettierignore を作成（2スペース・100文字）
- [x] vitest.config.ts を作成（tests/unit・integration 対象、カバレッジ閾値90%）
- [x] .gitignore を更新（dist, out, .steering/, resources/audiveris, resources/jre, _.solfaproj_, logs 等）

## フェーズ2: shared 型定義・定数

- [x] src/shared/types/ に Pitch.ts / SolfaDegree.ts / KeyRegion.ts（ScorePosition 含む）/ ProjectSettings.ts を作成（機能設計書のエンティティ定義を転記）
- [x] src/shared/constants/DEFAULT_SETTINGS.ts を作成（kodaly / la / 濃赤 / 紫。フォントは F-4 実装時に選定する仮値）

## フェーズ3: SolfaEngine（階名計算コア）

- [x] src/domain/solfa/syllableTables.ts を作成（コダーイ式・Tonic sol-fa 略記の全表 + フォールバック文字列化）
- [x] src/domain/solfa/SolfaEngine.ts を作成
  - [x] resolveDo（La基準短調 = 平行長調の主音。理論的根拠をコメントに残す）
  - [x] letterDistance / expectedAlterInDoMajor（NATURAL_SEMITONES + MAJOR_SCALE_OFFSETS + signedDiff12）
  - [x] computeDegree / toSyllable / SolfaEngine クラス
- [x] tests/unit/domain/solfa/SolfaEngine.test.ts を作成
  - [x] 全24調の expectedAlterInDoMajor 表駆動検証（長調15調の調号一致 + La基準短調15調の平行長調解決）
  - [x] computeDegree の代表ケース（ト長調F♮=7/-1、イ短調La基準C=1/0 ほか長短×La/Do×臨時記号）
  - [x] La基準⇔Do基準の読み替え検証（イ短調の C/F/G）
- [x] tests/unit/domain/solfa/syllableTables.test.ts を作成
  - [x] 両体系の文字列化表を全セル網羅（コダーイ te ⇔ Tonic sol-fa ta の相違を明示検証）
  - [x] フォールバック表示（±2変位・表にない組合せ）
- [x] solfa コアのカバレッジ90%以上を確認（test:coverage）→ 81テスト全パス・カバレッジ100%（到達不能な防御ガード2箇所は v8 ignore で除外）

## フェーズ4: Electron 最小シェル

- [x] src/shared/ipc/channels.ts を作成（app:getVersion）
- [x] src/main/index.ts を作成（BrowserWindow + ハードニング3点 + IPCハンドラ登録）
- [x] src/preload/index.ts / api.ts を作成（contextBridge で getAppVersion を公開）
- [x] src/renderer/ を作成（index.html: CSP付き / main.tsx / App.tsx / screens/Home/Home.tsx スタブ + global.d.ts）

## フェーズ5: CI

- [x] .github/workflows/ci.yml を作成（push/PR: lint → typecheck → test。Electron バイナリはスキップして高速化）

## フェーズ6: 品質チェックと修正

- [x] すべてのテストが通ることを確認
  - [x] `npm run test` → 81件パス
- [x] リントエラーがないことを確認
  - [x] `npm run lint` → エラーなし
  - [x] レイヤー境界違反を意図的に書いて ESLint が検出することを確認（domain での electron / node:fs import を2件検出。確認後に削除）
- [x] 型エラーがないことを確認
  - [x] `npm run typecheck` → node / web 両プロジェクトでエラーなし
- [x] ビルドが成功することを確認
  - [x] `npm run build`（main / preload / renderer の3バンドル生成を確認）
  - 備考: コンテナに X サーバがないため GUI 起動確認は未実施（実機での `npm run dev` 確認は次回作業時に推奨）

## フェーズ7: ドキュメント更新

- [x] docs/architecture.md に UI スタック決定（React + electron-vite）を追記
- [x] README.md を更新（プロジェクト概要・セットアップ手順・実装状況）
- [x] 実装後の振り返り（このファイルの下部に記録）

---

## 実装後の振り返り

### 実装完了日

2026-07-17

### 計画と実績の差分

**計画と異なった点**:

- 依存バージョン: design.md 想定（vitest ^3 / electron-vite ^4 / vite 8可）に対し、実際は vitest 4 / electron-vite 5 / vite ^7 で確定。electron-vite 5 の peerDependencies が vite ^7 までのため vite 8 は採用不可だった
- TypeScript は `npm install typescript` で 6.x が入ったため、architecture.md（5.x が正）に合わせて ^5.9 へ明示的にダウングレードした
- package.json の `"type": "module"` は削除した（sandbox 有効の preload は ESM を読み込めず、CJS 出力に統一するのが最も単純なため）
- カバレッジ90%閾値に対し、到達不能な防御ガード（mod 7 の範囲外等）2箇所がブランチカバレッジを下げたため、`/* v8 ignore start/stop */` で除外し実質100%とした（`v8 ignore next N` 形式は vitest 4 で効かなかった）

**新たに必要になったタスク**:

- `src/renderer/global.d.ts` の作成（`window.solfaOverlay` の型宣言。preload の型を `import type` で参照する設計の実装上の必須ピース）
- @types/node の追加（Main プロセスの `path` / `process` 参照に必要）

### 学んだこと

**技術的な学び**:

- オブジェクトリテラルの負の数値キーは `{ -1: ... }` と書けず `{ [-1]: ... }`（computed key）が必要（syllableTables で遭遇）
- devcontainer のファイアウォールは GitHub の IP レンジを許可済みのため、Electron バイナリ（GitHub Releases 配信）のダウンロードはホワイトリスト追加なしで成功した
- `@typescript-eslint/no-restricted-imports` の `allowTypeImports: true` で「renderer → preload は import type のみ許可」という境界を機械的に表現できる
- 機能設計書の検算規定（expectedAlterInDoMajor は do 長調の調号と一致する）は、調号の定義（♯♭の追加順）からテスト期待値を導出できるため、手書きの期待値表なしで24調を網羅できた

**プロセス上の改善点**:

- 永続ドキュメントが詳細（アルゴリズムの擬似コード・検算規定・エラー分類まで定義済み）だったため、実装は「転記＋テスト」に近く、判断に迷う箇所がほぼなかった
- ユーザー確認（スコープ・UIスタック）を計画段階で済ませたため、実装中の手戻りがゼロだった

### 追記（2026-07-17 実機動作確認のトラブルシュート）

devcontainer での `npm run dev` 起動失敗を解決した。原因は2段階:

1. **共有ライブラリ不足**（`libnspr4.so`）: ベースイメージ `node:20` に Chromium 実行用ライブラリがない
   → `.devcontainer/Dockerfile` に libnss3 / libgtk-3-0 等14パッケージを追加（要リビルド）
2. **SUID サンドボックス構成不可**: Docker の既定 seccomp で user namespace が使えず、bind mount 上の chrome-sandbox に SUID も付けられない
   → `scripts/dev.mjs`（起動ラッパー）が Linux コンテナ（/.dockerenv 検出）でのみ `--noSandbox` を付与
3. **X11 転送経由の起動デッドロック**: WSLg が転送する X11（XWayland）ソケット経由だと Chromium のプラットフォーム初期化が失敗し、`app.whenReady()` が永遠に解決しない（ウィンドウが出ない・^C 必須）。プロセス解剖の結果、全ワーカースレッドが exit 済みで main スレッドだけが自己パイプへの write でブロックする片付け中デッドロックだった。X サーバ生存確認済み・`--disable-gpu`・`--no-zygote`・`--ozone-platform=x11` いずれも効果なし
   → `--ozone-platform=wayland`（WSLg ネイティブの Wayland ソケット使用）で即解決。`scripts/dev.mjs` が `WAYLAND_DISPLAY` 設定時のみ `-- --ozone-platform=wayland` を付与（electron-vite の `--` 以降は ELECTRON_CLI_ARGS として Electron に渡る）

**不採用だった案（検証済み・重要な知見）**:

- `ELECTRON_DISABLE_SANDBOX` を devcontainer.json（containerEnv / remoteEnv）や Dockerfile ENV で設定
  → いずれも PID 1 には届くが **VS Code のターミナル（zsh）へ伝播しない**（DEVCONTAINER=true は届くのに、この変数だけ欠落。原因未特定）
- `app.commandLine.appendSwitch('no-sandbox')` / `appendSwitch('ozone-platform', 'wayland')`
  → どちらも Main の JS 実行より前に走る初期化に**間に合わない**（実測で確認）。この種のフラグは起動コマンドラインで渡すしかない

動作確認結果: `npm run dev` でウィンドウ表示・React 描画・IPC（`app.getVersion()` → 0.1.0 表示）まで確認済み。コンテナに CJK フォントが無く日本語が豆腐になるため `fonts-noto-cjk` を Dockerfile に追加（要リビルド）。

**既知の無害ログ（devcontainer での `npm run dev` 時・対応不要）**:

- `ERROR:dbus/bus.cc` / `ERROR:dbus/object_proxy.cc` 系: Chromium が OS 連携（電源管理・通知・メディアキー等）のため D-Bus へ接続を試みるが、コンテナ内にはデーモンも `DBUS_SESSION_BUS_ADDRESS` も無いため失敗する。失敗時は該当機能を諦めて動作継続する設計で、アプリへの影響なし（dbus エラーが出たまま READY 到達・描画成功を確認済み）
- `ERROR:...drm_render_node_path_finder.cc` (`drmGetDevices2() has not found any devices`): コンテナに GPU デバイス（`/dev/dri/*`）が渡されていないだけ。ソフトウェアレンダリングに自動フォールバックする。そもそもコンテナ内 dev はハードウェアアクセラレーション無効（`src/main/index.ts`）
- どちらも devcontainer 特有で、配布パッケージ版を通常のデスクトップ環境で実行する際には出ない。握りつぶす細工はしない方針

### 追記（2026-07-17 コードレビュー指摘の修正）

/code-review（high）の指摘 21件（CONFIRMED 0・PLAUSIBLE 21）のうち上位6件を修正:

1. `scripts/dev.mjs`: WAYLAND_DISPLAY 不在時に無言で X11（デッドロック既知）へ落ちず警告を出す
2. `electron.vite.config.ts`: CSP 置換が不一致で無言 no-op にならないよう throw を追加
3. `src/shared/ipc/contract.ts` 新設: IPC の引数・戻り値契約を単一ソース化。main は `handleIpc()`、preload は `invoke()` が契約から型導出（preload の `as Promise<string>` 手動キャスト廃止）
4. `global.d.ts`: `window.solfaOverlay` をオプショナルに（ブラウザ直開きで undefined になる実態と一致）
5. `src/main/index.ts`: loadURL/loadFile の失敗を catch してログ出力（無言の空ウィンドウ防止）
6. `Home.tsx`: getAppVersion() に catch を追加（「取得中…」のまま固まる問題）

未対応（低優先のクリーンアップ系・次回以降の候補）: MAJOR_SCALE_OFFSETS の導出化、DoPitch の Pick 化、SolfaEngine クラスの整理、v8-ignore 付き到達不能ガード、テストフィクスチャ共有化、setWindowOpenHandler/will-navigate ガード、コンテナ判定の共通化（Podman 対応）、firewall の wikipedia.org 要否確認

### 次回への改善提案

- 次の作業単位の候補: (1) MusicXML パーサ + ScoreModelBuilder（フィクスチャ整備込み）、(2) ProjectStore + Zod スキーマ、(3) OmrRunner。(1) が SolfaEngine の成果を最短で繋げられる
- 実機（GUI環境）での `npm run dev` 起動確認を次回作業の冒頭に行うこと。dev モードで CSP が @vitejs/plugin-react の HMR 用インラインスクリプトをブロックする可能性があり、その場合は「dev のみ緩和・本番は default-src 'self' 維持」の対応を検討する
- 依存バージョンは設計時に npm レジストリの最新を確認してから design.md に書くと差分が減る
