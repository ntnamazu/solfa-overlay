# サードパーティ・ライセンス表記（配布物同梱コンポーネント）

本アプリ（Solfa Overlay）の配布版インストーラには、以下の第三者コンポーネントを**同梱**しています。各コンポーネントの著作権表示・ライセンスと入手元、および対応ソースの提供方法を以下に示します。

このファイルは配布物（インストーラ）にも同梱されます（`electron-builder.yml` の `extraResources`）。

> 開発用の足場（`.claude/` 配下のスキル・コマンド・`CLAUDE.md` 等）のライセンスは、別途 [`THIRD_PARTY_LICENSE`](THIRD_PARTY_LICENSE)（MIT / Generative Agents）を参照してください。本ファイルは**実行時に同梱されるバイナリ**のライセンスを扱います。

---

## Audiveris（OMR エンジン）

- **バージョン**: 5.6.1（完全固定。更新時は SHA-256 とフィクスチャ再生成をセットで扱う）
- **ライセンス**: GNU Affero General Public License v3.0（AGPL-3.0-or-later）
- **著作権**: © Hervé Bitteur and the Audiveris contributors
- **プロジェクト**: <https://audiveris.org/> / <https://github.com/Audiveris/audiveris>
- **同梱物**: `Audiveris-5.6.1-windows-x86_64.msi`（jpackage 製 app-image）を展開したもの。
  取得・検証は `scripts/fetch-resources.ts`（URL・SHA-256 固定）が行う。
- **ライセンス全文**: <https://www.gnu.org/licenses/agpl-3.0.html>。
  併せて、Audiveris 配布物内に同梱される LICENSE 表記がインストール先の
  `resources/audiveris/win/` 配下にそのまま含まれます。

### 対応ソースの提供

本アプリは Audiveris を**無改変**で同梱しています。したがって対応ソースは、上記 upstream の
**固定バージョン（5.6.1）のソース**で提供します:

- ソース（タグ 5.6.1）: <https://github.com/Audiveris/audiveris/releases/tag/5.6.1>

Audiveris に改変を加える場合は、その改変部分を AGPL-3.0 の条件で公開する義務が生じます
（本プロジェクトは改変しない方針です）。

### アプリ本体との関係（mere aggregation）

本アプリ本体と Audiveris は**別個のプログラム**です。両者は次の構成でのみ連携します:

- Audiveris は JVM の**別プロセス**として起動される（同一プロセスへのリンク・JNI は無し）。
- 連携は**コマンドライン引数（ファイルパス）と、ファイル入出力＋標準出力**に限定される。

これは FSF が GPL FAQ で「別々の著作物（集積 / mere aggregation）」と説明する構成に該当します。
本アプリ本体のソースコードは AGPL-3.0 の対象ではありません（アプリ本体自身のライセンスは
下記「アプリ本体（Solfa Overlay）のライセンス」節のとおり MIT）。

> ⚠️ 「exec / パイプなら別著作物」は FSF の立場であり判例で確定した黒白ではありません。
> 個人利用〜無償配布ではリスクは低いものの、上記の別プロセス・アームズレングス実行の構成を
> 崩さないこと（詳細は `docs/ideas/audiveris-bundling-license.md`）。

---

## 同梱 Java ランタイム（OpenJDK）

- **由来**: Audiveris の jpackage app-image に**同梱された** Java ランタイム（`resources/audiveris/win/runtime/`）。
- **ライセンス**: GNU General Public License v2.0 with the Classpath Exception（GPLv2 + CE）。
  この Classpath Exception により、ランタイム上で動作するアプリケーションへ GPL の効力は及びません。
- **入手元**: OpenJDK（Adoptium/Temurin 等のディストリビューションが一般的）。実際のベンダ・版は
  Audiveris 配布物に同梱されるランタイムの `release` ファイルおよびライセンス表記に従います。
- **ライセンス全文**: <https://openjdk.org/legal/gplv2+ce.html>

> 本アプリは JRE を**別立てで同梱しません**（`resources/jre/` は使わない）。Windows 版 Audiveris の
> MSI が jpackage 製でランタイムを内包するため、二重同梱を避けています。

---

## その他（Audiveris 配布物に内包される第三者コンポーネント）

Audiveris の app-image には、OCR エンジン **Tesseract**（Apache License 2.0）など複数の第三者
コンポーネントが内包されます。これらのライセンス表記は、インストール先の
`resources/audiveris/win/` 配下に同梱される各コンポーネントの表記に従います。

---

## アプリ本体（Solfa Overlay）のライセンス

本アプリ本体は **MIT License** です。全文は [`LICENSE`](LICENSE) を参照してください。

「本体」とは、本リポジトリで開発されたソースコードとその成果物（`src/` 配下のコード、
およびそれをビルドした `app.asar` の内容）を指します。

### 同梱物との関係（重要）

配布版インストーラは、**ライセンスの異なる複数のプログラムを1つのパッケージにまとめたもの**です。
本体が MIT であることは、**同梱物のライセンス条件を緩めるものではありません**。

| 構成要素 | ライセンス |
| --- | --- |
| アプリ本体（`src/` 由来のコード） | MIT |
| 同梱 Audiveris | AGPL-3.0-or-later |
| 同梱 Java ランタイム（Audiveris 内包） | GPLv2 + Classpath Exception |
| Audiveris 内包の第三者コンポーネント（Tesseract 等） | 各コンポーネントの表記に従う |

両者が別個のプログラムである根拠は、上記「アプリ本体との関係（mere aggregation）」節のとおりです
（別プロセス実行・コマンドライン引数とファイル入出力のみでの連携）。

### 配布物を再配布する場合の注意

インストーラや展開後のファイル一式を第三者へ再配布する場合、**同梱された Audiveris 部分については
AGPL-3.0 の条件（対応ソースの提供義務を含む）に従う必要があります**。本ファイルの「対応ソースの提供」
節に記載した upstream の固定バージョンのソースが、その要件を満たすための情報です。

MIT が適用されるのはアプリ本体のみであり、同梱物へは及びません。

判断根拠の詳細は `docs/ideas/audiveris-bundling-license.md`「5. 公開配布時のチェックリスト」を参照。

