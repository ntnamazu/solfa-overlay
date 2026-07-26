# Victoria《O magnum mysterium》実 Audiveris フィクスチャ

ロードマップ Phase 1「OMR 実行と実データ検証」のゲート用。**実 Audiveris 出力**で
ScoreModelBuilder の照合コアが期待どおり動くことを固定する回帰フィクスチャ。

## 出典・著作権（帰属表示）

> ⚠️ **楽曲と楽譜（版）でライセンスが異なる**。当初この README は全体を「パブリックドメイン」と
> 記載していたが、これは**誤り**だった（2026-07-26 に訂正）。楽曲は PD だが、**このフィクスチャの
> もとになった楽譜の版は Creative Commons ライセンス**である。

### 楽曲

- Tomás Luis de Victoria《O magnum mysterium》
- 作曲者 1611 年没 → **パブリックドメイン**（音符そのものの情報に権利は及ばない）

### 楽譜の版（このフィクスチャの直接の出所）

- **編集者: Nancho Alvarez**（2008）
- 出典: IMSLP #19716（PMLP46230）
  <https://imslp.org/wiki/O_magnum_mysterium_(Victoria,_Tom%C3%A1s_Luis_de)>
- **ライセンス: Creative Commons Attribution-NonCommercial-ShareAlike 3.0（CC BY-NC-SA 3.0）**
  <https://creativecommons.org/licenses/by-nc-sa/3.0/>
- **改変の内容**: 上記の版に対し、(1) Audiveris によるOMR で記号データ（`.omr` / `.mxl`）を抽出し、
  (2) プロトタイプ検証では階名を重ね書きした PDF を生成した。本ディレクトリに置いているのは (1) のみ。

### 取り扱い上の注意

- **NC（非営利）条項が付く**。この素材に由来するデータを商用目的で利用することはできない。
  本リポジトリのコードは MIT だが、**リポジトリ全体が商用利用可能なわけではない**
  （[`THIRD_PARTY_LICENSES.md`](../../../THIRD_PARTY_LICENSES.md)「テスト用素材」節を参照）。
- **原本の楽譜 PDF と、階名を重ねた出力 PDF はリポジトリにコミットしない**（`.gitignore` で除外）。
  原本の再配布は MIT を掲げる本リポジトリと整合せず、階名を重ねた出力は ShareAlike が及ぶ翻案物になる。
- 開発ガイドライン「テストデータの著作権ルール」への適合: **適合**（再配布可能なライセンスであり、
  本節で帰属表示を行っている）。

### 将来 PD 版へ差し替える場合の候補

NC 条項を完全に排除したくなった場合（商用展開の検討時など）、同じ IMSLP ページに
**パブリックドメインの版**がある:

| IMSLP # | 版 | 年 |
| --- | --- | --- |
| #63573 / #63649 | Proske, Carl | 1854 |
| #107866 / #412831 | Pedrell, Felipe | 1902 |
| #956632 | O'Carroll, Kevin（CC Zero 1.0） | 2025 |

ただし**版が変わるとレイアウトが変わる**ため、本 README が固定する回帰値（movements 2 / pages 4 /
matched 295 小節 / 808 音符 / 音高クロスチェック不一致 0 など）はすべて再測定が必要になる。

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

`ClefKeyConfirm`（F-2）で調の長短を指定できるようにすることでこれを解消した（Phase 4）。

**Phase 4 で判明した訂正**: 当初「La 基準の移動ドが自動では効かない」と記していたが、これは誤り。
La 基準は短調の主音を La と数える＝ do を「主音の短3度上」＝平行長調の主音に置くため、
自動判定の「常に長調」のままでも **La 基準の階名は正しい**。旋法の指定が階名に効くのは
**Do 基準のとき**である（`tests/unit/main/ProjectSession.test.ts` と
`tests/integration/pipeline/confirmation-effect.test.ts` が両方の性質を固定している）。

## 確認フローの実測値（Phase 4）

`tests/integration/pipeline/confirmation-effect.test.ts` が固定する値。

| 項目 | 値 |
|---|---|
| 譜表数 | 36 |
| 確認項目（パート×検出音部記号のグループ） | 5 行 |

譜表を 1 行ずつ並べる代わりにグループへ畳むことで、確認作業を「1曲5分以内」に収める。

## 注釈・PDF出力の実測値（Phase 5: 階名付与とPDF出力）

`annotation-placement.test.ts` / `export-pdf.test.ts` が固定する値。

### ページ対応（重要）

Audiveris は **3 sheet に対して 4 page** を出力する。`sheet#1` が movement 境界で
2 ページに分かれるため（page 0 = 40音・page 1 = 206音）。

| Audiveris page | sheet | 元PDF ページ（0始まり） |
| -------------- | ----- | ----------------------- |
| 0              | 1     | 0                       |
| 1              | 1     | 0                       |
| 2              | 2     | 1                       |
| 3              | 3     | 2                       |

**`PageAnchor.pageIndex` を元PDFのページ番号として使ってはいけない。**
そのまま使うと page 1 以降の注釈が丸ごと 1 ページずれ、page 3 は存在しないページを指す。
対応の正は book.xml の `<sheet><input><number>`。

### 画像・寸法

| 項目               | 値                                       |
| ------------------ | ---------------------------------------- |
| `.omr` 画像寸法    | 2480 × 3507 px（sheet 単位。300dpi の A4） |
| 譜線間隔           | 17 px                                    |
| 元PDF ページ寸法   | 595.28 × 841.89 pt（実物で確認）          |
| 元PDF ページ数     | 3                                        |

### 注釈と配置

| 指標                       | 値                    |
| -------------------------- | --------------------- |
| 注釈数                     | 808（階名を得た音符と 1:1） |
| 配置を解決できなかった注釈 | **0 件**              |
| 注釈どうしの重なり         | 0                     |
| 標準フォントで描けない音節 | なし                  |

### 出力PDF

ページ数・各ページ寸法とも元PDFと一致する（版面を変えない）。

> **元PDF はリポジトリに含めていない**（**ライセンス上の理由**。CC BY-NC-SA 3.0 の楽譜そのものを
> MIT リポジトリで再配布しないため。当初この README は理由を「数十MBあるため」と記していたが、
> 実サイズは 124KB で事実と異なっていた。2026-07-26 訂正）。テストでは `.omr` の画像寸法を
> 300dpi として逆算した寸法の空PDF を合成して使う。検証対象は px → pt の線形変換と
> ページ対応であり、版面の中身には依存しない。
