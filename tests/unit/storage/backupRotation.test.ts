import { describe, expect, it } from 'vitest';
import { BACKUP_GENERATIONS, backupPath, planRotation } from '../../../src/storage/backupRotation';

const PROJECT = '/scores/song.solfaproj';

/** 実在するパスの集合から existing 判定を作る */
const existingOf = (paths: string[]) => (path: string) => paths.includes(path);

describe('backupRotation', () => {
  describe('planRotation', () => {
    it('初回保存（本体もバックアップもない）では何もしない', () => {
      expect(planRotation(PROJECT, existingOf([]))).toEqual([]);
    });

    it('2回目の保存では本体を bak1 へ退避するだけ', () => {
      expect(planRotation(PROJECT, existingOf([PROJECT]))).toEqual([
        { kind: 'rename', from: PROJECT, to: `${PROJECT}.bak1` },
      ]);
    });

    it('古い世代から順に処理する（若い番号から動かすと世代が全て同じ内容になる）', () => {
      const paths = [PROJECT, `${PROJECT}.bak1`, `${PROJECT}.bak2`];
      expect(planRotation(PROJECT, existingOf(paths))).toEqual([
        // bak2 → bak3 が先。逆順だと bak1→bak2 が既存 bak2 を潰し、
        // 続く bak2→bak3 が同じ内容を運んで 2 世代が重複する
        { kind: 'rename', from: `${PROJECT}.bak2`, to: `${PROJECT}.bak3` },
        { kind: 'rename', from: `${PROJECT}.bak1`, to: `${PROJECT}.bak2` },
        { kind: 'rename', from: PROJECT, to: `${PROJECT}.bak1` },
      ]);
    });

    it('世代が上限に達していれば最古世代を捨ててからずらす', () => {
      const paths = [PROJECT, `${PROJECT}.bak1`, `${PROJECT}.bak2`, `${PROJECT}.bak3`];
      expect(planRotation(PROJECT, existingOf(paths))).toEqual([
        { kind: 'remove', path: `${PROJECT}.bak3` },
        { kind: 'rename', from: `${PROJECT}.bak2`, to: `${PROJECT}.bak3` },
        { kind: 'rename', from: `${PROJECT}.bak1`, to: `${PROJECT}.bak2` },
        { kind: 'rename', from: PROJECT, to: `${PROJECT}.bak1` },
      ]);
    });

    it('世代が歯抜けでも存在するものだけを動かす', () => {
      const paths = [PROJECT, `${PROJECT}.bak2`];
      expect(planRotation(PROJECT, existingOf(paths))).toEqual([
        { kind: 'rename', from: `${PROJECT}.bak2`, to: `${PROJECT}.bak3` },
        { kind: 'rename', from: PROJECT, to: `${PROJECT}.bak1` },
      ]);
    });

    it('本体がなくバックアップだけある場合は本体の退避を行わない', () => {
      expect(planRotation(PROJECT, existingOf([`${PROJECT}.bak1`]))).toEqual([
        { kind: 'rename', from: `${PROJECT}.bak1`, to: `${PROJECT}.bak2` },
      ]);
    });

    it('操作を順に適用すると保持世代が上限を超えない', () => {
      // 実際にローテーションを繰り返して、生き残るファイルが本体＋3世代に収まることを確認する
      const files = new Set<string>();
      for (let save = 0; save < 10; save += 1) {
        for (const operation of planRotation(PROJECT, (path) => files.has(path))) {
          if (operation.kind === 'remove') {
            files.delete(operation.path);
          } else {
            files.delete(operation.from);
            files.add(operation.to);
          }
        }
        files.add(PROJECT); // 保存で本体が書かれる
      }
      expect([...files].sort()).toEqual([
        PROJECT,
        `${PROJECT}.bak1`,
        `${PROJECT}.bak2`,
        `${PROJECT}.bak3`,
      ]);
      expect(files.size).toBe(BACKUP_GENERATIONS + 1);
    });
  });

  describe('backupPath', () => {
    it('世代番号を末尾に付ける（.gitignore の *.solfaproj.bak* と一致する形）', () => {
      expect(backupPath(PROJECT, 1)).toBe('/scores/song.solfaproj.bak1');
      expect(backupPath(PROJECT, 3)).toBe('/scores/song.solfaproj.bak3');
    });
  });
});
