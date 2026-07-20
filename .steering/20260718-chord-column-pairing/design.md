# 設計

- 作業名: 20260718-chord-column-pairing（和音・多声の符頭対付け修正）

## 現状の問題

`matchStack`（ScoreModelBuilder.ts）は次の対付けを行う:

```
stackHeads（x 昇順） × xmlNotes（文書順） を添字 zip
```

- 和音: 構成音の x はほぼ同値 → x 順と文書順の一致は保証されない
- 異リズム多声: 文書順は「声部1全部 → backup → 声部2全部」、x 順は時間順 → 原理的に不一致

## 新アルゴリズム: 貪欲な offset 列対付け

```
1. xmlNotes を offset でグループ化 → 列（同時に鳴る音群）。列を offset 昇順に整列
2. 音符総数の照合（不一致 → skipped + measureCountMismatch issue）※現行維持・列化の前段
3. x 昇順の stackHeads を、列サイズどおり先頭から貪欲にスライス
4. 列内の対付け:
   - 符頭: 譜表位置 pitch 昇順（中線=0・下向き正 → 昇順 = 高い音から）、同値は x 昇順
   - 音符: diatonicIndex（= octave*7 + stepIndex, C0 起点）降順（= 高い音から）、
     同値は文書順（Array.prototype.sort は安定）
5. step クロスチェック・NoteEvent 生成は現行どおり（対ごと）
```

### この設計の根拠

- **offset は既に正しい**: MusicXmlParser のカーソル方式（backup/forward 対応）が
  実装・テスト済みのため、多声の音符も正しい小節内時刻を持つ。offset 列化だけで
  声部マージが完了し、声部推定（y 帯・符尾方向）は不要
- **総数照合が安全網**: 列サイズ合計 = 音符総数 = 符頭総数（前段で照合済み）のため、
  貪欲スライスは常に全符頭をちょうど消費する。列境界の閾値（マジックナンバー）不要
- **縦位置は診断的に一意**: 譜表位置は幹音（step+octave）と一対一（臨時記号は
  位置を動かさない）。同列内の対付けキーとして曖昧さがない
- **グレースノートも改善**: grace は主音符と同 offset（duration 0）→ 同列になり、
  縦位置対付けで x ずれ（グレースは左に彫られる）の影響を受けない

### 挙動が変わる点（互換性メモ）

- `Measure.notes` の並び順が「x 順」から「offset 順 → 列内は高い音から」に変わる。
  NoteEvent.id（`partId:m小節:n連番`）はこの並びで採番される。決定的であることは
  維持（OMR 再実行後の注釈引き継ぎ照合の前提は保たれる）
- synthetic-mini 統合テストは期待値変更なしでパスする見込み（和音 D5+B4 は
  文書順が既に高→低のため）

### 既知の限界（次作業へ申し送り）

- **ユニゾン共有符頭**: 版面上 1 符頭に 2 声部が乗る場合、音数不一致 → skipped。
  divisi の入り/終わりで頻出しうる。緩和ルール（同 offset・同音高の重複集約）は
  実フィクスチャで Audiveris の実出力を確認してから導入判断
- **列間の x 逆転**: 密な彫版で 2 度衝突の符頭シフトが隣列の x を跨ぐ理論上の
  ケースは貪欲スライスでは検出できない。実フィクスチャで頻度を観察

## 変更ファイル

| ファイル                                            | 変更                                                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/domain/score/clefTable.ts`                     | `diatonicIndex(step, octave)` を export（LETTERS を再利用）                                    |
| `src/domain/score/ScoreModelBuilder.ts`             | `matchStack` を列対付けに書き換え。stack 内包判定の丸めを `Math.trunc` に統一（レビュー指摘3） |
| `tests/unit/domain/score/clefTable.test.ts`         | `diatonicIndex` のテスト追加                                                                   |
| `tests/unit/domain/score/ScoreModelBuilder.test.ts` | note ヘルパーに offset 追加・新シナリオ4件                                                     |
| `docs/functional-design.md`                         | 小節照合 3. の記述を列対付けに更新                                                             |

## テスト設計（新シナリオ）

1. **和音の文書順×x順食い違い（異レター）**: doc=[C4,E4]・head x順=[E位置,C位置]。
   旧: 座標取り違え＋クロスチェック誤検出2件 → 新: 正対付け・issue 0
2. **オクターブ重複 divisi（同レター）**: doc=[G5,G4]・head x順=[G4位置,G5位置]。
   旧: 静かに座標取り違え（step 同一で検出不能） → 新: 縦位置で正対付け
3. **backup/forward 異リズム多声**: 声部1=[C5@0,D5@2]・声部2=[E4@0(全音符)]。
   列 {0:[C5,E4], 2:[D5]} の貪欲スライスで正対付け・issue 0
4. **ユニゾン共有符頭の現状明文化**: 同 offset・同音高 2 音 vs 符頭 1 個 →
   measureCountMismatch で skipped（厳格照合の現状をテストで固定）

## リスクと対策

- 既存テストの note ヘルパーは全音符 offset=0 のため、列化で同一列に束ねられ
  並び順が変わる → ヘルパーに offset 引数を追加し、逐次音は逐次 offset を渡す
  （実パーサの挙動に合わせた修正。テストの意味論がより正確になる）
