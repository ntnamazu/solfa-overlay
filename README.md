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

## 実装状況

- [x] プロジェクト基盤（TypeScript strict / ESLint レイヤー境界 / Vitest / CI）
- [x] Electron 最小シェル（ハードニング済み Main + 型付きIPC + React Renderer）
- [x] SolfaEngine（階名計算コア: 度数＋変位の内部表現、コダーイ式 / Tonic sol-fa 略記の文字列化）
- [x] ScoreModelBuilder（MusicXML × .omr 照合コア: MusicXmlParser / OmrSheetParser / clefTable による小節照合・音高クロスチェック。合成フィクスチャで通し回帰済み）
- [ ] OmrRunner（Audiveris 統合: zip(.omr/.mxl) 展開・ヘッドレス実行・実 Victoria 楽譜フィクスチャ）
- [ ] 確認画面（StructureConfirm / ClefKeyConfirm）
- [ ] Editor（注釈修正UI）・PDF出力
