import { describe, expect, it } from 'vitest';
import {
  buildAudiverisArgs,
  buildAudiverisEnv,
  parseProgressLine,
} from '../../../../src/main/omr/audiverisCommand';

describe('buildAudiverisArgs', () => {
  it('引数を配列で返し PDF パスを -- 以降に分離する（シェル連結しない）', () => {
    expect(buildAudiverisArgs('/in/score.pdf', '/out/dir')).toEqual([
      '-batch',
      '-save',
      '-export',
      '-output',
      '/out/dir',
      '--',
      '/in/score.pdf',
    ]);
  });

  it('空白や特殊文字を含むパスもそのまま1要素として渡す（分割・エスケープしない）', () => {
    const args = buildAudiverisArgs('/in/a b; rm -rf.pdf', '/out dir');
    expect(args[args.length - 1]).toBe('/in/a b; rm -rf.pdf');
    expect(args).toContain('/out dir');
  });
});

describe('buildAudiverisEnv', () => {
  it('headless オプションを付与し元の env を破壊しない', () => {
    const base = { PATH: '/usr/bin' } as NodeJS.ProcessEnv;
    const env = buildAudiverisEnv('darwin', base);
    expect(env.JAVA_TOOL_OPTIONS).toBe('-Djava.awt.headless=true');
    expect(env.PATH).toBe('/usr/bin');
    expect(base.JAVA_TOOL_OPTIONS).toBeUndefined(); // 元 env は不変
  });

  it('既存の JAVA_TOOL_OPTIONS を保持して headless を追記する', () => {
    const env = buildAudiverisEnv('darwin', { JAVA_TOOL_OPTIONS: '-Xmx2g' });
    expect(env.JAVA_TOOL_OPTIONS).toBe('-Xmx2g -Djava.awt.headless=true');
  });

  it('Linux では GDK_SCALE=1 を付与する', () => {
    expect(buildAudiverisEnv('linux', {}).GDK_SCALE).toBe('1');
  });

  it('Linux 以外では GDK_SCALE を付与しない', () => {
    expect(buildAudiverisEnv('win32', {}).GDK_SCALE).toBeUndefined();
  });
});

describe('parseProgressLine', () => {
  it('シート番号を伴う処理ログを transcribing として番号付きで返す', () => {
    expect(parseProgressLine('INFO  [IMSLP19716] Sheet #2 HEADS step')).toEqual({
      phase: 'transcribing',
      sheet: 2,
      totalSheets: null,
      message: 'INFO  [IMSLP19716] Sheet #2 HEADS step',
    });
  });

  it('sheet#N 表記からも番号を抽出する', () => {
    expect(parseProgressLine('Processing sheet#10 ...')?.sheet).toBe(10);
  });

  it('読み込みログを loading として返す', () => {
    expect(parseProgressLine('Loading book from score.pdf')?.phase).toBe('loading');
  });

  it('書き出しログを exporting として返す（export はシートより優先）', () => {
    const progress = parseProgressLine('Book exported to sheet#3 area');
    expect(progress?.phase).toBe('exporting');
  });

  it('無関係な行は null を返す（誤進捗を出さない）', () => {
    expect(parseProgressLine('DEBUG some unrelated diagnostic')).toBeNull();
  });

  it('空行は null を返す', () => {
    expect(parseProgressLine('   ')).toBeNull();
  });
});
