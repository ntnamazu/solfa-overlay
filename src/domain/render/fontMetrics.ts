import { StandardFontEmbedder, StandardFonts } from 'pdf-lib';

/**
 * 階名の描画に使う標準フォントと、その寸法計測
 *
 * **配置（`placementResolver`）と描画（`OverlayRenderer`）が同じ関数で寸法を測る**ための
 * 共通の入口。別々に測ると「配置は収まると判断したのに描画すると隣とぶつかる」という
 * 食い違いが起きる。
 *
 * `StandardFontEmbedder.for` は同期のため、注釈生成を非同期化せずに済む
 * （非同期化すると `ProjectSession.analyze` から IPC ハンドラまで波及する）。
 */

/** 音節の文字列化で使われる記号 → WinAnsi で描ける代替（要求 発見4） */
const CHARACTER_SUBSTITUTIONS: ReadonlyMap<string, string> = new Map([
  ['♯', '#'], // ♯
  ['♭', 'b'], // ♭
]);

/** どの代替でも描けない文字の最終手段（文字が消えるより見えた方がよい） */
const UNPRINTABLE_REPLACEMENT = '?';

/** 置換が起きた 1 件 */
export interface CharacterSubstitution {
  from: string;
  to: string;
}

export interface DisplayText {
  /** 実際に描画・計測する文字列 */
  text: string;
  /** 置換した文字（呼び出し側が「無言で化けさせない」ための報告に使う） */
  substitutions: CharacterSubstitution[];
}

export interface TextMetrics {
  /** pdf-lib の `embedFont` へ渡すフォント名。描画側が同じ書体を使うために公開する */
  readonly fontName: StandardFonts;
  /** 描画可能な文字列へ直す（置換の記録付き） */
  displayText(text: string): DisplayText;
  /** 描画幅（ポイント）。入力は置換前でもよい */
  widthPt(text: string, fontSizePt: number): number;
  /**
   * アセンダ高（ポイント）
   *
   * em 全体ではなくアセンダ高を使う。階名の音節は小文字のみでディセンダを持たないため、
   * em 全体で衝突判定すると実際には空いている位置を「埋まっている」と誤判定する
   * （実測では divisi の配置不能が 25 → 54 件に倍増した）
   */
  ascentPt(fontSizePt: number): number;
}

/** 幹音（通常）と変化音（太字）のフォント対 */
export interface SolfaFonts {
  regular: TextMetrics;
  bold: TextMetrics;
}

/** CSS 風の総称ファミリ名 → 標準14フォント */
const FONT_FAMILIES: Readonly<Record<string, { regular: StandardFonts; bold: StandardFonts }>> = {
  'sans-serif': { regular: StandardFonts.Helvetica, bold: StandardFonts.HelveticaBold },
  serif: { regular: StandardFonts.TimesRoman, bold: StandardFonts.TimesRomanBold },
  monospace: { regular: StandardFonts.Courier, bold: StandardFonts.CourierBold },
};

const DEFAULT_FAMILY = FONT_FAMILIES['sans-serif'] as {
  regular: StandardFonts;
  bold: StandardFonts;
};

/**
 * 設定のフォント名を標準14フォントへ解決する
 *
 * 埋め込みフォントは同梱ファイルが要るためスコープ外。未知の名前は既定（Helvetica）へ落とし、
 * **設定の綴り間違いで出力が失敗しない**ようにする
 */
export function resolveFontFamily(fontFamily: string): {
  regular: StandardFonts;
  bold: StandardFonts;
} {
  return FONT_FAMILIES[fontFamily.trim().toLowerCase()] ?? DEFAULT_FAMILY;
}

/**
 * `StandardFontEmbedder.for` が受け取るフォント名の型
 *
 * pdf-lib は公開 API の `StandardFonts` と内部の `FontNames` を別の enum として定義している。
 * **値（文字列）は同一**だが TypeScript の enum は名前で区別されるため代入できない。
 * 内部 enum は公開されていないので、引数の型を引き出して橋渡しする
 */
type EmbedderFontName = Parameters<typeof StandardFontEmbedder.for>[0];

function createMetrics(fontName: StandardFonts): TextMetrics {
  const embedder = StandardFontEmbedder.for(fontName as unknown as EmbedderFontName);
  // 文字ごとの描画可否は入力に依存せず決まるため、1 度だけ調べて使い回す
  const encodable = new Map<string, boolean>();

  const canEncode = (character: string): boolean => {
    const cached = encodable.get(character);
    if (cached !== undefined) {
      return cached;
    }
    let ok = true;
    try {
      embedder.widthOfTextAtSize(character, 1);
    } catch {
      ok = false;
    }
    encodable.set(character, ok);
    return ok;
  };

  const displayText = (text: string): DisplayText => {
    const substitutions: CharacterSubstitution[] = [];
    let result = '';
    // サロゲートペアを壊さないよう、コードポイント単位で走査する
    for (const character of text) {
      const mapped = CHARACTER_SUBSTITUTIONS.get(character);
      if (mapped !== undefined) {
        substitutions.push({ from: character, to: mapped });
        result += mapped;
        continue;
      }
      if (canEncode(character)) {
        result += character;
        continue;
      }
      substitutions.push({ from: character, to: UNPRINTABLE_REPLACEMENT });
      result += UNPRINTABLE_REPLACEMENT;
    }
    return { text: result, substitutions };
  };

  return {
    fontName,
    displayText,
    // 置換前の文字列をそのまま測ると WinAnsi のエンコード時点で例外になるため、
    // **必ず置換を通してから**測る（描画と同じ文字列を測ることにもなる）
    widthPt: (text, fontSizePt) => embedder.widthOfTextAtSize(displayText(text).text, fontSizePt),
    ascentPt: (fontSizePt) => embedder.heightOfFontAtSize(fontSizePt, { descender: false }),
  };
}

/** 設定のフォント名から、幹音用（通常）と変化音用（太字）の計測器を作る */
export function solfaFonts(fontFamily: string): SolfaFonts {
  const family = resolveFontFamily(fontFamily);
  return { regular: createMetrics(family.regular), bold: createMetrics(family.bold) };
}
