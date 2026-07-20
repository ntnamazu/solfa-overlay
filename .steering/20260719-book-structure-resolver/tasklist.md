# タスクリスト

- 作業名: 20260719-book-structure-resolver（Phase 2: 譜表構造の解決）

## 🚨 タスク完全完了の原則

**このファイルの全タスクが完了するまで作業を継続すること**

### 必須ルール

- **全てのタスクを`[x]`にすること**
- 「時間の都合により別タスクとして実施予定」は禁止
- 未完了タスク（`[ ]`）を残したまま作業を終了しない

### タスクスキップが許可される唯一のケース

実装方針・アーキテクチャ・依存関係の変更により技術的にタスクが不要／実行不可能になった場合のみ。
スキップ時は `- [x] ~~タスク名~~（理由）` の形式で理由を明記する。

---

## フェーズ1: MusicXmlParser の段レイアウト抽出

- [x] `MusicXmlSystemLayout` 型を定義し `ParsedMusicXml` に `layout` を追加
- [x] `<print new-page>` / `<print new-system>` からレイアウトを導出する実装
  - [x] 小節数が最大のパートを基準にする（divisi の P7 は 328・他は 329）
  - [x] `new-page` は暗黙に段の開始でもある
  - [x] `<print>` なし → 1 ページ・1 段・全小節のフォールバック
- [x] `tests/unit/domain/score/MusicXmlParser.test.ts` にレイアウト抽出テストを追記（18 tests pass）
- [x] 既存の MusicXmlParser テストが退行しないことを確認
- [x] 実フィクスチャで検算（divisi 20 ページ/69 段/329 小節・Victoria mvt1 3 段/mvt2 9 段）

## フェーズ2: ResolvedStructure の拡張

- [x] `ResolvedSystem`（pageIndex / systemIndex / firstMeasureIndex / measureCount）を定義
- [x] `ResolvedMovement` に `systems` を追加（`pageIndices` は表示材料として維持）
- [x] 型コメントを「未実装」から実装済みの意味に更新

## フェーズ3: BookStructureResolver（新規）

- [x] `StructureIssue` / `StructureDecision` 型を定義
- [x] `detect(artifacts, bookPages)` を実装
  - [x] movement 数不一致（`movementCountMismatch`）
  - [x] ページ数不一致（`pageCountMismatch`）
  - [x] 段数不一致（`systemCountMismatch`）
  - [x] 段あたり小節数不一致（`systemMeasureCountMismatch`）
  - [x] ~~誤分割の疑い（`fragmentedSystem`。stack 境界一致・譜表集合が重複しない連続段）~~
        → `inconsistentSystemStaffCount`（同一ページ内で段ごとの譜表数が不揃い）に置き換え
        （判定条件の変更: stack 境界一致は Victoria の正常な段を誤検出し divisi page0 を取りこぼした）
- [x] `resolve(artifacts, bookPages, decisions?)` を実装
  - [x] movement 割当（既定 `min(i, movements.length - 1)`・decision で上書き）
  - [x] 段ごとの `firstMeasureIndex` / `measureCount` アンカー生成
  - [x] 小節数の決定順（decision → XML レイアウト → stacks.length）
  - [x] movement をまたぐ通し小節番号の累積（MusicXML の論理小節数基準）
- [x] `tests/unit/domain/score/BookStructureResolver.test.ts` を新規作成
  - [x] detect の各 issue 種別
  - [x] 正常な段では譜表数の警告を出さない
  - [x] resolve の既定アンカー・フォールバック・decision 反映・複数 movement 累積

## フェーズ4: ScoreModelBuilder のアンカー対応

- [x] `movement.systems` を走査する形へ変更（stack 数の累積を撤廃）
- [x] `globalMeasureIndex = firstMeasureIndex + stackIndex` に変更
- [x] `measureCount` 超過 stack を `measureOutOfRange` として段内に隔離
- [x] `SystemInfo.measureCount` にアンカー値を反映
- [x] MusicXML ローカル小節番号を movement 先頭からの相対で引く
- [x] `tests/unit/domain/score/ScoreModelBuilder.test.ts` に追記
  - [x] 段の小節数超過が後続段の小節番号をずらさない
  - [x] `SystemInfo.measureCount` がアンカー値になる

## フェーズ5: 呼び出し側の置き換え

- [x] `tests/integration/pipeline/realFixtureHelpers.ts` を BookStructureResolver 経由に変更
  - [x] `FixtureSummary` に `structureIssueCounts` を追加
- [x] `tests/integration/pipeline/synthetic-mini.test.ts` の `resolveStructure` を置き換え
- [x] synthetic-mini の既存期待値が変わらないことを確認

## フェーズ6: 実データ回帰

