# 開発ガイドライン (Development Guidelines)

- 作成日: 2026-07-13
- 前提ドキュメント: [アーキテクチャ設計書](architecture.md) / [リポジトリ構造定義書](repository-structure.md)

## コーディング規約

### 命名規則

#### 変数・関数

```typescript
// ✅ 良い例
const skippedMeasures = builder.listSkippedMeasures();
function computeDegree(note: Pitch, region: KeyRegion): SolfaDegree { }

// ❌ 悪い例
const data = build();
function calc(n: any): any { }
```

**原則**:
- 変数: camelCase、名詞または名詞句
- 関数: camelCase、動詞で始める
- 定数: UPPER_SNAKE_CASE
- Boolean: `is`, `has`, `should` で始める（例: `isConfirmed`, `hasCollision`）

#### クラス・インターフェース

```typescript
// クラス: PascalCase、名詞
class SolfaEngine { }
class ScoreModelBuilder { }

// インターフェース・型: PascalCase、I接頭辞なし
interface KeyRegion { }
type SyllableSystem = 'kodaly' | 'tonicSolfa';
```

#### ドメイン用語の扱い

- 音楽用語は[用語集](glossary.md)の英語表記に統一する（例: `keyRegion`, `solfaDegree`, `clef`, `accidental`）
- 同じ概念に複数の名前を使わない（例: 「階名」は常に `solfa`。`syllable` は表示文字列のみに使う）

### TypeScript規約

- `tsconfig.json` は `strict: true`。`any` の使用は禁止（外部データは `unknown` で受けて Zod で絞る）
- 型のみの参照は `import type` を使う（特に renderer → preload の境界で実体importを防ぐ）
- レイヤー境界は ESLint（`no-restricted-imports`, `import/no-cycle`）で機械的に強制する（違反はCIで落とす）
- `src/domain/` は Electron・Node API に依存しない純粋 TypeScript を維持する（ファイルアクセスが必要なら呼び出し側の main/storage で行い、データを渡す）

### コードフォーマット

- **インデント**: 2スペース
- **行の長さ**: 最大100文字
- Prettier に全面的に委ね、手動整形の議論をしない（設定はリポジトリの `.prettierrc` が正）

### コメント規約

**関数・クラスのドキュメント（TSDoc）**:
```typescript
/**
 * 調文脈と記譜音高から階名の内部表現（度数＋変位）を計算する
 *
 * @param note - MusicXML由来の記譜音高（調号込みの実音）
 * @param region - この音符が属する調文脈
 * @param basis - 短調の読み方（'la' | 'do'）
 * @returns 度数＋変位。音節体系に依存しない
 */
function computeDegree(note: Pitch, region: KeyRegion, basis: MinorBasis): SolfaDegree { }
```

**インラインコメント**:
```typescript
// ✅ 良い例: コードから読み取れない制約・理由を書く
// .omr の符頭 pitch は「中線=0・下向き正」（Audiveris仕様）
const staffStep = -omrPitch;

// ❌ 悪い例: コードを見れば分かること
// staffStep に -omrPitch を代入する
const staffStep = -omrPitch;
```

- 音楽理論上の前提（例: La基準では do = 平行長調の主音）は、実装箇所にコメントで根拠を残す

### エラーハンドリング

**原則**:
- 予期されるエラー（OMR失敗・照合不一致・ファイル破損）はドメインのエラークラスで表現し、UIで回復可能に扱う
- 予期しないエラーは握りつぶさず上位に伝播させ、Main プロセスの集約ハンドラでログ＋ダイアログ表示する
- 機能設計書「エラーハンドリング」の分類表と対応させる（部分失敗は全体を失敗にしない）

**例**:
```typescript
class OmrExecutionError extends Error {
  constructor(message: string, public readonly logPath: string) {
    super(message);
    this.name = 'OmrExecutionError';
  }
}

class ProjectFileError extends Error {
  // cause の種別は用語集「プロジェクトファイルエラー」の定義を正とする
  // （'version' はアプリより新しい schemaVersion の検出。ファイルを変更せずアプリ更新を案内する）
  constructor(message: string, public readonly cause: 'zip' | 'schema' | 'version' | 'io') {
    super(message);
    this.name = 'ProjectFileError';
  }
}
```

### セキュリティ規約（本プロジェクト固有・最重要）

