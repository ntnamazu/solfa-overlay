# アイデアメモ: Audiveris 同梱配布とライセンス（AGPL-3.0）の判断根拠

- 記録日: 2026-07-21
- ステータス: 調査・方針メモ（実装は将来のリリース準備時）
- 発案者: Nobuhiro Takaichi
- 位置づけ: 壁打ち成果物・技術調査メモ。**正式な決定の一行は [repository-structure.md](../repository-structure.md) の「resources/ (同梱リソース)」節にある**（AGPL-3.0 のため別プロセス実行を維持し、公開前に同梱条件を確認）。本メモはその「なぜ」と「配布前にやること」を補完する（二重管理を避けるため、正式決定は repository-structure 側を正とする）。

## 1. 一言で言うと

将来このアプリをリリースする際、Electron に Audiveris（＋JRE）を同梱して 3OS のインストーラ（`.exe` 等）で配布したい。その際に鍵となる Audiveris のライセンス（**AGPL-3.0**）の扱いと、実装難易度・配布前チェックリストを記録しておく。

## 2. 方向性の結論

- **同梱配布の方向は妥当**。むしろ PRD のコア価値（「ツールチェーンを自分で組めない人にインストール不要の1個のアプリを届ける」）そのもの。
- 設計はすでに同梱前提で組まれている（`docs/architecture.md`：electron-builder の extraResources で JRE＋Audiveris 同梱、`docs/repository-structure.md`：`resources/audiveris/`・`resources/jre/<platform>/`・`scripts/fetch-resources.ts` でバージョン・ハッシュ固定取得）。
- **ただし今すぐ配布パイプラインを作り込む必要はない**。まずは自分用にホスト install / devcontainer build で運用する。配布オペ（署名・公証・CI）はリリース直前の関心事。

## 3. 実装難易度の見立て

### アプリ側コードは軽い
`OmrRunner` は最初から `audiverisPath` を DI 可能（`src/main/omr/OmrRunner.ts` のコンストラクタ）。内蔵化で必要なアプリ側変更は実質:

> パッケージ実行時（`app.isPackaged`）は `process.resourcesPath/audiveris/...` を解決して `new OmrRunner({ audiverisPath })` に渡す

だけ。**「別プロセス起動＋ファイルパス渡し」という実行モデルは内蔵しても不変**（これが後述のライセンス面でも重要）。

### 難所は「配布のオペレーション」（まだ未実装）
| 項目 | 難易度 | 中身 |
|---|---|---|
| `scripts/fetch-resources.ts` | 低〜中 | Audiveris/JRE を OS別に DL・ハッシュ固定・配置。docs にはあるが実体は未作成 |
| electron-builder 設定 | 中 | `package.json` に electron-builder 自体が未導入。extraResources＋3OS インストーラ設定 |
| 実行時パス解決 | 低 | `app.isPackaged` 分岐（dev＝PATH / 配布＝resourcesPath） |
| クロスOSビルド | 中〜高 | `.exe`＝Windows、`.dmg`＝mac 実機/CI が必要。1台で全部は不可 → GitHub Actions の OS matrix が定石 |
| コード署名・公証 | 高（有料・手間） | Win の SmartScreen、mac の notarization。**現実世界で一番の壁**。個人利用では不要 |
| サイズ | — | Audiveris＋JRE で数百MB（architecture の目標は 800MB 以内） |

### メモ: JRE の二重同梱に注意
Audiveris 5.x の公式配布物は jpackage 製で**ランタイム（JRE）を同梱済み**（`docs/ideas/solfa-annotation-app.md` の検証メモ：.deb を展開し同梱JREでヘッドレス実行可能）。`resources/jre/` を別立てにするか Audiveris 同梱ランタイムをそのまま使うかは、実装時に一度見直す。

## 4. ライセンスの核心: Audiveris は AGPL-3.0

### ネットワーク条項（第13条）は基本トリガーしない
AGPL ＝ GPLv3 ＋ ネットワーク条項。本アプリは**ローカル完結のデスクトップ実行**で Audiveris をネット越しにサービス提供しないため、第13条（ネット利用者へのソース提供義務）は基本発動せず、**実質 GPLv3 相当**の振る舞い。

### 本当の論点: 同梱で「アプリ全体も AGPL 化」を強制されるか
- 分かれ目は「**別個のプログラム（mere aggregation）**」か「**結合著作物**」か。判定は"どう繋ぐか"で決まる。
- **FSF の見解（GPL FAQ）**: パイプ・ソケット・**コマンドライン引数**・**別プロセス（別アドレス空間）**でアームズレングスに通信するものは**別々の著作物（集積）**。同一プロセスへの動的/静的リンクは結合著作物になりやすい。
- **本アプリの構成**: Audiveris は JVM の別プロセス、`spawn` で**ファイルパスを引数**として渡し、やりとりは**ファイル入出力＋stdout**。JNI もリンクも無し → FSF の言う「集積」パターンに合致。
- よって設計が意図的に「リンクせず spawn＋ファイルパスだけ」にしているのは、**アプリ本体のライセンス独立性を守るための布石**。

### ⚠️ 過信しない（残るグレー）
「exec/パイプなら別著作物」は **FSF の立場であり、判例で確定した黒白ではない**。「アプリは Audiveris 無しでは動かない／一緒に配布／直接呼ぶ」＝密結合とみなす立場も理屈上あり得る。個人利用〜無償配布ならリスクは低いが、"確実にゼロ"とは言えない、という温度感で扱う。

## 5. 公開配布時のチェックリスト（＝リリース前にやること）

1. **Audiveris の AGPL-3.0 全文＋著作権表示**を配布物に同梱（`THIRD_PARTY_LICENSES.md` に集約）。
2. **対応ソースの提供**: 無改変なら**固定バージョンの upstream ソースへのリンク or 同梱 or 書面オファー**でよい。
3. **Audiveris は無改変・別バイナリ・アームズレングス実行を維持**（今の構造を崩さない）。
4. **Audiveris を改変したら、その改変は AGPL で公開義務**が発生 → 改変は避けるのが吉。
5. **JRE のライセンスも別途表記**: Temurin/Adoptium 等は通常 **GPLv2＋Classpath Exception**（AGPL ではない）で再配布可。同梱物ごとに入手元とライセンスを列挙。
6. **アプリ本体と同梱物の関係を明示**: 「アプリ本体＝（選択したライセンス）／同梱 Audiveris＝AGPL-3.0（別プログラム）」と示し、mere aggregation の意図を明確化。
   - 現状 `THIRD_PARTY_LICENSE` はテンプレ由来の MIT（Generative Agents）。公開前にアプリ本体のライセンス方針を確定する。

## 6. 次アクションの候補（今やるなら小さく）

- `scripts/fetch-resources.ts` の骨組みだけ先に作り、**内蔵パスでの Audiveris 起動を1回通す**ミニ検証（配布まで行かずとも「同梱パスで動く」確証が得られる）。
- 上記をやるなら steering で計画（`.steering/YYYYMMDD-audiveris-bundling-poc/`）。

## 参考

- Audiveris 公式: https://audiveris.org/
- ライセンス正式決定: `docs/repository-structure.md`（resources/ 節）
- 実行制御の実装: `src/main/omr/OmrRunner.ts` / `src/main/omr/audiverisCommand.ts`
