# divisi《The Message of the Angels》実 Audiveris フィクスチャ（Phase 2 前ベースライン）

ロードマップ Phase 1 で「SSAATTBB divisi 曲による列対付けの実データ検証」を狙ったフィクスチャ。
実データ検証の結果、**この曲は BookStructureResolver（Phase 2）なしでは正しく照合できない**ことが
判明した。本フィクスチャは列対付けの正しさを主張するものではなく、**現状のスナップショット**と
**Phase 2 の改善目標**を固定する。

## 出典・著作権

- 楽曲: William Reed《The Message of the Angels》（Copyright 1919・作曲者ベースでも 70 年超過・
  IMSLP 表記 **Public Domain**）
- 出典: IMSLP #175782 <https://imslp.org/wiki/The_Message_of_the_Angels_(Reed%2C_William)>
- 開発ガイドライン「テストデータの著作権ルール」（PD のみ commit 可）に適合。

## 構成ファイル

| ファイル | 内容 |
| --- | --- |
| `IMSLP175782.omr` | Audiveris 5.6.1 の book 出力（zip）。`book.xml` と `sheet#N/sheet#N.xml` |
| `IMSLP175782.mxl` | 単一 movement の MusicXML（OPC zip・8 パート・329 小節） |

- **slim 済み**: `BINARY.png` を除去（5.1MB → 2.4MB）。回帰結果は除去前後で一致。
- sheet#1/#2 は画像のみで sheet XML を持たない（Audiveris が未転写としたページ）。assembleArtifacts は
  XML を持つシートのみをページ化するため、これらは自然に飛ばされる。

## 実データが露呈させた構造問題（重要）

- この曲は**声部の段階的入り**を含む。`book.xml` の 1 ページ目は
  `part8 → part7,8 → part7,8 → part4-8` とシステムごとに登場パートが変化する。
- ScoreModelBuilder は「全パートが全システムに存在する」前提で、システムの stack 数を
  movement 全体で累積して通し小節番号を決める。遅れて入るパートは小節番号が全体的にずれ、
  結果として大量の小節が `measureCountMismatch` / `pitchCrossCheckMismatch` になる。
- これはまさに BookStructureResolver（機能設計書: インチピット等による**誤分割の検出と復元**）が
  解決すべき領域であり、**Phase 2 の対象**。列対付けアルゴリズム自体の欠陥ではない。

## 現状値（`divisi-regression.test.ts` が固定するベースライン）

| 指標 | 値 | 備考 |
| --- | --- | --- |
| movements / pages / parts | 1 / 20 / 8 | P8 は Audiveris が 2 段（Piano）として検出 |
| matched 小節 | 604 | 構造ずれを含む |
| skipped 小節 | 561 | **Phase 2 で減少見込み** |
| matched 音符 | 1433 | |
| 和音・divisi 列を持つ小節 | 84 | **列対付けが実際に稼働している証拠** |
| `pitchCrossCheckMismatch` | 395 | 大半は構造ずれ由来（列対付けの取り違えではない） |
| `measureCountMismatch` | 561 | |
| `measureOutOfRange` | 13 | |

> これらの数値は BookStructureResolver 未実装ゆえの構造ずれを含む。Phase 2 実装後、
> skipped・mismatch は減少方向に更新される想定であり、テストの期待値もその時点で更新する。

## 既知の限界（Phase 2 以降で観察・判断する項目）

前作業（chord-column-pairing）の申し送りで実フィクスチャ観察が求められた項目。構造ずれが解消
する Phase 2 以降でないと個別現象を切り分けられないため、現時点では**未確定**として記録する:

- **ユニゾン共有符頭**（1 符頭 2 声部）の Audiveris 実出力挙動 → 照合緩和ルールの要否
- **列間 x 逆転**（2 度衝突の符頭シフトが隣列を跨ぐか）の頻度
- **グレースノート**の符頭が head として出力されるか（出力されない場合は音数不一致になる）
