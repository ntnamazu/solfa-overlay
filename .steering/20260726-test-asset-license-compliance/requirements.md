# 要求内容

## 概要

テスト用フィクスチャおよびプロトタイプ検証で使用した楽譜素材のライセンス表記を、実態に合わせて是正する。公開リポジトリとして、第三者著作物の帰属表示（CC BY）とライセンス表示を正しく行える状態にする。

## 背景

v0.1.0 公開準備（`.steering/20260726-v0.1.0-public-release-prep/`）の最終確認中に、**テスト素材のライセンス認識に誤りがあること**が判明した。

`tests/fixtures/victoria/` および `tmp/` で使用している楽譜（IMSLP #19716）は、**楽曲**（Tomás Luis de Victoria、1611年没）こそパブリックドメインだが、**楽譜そのもの（Nancho Alvarez 編・2008）は Creative Commons Attribution-NonCommercial-ShareAlike 3.0（CC BY-NC-SA 3.0）**である。IMSLP のページで確認済み（2026-07-26）。

これにより、次の問題が生じている:

1. **`tmp/` に CC BY-NC-SA 素材そのものと、その翻案物が Git 追跡下で含まれている**
   - `tmp/IMSLP19716-PMLP46230-O_Magnum_Mysterium.pdf`: 楽譜そのもの（コミット `186ee08` で混入。`.gitignore` に `tmp/` の記述がない）
   - `tmp/solfa-proto/O_Magnum_Mysterium_solfa.pdf`: 階名を重ねた出力＝**明白な翻案物**。ShareAlike 条項により、これを MIT リポジトリの一部として配布するのはライセンス上成立しない
   - `tmp/solfa-proto/annotations.json`: 版のレイアウト座標と階名のデータ
2. **帰属表示（BY）が一切ない**。CC BY-NC-SA は再配布を許可するが、原著作者のクレジット・ライセンス表示・改変の明示を必須とする
3. **ドキュメントの記述が事実と食い違っている**
   - `tests/fixtures/victoria/README.md`: 「作曲者 1611 年没・**パブリックドメイン**」「開発ガイドラインのルール: PD のみ → **適合**」は誤り
   - 同ファイル: 「**元PDF はリポジトリに含めていない**」も誤り（`tmp/` に含まれている）
   - `docs/development-guidelines.md`:「`tests/fixtures/` に置けるのは**パブリックドメインの楽譜のみ**」というルールに対し、**現状は違反状態**
4. **`tests/fixtures/divisi/` の出典番号が現状と合わない可能性**。IMSLP のページ上に #175782 が見当たらず、#954369 に置き換わっている（楽曲《The Message of the Angels》・1910年 Oliver Ditson Co. 出版・**Public Domain** 表記自体は変わらず、こちらは権利上の問題なし）

## 実装対象の機能

### 1. CC BY-NC-SA 素材とその翻案物の追跡除外

- `tmp/` 配下の楽譜PDF・翻案PDF・注釈データを `.gitignore` に追加し、`git rm --cached` で追跡から外す
- **自作のプロトタイプスクリプト（`.py`）は追跡を維持する**。除外の理由は第三者著作物のライセンスにあり、著作権上問題のない自作コードまで巻き添えにする必要がないため。また `tests/fixtures/synthetic-mini/README.md` ほか2箇所から参照されている

**履歴の書き換えは行わない**。CC BY-NC-SA は非営利での再配布を許可しており、過去のコミットに含まれていたこと自体は違法な配布ではない。不備は帰属表示を欠いていた点であり、それは以降の表記で是正できる（ユーザー判断・2026-07-26）。

### 2. 帰属表示（CC BY）の追加

CC BY-NC-SA 3.0 が求める要素を、素材を使用している箇所に明記する:

- 原著作者・編集者名: **Nancho Alvarez**（2008）
- 出典: IMSLP #19716（PMLP46230）とページ URL
- ライセンス名とバージョン: **CC BY-NC-SA 3.0**（ライセンス本文への URL）
- **改変した旨**: OMR による記号データの抽出、および階名の重ね書きを行っていること

### 3. ドキュメント記述の是正

