import { StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { resolveFontFamily, solfaFonts } from '../../../../src/domain/render/fontMetrics';

describe('resolveFontFamily', () => {
  it('総称ファミリ名を標準14フォントへ対応づける', () => {
    expect(resolveFontFamily('sans-serif').regular).toBe(StandardFonts.Helvetica);
    expect(resolveFontFamily('serif').regular).toBe(StandardFonts.TimesRoman);
    expect(resolveFontFamily('monospace').bold).toBe(StandardFonts.CourierBold);
  });

  it('大文字・前後の空白を吸収する', () => {
    expect(resolveFontFamily('  Serif ').regular).toBe(StandardFonts.TimesRoman);
  });

  it('未知の名前は既定（Helvetica）へ落とす（綴り間違いで出力を失敗させない）', () => {
    expect(resolveFontFamily('Comic Sans MS').regular).toBe(StandardFonts.Helvetica);
    expect(resolveFontFamily('').bold).toBe(StandardFonts.HelveticaBold);
  });
});

describe('solfaFonts', () => {
  const fonts = solfaFonts('sans-serif');

  it('変化音用に太字を返す', () => {
    expect(fonts.regular.fontName).toBe(StandardFonts.Helvetica);
    expect(fonts.bold.fontName).toBe(StandardFonts.HelveticaBold);
  });

  it('ASCII の音節はそのまま通す', () => {
    expect(fonts.regular.displayText('do')).toEqual({ text: 'do', substitutions: [] });
  });

  it('♯ ♭ を WinAnsi で描ける文字へ置換し、置換内容を報告する', () => {
    // 実データ（divisi）に出る音節。置換しないと pdf-lib が例外を投げる
    expect(fonts.regular.displayText('do♭')).toEqual({
      text: 'dob',
      substitutions: [{ from: '♭', to: 'b' }],
    });
    expect(fonts.regular.displayText('ti♯')).toEqual({
      text: 'ti#',
      substitutions: [{ from: '♯', to: '#' }],
    });
  });

  it('重変化（♭が2つ）も全て置換する', () => {
    expect(fonts.regular.displayText('do♭♭').text).toBe('dobb');
    expect(fonts.regular.displayText('do♭♭').substitutions).toHaveLength(2);
  });

  it('WinAnsi で描けないその他の文字は ? へ落として報告する', () => {
    const result = fonts.regular.displayText('あ');
    expect(result.text).toBe('?');
    expect(result.substitutions).toEqual([{ from: 'あ', to: '?' }]);
  });

  it('♯ を含む文字列の幅が例外にならず測れる（置換を計測の前に通している）', () => {
    // 置換を通さないと widthOfTextAtSize の時点で WinAnsi の例外になる
    expect(() => fonts.regular.widthPt('ti♯', 8)).not.toThrow();
    expect(fonts.regular.widthPt('ti♯', 8)).toBeCloseTo(fonts.regular.widthPt('ti#', 8), 6);
  });

  it('幅はフォントサイズに比例する', () => {
    expect(fonts.regular.widthPt('do', 16)).toBeCloseTo(fonts.regular.widthPt('do', 8) * 2, 6);
  });

  it('太字の方が幅が広い', () => {
    expect(fonts.bold.widthPt('do', 8)).toBeGreaterThan(fonts.regular.widthPt('do', 8));
  });

  it('アセンダ高は正で、フォントサイズより小さい', () => {
    const ascent = fonts.regular.ascentPt(8);
    expect(ascent).toBeGreaterThan(0);
    expect(ascent).toBeLessThan(8);
  });
});
