# 開発ガイドライン (Development Guidelines)

- 作成日: 2026-07-13
- 前提ドキュメント: [アーキテクチャ設計書](architecture.md) / [リポジトリ構造定義書](repository-structure.md)

## コーディング規約

### 命名規則

#### 変数・関数

```typescript
// ✅ 良い例
const skippedMeasures = builder.listSkippedMeasures();
function computeDegree(note: Pitch, region: KeyRegion): SolfaDegree {}

// ❌ 悪い例
const data = build();
function calc(n: any): any {}
```

**原則**:

- 変数: camelCase、名詞または名詞句
- 関数: camelCase、動詞で始める
- 定数: UPPER_SNAKE_CASE
- Boolean: `is`, `has`, `should` で始める（例: `isConfirmed`, `hasCollision`）

#### クラス・インターフェース

```typescript
// クラス: PascalCase、名詞
class SolfaEngine {}
class ScoreModelBuilder {}

// インターフェース・型: PascalCase、I接頭辞なし
interface KeyRegion {}
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
function computeDegree(note: Pitch, region: KeyRegion, basis: MinorBasis): SolfaDegree {}
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
  constructor(
    message: string,
    public readonly logPath: string,
  ) {
    super(message);
    this.name = 'OmrExecutionError';
  }
}

class ProjectFileError extends Error {
  // cause の種別は用語集「プロジェクトファイルエラー」の定義を正とする
  // （'version' はアプリより新しい schemaVersion の検出。ファイルを変更せずアプリ更新を案内する）
  constructor(
    message: string,
    public readonly cause: 'zip' | 'schema' | 'version' | 'io',
  ) {
    super(message);
    this.name = 'ProjectFileError';
  }
}
```

### UIテキスト規約

画面に出す日本語は、**ユーザーを案内する**ために書く。丁寧さを積み上げるほど文は長くなり、
「何をすればよいか」が文の後ろへ追いやられる。

**指示は「〜してください」で書く**:

```typescript
// ✅ 良い例
'段の小節数を楽譜と見比べて入力してください';
'楽譜を見て選ぶと、そこから照合できるようになります';

// ❌ 悪い例
'段の小節数を楽譜と見比べて入力していただきたい';
'楽譜を見て選んでいただくと、そこから照合できるようになります';
```

「〜していただく」は「〜してもらう」の謙譲語であり、**隠れ主語がアプリ側**になる。
確認画面の作業はユーザー自身の楽譜を仕上げるための行動であって、アプリが恩恵を受ける構図ではない。
願望を重ねた「〜していただきたい」は、案内ではなく申し入れとして読まれる。

**見出しは名詞句にする**:

```typescript
// ✅ 良い例
<h2>直すところ（{n} 件）</h2>

// ❌ 悪い例
<h2>直していただきたいところ（{n} 件）</h2>
```

**ユーザーが取る行動を書く。評価・感想は書かない**:

```typescript
// ✅ 良い例
'段の小節数がずれると、そのあとのページ全体に影響します。ここは直してから次へ進んでください';

// ❌ 悪い例
'段の小節数がずれると、そのあとのページ全体に影響します。ここだけは直しておく価値があります';
```

**エラーは非難せず、次の一手を示す**:

読み取り結果が期待どおりでないことは、このアプリでは通常運転である（OMR の限界）。
ユーザーの操作ミスとして書かない。

**敬語を使うのは、ユーザーが本来やりたくない操作を強いるときに限る**:

確認画面はユーザー自身の目的（正しい階名付き楽譜を得ること）に沿った作業なので該当しない。

**内部識別子・専門用語を画面に出さない**:

方針と実例は[機能設計書](functional-design.md)「画面に出す語彙の方針」を正とする。
表示文字列の実体は `src/renderer/labels/scoreLabels.ts` に置く（用語集と二重管理しない）。

**原則**:

- 指示は「〜してください」。「〜いただく」「〜いただきたい」は使わない
- 見出しに依頼表現を入れない
- 「〜することができます」ではなく「〜できます」
- 同じ概念を複数の言い回しで説明しない
- 1 文を短くする。逆接で 2 つの情報を繋がず、言い切ってから理由を続ける

**参考にした外部ガイドライン**:

- [SmartHR Design System「基本的な考え方」](https://smarthr.design/products/contents/writing-style/) — 「敬語を使いすぎない」「冗長な日本語を避ける」
- [Ubie Vitals「UXライティング ガイドライン」](https://vitals.ubie.life/ux-writing/) — UI コンポーネントでは原則として敬語を使わない
- [Apple HIG「Writing」](https://developer.apple.com/design/human-interface-guidelines/writing) — エラーメッセージで "we" を主語に立てない
- [Microsoft Writing Style Guide「Writing tips」](https://learn.microsoft.com/en-us/style-guide/global-communications/writing-tips) — 手順は命令法（imperative mood）で書く

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

- 検証済み題材（Victoria《O magnum mysterium》）の実 Audiveris 出力で定量回帰: matched 295小節・808音・音高クロスチェック不一致0・skipped 1小節（実測値。`tests/fixtures/victoria/README.md` を正とする）。数値は Audiveris バージョン依存のため更新時は差分レビュー必須
- Audiveris 本体はテストで実行しない（フィクスチャ化した出力を使う）。Audiveris 更新時はフィクスチャを再生成し、差分をレビューする

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

### テストの実行時間

実フィクスチャ（`.omr` / `.mxl`）の展開とパースは 1 回あたり数百 ms かかる。放置するとテストが
CI ランナーの速度差でタイムアウトする（実例: `assembleArtifacts` をテストごとに呼び直していた
`ProjectSession.test.ts` が GitHub Actions 上でのみ 5000ms を超えて CI が落ちた）。

**組み立ての使い回し**:

- フィクスチャの組み立てが**純粋関数**で、入力がテスト間で変わらないなら、モジュールスコープで
  1 度だけ組み立てて使い回す。テストごとに作り直しても同じ結果にしかならない
- 使い回すオブジェクトは**再帰的に `Object.freeze` する**。破壊的変更があれば即座に失敗するため、
  テスト間汚染を防ぎつつ「解析側は読むだけ」であることの実行時の証明にもなる
- ただし**検証対象そのもの**は使い回さない。上の判断は「そのテストが何を確かめているか」に依る

**待機ヘルパー**:

- 条件成立をポーリングで待つときは、**観測手段を軽いものにする**（例: 保存の発生は重い再オープンではなく
  世代バックアップファイルの出現で見る）。重い処理をポーリングで回すと、それ自体がタイムアウトの原因になる
- 軽い観測で「起きたこと」を確認したうえで、**内容の検証は成立後に 1 度だけ**行う

**タイムアウト設定**:

- `vitest.config.ts` の `testTimeout` は CI ランナーの速度差に対する余裕であり、遅いテストを
  許容するためのものではない。まずテストを速くし、そのうえで保険として置く
- **`projects` の各設定はルート直下の `test` を継承しない**。`testTimeout` などはプロジェクトごとに指定する

**遅くなったときの調査**:

```bash
npx vitest run <対象ファイル> --reporter=verbose   # テストごとの所要時間が出る
```

多くのテストが同じくらい遅いなら、共通の下ごしらえ（`beforeEach` や擬似実行器）に下駄がある。

### テストデータの著作権ルール

**`tests/fixtures/` に置けるのは、パブリックドメイン、または再配布可能なライセンスの楽譜のみ**。
後者の場合、次を必ず満たすこと:

- そのフィクスチャの `README.md` に**帰属表示**を書く（編集者名・出典 URL・ライセンス名とバージョン・
  ライセンス本文 URL・**どう改変したか**）
- `THIRD_PARTY_LICENSES.md`「テスト用素材」節の一覧に追加する

**素材の判断でよくある誤り: 楽曲と楽譜（版）でライセンスが違う**

古い楽曲の楽譜は、**楽曲がパブリックドメインでも、その版（校訂・浄書）には別の権利やライセンスが
付いている**ことがある。IMSLP のページでは楽曲単位ではなく**ファイル単位**でライセンスが表示されるので、
必ず**使用するファイルの表記**を確認すること。

> 実例: `tests/fixtures/victoria/` は Victoria（1611 年没）の楽曲だが、素材にした版は
> Nancho Alvarez 編（2008）で **CC BY-NC-SA 3.0**。当初 PD と誤認していた（2026-07-26 訂正）。

**コミットしてはいけないもの**

- 著作権のある楽譜のスキャン・OMR成果物（ローカル検証にとどめる。`.gitignore` の `*.solfaproj` 除外を外さない）
- **PD でない素材の原本 PDF**（再配布にあたる）
- **PD でない素材から生成した階名付き出力 PDF**（ShareAlike 条項が及ぶ翻案物になる）

**NC（非営利）条項が付く素材を使う場合**

その素材に由来するデータは商用利用できない。本リポジトリのコードは MIT だが、**リポジトリ全体が
商用利用可能なわけではない**状態になるため、`THIRD_PARTY_LICENSES.md` にその旨を明記すること。
NC 条項を避けたい場合は、PD または CC0 の版を探して差し替える。

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

| ツール  | バージョン  | インストール方法                 |
| ------- | ----------- | -------------------------------- |
| Node.js | v24.x (LTS) | nvm / 公式インストーラ           |
| npm     | 11.x        | Node.js に同梱                   |
| Git     | 最新        | OS標準またはパッケージマネージャ |

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
