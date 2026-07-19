# 要求内容

- 作業名: 20260719-solfa-pipeline-wiring（階名パイプラインの結線）
- ロードマップ上の位置: Phase 3「階名パイプラインの結線」（`docs/product-requirements.md` の F-3）
  - ユーザー指示では「Phase 2」と呼ばれたが、`.steering/20260719-book-structure-resolver`（＝譜表構造の解決）が
    ロードマップ上の Phase 2 として完了済み。本作業はその次にあたる**階名パイプラインの結線**であり、
    内容は両者で一致している。以降は「Phase 3」と表記する

## 背景

`BookStructureResolver` の導入により、実データの通し小節番号が信頼できるようになった
（divisi: skipped 561 → 135 / matched 604 → 1029 / 照合音符 1433 → 3500）。
一方で `SolfaEngine` は **1音符単位の `computeDegree()` しか持たず**、`ScoreModel` 全体を
階名へ変換する経路が存在しない。`KeyRegion` も型定義だけで生成器がない。

その結果、「MusicXML → 階名文字列」を実データで検証する手段がなく、
F-3（移動ド階名の計算）の正しさは合成した `KeyRegion` に対する単体テストでしか担保されていない。

## 目的

**UI なしで、実フィクスチャの MusicXML から階名文字列列まで一気通貫でテストできる状態にする**
（ロードマップの Phase 3 ゲート）。

## 事前調査（着手前に実施した実データ調査）

前作業の学び「実データを扱う作業では着手前に分布を出す」に従い、
両フィクスチャの `<key>` 宣言を実測した。**設計を左右する事実が3点判明した。**

### 実測結果

| フィクスチャ | movement | パート数 | `<key>` 宣言総数 | 宣言のあった小節（movement ローカル） |
|---|---|---|---|---|
| victoria | 0 | 1 | 0 | （なし） |
| victoria | 1 | 4 | 12 | m7 / m24 / m47（いずれも fifths=1・全4パート） |
| divisi | 0 | 8 | 78 | m48, m108, m114, m133, m141, m145, m148, m153, m177, m178, m182, m186, m187, m195, m196, m204, m205, m317, m321 |

### 判明した事実と、それが設計に与える影響

1. **`<mode>` が実データに1つも存在しない**（全宣言で `mode=null`）
   - Audiveris は `<key><fifths>` のみを出力し `<mode>` を書かない
   - → **長調/短調の自動判別は不可能**。既定を `'major'` に固定し、短調解釈はユーザー指定
     （Phase 4 の ClefKeyConfirm / Phase 6 の転調点 UI）に委ねる
   - → これは **La 基準の移動ド（本アプリの主目的の1つ）が自動では効かない**ことを意味する。
     この制約を明示的に記録し、Phase 4 の要件に送る

2. **曲頭に `<key>` 宣言がない**（victoria は m7、divisi は m48 が初出）
   - → `KeyRegion` の制約「先頭要素は曲頭（measureIndex=0, offset=0）に必ず存在する」を
     満たすため、**曲頭の既定 KeyRegion（fifths=0 = ハ長調）を必ず生成する**必要がある

3. **パート間で有効調号が食い違う小節が実在する**
   - divisi m182: 同じ小節で `fifths=0` と `fifths=-1` が別パートから宣言されている
   - divisi m114 / m141 / m145 / m153: 8 パート中 7 パートのみが宣言（残り1つは前の調号が持続）
   - → 「小節ごと・パートごとに有効な調号を持続計算し、多数決で1つに決める」処理が必要。
     食い違いは**例外にせず issue として報告**する（本プロジェクトの部分失敗方針）

4. **（付随的な観察）自動検出の調号は誤検出を多く含む**
   - divisi の fifths は `1→0→-1→0→-1→0→…` と短い間隔で揺れており、
     楽曲の実際の転調としては不自然
   - → 本作業のスコープは「調号宣言を素直に KeyRegion へ変換すること」であり、
     **誤検出の訂正は Phase 4（ClefKeyConfirm）の責務**。本作業では
     生成された KeyRegion 数を実測値として固定し、Phase 4 の改善目標にする

## 機能要求

