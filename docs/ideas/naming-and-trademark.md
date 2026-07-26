# アイデアメモ: プロダクト名「Solfa Overlay」の正式採用と商標調査

- 記録日: 2026-07-26
- ステータス: **決定済み**。v0.1.0 初回公開リリース準備（`.steering/20260726-v0.1.0-public-release-prep/`）で反映
- 決定者: Nobuhiro Takaichi
- 位置づけ: 名称確定の経緯と調査結果の記録。正式な名称の記載は [product-requirements.md](../product-requirements.md)「名称」節を正とする

## 1. 決定内容

プロダクト名を **Solfa Overlay** に正式決定し、「（仮称）」の表記を外す。
併せて GitHub リポジトリ名を `movable-do-analyzer` から `solfa-overlay` へ変更する。

## 2. 背景: 名前が2つに割れていた

`Solfa Overlay` は開発中から実質的な正式名称として使われており、**利用者が触れる面はすべてこの名前**だった:

| 箇所 | 表記 |
| --- | --- |
| `electron-builder.yml` の `productName` | Solfa Overlay |
| `electron-builder.yml` の `appId` | `com.solfa-overlay.app` |
| `package.json` の `name` | `solfa-overlay` |
| アプリ画面の見出し（`src/renderer/screens/Home/Home.tsx`） | Solfa Overlay |
| Windows のスタートメニュー・アンインストール一覧 | Solfa Overlay |

一方で **GitHub リポジトリ名だけが `movable-do-analyzer` のまま**取り残されていた。
公開前にどちらかへ寄せる必要があり、`Solfa Overlay` を採る判断をした。

## 3. `Solfa Overlay` を選んだ理由

1. **コンセプトを正しく表す**。PRD のコンセプト「**元の版面へのオーバーレイ**」がそのまま名前になっている。
2. **`movable-do-analyzer` は機能を誤って表す**。本アプリは楽譜を「解析（analyze）」して終わるものではなく、
   階名を**付与して印刷可能な PDF を出力する**ことが価値の中心。"analyzer" は成果物の性質と合わない。
3. **変更コストの非対称性**。`Solfa Overlay` へ寄せるなら変更は README と PRD の「（仮称）」削除、および
   リポジトリ名変更のみ。逆に `movable-do-analyzer` へ寄せると、`appId`・インストーラの表示名・
   アプリ画面・テストの期待値まで広範囲に及ぶ。

## 4. 商標調査

### 調査条件と結果

- **調査日**: 2026-07-26
- **調査サービス**: J-PlatPat（独立行政法人 工業所有権情報・研修館） <https://www.j-platpat.inpit.go.jp/>
- **検索方法**: 商標 → 称呼検索「**ソルファ**」
- **対象区分**:
  - 第9類（コンピュータソフトウェア等）
  - 第42類（ソフトウェアの設計・提供等）
- **結果**: **いずれの区分にも該当なし**

> 検索結果の PDF は保全していない。J-PlatPat は上記条件で同じ検索を再現できるため、
> 追試が必要な場合は調査条件をそのまま適用すること。

### 評価

- `Solfa`（tonic sol-fa 由来の音楽用語）・`Overlay`（一般語）はいずれも**識別力が弱い普通名詞**であり、
  第三者が独占的な商標を取得している可能性が構造的に低い。調査結果とも整合する。
- 裏を返せば**自プロダクト側も商標として強く保護できない**が、無償・個人開発・非商用の配布規模では
  実務上の不利益はないと判断した。
- 補足: 日本語表記「ソルファ」はロックバンドのアルバム名として広く知られており、**検索結果の上位を
  占める**。ただし本プロダクトは英字2語 `Solfa Overlay` で表記するため、混同のおそれは低いと見ている。

### 残る留意点（過信しない）

- 商標の調査は**称呼検索のみ**で行っており、図形商標・外国での登録・未登録商標（周知表示）は
  確認していない。国内・無償配布のスケールでは十分と判断したが、**商用展開や海外配布を行う場合は
  改めて調査が必要**である。

## 5. 反映先

- `README.md` H1: `# Solfa Overlay`（「（仮称）」削除）
- `docs/product-requirements.md`「名称」節: 「（仮称）」削除
- GitHub リポジトリ名: `solfa-overlay`（変更後、ローカルの `git remote set-url` で追従）

## 参考

- 名称の反映作業: `.steering/20260726-v0.1.0-public-release-prep/`
- J-PlatPat: <https://www.j-platpat.inpit.go.jp/>
