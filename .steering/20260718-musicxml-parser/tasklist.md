# タスクリスト

- 作業名: 20260718-musicxml-parser（MusicXML パーサ + OmrSheetParser + ScoreModelBuilder）

## 🚨 タスク完全完了の原則

**このファイルの全タスクが完了するまで作業を継続すること**

### 必須ルール
- **全てのタスクを`[x]`にすること**
- 「時間の都合により別タスクとして実施予定」は禁止
- 「実装が複雑すぎるため後回し」は禁止
- 未完了タスク（`[ ]`）を残したまま作業を終了しない

### タスクスキップが許可される唯一のケース
以下の技術的理由に該当する場合のみスキップ可能:
- 実装方針の変更により、機能自体が不要になった
- アーキテクチャ変更により、別の実装方法に置き換わった
- 依存関係の変更により、タスクが実行不可能になった

スキップ時は必ず理由を明記:
```markdown
- [x] ~~タスク名~~（実装方針変更により不要: 具体的な技術的理由）
```

---

## フェーズ1: 依存追加・共有型定義

- [x] fast-xml-parser（^5）を dependencies に追加し、ネットワークアクセスなしを確認
  - 備考: v4（依存1個）も検討したが XMLBuilder の既知脆弱性で npm audit 警告が残るため v5 を採用。
    v5 の transitive 依存6個に network/fs/child_process コードがないことを確認済み
- [x] src/shared/types/ScoreModel.ts を作成（ScoreModel / Part / Measure / NoteEvent /
      PageAnchor / SystemInfo / StaffRef。機能設計書のエンティティ定義を転記）
- [x] src/shared/types/Confirmation.ts を作成（ConfirmationState / ConfirmationItem）
- [x] src/shared/types/ResolvedStructure.ts を作成（v1 最小形）

## フェーズ2: XML パース基盤

- [x] src/domain/score/errors.ts を作成（ScoreParseError）
- [x] src/domain/score/xmlTree.ts を作成（fast-xml-parser preserveOrder → XmlElement 変換、
      find / findAll / findText / attr ヘルパー、不正XMLのエラー化）
- [x] tests/unit/domain/score/xmlTree.test.ts を作成（10テストパス）

## フェーズ3: MusicXmlParser

- [x] src/domain/score/MusicXmlParser.ts を作成
  - [x] part-list からの id→name 解決（part-name 欠落時は id）
  - [x] 小節ごとの調号（fifths / mode）抽出と divisions の持続管理
  - [x] 発音音符の抽出（休符除外・chord フラグ・alter 整数化・staff 番号）
  - [x] カーソル方式の小節内オフセット計算（note / chord / grace / backup / forward）
  - [x] score-timewise・不正XMLの ScoreParseError 化
- [x] tests/unit/domain/score/MusicXmlParser.test.ts を作成（12テストパス）

## フェーズ4: OmrSheetParser + clefTable

- [x] src/domain/score/OmrSheetParser.ts を作成
  - [x] parseSheetXml（page / system / stack / part / staff / clef / head+bounds 抽出、
        head の x 昇順ソート、bounds なし head の無視、最初の clef 採用）
  - [x] parseBookXml + groupMovements（movement-start・先頭ページの暗黙開始）
- [x] src/domain/score/clefTable.ts を作成（CLEF_MIDDLE_LINE + headStepOctave + isKnownClefKind。
      「中線=0・下向き正」の根拠コメント）
- [x] tests/unit/domain/score/OmrSheetParser.test.ts を作成（11テストパス）
- [x] tests/unit/domain/score/clefTable.test.ts を作成（15テストパス）

## フェーズ5: ScoreModelBuilder

- [x] src/domain/score/ScoreModelBuilder.ts を作成
  - [x] OmrArtifacts / BuildResult / BuildIssue 型定義
  - [x] 有効 clef の解決（ConfirmationState の corrected → 検出値の順）
  - [x] stack×譜表の小節照合（一致→対付け＋NoteEvent 化、不一致→ skipped + issue）
  - [x] 音高クロスチェック（headStepOctave との step 比較 → issue）
  - [x] 多譜表パートの staff 番号による音符分割
  - [x] 複数 movement の通し小節番号化と SystemInfo / Part(staves) / Measure 整列
- [x] tests/unit/domain/score/ScoreModelBuilder.test.ts を作成（13テストパス）
  - [x] matched 対付け（座標・音高・NoteEvent.id 採番）
  - [x] 音符数不一致 → skipped 隔離（他小節へ波及しない）
  - [x] クロスチェック不一致 issue と、clef 修正（TREBLE→BASS）での解消
    - 注: クロスチェックは step（レター）比較のみのため、TREBLE→TREBLE_DOWN_8 のような
      同レター・オクターブ違いの修正では結果が変わらない。検証シナリオはレターが変わる
      誤認識（TREBLE⇔BASS）に変更（クロスチェックの検出限界として振り返りに記録）
  - [x] 複数 movement の通し小節番号
  - [x] partNotFound / measureOutOfRange / unknownClef の issue 化

## フェーズ6: 合成フィクスチャ + 統合テスト

- [x] tests/fixtures/synthetic-mini/ を作成（score.musicxml / sheet1.xml / book.xml / README.md）
- [x] tests/integration/pipeline/synthetic-mini.test.ts を作成
      （パース→照合の通し回帰: matched / skipped / issue 数と代表音符の座標・音高を固定）

