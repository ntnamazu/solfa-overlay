# 設計書

## アーキテクチャ概要

アプリコードには一切手を入れず、**CI（GitHub Actions）のワークフロー定義にガード（fail fast）を 1 ステップ追加する**だけの変更。加えて README のリリース手順を実態に合わせて補強する。

現行のリリースジョブと、追加位置は以下のとおり。

```
push tag v*
   │
   ▼
job: build-win (windows-latest)
   ├─ actions/checkout@v4
   ├─ actions/setup-node@v4 (node 24, cache: npm)
   ├─ ★ 新規: タグと package.json の version 一致を検証   ← ここに挿入
   ├─ npm ci                        （不一致ならここまで到達しない）
   ├─ npm run fetch-resources       （Audiveris MSI DL + 展開: 重い）
   ├─ npm run dist:win              （electron-builder: 重い）
   ├─ actions/upload-artifact@v4
   └─ softprops/action-gh-release@v2 (draft: true)
```

## コンポーネント設計

### 1. 検証ステップ（`.github/workflows/release.yml`）

**責務**:

- `GITHUB_REF_NAME`（= push されたタグ名）から先頭の `v` を除いた文字列を得る
- `package.json` の `version` を読み出す
- 両者を比較し、不一致ならエラーアノテーションを出して `exit 1`

**実装の要点**:

- **配置は `setup-node` の直後、`npm ci` の前**。理由は 2 つ。
  - `node -p` を使うため Node がセットアップ済みである必要がある（`windows-latest` イメージには Node がプリインストールされているが、バージョンが `setup-node` の指定と異なりうるため、明示的にセットアップ後に置くほうが素直）
  - 最も重い `fetch-resources`（Audiveris MSI のダウンロード・`msiexec /a` 展開）と `dist:win` の前に落とすことで、失敗の通知が早くなる
- **`shell: bash` を明示する**。`windows-latest` の既定シェルは PowerShell であり、`${VAR#v}` のパラメータ展開や `[ ... ]` は解釈できない。GitHub 提供の Windows ランナーには Git Bash が同梱されており、`shell: bash` で利用できる
- **version の読み出しは `node -p "require('./package.json').version"`**。`jq` に依存せず（Windows ランナーの `jq` 有無に左右されない）、Node は直前のステップで確実に用意されている
- **タグ名は `GITHUB_REF_NAME` を使う**。`GITHUB_REF`（`refs/tags/v0.1.0`）より前処理が少なく、タグ push 限定のワークフローなので曖昧さがない
- **`${GITHUB_REF_NAME#v}` は先頭の 1 文字が `v` のときだけ除去する**（`#` は最短前方一致）。`v` を含まないタグ名が来ても壊れず、単に不一致として検出される
- **エラー出力は `::error::` ワークフローコマンド**を使い、Actions の UI 上部にアノテーションとして出す。メッセージにはタグ側と `package.json` 側の**両方の値**を含め、どちらを直すべきか判断できるようにする
- ステップ名は日本語（既存のステップ名 `Attach installer to GitHub Release` は英語だが、本リポジトリのコメントは日本語で統一されている。ステップ名も内容が伝わることを優先し、既存コメントの言語に合わせる）

**追加するステップ**:

```yaml
# タグ名と package.json の version が食い違ったまま配布物を作らないためのガード。
#
# 画面表示のバージョン（app.getVersion() → Home 画面）・インストーラ名
# （${productName} Setup ${version}.exe）・exe のファイルプロパティは、いずれも
# package.json の version が唯一の情報源。タグは release.yml の起動条件でしかなく、
# 両者を同期する仕組みは無いため、ここで一致を検証する。
#
# 重い fetch-resources / dist:win の前に置いて、早く落とす。
- name: タグと package.json の version 一致を検証
  shell: bash # windows-latest の既定は PowerShell のため明示する
  run: |
    PKG_VERSION=$(node -p "require('./package.json').version")
    TAG_VERSION="${GITHUB_REF_NAME#v}"
    if [ "$PKG_VERSION" != "$TAG_VERSION" ]; then
      echo "::error::タグ($GITHUB_REF_NAME) と package.json の version($PKG_VERSION) が一致しません。package.json を更新してからタグを打ち直してください。"
      exit 1
    fi
    echo "バージョン一致を確認: $PKG_VERSION"
```

### 2. README「リリース手順」の補強

**責務**:

- 「タグを打つ前に `package.json` を上げる」という順序を明示する
- `npm version` を使えばコミットとタグが一括で作られることを案内する

**実装の要点**:

- `npm version <patch|minor|major>` は `package.json` と `package-lock.json` を更新し、コミットと **`v` 付きタグ**（既定の `tag-version-prefix` が `v`）を作る。これは `release.yml` の起動条件 `tags: ['v*']` と整合する
- `git push --follow-tags` でコミットとタグをまとめて push できることを併記する
- 既存の `git tag v0.1.0` 手作業の例は、`npm version` を使わない場合の手順として残すか、`npm version` に置き換えるかを検討する → **`npm version` を主手順とし、検証ステップの存在に触れる形へ書き換える**（手作業の例を残すと、package.json の更新を忘れる導線が残るため）