- [x] **先に** Victoria 回帰を実行し、期待値が 1 つも変わらないことを確認（退行検知・全 4 テスト pass）
- [x] divisi 回帰を実行し、新しい実測値を取得
- [x] `divisi-regression.test.ts` を「構造解決後の回帰」に書き換え（見出し・コメント含む）
  - [x] matched / skipped / notes / issueCounts の期待値を実測値で固定
  - [x] detect() の StructureIssue 件数を固定
- [x] 成功指標の達成を確認（skipped < 200 かつ notes >= 3000）
- [x] `tests/fixtures/divisi/README.md` を更新（真因の訂正・新実測値・残存する既知の限界）

## フェーズ7: 品質チェック

- [x] `npm run test`（222 passed / 14 files）
- [x] `npm run test:coverage`（statements 99.28% / branches 94.56% / functions 100% / lines 99.5%。従来 99.09/93.65/100/99.37 から改善）
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run build`

## フェーズ7.5: 実装検証（implementation-validator）反映

- [x] implementation-validator を実施（総合 5/5・重大問題なし）
- [x] [推奨] `planMovements` の既知の限界（ページ列の途中で sheet XML が欠落するとページ対応がずれる）を
      TSDoc に明記
- [x] [推奨] `docs/functional-design.md` のシグネチャ乖離 → フェーズ8 で対応（計画済みのため重複計上しない）
- [x] [提案] `measureCount: 0` の decision の境界テストを追加（227 tests pass）
- [x] [提案] `detect` / `resolve` のレイアウト対応判定の共通化 → **見送り**。
      現状の行数・分岐数では抽象化の利得より可読性の低下が上回ると判断。
      `StructureIssue` の種別追加時に再検討する

## フェーズ7.6: コードレビュー（/code-review）反映

- [x] `/code-review`（high・8角度）を実施（8件検出）
- [x] [修正] アンカー小節数が stack 数を上回る場合の**無言の小節欠落**
      → `measureNotDetected` issue ＋ 当該小節を `skipped` として残す。
      逆方向（stack 超過＝`measureOutOfRange`）との非対称を解消
- [x] [修正] book.xml と実ページ数が食い違うときの**無言の小節番号ずれ**
      → `arePagesAligned` で判定し、ずれている場合は XML へアンカーせず stack 数へ退避。
      `pageCorrespondenceMismatch` で報告
- [x] [修正] movement 基準を `systems[0]` 依存にしたことで**小節番号の重複を検知できない**問題
      → `firstMeasureIndex` の最小値を採用（段の並び順に非依存）＋ movement 間の重複を契約違反として例外化
- [x] [修正] `detect` / `resolve` のレイアウト対応判定の重複（7.5 で見送った項目）
      → `pageContexts()` に共通化。見送り時の前提（実害なし）が崩れていた
      （`anchorable` が resolve にしかなく、段数不一致ページで報告と採用値が食い違っていた）
- [x] [ついでに修正] `systemMeasureCount` decision の負値を `Math.max(0, ...)` でクランプ
- [x] 回帰テスト追加（6件・計 233 tests pass）
- [x] 未対応（低優先・記録のみ）:
      `ResolvedMovement.pageIndices` の冗長性 / `realFixtureHelpers` の集計ループ重複 /
      `divisi-regression.test.ts` の恒等 `.map`

## フェーズ8: ドキュメント更新・振り返り

- [x] `docs/functional-design.md` の BookStructureResolver を実装に合わせて更新
      （コードレビュー反映分: `pageCorrespondenceMismatch` / `measureNotDetected` / 契約検証も追記）
  - [x] `detect` / `resolve` のシグネチャ変更（`bookPages` 追加）と理由
  - [x] ScoreModelBuilder のアンカー方式・小節照合の実データ限界を更新
- [x] `docs/architecture.md` の統合テスト期待値を更新
- [x] `docs/repository-structure.md` の新規ファイル・回帰テストの説明を更新
- [x] `docs/glossary.md` の BookStructureResolver 定義を実装に合わせて確認・更新
- [x] requirements.md の受け入れ条件を実績反映
- [x] 実装後の振り返り（このファイルの下部に記録）

---

## 実装後の振り返り

### 実装完了日

2026-07-19

### 計画と実績の差分

**計画と異なった点**:

- **Phase 1 の申し送りにあった真因の推定が誤っていた**。「声部の段階的入りによる構造誤分割」ではなく、
  **20 ページ中 2 段だけの小節数のズレが累積して全体へ波及していた**のが主因。計画着手前に
  ページ単位・段単位で不一致の分布を実測したことで、着手前に方針を修正できた
  （分布は「page 6 以降で急増」というドリフト特有の形をしていた）。
- **`fragmentedSystem`（誤分割検出）を `inconsistentSystemStaffCount` に置き換えた**。当初案の
  「同一ページ内で stack 境界が一致する連続段を誤分割とみなす」判定は、実データで
  Victoria の正常な段（page 0 の 3 段）を誤検出し、逆に divisi の page 0 を取りこぼした。
  判定条件が明確な「同一ページ内で段ごとの譜表数が不揃い」に変更した。
- **段レイアウトのフォールバック条件を実装中に修正**した。当初は「XML レイアウトがあれば使う」
  だったが、`<print>` を持たない合成フィクスチャで段 0 に全小節が割り当たる不具合が出た。
  **段数が一致するページでだけ XML レイアウトを信用する**（対応づけが序数のため）に変更。

**新たに必要になったタスク**:

- `MusicXmlParser` の段レイアウト抽出（当初は BookStructureResolver 内で完結する想定だった）。
  `<print>` の解釈はパーサの責務なので分離した。
- `ScoreModelBuilder.test.ts` の既存 `ParsedMusicXml` リテラル 14 箇所への `layout` 追加。
- `planMovements` のリファクタ（ページ index ではなくページ実体を持たせる）。防御的な
  `undefined` ガードが消え、カバレッジが 100% になった。

**技術的理由でスキップしたタスク**:

- 「`detect` / `resolve` のレイアウト対応判定を共通ヘルパーへ切り出す」（implementation-validator の提案2）
  - スキップ理由: 現状の行数・分岐数では抽象化の利得より可読性の低下が上回ると判断
  - 代替: `StructureIssue` の種別が増えた時点で再検討する旨をタスクに記録

### 学んだこと

**技術的な学び**:

- **「構造がおかしい」という印象で原因を推定してはいけない**。Phase 1 は skipped 561 という結果から
  「構造誤分割」と推定したが、実際は全く別の原因だった。**ページ単位・段単位で不一致の分布を出す**
  だけで、ドリフト（特定ページ以降で急増）か局所的な問題かは一目で分かる。
- **仮説は最小コストで実証してから設計する**。本作業では「該当 2 段の余剰 stack を除去して再実行」
  という 10 行のスクリプトで skipped 561 → 135 を確認してから設計に入った。設計・実装後に
  「効果がなかった」と分かる事故を防げた。実装後の実測値は事前検証と完全に一致した。
- **累積は誤差を増幅する**。「stack 数を累積して小節番号を決める」設計は、1 か所の検出ミスが
  以降の全データを壊す。**外部の権威ある情報（MusicXML の段レイアウト）にアンカーし、
  ズレを局所に閉じ込める**設計へ変えることで、同じ入力から劇的に良い結果が得られた。
- **退行検知の順序が効いた**。Victoria を先に通してから divisi の期待値を更新する手順を守ったことで、
  「壊れた実装に期待値を合わせる」事故を構造的に防げた。Victoria は 1 行も変更せずパスした。
- **残った不一致の性質を数えると次の課題が特定できる**。クロスチェック不一致 569 件のうち
  487 件が「幹音ちょうど 1 つ低い」という系統的ズレで、402 件が P6 に集中していた。
  P6 は `ALTO` と検出されており、アルト記号の中線 C4 とト音記号の中線 B4 は幹音 1 つ違い。
  「残りは音部記号の誤検出であり ClefKeyConfirm（Phase 4）の対象」と根拠つきで結論できた。

**プロセス上の改善点**:

- 計画（requirements/design）を書く前に**実データ調査に時間を使った**のが最も効いた。
  結果として requirements.md に「Phase 1 の推定の訂正」を根拠つきで書け、設計が一発で決まった。
- 実装中に判定条件を変更した際、requirements.md の受け入れ条件・tasklist.md の該当タスクを
  **その場で理由つきに書き換えた**ため、ドキュメントと実装の乖離が残らなかった。

### 次回への改善提案

- **次作業は Phase 3（階名パイプラインの結線）**。KeyRegion の自動生成と
  `ScoreModel` → `SolfaEngine.computeDegrees()` の接続。実データの小節番号が信頼できるように
  なったため、divisi/Victoria で階名文字列まで一気通貫のテストが書ける。
- **音部記号の誤検出（divisi P6 の ALTO 判定）は Phase 4 の ClefKeyConfirm の具体的な検証材料**になる。
  「この段の clef を TREBLE に直すとクロスチェック不一致が何件減るか」を回帰テストにできる。
- 実データを扱う作業では、**着手前に「不一致の分布」を出す**ことを定型手順にする。今回はそれで
  前フェーズの推定を覆せた。
- `planMovements` の既知の限界（ページ列の途中で sheet XML が欠落するとページ対応がずれる）は
  TSDoc に記録済み。解決には `assembleArtifacts` がページに sheet 番号を持たせる必要があり、
  実データで該当ケースが出た時点で対応する。
