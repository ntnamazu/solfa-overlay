import { describe, expect, it } from 'vitest';
import { ProjectFileError } from '../../../src/storage/errors';
import { ProjectStore } from '../../../src/storage/ProjectStore';
import { SCHEMA_VERSION, parseProject } from '../../../src/storage/projectSchema';

/** 検証対象の素材。`create()` の出力をそのまま使い、実装とスキーマの乖離も同時に検知する */
const validProject = () => JSON.parse(JSON.stringify(new ProjectStore().create())) as unknown;

/** ProjectFileError の reason を取り出す（型を絞ってから assert するため） */
function reasonOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof ProjectFileError) {
      return error.reason;
    }
    throw error;
  }
  throw new Error('例外が投げられなかった');
}

describe('projectSchema', () => {
  describe('parseProject', () => {
    it('ProjectStore.create() の出力をそのまま受け入れる', () => {
      const parsed = parseProject(validProject());
      expect(parsed.schemaVersion).toBe(SCHEMA_VERSION);
      expect(parsed.settings.minorBasis).toBe('la');
    });

    it('解析結果は入力と同一の内容になる（読込で値が落ちない）', () => {
      const source = validProject();
      expect(parseProject(source)).toEqual(source);
    });

    it('必須フィールドが欠けていれば schema エラー', () => {
      const project = validProject() as Record<string, unknown>;
      delete project.keyRegions;
      expect(reasonOf(() => parseProject(project))).toBe('schema');
    });

    it('型が違えば schema エラー', () => {
      const project = validProject() as Record<string, unknown>;
      project.annotations = 'not-an-array';
      expect(reasonOf(() => parseProject(project))).toBe('schema');
    });

    it('列挙値の想定外は schema エラー（設定値の取り違えを読込時に止める）', () => {
      const project = validProject() as { settings: Record<string, unknown> };
      project.settings.minorBasis = 'so';
      expect(reasonOf(() => parseProject(project))).toBe('schema');
    });

    it('オブジェクトでない入力は schema エラー', () => {
      expect(reasonOf(() => parseProject(null))).toBe('schema');
      expect(reasonOf(() => parseProject('project'))).toBe('schema');
    });

    it('アプリより新しい版数は version エラー（構造検証より先に判定する）', () => {
      const project = validProject() as Record<string, unknown>;
      project.schemaVersion = SCHEMA_VERSION + 1;
      // 新版で増えたフィールドは現行スキーマでは不正になり得る。それでも
      // 「アプリを更新すれば開ける」と案内するため version が優先されねばならない
      project.unknownFieldFromFutureVersion = { anything: true };
      delete project.keyRegions;
      expect(reasonOf(() => parseProject(project))).toBe('version');
    });

    it('現行版と同じ版数は version エラーにしない', () => {
      const project = validProject() as Record<string, unknown>;
      project.schemaVersion = SCHEMA_VERSION;
      expect(() => parseProject(project)).not.toThrow();
    });

    it('版数が数値でなければ構造検証に委ねる（schema エラー）', () => {
      const project = validProject() as Record<string, unknown>;
      project.schemaVersion = 'v1';
      expect(reasonOf(() => parseProject(project))).toBe('schema');
    });

    it('確認項目・調区間を持つプロジェクトを往復できる', () => {
      const project = validProject() as Record<string, unknown>;
      project.confirmation = {
        items: [
          {
            id: 'clef-P6-ALTO',
            kind: 'clef',
            partId: 'P6',
            detected: 'ALTO',
            corrected: 'TREBLE',
            staffRefs: [{ pageIndex: 0, systemIndex: 1, staffIndex: 2, partId: 'P6' }],
            clipRect: { pageIndex: 0, x: 10, y: 20, width: 30, height: 40 },
            mismatchCount: 402,
          },
        ],
        completedAt: '2026-07-19T00:00:00.000Z',
      };
      project.keyRegionDecisions = [{ measureIndex: 0, mode: 'minor' }];
      project.keyRegions = [
        {
          id: 'kr-0',
          start: { measureIndex: 0, offset: 0 },
          tonicStep: 'A',
          tonicAlter: 0,
          mode: 'minor',
          source: 'user',
        },
      ];
      expect(parseProject(project)).toEqual(project);
    });
  });
});

describe('版数の下限', () => {
  it.each([0, -1])('存在しない版数 %i は version エラー（v1 として読まない）', (schemaVersion) => {
    const project = validProject() as Record<string, unknown>;
    project.schemaVersion = schemaVersion;
    expect(reasonOf(() => parseProject(project))).toBe('version');
  });
});
