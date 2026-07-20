import type { KeyRegion } from '../../shared/types/KeyRegion';
import type { Pitch, PitchStep } from '../../shared/types/Pitch';
import type { MinorBasis, ProjectSettings } from '../../shared/types/ProjectSettings';
import type { ScoreModel } from '../../shared/types/ScoreModel';
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
  return (((diff % 12) + 18) % 12) - 6;
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
 * 通し小節番号から、その位置で有効な KeyRegion を二分探索で引く
 *
 * `regions` は start 昇順・先頭が measureIndex 0 であることを前提とする（呼び出し側が検証済み）
 */
function regionAt(regions: readonly KeyRegion[], measureIndex: number): KeyRegion {
  let low = 0;
  let high = regions.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const region = regions[mid];
    /* v8 ignore start -- mid は必ず配列長の範囲内のため到達しない防御ガード */
    if (region === undefined) {
      break;
    }
    /* v8 ignore stop */
    if (region.start.measureIndex <= measureIndex) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  const found = regions[low];
  /* v8 ignore start -- 先頭要素の存在は契約検証済みのため到達しない防御ガード */
  if (found === undefined) {
    throw new Error('unreachable: KeyRegion が空です');
  }
  /* v8 ignore stop */
  return found;
}

/**
 * KeyRegion 列が階名計算の前提を満たすか検証する
 *
 * 制約違反は認識エラーではなく**呼び出し側が組んだデータの契約違反**のため例外にする
 * （`ScoreModelBuilder` が `ResolvedStructure` の不整合を例外にするのと同じ扱い）
 */
function assertKeyRegions(regions: readonly KeyRegion[]): void {
  const head = regions[0];
  if (head === undefined) {
    throw new Error('KeyRegion が空です（曲頭の調文脈は必須）');
  }
  if (head.start.measureIndex !== 0 || head.start.offset !== 0) {
    throw new Error(
      `KeyRegion の先頭は曲頭（measureIndex=0, offset=0）である必要があります: ` +
        `${head.start.measureIndex}:${head.start.offset}`,
    );
  }
  for (let i = 1; i < regions.length; i += 1) {
    const previous = regions[i - 1];
    const current = regions[i];
    /* v8 ignore start -- ループ範囲内のため到達しない防御ガード */
    if (previous === undefined || current === undefined) {
      continue;
    }
    /* v8 ignore stop */
    if (current.start.measureIndex <= previous.start.measureIndex) {
      throw new Error(
        `KeyRegion は小節番号の昇順・重複なしである必要があります: ` +
          `${previous.start.measureIndex} → ${current.start.measureIndex}`,
      );
    }
  }
}

/**
 * 階名計算結果を ScoreModel に反映した**新しい** ScoreModel を返す（非破壊のマージ）
 *
 * `computeDegrees` が返す Map だけでは「小節ごとの階名列」を取り出すのに呼び出し側で
 * 毎回の突き合わせが要るため、注釈生成（AnnotationManager）と通し回帰テストのために用意する。
 *
 * `degrees` に対応する結果がない音符は**既存の `solfa` をそのまま保つ**（上書きしない）。
 * これは部分的な再計算を安全にするための意味論で、転調指定の変更時に
 * 「影響を受ける KeyRegion 範囲だけ再計算する」（アーキテクチャ設計書の性能要件）を行っても、
 * 範囲外の音符の階名が無言で消えない。全体を計算し直したい場合は
 * `computeDegrees` の結果が全音符を覆うため、そのまま渡せば全て置き換わる
 */
export function applyDegrees(
  score: ScoreModel,
  degrees: ReadonlyMap<string, SolfaDegree>,
): ScoreModel {
  return {
    ...score,
    measures: score.measures.map((measure) => ({
      ...measure,
      notes: measure.notes.map((note) => ({ ...note, solfa: degrees.get(note.id) ?? note.solfa })),
    })),
  };
}

/** 階名計算エンジン（用語集「SolfaEngine」） */
export class SolfaEngine {
  computeDegree(note: Pitch, region: KeyRegion, basis: MinorBasis): SolfaDegree {
    return computeDegree(note, region, basis);
  }

  /**
   * 楽譜モデル全体の階名を計算する（機能設計書「コンポーネント設計」）
   *
   * @param score - 照合済みの楽譜モデル
   * @param keyRegions - 調文脈。start 昇順・重複なしで、先頭は曲頭（measureIndex=0, offset=0）
   * @param basis - 短調の読み方（'la' | 'do'）。機能設計書のシグネチャに対する追加引数で、
   *   これがないと短調の do の位置が決まらない
   * @returns 音符ID → 度数＋変位。skipped 小節は音符を持たないため結果にも現れない
   * @throws keyRegions が制約（非空・曲頭・昇順）を満たさない場合
   *
   * **既知の限界**: `NoteEvent` は小節内オフセットを持たないため、`KeyRegion.start.offset` は
   * 無視され、転調はその小節の先頭から適用される。自動生成の KeyRegion は必ず offset=0 のため
   * 現時点で実害はない。小節途中の転調指定（F-6）を実装する際に `NoteEvent` へ
   * オフセットを持たせるか判断する
   */
  computeDegrees(
    score: ScoreModel,
    keyRegions: readonly KeyRegion[],
    basis: MinorBasis,
  ): Map<string, SolfaDegree> {
    assertKeyRegions(keyRegions);
    const degrees = new Map<string, SolfaDegree>();
    for (const measure of score.measures) {
      if (measure.notes.length === 0) {
        continue;
      }
      const region = regionAt(keyRegions, measure.index);
      for (const note of measure.notes) {
        degrees.set(note.id, computeDegree(note.pitch, region, basis));
      }
    }
    return degrees;
  }

  /** 設定（音節体系）に応じた表示文字列の導出 */
  toSyllable(degree: SolfaDegree, settings: ProjectSettings): string {
    return syllableFor(degree, settings.syllableSystem);
  }
}
