import type { KeyRegion } from '../../shared/types/KeyRegion';
import type { Pitch, PitchStep } from '../../shared/types/Pitch';
import type { MinorBasis, ProjectSettings } from '../../shared/types/ProjectSettings';
import type { SolfaDegree } from '../../shared/types/SolfaDegree';
import { syllableFor } from './syllableTables';

/** 「do」の位置（オクターブに依存しないため step + alter のみ） */
export interface DoPitch {
  step: PitchStep;
  alter: number;
}

/** 幹音のレター順（度数計算の基準。C起点は音名→半音位置の対応表と揃えるための便宜で、do の位置には依存しない） */
const STEP_ORDER: readonly PitchStep[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/** 幹音の半音位置（オクターブ内 0〜11） */
const NATURAL_SEMITONES: Readonly<Record<PitchStep, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

/** 度数1〜7の do からの半音数（長音階） */
const MAJOR_SCALE_OFFSETS: Readonly<Record<SolfaDegree['degree'], number>> = {
  1: 0,
  2: 2,
  3: 4,
  4: 5,
  5: 7,
  6: 9,
  7: 11,
};

function stepIndex(step: PitchStep): number {
  return STEP_ORDER.indexOf(step);
}

/** レター順で index 番目（mod 7）の幹音を返す */
function stepAt(index: number): PitchStep {
  const step = STEP_ORDER[((index % 7) + 7) % 7];
  /* v8 ignore start -- mod 7 により添字は常に 0〜6 のため到達しない防御ガード */
  if (step === undefined) {
    throw new Error(`unreachable: invalid step index ${index}`);
  }
  /* v8 ignore stop */
  return step;
}

/** 半音差を最小絶対値（-6〜+5）に正規化する。実用上の調では -2〜+2 に収まる */
function signedDiff12(diff: number): number {
  return ((diff % 12) + 18) % 12 - 6;
}

/**
 * 「do」の位置を決定する（機能設計書「階名計算」ステップ1）
 *
 * - major または Do基準短調: do = KeyRegion の主音
 * - La基準短調: do = 平行長調の主音（主音の短3度上 = レター2つ上・半音3つ上。
 *   例: イ短調 → do = C。平行調は同じ調号を持つため、以降の期待変位計算が長調と共通化できる）
 */
export function resolveDo(region: KeyRegion, basis: MinorBasis): DoPitch {
  if (region.mode === 'major' || basis === 'do') {
    return { step: region.tonicStep, alter: region.tonicAlter };
  }
  const doStep = stepAt(stepIndex(region.tonicStep) + 2);
  const doSemitone = NATURAL_SEMITONES[region.tonicStep] + region.tonicAlter + 3;
  const alter = signedDiff12(doSemitone - NATURAL_SEMITONES[doStep]);
  return { step: doStep, alter };
}

/** do から対象音への幹音距離（レター距離）で度数を決める（ステップ2） */
export function letterDistance(doStep: PitchStep, noteStep: PitchStep): SolfaDegree['degree'] {
  // 結果は 1〜7 に閉じる（mod 7 + 1）ため度数リテラル型へ絞り込める
  return (((stepIndex(noteStep) - stepIndex(doStep) + 7) % 7) + 1) as SolfaDegree['degree'];
}

/**
 * do を主音とする長音階における度数 degree の期待変位（調号由来。ステップ3）
 *
 * 結果は do 長調の調号と必ず一致する（例: do=G なら F のみ +1）。この性質をテストで検証する
 */
export function expectedAlterInDoMajor(doPitch: DoPitch, degree: SolfaDegree['degree']): number {
  const targetStep = stepAt(stepIndex(doPitch.step) + (degree - 1));
  const expectedSemitone =
    (((NATURAL_SEMITONES[doPitch.step] + doPitch.alter + MAJOR_SCALE_OFFSETS[degree]) % 12) + 12) %
    12;
  return signedDiff12(expectedSemitone - NATURAL_SEMITONES[targetStep]);
}

/**
 * 調文脈と記譜音高から階名の内部表現（度数＋変位）を計算する
 *
 * @param note - MusicXML由来の記譜音高（調号込みの実音）
 * @param region - この音符が属する調文脈
 * @param basis - 短調の読み方（'la' | 'do'）
 * @returns 度数＋変位。音節体系に依存しない
 */
export function computeDegree(note: Pitch, region: KeyRegion, basis: MinorBasis): SolfaDegree {
  const doPitch = resolveDo(region, basis);
  const degree = letterDistance(doPitch.step, note.step);
  const alteration = note.alter - expectedAlterInDoMajor(doPitch, degree);
  return { degree, alteration };
}

/**
 * 階名計算エンジン（用語集「SolfaEngine」）
 *
 * computeDegrees(score, keyRegions) は ScoreModel 実装後に追加する
 * （インターフェースは機能設計書「コンポーネント設計」で確定済み）
 */
export class SolfaEngine {
  computeDegree(note: Pitch, region: KeyRegion, basis: MinorBasis): SolfaDegree {
    return computeDegree(note, region, basis);
  }

  /** 設定（音節体系）に応じた表示文字列の導出 */
  toSyllable(degree: SolfaDegree, settings: ProjectSettings): string {
    return syllableFor(degree, settings.syllableSystem);
  }
}