- `tests/fixtures/victoria/README.md`: ライセンス表記の訂正・帰属表示の追加・「元PDF を含めていない」記述の修正
- `tests/fixtures/divisi/README.md`: 出典ファイル番号の現状（#954369 に置き換わっている可能性）を注記
- `docs/development-guidelines.md`:「PD のみ」というルールを実態に即した内容へ更新
- `docs/ideas/solfa-annotation-app.md`: プロトタイプ成果物の記述に、リポジトリに含まれないファイルがある旨を注記

### 4. テスト素材のライセンス一覧の新設

`THIRD_PARTY_LICENSES.md` に「テスト用素材」の節を追加し、**MIT が及ぶ範囲（本プロジェクトのコード）と、第三者素材（各ライセンス）の区別**を明確にする。特に **NC（非営利）条項の存在**は、リポジトリを MIT で公開するうえで再利用者が知るべき情報である。

### 5. 将来の差し替え候補の記録

IMSLP の同一ページには**パブリックドメインの版が存在する**ことが判明した:

| IMSLP # | 版 | 年 | ライセンス |
| --- | --- | --- | --- |
| #63573 / #63649 | Proske, Carl | 1854 | Public Domain |
| #107866 / #412831 | Pedrell, Felipe | 1902 | Public Domain |
| #956632 | O'Carroll, Kevin | 2025 | CC Zero 1.0 |

今回は差し替えない（後述「スコープ外」）が、**将来 PD 素材へ移行する際の候補として記録する**。

## 受け入れ条件

### 追跡除外

- [ ] `git ls-files tmp/` に PDF・`annotations.json` が含まれない
- [ ] `.gitignore` に除外理由がコメントとして記載されている
- [ ] `tmp/solfa-proto/*.py` は引き続き追跡されている

### 帰属表示

- [ ] `tests/fixtures/victoria/README.md` に、編集者名・出典・ライセンス名とURL・改変した旨がすべて記載されている
- [ ] `THIRD_PARTY_LICENSES.md` にテスト用素材の節があり、NC 条項の存在が明記されている

### ドキュメントの整合

- [ ] `tests/fixtures/victoria/README.md` に「パブリックドメイン」という誤った記述が残っていない
- [ ] `tests/fixtures/victoria/README.md` の「元PDF はリポジトリに含めていない」の記述が実態と一致している
- [ ] `docs/development-guidelines.md` のテストデータのルールが、現状の素材構成と矛盾しない
- [ ] `docs/ideas/solfa-annotation-app.md` のプロトタイプ成果物の記述が、追跡除外後の実態と一致している
- [ ] 将来の差し替え候補（PD 版の IMSLP 番号）が記録されている

### 全体品質

- [ ] `npm run test` がパスする（フィクスチャの実体は変更しないため、回帰値に影響がないことの確認）
- [ ] `npm run lint` がパスする

## 成功指標

- 公開リポジトリとして、同梱している第三者著作物すべてについて「誰の・どのライセンスの・どう改変した素材か」を説明できる状態になる
- リポジトリの再利用者が、MIT が及ぶ範囲と、NC 条項が付く素材の区別を誤解しない

## スコープ外

以下はこのフェーズでは実施しません:

- **Victoria フィクスチャの PD 版への差し替え** — `tests/fixtures/victoria/README.md` が固定する回帰値（movements 2 / pages 4 / matched 295 小節 / 808 音符 / 音高クロスチェック不一致 0 など）は版のレイアウトに依存するため、差し替えると Phase 1 のゲート値をすべて再設定する必要がある。ライセンス上は帰属表示で要件を満たせるため、公開を止める理由にはならない。**将来の課題として記録する**
- **Git 履歴の書き換え**（`git filter-repo` 等）— 上記のとおり不要と判断（ユーザー判断）
- **`tmp/` ディレクトリ自体の廃止・整理** — 追跡除外で目的は達せられるため、構造の見直しは行わない

## 参照ドキュメント

- `docs/development-guidelines.md` - テストデータの著作権ルール
- `tests/fixtures/victoria/README.md` / `tests/fixtures/divisi/README.md` - フィクスチャの出典記録
- `THIRD_PARTY_LICENSES.md` - 同梱コンポーネントのライセンス表記
- `.steering/20260726-v0.1.0-public-release-prep/` - 本作業のきっかけとなった公開準備タスク
- IMSLP: <https://imslp.org/wiki/O_magnum_mysterium_(Victoria,_Tom%C3%A1s_Luis_de)>