### R-1: KeyRegion の自動生成

- `OmrArtifacts`（の MusicXML 群）と `ResolvedStructure` から `KeyRegion[]` を生成する
- movement ローカルの小節番号を、確定構造のアンカー経由で**通し小節番号**へ変換する
- パートごとに調号を持続計算し、小節単位で全パートの有効調号を突き合わせて多数決で決定する
- 調号（fifths）から主音（`tonicStep` / `tonicAlter`）を決定する
- 直前の区間と同じ調が続く小節では新しい `KeyRegion` を作らない
- 曲頭（measureIndex=0, offset=0）の `KeyRegion` を必ず先頭に置く
- 生成した `KeyRegion` の `source` は `'auto'`
- 例外を投げず、検出した問題は issue として部分結果と共に返す

### R-2: ScoreModel → SolfaEngine の結線

- `SolfaEngine.computeDegrees(score, keyRegions, basis)` を実装し、
  `ScoreModel` の全 `NoteEvent` について `SolfaDegree` を計算した `Map<noteId, SolfaDegree>` を返す
- 各音符が属する `KeyRegion` を、その音符の通し小節番号から解決する
- 計算結果を `ScoreModel` に反映するヘルパーを提供し、`NoteEvent.solfa` を埋めた
  新しい `ScoreModel` を得られるようにする（一気通貫テストと Phase 5 の AnnotationManager のため）

### R-3: 実データでの一気通貫回帰

- victoria / divisi の両フィクスチャで、
  「.omr + .mxl → 構造解決 → 照合 → KeyRegion 生成 → 階名計算 → 階名文字列」まで通す回帰テストを追加する
- 実測値（KeyRegion 数・階名を得た音符数・階名の分布・代表小節の階名列）を固定する
- 既存の victoria / divisi 回帰の期待値を**1つも変更しない**（退行検知）

## 受け入れ条件（実績）

- [x] `KeyRegion[]` が実フィクスチャから生成でき、曲頭要素・昇順・重複なしの制約を満たす
      → victoria 2 区間（`m0:C` / `m28:G`）・divisi 8 区間。曲頭は既定のハ長調が入る。
      制約は `KeyRegionBuilder` が生成時に担保し、`SolfaEngine.computeDegrees` が契約として検証する
- [x] `SolfaEngine.computeDegrees()` が `ScoreModel` の全 matched 音符に `SolfaDegree` を与える
      → victoria 808 音 / divisi 3500 音とも**取りこぼしゼロ**
- [x] victoria / divisi で「MusicXML → 階名文字列」の通し回帰テストがパスする
      → `tests/integration/pipeline/solfa-pipeline.test.ts`（13 テスト）
- [x] 既存の victoria / divisi 回帰の期待値が変わらない（退行ゼロ）
      → 着手直後と実装後の 2 回確認し、1 行も変更せずパス
- [x] `npm run test`（345 passed / 18 files）/ `test:coverage`（statements 99.48% / branches 95.42% /
      functions 100% / lines 99.64%。着手前 99.28 / 94.56 / 100 / 99.5）/ `lint` / `typecheck` / `build` 成功
- [x] 判明した制約（mode 不在による長短自動判別の不可能性）が docs に記録され、Phase 4 へ申し送られている
      → `docs/functional-design.md`（KeyRegionBuilder / SolfaEngine / 階名計算ステップ0）・
      `docs/architecture.md`（統合テスト）・`docs/glossary.md`（KeyRegion.source）・両フィクスチャ README

### 事前調査の予測と実績の一致

事前調査で立てた3つの予測は全て実データで裏付けられた。
特に「La 基準の移動ド（本アプリの主目的の1つ）が自動では効かない」は、
**両基準の階名分布が完全に一致する**という形で実測され、回帰テストに固定した。

## スコープ外

- 調号誤検出の訂正 UI（Phase 4: ClefKeyConfirm）
- ユーザーによる転調点指定（Phase 6: F-6）
- 注釈生成・PDF 出力（Phase 5: AnnotationManager / OverlayRenderer）
- 音部記号の誤検出への対処（Phase 4。divisi P6 の ALTO 誤検出は既知）
