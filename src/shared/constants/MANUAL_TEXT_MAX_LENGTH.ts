/**
 * 手動で書く階名の文字数の上限（F-5）
 *
 * 階名は長くても `do#` 程度で、楽譜の余白に収まる長さでなければ判読できない。
 * 上限が無いと貼り付けた長文が譜面を横切り、出力PDFを台無しにする。
 * Main（`applyAnnotationEdit` の検証）と Renderer（入力欄の `maxLength`）が同じ値を使う
 */
export const MANUAL_TEXT_MAX_LENGTH = 16;
