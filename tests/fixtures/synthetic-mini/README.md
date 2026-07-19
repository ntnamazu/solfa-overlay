# synthetic-mini フィクスチャ

MusicXML パーサ + OmrSheetParser + ScoreModelBuilder の**通し回帰**（パース→照合）を固定するための合成フィクスチャ。

Audiveris 実出力（`.omr` / `.mxl`）はこのリポジトリでは入手困難なため、プロトタイプ
`tmp/solfa-proto/solfa_proto.py` で実証済みのスキーマを模した**手作りの最小データ**で代替する。
実 Victoria 楽譜での回帰は OmrRunner（zip 展開・Audiveris 実行）実装時に別途整備する。

## 構成ファイル

| ファイル | 役割 |
| --- | --- |
| `score.musicxml` | 論理情報（`parseMusicXml` 入力）。score-partwise・2パート×4小節 |
| `sheet1.xml` | 物理座標（`parseSheetXml` 入力）。1ページ・2システム |
| `book.xml` | movement 分割（`parseBookXml` 入力）。1 sheet・1ページ・単一 movement |

## 楽譜の内容

- **P1 (Soprano / ト音記号 TREBLE)** 4小節
  - m0: G4, （休符）, A4 　※休符は照合対象外
  - m1: D5 + B4（和音）
  - m2: F#5, E5, C5 　※臨時記号 `alter=1` の保持を確認
  - m3: G4
- **P2 (Bass / ヘ音記号 BASS)** 4小節
  - m0: G2
  - m1: C3, D3
  - m2: B2, E♭3 　※臨時記号 `alter=-1`
  - m3: G2, G3 　→ **sheet 側は符頭 3 個**にして音符数不一致を意図的に発生させる

調号は G-dur（`fifths=1`）を第1小節で宣言し、以降は持続。

## 座標設計（中線=0・下向き正）

Audiveris の符頭 `pitch` は「譜表中線を 0、下向きを正」で表す。`clefTable.headStepOctave`
の逆算式 `absIndex = octave*7 + stepIndex - pitch` と整合するよう、各音の `pitch` を決めている。

- TREBLE 中線 = B4（absIndex 34）: G4→2, A4→1, D5→-2, B4→0, F5→-4, E5→-3, C5→-1
- BASS 中線 = D3（absIndex 22）: G2→4, C3→1, D3→0, B2→2, E3→-1, G3→-3

符頭の水平位置は stack（小節の水平範囲）`[left, right)` に符頭中心 `x + trunc(w/2)`（w=20 → +10）が
含まれるかで小節に割り当てられる。system ごとに stack を `[100,500)` と `[500,900)` の 2 つ用意し、
前半小節・後半小節に振り分けている。

## 期待される照合結果（統合テストの固定値）

- **matched 音符 = 13**（P1: 2+2+3+1、P2: 1+2+2+0 　※P1 m0 は休符除外で 2 音）
- **skipped = 1 小節**（P2 の通し小節3。sheet 3 符頭 vs MusicXML 2 音）
- **issues = 1 件のみ**: `measureCountMismatch`（partId=P2, measureIndex=3, omrCount=3, xmlCount=2）
- **音高クロスチェック不一致 = 0**（全音の clef 逆算 step が MusicXML の step と一致）
- SystemInfo: `firstMeasureIndex` = 0（system0）, 2（system1）、各 `measureCount` = 2

### クロスチェックの検出限界（設計メモ）

クロスチェックは step（レター）のみを比較する（octave / alter は対象外）。したがって
TREBLE↔TREBLE_DOWN_8 のような同レター・オクターブ違いの誤認識は検出できない。
検出できるのはレターが変わる誤り（例: TREBLE↔BASS）に限られる。この限界はプロトタイプ実測に基づく
既知の制約で、ユニットテスト（`ScoreModelBuilder.test.ts`）では TREBLE→BASS シナリオで検証している。
