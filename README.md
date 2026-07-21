# Solfa Overlay（仮称）

合唱楽譜PDFへの移動ド階名自動付与アプリ。

購入した楽譜のスキャンPDFを読み込むと、OMR（Audiveris）で楽譜を認識し、全音符に移動ドの階名を元の版面そのままにオーバーレイした印刷可能なPDFを出力します。楽譜データはすべてローカルで処理され、外部サーバーには一切送信されません（ローカル完結）。

## 技術スタック

Electron + TypeScript + React。詳細・選定理由は [docs/architecture.md](docs/architecture.md) を参照してください。

## ドキュメント

| ドキュメント                                         | 内容                                         |
| ---------------------------------------------------- | -------------------------------------------- |
| [プロダクト要求定義書](docs/product-requirements.md) | 何を作るか・成功指標                         |
| [機能設計書](docs/functional-design.md)              | データモデル・コンポーネント・アルゴリズム   |
| [アーキテクチャ設計書](docs/architecture.md)         | 技術スタック（正）・レイヤー構成・永続化戦略 |
| [リポジトリ構造定義書](docs/repository-structure.md) | ディレクトリ構造・命名規則・依存ルール       |
| [開発ガイドライン](docs/development-guidelines.md)   | コーディング規約・Git運用・テスト戦略        |
| [用語集](docs/glossary.md)                           | ドメイン用語と英語表記の対応                 |

## 開発環境セットアップ

必要ツール: Node.js v20 以降（devcontainer 利用時は設定済み）

```bash
# 依存関係のインストール（lockfile に従う）
npm ci

# 開発モードで起動
npm run dev

# テスト実行
npm run test           # ユニット（＋統合）テスト
npm run test:coverage  # カバレッジ付き

# 静的チェック
npm run lint
npm run typecheck

# プロダクションビルド（out/ に main / preload / renderer を生成）
npm run build
```

詳細は [開発ガイドライン](docs/development-guidelines.md) を参照してください。

### OMR エンジン（Audiveris）の用意

PDF 取り込み（OMR）を実際に動かすには、実行時に **Audiveris**（同梱 JRE でヘッドレス実行）が必要です。未用意のまま取り込むと「Audiveris が見つかりません」という案内が表示されます。次の 2 通りのどちらかで用意してください（どちらも効果は同じです）。

**ルートA: 自前で調達する（基本）**

1. [Audiveris](https://github.com/Audiveris/audiveris/releases) をインストールする（本プロジェクトは **5.6.1** で検証済み。テストフィクスチャも同版）。
2. 実行ファイルを PATH に通す（コマンド名 `audiveris` で起動できる状態にする）か、環境変数 `SOLFA_AUDIVERIS_PATH` に実行ファイルの絶対パスを設定する。

   ```bash
   # 例: PATH を通さず場所だけ指定する場合
   export SOLFA_AUDIVERIS_PATH=/opt/audiveris/bin/Audiveris
   npm run dev
   ```

**ルートB: Dev Container を使う（手軽に試す）**

- `.devcontainer` で開く／リビルドすると、Audiveris 5.6.1（＋同梱 JRE21）が同梱された状態でコンテナが起動します。追加のインストールや `SOLFA_AUDIVERIS_PATH` の設定は不要で、そのまま `npm run dev` で OMR まで動きます。
- 既に起動中のコンテナに後から反映する場合は、VS Code の「Dev Containers: Rebuild Container」でイメージを再ビルドしてください。

> どちらの経路も最終的に「`audiveris` が実行できる状態」を作るための手段です。配布版アプリでは Audiveris を同梱するため、この用意は不要になります（開発時のみの手順）。

## 実装状況

- [x] プロジェクト基盤（TypeScript strict / ESLint レイヤー境界 / Vitest / CI）
- [x] Electron 最小シェル（ハードニング済み Main + 型付きIPC + React Renderer）
- [x] SolfaEngine（階名計算コア: 度数＋変位の内部表現、コダーイ式 / Tonic sol-fa 略記の文字列化）
- [x] ScoreModelBuilder（MusicXML × .omr 照合コア: MusicXmlParser / OmrSheetParser / clefTable による小節照合・音高クロスチェック。合成フィクスチャで通し回帰済み）
- [ ] OmrRunner（Audiveris 統合: zip(.omr/.mxl) 展開・ヘッドレス実行・実 Victoria 楽譜フィクスチャ）
- [ ] 確認画面（StructureConfirm / ClefKeyConfirm）
- [ ] Editor（注釈修正UI）・PDF出力
