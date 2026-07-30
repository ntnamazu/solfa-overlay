import type { PageAnchor, StaffRef } from './ScoreModel';

/** 音部記号が検出できなかった譜表をまとめるグループの検出値 */
export const UNKNOWN_CLEF = 'UNKNOWN';

/**
 * 確認画面（ClefKeyConfirm）の確認項目1件（機能設計書 F-2）
 *
 * **1 項目 = 画面の 1 行 = 訂正の 1 単位**であり、パート×検出音部記号でグルーピングされている。
 * 譜表を 1 行ずつ並べると divisi 実フィクスチャで 288 行になり、受け入れ条件
 * 「1曲5分以内」を満たせない。パート×検出値で畳むと 17 行（Victoria は 36 譜表 → 5 行）に収まり、
 * かつ誤検出は段ごとにばらけず**パート単位で系統的に起きる**（divisi の P6 は 35 段が一括で
 * ALTO 誤検出）ため、この単位で訂正するのが実データの性質にも合う。
 *
 * `detected` / `corrected` は Audiveris の kind 表記（例: 'TREBLE', 'TREBLE_DOWN_8', 'BASS'）。
 * ScoreModelBuilder が clefTable の逆算にそのまま使うため、表示用文字列ではなく kind を保持する。
 * 検出できなかった譜表は `UNKNOWN_CLEF` でまとまる。
 *
 * **調号は含まない**: 調は譜表ではなく調文脈（小節区間）の属性であり、divisi では譜表 288 に対し
 * 調文脈は 8 しかない。譜表ごとに調号を並べると同じ情報が重複するため、調の訂正は
 * `KeyRegionDecision`、構造の訂正は `StructureDecision` が担う（訂正の入口は 1 概念 1 型）
 */
export interface ConfirmationItem {
  /** `clef-<partId>-<detected>` 形式（決定的。再解析しても同じ項目が同じ id になる） */
  id: string;
  kind: 'clef';
  /** グルーピングの単位となるパート。構造未確定・不明の場合は null */
  partId: string | null;
  /** 検出値（Audiveris の kind 表記。未検出は UNKNOWN_CLEF） */
  detected: string;
  /** ユーザー修正値。null なら検出値を採用 */
  corrected: string | null;
  /** このグループに属する全譜表。訂正はこの全てに適用される */
  staffRefs: StaffRef[];
  /**
   * 代表譜表（staffRefs の先頭）の元画像の切り抜き範囲
   *
   * `.omr` は譜表・音部記号の矩形を持たない（`OmrStaff` は符頭のみ）ため、
   * 符頭座標から求めた**近似値**である。切り抜き画像の表示（PDF.js の導入）は
   * Editor のビューアと同時に入るため、精緻化はその時点で行う
   */
  clipRect: PageAnchor & { width: number; height: number };
  /**
   * このグループの譜表で発生した音高クロスチェック不一致の件数
   *
   * 機能設計書「不一致のある行を強調する」の材料（**並び順には使わない**。一覧は楽譜順に固定する）。
   * 実データでは音部記号の誤検出がそのまま不一致件数に現れる（divisi の P6 は 402 件）。
   *
   * **0 件が「問題なし」を意味するとは限らない**。`detected` が `UNKNOWN_CLEF` の場合は
   * `headStepOctave` がクロスチェックをスキップするため、検算していない状態のまま 0 になる
   * （UI はこれを「未検査」として区別する）
   */
  mismatchCount: number;
}

/**
 * 音部記号の確認状態（F-2）
 *
 * 制約: completedAt が null の間は階名生成・PDF出力に進めない（機能設計書の受け入れ条件。
 * ゲートは編成レイヤーが強制する）
 */
export interface ConfirmationState {
  items: ConfirmationItem[];
  /** ISO 8601。未完了なら null */
  completedAt: string | null;
}

/**
 * 確認画面で選べる音部記号（Audiveris の clef kind）
 *
 * 合唱譜に現れるものに絞った一覧。`G_CLEF` / `F_CLEF` は Audiveris が
 * `TREBLE` / `BASS` と同義で出す別名のため、選択肢には含めない
 * （同じ意味の項目が 2 つ並ぶと、どちらを選ぶべきか判断できなくなる）。
 *
 * domain の音部記号表と食い違うと「選べるのに解釈できない値」が生まれるため、
 * 整合は `tests/unit/domain/score/clefTable.test.ts` の回帰テストで固定する
 */
export const SELECTABLE_CLEF_KINDS = ['TREBLE', 'TREBLE_DOWN_8', 'ALTO', 'TENOR', 'BASS'] as const;