## フェーズ7: 品質チェックと修正

- [x] すべてのテストが通ることを確認
  - [x] `npm run test`（151 passed）
- [x] カバレッジ 90% 以上を確認
  - [x] `npm run test:coverage`（branches 92.97% / statements 99.04% / functions 100% / lines 99.34%）
    - 備考: 分岐カバレッジ確保のため欠損データ耐性テスト（不正属性・id/座標欠落・不正 pitch・
      多譜表での skipped 再訪・ネスト処理命令）を追加。xmlTree の到達不能な防御ガードは
      `/* v8 ignore */` で除外
- [x] リントエラーがないことを確認
  - [x] `npm run lint`
- [x] 型エラーがないことを確認
  - [x] `npm run typecheck`
- [x] ビルドが成功することを確認
  - [x] `npm run build`

## フェーズ8: ドキュメント更新

- [x] docs/architecture.md の依存関係管理表に fast-xml-parser を追記
- [x] README.md の実装状況を更新（ScoreModelBuilder 照合コアを完了に）
- [x] 実装後の振り返り（このファイルの下部に記録）

---

## 実装後の振り返り

### 実装完了日
2026-07-18

### 計画と実績の差分

**計画と異なった点**:
- **fast-xml-parser のバージョン選定が迷走**: 当初 v5（transitive 依存6個）→ 依存削減のため v4（1個）へ→
  v4 は XMLBuilder の既知脆弱性（GHSA-gh4j-gqv2-49f6・今回未使用機能）で npm audit 警告が残るため v5 に回帰。
  最終的に v5 の全 transitive 依存に network/fs/child_process コードがないことを grep 確認して採用。
  「依存数の少なさ」より「audit がクリーンで送信禁止規約に抵触しない」を優先する判断に落ち着いた。
- **クロスチェック検証シナリオの変更**: 当初 tasklist に「clef 修正 TREBLE→TREBLE_DOWN_8 での不一致解消」と
  書いたが、クロスチェックは step（レター）比較のみのため同レター・オクターブ違いでは結果が変わらないと判明。
  レターが変わる TREBLE→BASS シナリオへ変更（検出限界として README / requirements に明記）。
- **合成フィクスチャ方式の採用**: Audiveris 実出力（.omr/.mxl）がこの環境で入手困難なため、プロトタイプ
  実証済みスキーマを模した手作り合成フィクスチャで通し回帰を成立させた。Victoria 実フィクスチャは
  OmrRunner 実装時に延期（requirements のスコープ外に明記済み）。

**新たに必要になったタスク**:
- 分岐カバレッジ 90% 到達のための欠損データ耐性テスト追加（不正属性・id/座標欠落・不正 pitch・
  多譜表での skipped 再訪・ネスト処理命令）。当初のハッピーパス中心のテスト計画では branches が
  88.64% にとどまり閾値未達だった。
- xmlTree の到達不能な防御ガード（validate 済みなら必ずルート要素が存在）への `/* v8 ignore */` 注記。

### 学んだこと

**技術的な学び**:
- fast-xml-parser は `preserveOrder: true` にしないと同名タグ（note/backup/forward）の文書順が失われ、
  MusicXML のカーソル方式オフセット計算が破綻する。`parseTagValue/parseAttributeValue: false` で
  数値自動変換を止め、'012' のような桁落ちを避けて呼び出し側で明示解釈するのが安全。
- 音高クロスチェックの検出限界は「step 比較のみ」に起因する構造的なもの。オクターブ違いの誤認識は
  原理的に検出できないため、テスト・ドキュメントで限界を隠さず明示することが誠実さにつながる。
- カバレッジは statements/lines が高くても branches が独立に閾値を割ることがある。防御ガードや
  欠損データ分岐を意識的にテストするか `/* v8 ignore */` で除外するかを早めに設計すべき。

**プロセス上の改善点**:
- steering の tasklist をフェーズ単位でリアルタイム更新し、実装中に判明した設計変更（クロスチェック
  シナリオ・依存選定）をその場で備考として残せた。後追いの振り返りが容易だった。
- implementation-validator による検証で、コードは 5.0/5・ブロッカー無しと確認しつつ、ドキュメント側の
  内訳表記ミス（P1 m0 の音符数を休符込みの4と誤記）を拾えた。コードとドキュメントの二重チェックが有効。

### 次回への改善提案
- **実機 GUI での `npm run dev` 起動確認は本コンテナでは実施不能**（GUI 不可環境）。前作業からの申し送り
  として継続。Electron シェルや今後の UI/確認画面（StructureConfirm/ClefKeyConfirm）を実装する際は、
  ホスト側の実機環境での起動・表示確認を別途行うこと。
- **次作業候補**: (1) OmrRunner（.omr/.mxl の zip 展開・Audiveris ヘッドレス実行・実 Victoria 楽譜での
  784音・ミスマッチ0・skipped 5小節の回帰テスト差し替え）。本作業で ScoreModelBuilder の API を
  安定させたので、OmrRunner はパース済み文字列を渡すだけで接続できる。 (2) 確認画面（ClefKeyConfirm）は
  本作業の ConfirmationState / BuildIssue（unknownClef / pitchCrossCheckMismatch）を UI 入力源にできる。
- カバレッジ 90%（branches 含む）は最初のテスト設計時点で欠損データ分岐まで織り込むと手戻りが減る。