- **楽譜由来データ（PDF・画像・MusicXML・.omr・注釈）を外部送信するコードを書かない**。HTTP クライアントの追加・ネットワークアクセスを行う依存ライブラリの追加は、それ自体をレビューのブロッカーとする
- 子プロセス起動は `spawn` の引数配列のみ。シェル文字列連結（`exec`）禁止
- zip 展開時はエントリ名を検証し、パストラバーサルを拒否する
- Electron は `nodeIntegration: false` / `contextIsolation: true` / `sandbox: true` を変更しない
- Renderer の CSP（`default-src 'self'`）を緩和しない（外部リソース読込の遮断を維持する）
- `shell.openExternal` 等でユーザー提供の URL を開かない

## Git運用ルール

### ブランチ戦略

**ブランチ種別**:
- `main`: リリース可能な状態
- `develop`: 開発の最新状態（デフォルトの作業ベース）
- `feature/[機能名]`: 新機能開発（例: `feature/solfa-engine`）
- `fix/[修正内容]`: バグ修正
- `refactor/[対象]`: リファクタリング

**フロー**:
```
main
  └─ develop
      ├─ feature/solfa-engine
      ├─ feature/clef-confirm-ui
      └─ fix/omr-cancel-leak
```

### コミットメッセージ規約

**フォーマット**（Conventional Commits）:
```
<type>(<scope>): <subject>

<body>
```

**Type**: `feat` / `fix` / `docs` / `style` / `refactor` / `test` / `chore`

**Scope の例**: `solfa`, `score`, `annotations`, `render`, `storage`, `ui`, `omr`

**例**:
```
feat(solfa): La基準短調の度数計算を実装

- KeyRegion から do の位置を解決（minor × la は平行長調の主音）
- 度数＋変位の内部表現を返し、文字列化はsyllableTablesに分離
```

- `type`・`scope` は英語、件名（subject）と本文は日本語を基本とする（既存コミットの慣習。例: `docs: repository-structure.md へのレビュー指摘を反映`）

### プルリクエストプロセス

**作成前のチェック**:
- [ ] `npm run test`（ユニット・統合）がパス
- [ ] `npm run lint` / `npm run typecheck` がパス
- [ ] レイヤー境界違反がない（ESLintで検出）
- [ ] 競合が解決されている

**PRテンプレート**:
```markdown
## 概要
[変更内容の簡潔な説明]

## 変更理由
[なぜこの変更が必要か。対応するドキュメント・Issueへのリンク]

## 変更内容
- [変更点1]
- [変更点2]

## テスト
- [ ] ユニットテスト追加
- [ ] 統合テスト（該当する場合）
- [ ] 手動テスト実施（確認手順を記載）

## セキュリティ確認
- [ ] 楽譜由来データの外部送信・新規ネットワークアクセスを追加していない

## 関連Issue
Closes #[Issue番号]
```

**レビュープロセス**:
1. セルフレビュー（diff全体を自分で読む）
2. CI（テスト・lint・typecheck）のパス
3. レビュアーアサイン
4. フィードバック対応
5. 承認後 develop へマージ（squash推奨）

## テスト戦略

### テストの種類

#### ユニットテスト（Vitest）

**対象**: `domain/`・`storage/` の純粋ロジック

**カバレッジ目標**: サービスレイヤーのコアロジック（solfa/score/annotations/render）90%以上

**例**:
```typescript
describe('SolfaEngine', () => {
  describe('computeDegree', () => {
    it('ト長調のF♮を度数7・変位-1として計算する', () => {
      const region = keyRegion({ tonicStep: 'G', mode: 'major' });
      const degree = computeDegree(pitch('F', 0, 4), region, 'la');
      expect(degree).toEqual({ degree: 7, alteration: -1 });
    });

    it('イ短調La基準では do が C になる', () => {
      const region = keyRegion({ tonicStep: 'A', mode: 'minor' });
      const degree = computeDegree(pitch('C', 0, 4), region, 'la');
      expect(degree).toEqual({ degree: 1, alteration: 0 });
    });
  });
});
```

- 階名計算は**表駆動テスト**を基本とする（調×音×基準×体系の組合せを網羅）

#### 統合テスト

**対象**: パイプライン全体（OMR成果物フィクスチャ → 照合 → 階名 → PDF出力）