## データフロー

### バージョン不一致のタグを push したとき

```
1. 開発者が `git tag v0.2.0 && git push origin v0.2.0`（package.json は 0.1.0 のまま）
2. release.yml が起動し、checkout → setup-node が完了
3. 検証ステップが PKG_VERSION=0.1.0 / TAG_VERSION=0.2.0 を得る
4. 不一致 → ::error:: アノテーションを出力し exit 1
5. ジョブ失敗。npm ci 以降は実行されず、Release も作られない
6. 開発者は package.json を修正 → タグを打ち直して再実行
```

### 正しくバージョンを上げたとき

```
1. `npm version minor` → package.json 0.2.0 / コミット / タグ v0.2.0 が生成される
2. `git push --follow-tags`
3. 検証ステップが PKG_VERSION=0.2.0 / TAG_VERSION=0.2.0 を得て通過（一致ログを出力）
4. ビルドが進み、`Solfa Overlay Setup 0.2.0.exe` が下書き Release に添付される
5. 起動したアプリの Home 画面には「バージョン: 0.2.0」が表示される
```

## エラーハンドリング戦略

### カスタムエラークラス

不要（アプリコードの変更を伴わないため）。

### エラーハンドリングパターン

- 検証失敗は**ジョブの失敗として扱う**（`exit 1`）。警告に留めるとビルドが進み、不整合な配布物が Release に添付されてしまうため
- メッセージは「何が食い違ったか」と「どう直すか」の両方を含める

## テスト戦略

GitHub Actions のワークフロー自体はユニットテストの対象外のため、以下の 2 段構えで検証する。

### 静的検証

- `release.yml` を YAML パーサ（Node の `js-yaml`、無ければ Python の `yaml`）に通し、構文エラーがないことを確認する
- パース結果から、検証ステップが `npm ci` より前のインデックスに存在することを確認する

### ロジックの模擬実行

ローカルで検証スクリプトと同じロジックを実行し、期待どおりの終了コードになることを確かめる。

- ケース1（一致）: `GITHUB_REF_NAME=v0.1.0` → 終了コード 0・一致ログが出る
- ケース2（不一致）: `GITHUB_REF_NAME=v0.2.0` → 終了コード 1・`::error::` にタグと package.json の両値が含まれる
- ケース3（`v` なしタグ）: `GITHUB_REF_NAME=0.1.0` → 終了コード 0（`#v` は `v` が無ければ何もしないため、そのまま一致する）

### 既存テストへの影響確認

- `npm run lint` / `npm run typecheck` / `npm run test` を実行し、既存の品質チェックが壊れていないことを確認する（ワークフロー変更なので影響は想定されないが、手順として実施する）

## 依存ライブラリ

新規追加なし。

## ディレクトリ構造

```
.github/workflows/
  release.yml        # 変更: 検証ステップを追加
README.md            # 変更: 「リリース手順」を npm version ベースへ書き換え
.steering/20260731-release-version-guard/
  requirements.md    # 新規
  design.md          # 新規
  tasklist.md        # 新規
```

## 実装の順序

1. 作業ブランチ `chore/release-version-guard` を `develop` から作成
2. `release.yml` に検証ステップを追加
3. YAML パースとロジックの模擬実行で検証
4. README の「リリース手順」を更新
5. 品質チェック（lint / typecheck / test）
6. 振り返りの記録

## セキュリティ考慮事項

- **`GITHUB_REF_NAME` をシェルに展開する箇所は、必ず環境変数経由（`"$GITHUB_REF_NAME"`）で扱い、`${{ github.ref_name }}` のテンプレート補間を `run:` 内に直接埋め込まない**。後者はスクリプトインジェクションの経路として知られる（タグ名は攻撃者が任意に作れる文字列になりうる）。本設計では GitHub が自動で用意する環境変数 `GITHUB_REF_NAME` を参照し、変数展開はすべてダブルクォートで囲う
- 追加ステップは新たな権限を要求しない（`permissions: contents: write` は既存のまま）
- 外部アクションの追加なし（サプライチェーン上の新規依存が増えない）

## パフォーマンス考慮事項

- 追加されるのは Node の起動 1 回と文字列比較のみで、実行時間は 1 秒未満
- むしろ**不一致時に `fetch-resources`（MSI ダウンロード＋展開）と `dist:win` を丸ごと省略できる**ため、失敗ケースでは大幅な短縮になる

## 将来の拡張性

- 将来 macOS / Linux ビルドをジョブとして追加する場合、この検証ステップは各ジョブに複製するのではなく、**軽量な独立ジョブ**として切り出し、ビルドジョブ側で `needs:` 依存させる形にすると 1 箇所で済む。現状はジョブが 1 つのみのため、複雑化を避けてインラインで置く
- プレリリースタグ（`v0.2.0-beta.1`）にも追加変更なしで対応できる（`package.json` 側も同じ文字列にすればよく、比較は単純な文字列一致のため）
