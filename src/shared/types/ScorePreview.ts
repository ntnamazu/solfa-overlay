/**
 * Editor の楽譜プレビューに重ねる内容一式
 *
 * 書体・色も**出力PDFが実際に使う値へ正規化済み**で持つ。設定値をそのまま CSS に渡すと、
 * 未知の書体名や解釈できない色で出力PDF（既定値へ落とす）と画面の見た目が食い違う
 */
export interface ScorePreview {
  style: ScorePreviewStyle;
  /** 注釈などを重ねる元PDFページ（`sourcePageIndex` 昇順）。重ねるものが無いページは含まない */
  pages: ScorePreviewPage[];
}

/** 階名の見た目（出力PDFと同じ値） */
export interface ScorePreviewStyle {
  /** CSS の総称ファミリ名（出力PDFの標準フォントに対応するもの） */
  fontFamily: 'sans-serif' | 'serif' | 'monospace';
  fontSizePt: number;
  /** `#rrggbb` */
  diatonicColor: string;
  chromaticColor: string;
}

/**
 * 元PDFのページ 1 枚分の重ね描き内容
 *
 * `domain/render/scorePreview.ts` の `buildScorePreview` が組み立て、IPC 越しに Renderer へ送る。
 * 表示文字列・座標は **Main 側で確定済み**であり、Renderer は SVG に載せるだけにする
 * （表示文字列を導く domain を Renderer は import できない。`SolfaPreviewRow` と同じ理由）。
 *
 * **座標はすべて PDF ポイント・左上原点・y 下向き**。SVG の `viewBox="0 0 widthPt heightPt"` に
 * そのまま載る。PDF の描画座標（左下原点）ではない点に注意
 */
export interface ScorePreviewPage {
  /** 元PDF のページ添字（0始まり）。Audiveris のページ添字ではない */
  sourcePageIndex: number;
  /** 元PDFページの寸法（回転適用後） */
  widthPt: number;
  heightPt: number;
  annotations: ScorePreviewAnnotation[];
  skippedMeasures: ScorePreviewRegion[];
  placementWarnings: ScorePreviewMarker[];
}

/** 画面に重ねる階名 1 つ */
export interface ScorePreviewAnnotation {
  /** 注釈 id（`Annotation.id`） */
  id: string;
  /** 文字列の左端（pt） */
  x: number;
  /** 文字列のベースライン（pt・上端から） */
  y: number;
  /** 出力PDFに描くのと同じ文字列（描けない文字の置換済み） */
  text: string;
  /** 半音変化した階名か（色と太字で区別する） */
  chromatic: boolean;
  /** 自動で付いた階名か、ユーザーが書き足した階名か（編集パネルの操作の出し分けに使う） */
  origin: 'auto' | 'manual';
  /** 自動で付いた階名の文字をユーザーが書き換えているか（「自動の階名に戻す」を出す） */
  textOverridden: boolean;
}

/** スキップ小節のハイライト範囲（小節の横範囲 × パートの譜表の縦範囲） */
export interface ScorePreviewRegion {
  partId: string;
  /** 通し小節番号（0始まり） */
  measureIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 配置を調整できなかった注釈の位置 */
export interface ScorePreviewMarker {
  annotationId: string;
  x: number;
  y: number;
}
