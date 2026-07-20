import type { ProjectSnapshot } from '../../../src/shared/ipc/contract';
import type { ConfirmationItem } from '../../../src/shared/types/Confirmation';
import type { KeyRegion } from '../../../src/shared/types/KeyRegion';
import type { Project } from '../../../src/shared/types/Project';

/**
 * 画面テスト用の最小データ
 *
 * 実データの形（divisi の P6 は 35 段が ALTO 誤検出）を縮尺して持つ。
 * 解析の正しさは domain 側のテストが担うため、ここは表示に必要な形だけを揃える
 */

export function confirmationItem(overrides: Partial<ConfirmationItem> = {}): ConfirmationItem {
  return {
    id: 'clef-P6-ALTO',
    kind: 'clef',
    partId: 'P6',
    detected: 'ALTO',
    corrected: null,
    staffRefs: [{ pageIndex: 0, systemIndex: 0, staffIndex: 0, partId: 'P6' }],
    clipRect: { pageIndex: 0, x: 0, y: 0, width: 10, height: 10 },
    mismatchCount: 402,
    ...overrides,
  };
}

export function keyRegion(overrides: Partial<KeyRegion> = {}): KeyRegion {
  return {
    id: 'kr-0',
    start: { measureIndex: 0, offset: 0 },
    tonicStep: 'C',
    tonicAlter: 0,
    mode: 'major',
    source: 'auto',
    ...overrides,
  };
}

export function project(overrides: Partial<Project> = {}): Project {
  return {
    schemaVersion: 1,
    id: 'p1',
    sourcePdf: 'source.pdf',
    pages: [],
    score: null,
    confirmation: { items: [], completedAt: null },
    structureDecisions: [],
    keyRegionDecisions: [],
    keyRegions: [],
    annotations: [],
    settings: {
      syllableSystem: 'kodaly',
      minorBasis: 'la',
      diatonicColor: '#8b0000',
      chromaticColor: '#6a0dad',
      fontFamily: 'sans-serif',
      fontSizePt: 8,
    },
    createdAt: '2026-07-19T00:00:00.000Z',
    updatedAt: '2026-07-19T00:00:00.000Z',
    ...overrides,
  };
}

export function snapshot(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    project: project(),
    filePath: null,
    structureIssues: [],
    buildIssues: [],
    keyRegionIssues: [],
    pageIssues: [],
    annotationIssues: [],
    preview: [],
    unmatchedCorrections: [],
    ...overrides,
  };
}
