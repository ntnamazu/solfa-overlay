# Victoria《O magnum mysterium》実 Audiveris フィクスチャ

ロードマップ Phase 1「OMR 実行と実データ検証」のゲート用。**実 Audiveris 出力**で
ScoreModelBuilder の照合コアが期待どおり動くことを固定する回帰フィクスチャ。

## 出典・著作権

- 楽曲: Tomás Luis de Victoria《O magnum mysterium》（作曲者 1611 年没・**パブリックドメイン**）
- 楽譜 PDF: IMSLP #19716（PMLP46230）→ リポジトリの `tmp/IMSLP19716-PMLP46230-O_Magnum_Mysterium.pdf`
- 開発ガイドライン「テストデータの著作権ルール」: `tests/fixtures/` に置けるのは PD のみ → 適合

## 構成ファイル

| ファイル | 内容 |
| --- | --- |
| `IMSLP19716.omr` | Audiveris 5.6.1 の book 出力（zip）。`book.xml` と `sheet#N/sheet#N.xml`（N=1..3） |
| `IMSLP19716.mvt1.mxl` | movement 1（インチピット）の MusicXML（OPC zip） |
| `IMSLP19716.mvt2.mxl` | movement 2（本体）の MusicXML（OPC zip） |

- **slim 済み**: 元 `.omr` に含まれる `sheet#N/BINARY.png`（生画像・各 150KB 前後）はリポジトリ肥大化
  防止のため除去した。パーサが読むのは XML のみのため回帰結果に影響しない（除去前後で実測値一致を確認）。
- 生成コマンド（ホストで手動実行）: `GDK_SCALE=1 audiveris -batch -save -export -output <dir> -- <pdf>`

## 構造（実データの実挙動）

- Audiveris は 1 ページ目冒頭のインチピットを **別 movement** として切り出す（`book.xml` の
  `sheet#1/page#2` に `movement-start="true"`）。結果、movement は 2 つ（.mxl も 2 ファイル）。
  - movement 0: インチピット（logical part 1 のみ・1 ページ・21 小節）
  - movement 1: 本体（logical part 1–4 = SATB・3 ページ・74 小節）
- ページ総数 4（sheet#1 が 2 ページ、sheet#2/#3 が各 1 ページ）。

## 期待される照合結果（回帰の固定値）

`victoria-regression.test.ts` が固定する実測値（Audiveris 5.6.1・列対付けアルゴリズム）:

| 指標 | 値 |
| --- | --- |
| movements / pages | 2 / 4 |
| parts | P1–P4（すべて Voice = SATB） |
| matched 小節 | 295 |
| matched 音符 | 808 |
| skipped 小節 | 1（`P3:m45`。音符数不一致による隔離） |
| BuildIssue | `measureCountMismatch` 1 件のみ |
| **音高クロスチェック不一致** | **0**（列対付けが実データで取り違えを起こさない＝Phase 1 ゲート達成） |

### プロトタイプ実測との差分

プロトタイプ（`tmp/solfa-proto/solfa_proto.py`）の実測は **784 音・不一致 0・skipped 5 小節**。
本フィクスチャは **808 音・不一致 0・skipped 1 小節** で数値が異なる。要因:

- **Audiveris バージョン差**（本フィクスチャは 5.6.1）による認識音符数・小節認識の違い
- **照合アルゴリズムの違い**: プロトタイプは添字 zip、現行は列対付け（chord-column-pairing で導入）

不一致 0 の維持と skipped の減少（5→1）は良化方向。移植元プロトタイプの実測値は「その版・その
アルゴリズムでの値」であり、現行実装の正しさの基準にはしない（chord-column-pairing の学びを反映）。

## この曲の限界（設計メモ）

- O magnum mysterium は**完全なホモフォニー**（1 譜表 1 声部）で、**和音・divisi の列が 0**。
  したがって本フィクスチャは「パイプライン全体・小節照合・クロスチェック」は検証するが、
  **和音/divisi の列対付けそのものは exercise しない**。列対付けの実データ検証は divisi フィクスチャ
  （`tests/fixtures/divisi/`）が担う（ただし現状は構造誤分割により Phase 2 待ち）。

## 階名パイプライン実測値（Phase 3: 階名パイプラインの結線）

`tests/integration/pipeline/solfa-pipeline.test.ts` が固定する値。

| 項目 | 値 |
|---|---|
| KeyRegion | 2 区間: `m0:C`（曲頭の既定）・`m28:G` |
| KeyRegionIssue | 0 件（4 声部が全て同じ調号を宣言する） |
| 階名を得た音符 | 808（照合音符の全て・取りこぼしゼロ） |
| 階名の種類 | do/re/mi/fa/so/la/ti ＋ di/fi/si/te（変化音 69 音） |

### 調号宣言の実測

`<key><fifths>` の宣言は **mvt2 のローカル m7 / m24 / m47 の 3 箇所のみ**（いずれも fifths=1・全4パート）。
**mvt1 には調号宣言が一切なく、曲頭にも宣言がない**。そのため曲頭には既定のハ長調が置かれ、
mvt2 のローカル m7 = 通し 28 小節目（mvt1 の 21 小節 + 7）でト長調へ移る。

### 判明した制約: `<mode>` が存在しない

Audiveris は `<key><fifths>` のみを出力し **`<mode>` を書かない**。したがって
**長調/短調の自動判別は不可能**で、自動生成される KeyRegion は全て長調になる。
長調では La 基準と Do 基準で do の位置が変わらないため、**両基準の階名結果が完全に一致する**。

これは「La 基準の移動ド」が自動では効かないことを意味し、`ClefKeyConfirm`（F-2・Phase 4）で
調の長短を指定できるようにすることが必須要件になる。回帰テストはこの制約自体を固定しており、
Phase 4 で解消した時点で期待値を更新する。
