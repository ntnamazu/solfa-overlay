# 実装アプローチ

- 作業名: 20260719-solfa-pipeline-wiring（階名パイプラインの結線）

## 全体像

```
OmrArtifacts ─┬─→ BookStructureResolver.resolve() ─→ ResolvedStructure ─┐
              │                                                          ├─→ ScoreModelBuilder.build() ─→ ScoreModel ─┐
              └──────────────────────────────────────────────────────────┘                                            │
              │                                                                                                       ├─→ SolfaEngine.computeDegrees()
              └─→ KeyRegionBuilder.build(artifacts, structure) ─→ KeyRegion[] ───────────────────────────────────────┘
                                                                                                                       │
                                                                                              Map<noteId, SolfaDegree> ┘
                                                                                                       │
                                                                                    applyDegrees() ─→ ScoreModel（solfa 充填済み）
                                                                                                       │
                                                                                        SolfaEngine.toSyllable() ─→ 階名文字列
```

`KeyRegionBuilder` は `ScoreModelBuilder` と**同じ入力**（`OmrArtifacts` + `ResolvedStructure`）を取る。
どちらも「movement ローカル小節番号 → 通し小節番号」の変換を必要とするため、
この変換の基準値を求める処理を共通モジュールへ切り出す。

## 新規ファイル

| パス | 役割 |
|---|---|
| `src/domain/score/structureAnchors.ts` | `ResolvedMovement` から通し小節番号の基準値を求める純粋関数 |
| `src/domain/solfa/keyTable.ts` | 調号（fifths）→ 主音の対応表（`clefTable.ts` と同じ表駆動パターン） |
| `src/domain/solfa/KeyRegionBuilder.ts` | `KeyRegion[]` の自動生成 |

## 変更ファイル

| パス | 変更内容 |
|---|---|
| `src/domain/score/ScoreModelBuilder.ts` | 基準値計算を `structureAnchors.ts` へ委譲（重複解消） |
| `src/domain/solfa/SolfaEngine.ts` | `computeDegrees()` / `applyDegrees()` を追加 |
| `tests/integration/pipeline/realFixtureHelpers.ts` | 階名まで通すヘルパーと要約項目を追加 |

## 詳細設計

### 1. `structureAnchors.ts`

`ScoreModelBuilder` が現在インラインで持っている 2 つの計算を関数化する。
`KeyRegionBuilder` が同じ計算を再実装すると、片方だけ直したときに
「照合結果と KeyRegion の小節番号がずれる」という気付きにくい不具合になるため、最初から1箇所にする。

```typescript
/** movement の先頭小節（通し小節番号）。段の並び順に依存しないよう最小値を採る */
export function movementFirstMeasureIndex(movement: ResolvedMovement): number;

/** movement の終端（最後の小節の次）。段が空なら fallback をそのまま返す */
export function movementEndMeasureIndex(movement: ResolvedMovement, fallback: number): number;
```

`movementFirstMeasureIndex` は段が空のとき `Number.POSITIVE_INFINITY` を返す
（現行 `ScoreModelBuilder` の挙動を保つ。呼び出し側が `systems.length > 0` を確認してから使う）。

### 2. `keyTable.ts`

**調号 → 主音の対応表**。`fifths` は -7〜+7 を扱う。

```typescript
export const MAJOR_TONICS: Readonly<Record<number, KeyTonic>>;  // 0 → C, 1 → G, -1 → F, ...
export const MINOR_TONICS: Readonly<Record<number, KeyTonic>>;  // 0 → A, 1 → E, -1 → D, ...

export function tonicForFifths(fifths: number, mode: 'major' | 'minor'): KeyTonic | null;
```

- 範囲外（|fifths| > 7）は `null` を返し、呼び出し側が issue として報告する
- **検算テスト**: `MINOR_TONICS[f]` は `MAJOR_TONICS[f]` の平行短調（レター2つ下・半音3つ下）に
  必ず一致する。この性質を全 15 通りで表駆動検証する（既存 `SolfaEngine.test.ts` の
  「全24調で調号と一致する」検算と同じ流儀）
- さらに `resolveDo(MINOR_TONICS[f], 'la')` が `MAJOR_TONICS[f]` に一致することも検証し、
  **KeyRegionBuilder と SolfaEngine が同じ調観を共有している**ことを担保する

### 3. `KeyRegionBuilder`

```typescript
export interface KeyRegionBuildResult {
  keyRegions: KeyRegion[];
  issues: KeyRegionIssue[];
}

export type KeyRegionIssue =
  | { kind: 'keySignatureConflict'; measureIndex: number; fifthsByPart: Record<string, number>; adopted: number }
  | { kind: 'unsupportedKeySignature'; measureIndex: number; partId: string; fifths: number };

export class KeyRegionBuilder {
  build(artifacts: OmrArtifacts, structure: ResolvedStructure): KeyRegionBuildResult;
}
```

**アルゴリズム**（事前調査の実測に基づく）:

1. `structure.movements` を順に走査し、`movementFirstMeasureIndex` を基準に
   MusicXML のローカル小節番号を通し小節番号へ変換する
2. **パートごとに調号を持続させる**。`MusicXmlMeasure.key === null` は「前の調号が持続」を意味する
   （実測: divisi m114 は 8 パート中 7 パートのみが宣言 → 残り1つは持続値を使う必要がある）
