# 要求内容

## 概要

リリースワークフロー（`.github/workflows/release.yml`）に、**push された Git タグと `package.json` の `version` が一致しているかを検証するステップ**を追加する。不一致ならビルド前にジョブを失敗させ、バージョン表記のズレた配布物が生成されないようにする。

## 背景

アプリ画面に表示されるバージョン（`src/renderer/screens/Home/Home.tsx:53`）は、以下の経路で **`package.json` の `version` を唯一の情報源**としている。

```
package.json "version"
  → app.getVersion()                     src/main/index.ts:83
  → IPC 'app:getVersion'                 src/shared/ipc/channels.ts:3
  → preload getAppVersion()              src/preload/index.ts:21
  → Home の version state                src/renderer/screens/Home/Home.tsx:27
  → 「バージョン: x.y.z」表示             src/renderer/screens/Home/Home.tsx:53
```

同じ値は electron-builder にも渡り、`artifactName` 未指定のため既定の `${productName} Setup ${version}.exe` というインストーラ名、および exe のファイルプロパティ（FileVersion / ProductVersion）にも反映される。

一方 `release.yml` は `v*` タグの push で起動するが、**タグの値を `package.json` へ反映する処理も、両者の一致を確かめる処理も存在しない**。そのため次の事故が起こりうる。

- `package.json` を `0.1.0` のまま `v0.2.0` タグを push → 画面表示・インストーラ名・exe プロパティがすべて `0.1.0` のまま、Release だけ `v0.2.0` になる
- 逆に `package.json` だけ上げてタグを打ち間違えた場合も、Release 名と中身がズレる

これは配布後に気づいても差し替えが面倒（利用者は合唱仲間で、再配布の連絡コストが高い）であり、**タグ push 直後に機械的に検出できる類のミス**である。`v0.1.0` のリリース準備時（`.steering/20260726-v0.1.0-public-release-prep/tasklist.md` の「リリース実行手順」）では手順書の目視確認項目として書かれていたが、人手のチェックに依存している状態を解消する。

## 実装対象の機能

### 1. タグと `package.json` の version 一致検証ステップ

- `release.yml` に検証ステップを追加する
- 一致しない場合はワークフローを失敗させ、GitHub Actions のエラーアノテーションとして両方の値を表示する
- **ビルド系ステップより前**に配置し、無駄な待ち時間（`npm ci` と Audiveris MSI のダウンロード・展開）を発生させずに落とす

### 2. リリース手順ドキュメントの更新

- README の「リリース手順」に、**`package.json` の version を先に上げてからタグを打つ**という順序と、`npm version` を使う手順を追記する
- 検証ステップにより不一致では失敗することを明記する

## 受け入れ条件

### タグと version の一致検証ステップ

- [ ] `.github/workflows/release.yml` に、タグ名と `package.json` の `version` を比較するステップが存在する
- [ ] 比較時にタグ名の先頭 `v` が除去されている（`v0.1.0` と `0.1.0` が一致と判定される）
- [ ] 不一致の場合に `exit 1` でジョブが失敗する
- [ ] 失敗時のメッセージに**タグ名と `package.json` の値の両方**が含まれ、`::error::` アノテーションとして出力される
- [ ] 検証ステップが `npm ci` / `npm run fetch-resources` / `npm run dist:win` より前に配置されている
- [ ] Windows ランナーでも動作するよう `shell: bash` が明示されている
- [ ] ステップの意図（なぜ必要か）がコメントとして記述されている
- [ ] `release.yml` が YAML として妥当（パースエラーがない）
- [ ] 検証ロジックをローカルで模擬実行し、**一致時は成功・不一致時は exit 1** となることを確認済み

### リリース手順ドキュメントの更新

- [ ] README の「リリース手順」に `package.json` の version を先に上げる旨が記載されている
- [ ] `npm version` によるバージョン更新手順（コミット＋タグ生成）が記載されている
- [ ] タグと `package.json` が不一致だとワークフローが失敗する旨が記載されている

### 全体品質

- [ ] `npm run lint` がパスする
- [ ] `npm run typecheck` がパスする
- [ ] `npm run test` がパスする

## 成功指標

- バージョン不一致のタグを push した場合、**Audiveris のダウンロードやビルドを待たずに**（ジョブ開始から短時間で）失敗が通知される
- 画面表示バージョン・インストーラ名・exe プロパティ・GitHub Release 名の 4 者が、常に同一の値で揃うことが仕組みとして保証される

## スコープ外

以下はこのフェーズでは実施しません:

- **タグ名から `package.json` を自動更新する仕組み** — バージョンはコミット履歴に残る値であるべきで、CI が書き換えるとタグとコミットの対応が壊れる。検証（fail fast）に留める
- **バージョン番号の引き上げそのもの** — `0.1.0` のまま維持する（引き上げはユーザーの判断）
- **`ci.yml` への同種チェックの追加** — タグが存在しない通常の push / PR では比較対象がないため不要
- **SemVer 形式そのもののバリデーション**（`v1.2` のような不正な形の検出） — `package.json` 側が SemVer 準拠である以上、一致検証が通れば形式も担保される
- **リリースノートの自動生成** — 現行の「下書き Release を手で整えて公開する」運用を維持する

## 参照ドキュメント

- `docs/development-guidelines.md` - Git 運用ルール（ブランチ戦略・コミットメッセージ規約）
- `docs/architecture.md` - 技術スタック（正）
- `.steering/20260726-v0.1.0-public-release-prep/` - v0.1.0 公開準備（`draft: true` 導入・リリース実行手順の整備）
- `README.md` - 開発者向け情報「リリース手順」
