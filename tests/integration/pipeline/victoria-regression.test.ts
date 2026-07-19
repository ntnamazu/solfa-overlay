import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { issuesOfKind, runFixture } from './realFixtureHelpers';

/**
 * Victoria《O magnum mysterium》（パブリックドメイン）実 Audiveris 出力の定量回帰。
 *
 * ロードマップ Phase 1 のゲート: 合成フィクスチャではなく実 Audiveris 5.6.1 出力で
 * ScoreModelBuilder が期待どおり動くこと。実測値の根拠は tests/fixtures/victoria/README.md 参照。
 *
 * 注: プロトタイプ実測（784音・skipped5）とは Audiveris バージョン差・列対付けアルゴリズムの
 * 違いで数値が異なる。ここでは実フィクスチャの実測値を正とする。
 */
const read = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../../fixtures/victoria/${name}`, import.meta.url)));

describe('Victoria O magnum mysterium 実データ回帰', () => {
  const run = runFixture(read('IMSLP19716.omr'), [read('IMSLP19716.mvt1.mxl'), read('IMSLP19716.mvt2.mxl')]);

  it('2 movement・4 ページ・4 声部（SATB）を復元する', () => {
    expect(run.summary.movements).toBe(2);
    expect(run.summary.pages).toBe(4);
    expect(run.summary.parts).toEqual(['P1(Voice)', 'P2(Voice)', 'P3(Voice)', 'P4(Voice)']);
  });

  it('295 小節が matched・808 音が照合される', () => {
    expect(run.summary.matchedMeasures).toBe(295);
    expect(run.summary.notes).toBe(808);
  });

  it('音高クロスチェック不一致が 0 件（列対付けが実データで取り違えを起こさない）', () => {
    expect(issuesOfKind(run.result, 'pitchCrossCheckMismatch')).toHaveLength(0);
  });

  it('音符数不一致は 1 小節（P3 の通し小節45）だけに隔離される', () => {
    expect(run.summary.skippedMeasures).toBe(1);
    expect(run.summary.skippedRefs).toEqual(['P3:m45']);
    expect(run.summary.issueCounts).toEqual({ measureCountMismatch: 1 });
  });
});