3. 小節ごとに全パートの有効 fifths を集計し、**最頻値を採用**する。同数の場合は
   小さい fifths を採る（決定的にするため）。2 種以上あれば `keySignatureConflict` を報告する
   （実測: divisi m182 は fifths=0 と -1 が混在）
4. 採用 fifths が直前の区間と異なる小節でのみ `KeyRegion` を生成する
5. **mode は常に `'major'`**。実測で `<mode>` が 1 つも存在しないため、
   `MusicXmlKey.mode` が `null` のときの既定を `'major'` とする
   （`'minor'` が来た場合は素直に尊重する。将来 Audiveris が出力するようになった場合に備える）
6. **曲頭 KeyRegion を必ず生成する**。`measureIndex 0` に採用値がなければ fifths=0（ハ長調）を置く
   （実測: victoria は m7、divisi は m48 が初出のため、これがないと制約を満たせない）
7. `id` は `key-<通し小節番号>` 形式（決定的で、回帰テストのスナップショットが安定する）

**issue にする理由**: 本プロジェクトは「部分失敗は全体を失敗にしない」方針
（機能設計書「エラーハンドリング」）。調号の食い違いは実データで日常的に起きるため、
例外にすると実用にならない。報告のみ行い、Phase 4 の ClefKeyConfirm が訂正材料に使う。

### 4. `SolfaEngine.computeDegrees()` / `applyDegrees()`

```typescript
class SolfaEngine {
  computeDegrees(score: ScoreModel, keyRegions: KeyRegion[], basis: MinorBasis): Map<string, SolfaDegree>;
}

export function applyDegrees(score: ScoreModel, degrees: Map<string, SolfaDegree>): ScoreModel;
```

**設計書からのシグネチャ変更**: 機能設計書は `computeDegrees(score, keyRegions)` だが、
`basis`（短調基準）がないと do の位置が決まらない。既存の `computeDegree(note, region, basis)` と
揃えて第3引数に `basis: MinorBasis` を足す。機能設計書を実装に合わせて更新する。

**KeyRegion の解決**:
- `keyRegions` は `start` 昇順・先頭が `measureIndex 0` であることを**契約**とし、
  違反時は例外を投げる（`ScoreModelBuilder` が `ResolvedStructure` の契約違反を例外にするのと同じ扱い。
  呼び出し側が組んだデータの健全性チェックであり、認識エラーではない）
- 音符の `measureIndex` に対して**二分探索**で「`start.measureIndex <= m` を満たす最後の region」を引く
  （実データは音符 3500・region 20 程度だが、線形走査の O(n×r) を避けて素直に書く）

**既知の限界（TSDoc に明記する）**:
`NoteEvent` は小節内オフセットを持たないため、**`KeyRegion.start.offset` は無視され、
その小節の先頭から新しい調が適用される**。自動生成の KeyRegion は必ず offset=0 のため
現時点で実害はない。ユーザーが小節途中の転調を指定できるようになる Phase 6（F-6）の時点で、
`NoteEvent` に offset を持たせるか判断する。

**`applyDegrees`**: `ScoreModel` を破壊せず、`solfa` を埋めた新しい `ScoreModel` を返す純粋関数。
`Map` を返す設計書準拠のインターフェースだけだと「小節ごとの階名列」を取り出すのに
呼び出し側で毎回 join が要るため、一気通貫テストと Phase 5 の `AnnotationManager` のために用意する。

## テスト方針

| テスト | 内容 |
|---|---|
| `tests/unit/domain/score/structureAnchors.test.ts` | 基準値計算（空 systems・逆順 systems・複数 movement） |
| `tests/unit/domain/solfa/keyTable.test.ts` | 全 15 fifths の主音・平行短調の検算・`resolveDo` との整合・範囲外 |
| `tests/unit/domain/solfa/KeyRegionBuilder.test.ts` | 曲頭既定・調号持続・多数決・conflict 報告・範囲外報告・movement 跨ぎ |
| `tests/unit/domain/solfa/SolfaEngine.test.ts`（追記） | `computeDegrees` の region 解決・契約違反例外・`applyDegrees` の非破壊性 |
| `tests/integration/pipeline/solfa-pipeline.test.ts` | victoria / divisi の一気通貫回帰（実測値を固定） |

**退行検知の順序**（前作業の学びを踏襲）:
既存の `victoria-regression.test.ts` / `divisi-regression.test.ts` を**先に**実行し、
期待値が 1 つも変わらないことを確認してから新規回帰テストの実測値を固定する。

## 判断の記録

- **`KeyRegionBuilder` を `src/domain/solfa/` に置く理由**: `KeyRegion` は調文脈＝階名計算の入力であり、
  楽譜認識（`src/domain/score/`）の成果物ではない。用語集でも「調文脈」は階名計算側の概念
- **mode 既定を `'major'` にする理由**: 実測で `<mode>` が存在せず判別材料がない。
  fifths=0 を「イ短調」と推測するより「ハ長調」と扱うほうが、ユーザーが誤りに気付いて
  訂正しやすい（調号なし＝ハ長調は最も一般的な既定）。La 基準短調は Phase 4 でユーザー指定に委ねる
- **多数決の同数時に小さい fifths を採る理由**: 実測で同数ケースは divisi m182（0 と -1 が 1:1）のみ。
  どちらが正しいかを判定する材料がないため、**決定的であること**を優先する。
  正しさの担保は Phase 4 の訂正 UI が担う