- 検証済み題材（Victoria《O magnum mysterium》）の定量回帰: 784音・音高ミスマッチ0・skipped 5小節を期待値として固定する
- Audiveris 本体はテストで実行しない（フィクスチャ化した出力を使う）。Audiveris 更新時のみ `scripts/generate-fixtures.ts` で再生成し、差分をレビューする

#### E2Eテスト（Playwright）

**対象**: ユーザーシナリオ全体（新規プロジェクト→確認→修正→出力）

- CI では Linux ヘッドレスで実行。OMR は小さなフィクスチャPDF（1ページ）で代替し、実行時間を抑える

### テスト命名規則

- `describe` はクラス/関数名、`it` は「[条件]で[期待結果]」を日本語で記述する（上記例参照）
- 曖昧な名前（`works`, `test1`）は禁止

### モック・スタブの使用

**原則**:
- 外部依存（Audiveris子プロセス・ファイルシステム・IPC）はモック化する
- `domain/` のロジックは実装をそのまま使う（純粋TSなのでモック不要のはず。モックが必要になったら設計を疑う）

### テストデータの著作権ルール

- `tests/fixtures/` に置けるのは**パブリックドメインの楽譜のみ**
- 著作権のある楽譜のスキャン・OMR成果物は、ローカル検証にとどめ、コミット禁止（`.gitignore` の `*.solfaproj` 除外を外さない）

## コードレビュー基準

### レビューポイント

**機能性**:
- [ ] 要件（PRD/機能設計書）を満たしているか
- [ ] エッジケース（skipped小節・重変位音・空ページ等）が考慮されているか
- [ ] 部分失敗の方針（全体を失敗にしない）に沿っているか

**可読性**:
- [ ] 命名が用語集と一致しているか
- [ ] 音楽理論上の前提がコメントで残されているか

**保守性**:
- [ ] レイヤー境界（domainの純粋性・rendererの隔離）を守っているか
- [ ] 内部表現（度数＋変位）と表示（文字列化）の分離を壊していないか
- [ ] 重複コードがないか
- [ ] ファイルサイズが指針内か（300行以下推奨・500行超は分割を強く推奨。詳細は[リポジトリ構造定義書](repository-structure.md)「ファイルサイズの管理」）

**パフォーマンス**:
- [ ] 全ページ・全注釈を無条件に舐める処理を UI 操作経路に入れていないか
- [ ] 再計算の範囲が影響 KeyRegion に限定されているか

**セキュリティ**:
- [ ] 楽譜由来データの外部送信・新規ネットワーク依存がないか（**最優先のブロッカー**）
- [ ] 入力検証（プロジェクトファイル・PDF）が適切か
- [ ] Electron ハードニング設定を変更していないか

### レビューコメントの書き方

**建設的なフィードバック**:
```markdown
## ✅ 良い例
この照合を音符単位で行うと、1音の誤認識が小節をまたいで波及します。
プロトタイプ同様、小節単位で数を突き合わせてから対にする方が安全ではないでしょうか？

## ❌ 悪い例
この書き方は良くないです。
```

**優先度の明示**:
- `[必須]`: 修正必須（マージブロッカー）
- `[推奨]`: 修正推奨
- `[提案]`: 検討してほしい
- `[質問]`: 理解のための質問

## 開発環境セットアップ

### 必要なツール

| ツール | バージョン | インストール方法 |
|--------|-----------|-----------------|
| Node.js | v24.x (LTS) | nvm / 公式インストーラ |
| npm | 11.x | Node.js に同梱 |
| Git | 最新 | OS標準またはパッケージマネージャ |

- Java は不要（Audiveris 用 JRE は `scripts/fetch-resources.ts` が配置する）

### セットアップ手順

```bash
# 1. リポジトリのクローン
git clone [URL]
cd [project-name]

# 2. 依存関係のインストール（lockfileに従う）
npm ci

# 3. 同梱リソース（Audiveris・JRE）の取得
npm run fetch-resources

# 4. 開発モードで起動
npm run dev

# 5. テスト実行
npm run test        # ユニット＋統合
npm run test:e2e    # E2E（Playwright）
```

### 品質自動化（CI）

- push / PR ごとに実行: `lint` → `typecheck` → `test`（ユニット・統合）
- E2E は develop / main への PR で実行
- CI がグリーンでない PR はマージ禁止
