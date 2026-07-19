import type { MusicXmlPart, ParsedMusicXml } from '../score/MusicXmlParser';
import type { OmrArtifacts } from '../score/ScoreModelBuilder';
import { movementEndMeasureIndex, movementFirstMeasureIndex } from '../score/structureAnchors';
import type { KeyRegion } from '../../shared/types/KeyRegion';
import type { ResolvedMovement, ResolvedStructure } from '../../shared/types/ResolvedStructure';
import { tonicForFifths } from './keyTable';

/**
 * 調文脈（KeyRegion）の自動生成で検出した問題
 *
 * 例外にせず部分結果と共に返す（機能設計書「エラーハンドリング」= 部分失敗は全体を失敗にしない）。
 * 実データでは調号の食い違いが日常的に起きるため、報告に留めて訂正は確認画面（F-2）へ委ねる
 */
export type KeyRegionIssue =
  | {
      /** 同じ小節でパートごとに有効な調号が食い違う（多数決で 1 つに決めた） */
      kind: 'keySignatureConflict';
      measureIndex: number;
      /** パートID → その小節で有効だった fifths */
      fifthsByPart: Record<string, number>;
      adopted: number;
    }
  | {
      /** 五度圏の範囲（-7〜+7）を外れた調号。その宣言は無視し、直前の調号を維持する */
      kind: 'unsupportedKeySignature';
      measureIndex: number;
      partId: string;
      fifths: number;
    };

export interface KeyRegionBuildResult {
  keyRegions: KeyRegion[];
  issues: KeyRegionIssue[];
}

/** 1 小節分の採用調号 */
interface AdoptedKey {
  fifths: number;
  mode: 'major' | 'minor';
}

/** MusicXML の `<key>` 宣言 1 つ分（範囲外の調号は採用せず報告のみ行う） */
type Declaration = { valid: true; key: AdoptedKey } | { valid: false; fifths: number };

/** 曲頭に調号宣言がないときの既定（調号なし＝ハ長調） */
const DEFAULT_KEY: AdoptedKey = { fifths: 0, mode: 'major' };

function sameKey(a: AdoptedKey, b: AdoptedKey): boolean {
  return a.fifths === b.fifths && a.mode === b.mode;
}

/** 2 つの KeyRegion が同じ調を指すか（区間の位置は見ない） */
function sameTonic(a: KeyRegion, b: KeyRegion): boolean {
  return a.tonicStep === b.tonicStep && a.tonicAlter === b.tonicAlter && a.mode === b.mode;
}

function keyToRegion(key: AdoptedKey, measureIndex: number): KeyRegion | null {
  const tonic = tonicForFifths(key.fifths, key.mode);
  /* v8 ignore start -- 採用値は範囲検証済みのため到達しない防御ガード */
  if (tonic === null) {
    return null;
  }
  /* v8 ignore stop */
  return {
    id: `key-${measureIndex}`,
    start: { measureIndex, offset: 0 },
    tonicStep: tonic.step,
    tonicAlter: tonic.alter,
    mode: key.mode,
    source: 'auto',
  };
}

/**
 * 採用候補の優先順位: 出現数が多い → fifths が小さい → 長調
 *
 * 同数のときにどちらが正しいかを判定する材料はない（実データでは divisi の 1 小節のみ）。
 * ここでは**結果が決定的であること**を優先し、正しさの担保は確認画面（F-2）へ委ねる
 */
function isBetterCandidate(
  candidate: { key: AdoptedKey; count: number },
  best: { key: AdoptedKey; count: number },
): boolean {
  if (candidate.count !== best.count) {
    return candidate.count > best.count;
  }
  if (candidate.key.fifths !== best.key.fifths) {
    return candidate.key.fifths < best.key.fifths;
  }
  return candidate.key.mode === 'major' && best.key.mode === 'minor';
}

/** パートごとの「その小節で有効な調号」から 1 つを選ぶ（最頻値） */
function vote(effective: Map<string, AdoptedKey>): AdoptedKey | null {
  const counts = new Map<string, { key: AdoptedKey; count: number }>();
  for (const key of effective.values()) {
    const id = `${key.fifths}:${key.mode}`;
    const entry = counts.get(id);
    if (entry === undefined) {
      counts.set(id, { key, count: 1 });
    } else {
      entry.count += 1;
    }
  }
  let best: { key: AdoptedKey; count: number } | null = null;
  for (const entry of counts.values()) {
    if (best === null || isBetterCandidate(entry, best)) {
      best = entry;
    }
  }
  return best?.key ?? null;
}

/** パートID → （ローカル小節番号 → 調号宣言）。宣言のない小節は欠番＝前の調号が持続する */
function declarationsByPart(parts: MusicXmlPart[]): Map<string, Map<number, Declaration>> {
  const byPart = new Map<string, Map<number, Declaration>>();
  for (const part of parts) {
    const byMeasure = new Map<number, Declaration>();
    for (const measure of part.measures) {
      const key = measure.key;
      if (key === null) {
        continue;
      }
      const mode = key.mode ?? 'major';
      byMeasure.set(
        measure.index,
        tonicForFifths(key.fifths, mode) === null
          ? { valid: false, fifths: key.fifths }
          : { valid: true, key: { fifths: key.fifths, mode } },
      );
    }
    byPart.set(part.id, byMeasure);
  }
  return byPart;
}

/** movement 内のローカル小節番号の上限（全パートで最も長いもの） */
function localMeasureCount(musicXml: ParsedMusicXml): number {
  return musicXml.parts.reduce(
    (max, part) => part.measures.reduce((inner, measure) => Math.max(inner, measure.index + 1), max),
    0,
  );
}

/**
 * 確定構造と MusicXML から調文脈（KeyRegion 列）を自動生成する（用語集「調文脈」）
 *
 * `ScoreModelBuilder` と同じ入力（`OmrArtifacts` + `ResolvedStructure`）を取り、
 * 同じ基準（`structureAnchors`）で通し小節番号へ変換するため、照合結果と小節番号が必ず揃う。
 *
 * **実データの制約**: Audiveris は `<key><fifths>` のみを出力し `<mode>` を書かないため、
 * **長調/短調の自動判別はできない**。宣言に mode がなければ長調として扱う。
 * 短調（La 基準の移動ド）で読みたい場合はユーザー指定が必要（F-2 / F-6 の担当）
 */
export class KeyRegionBuilder {
  build(artifacts: OmrArtifacts, structure: ResolvedStructure): KeyRegionBuildResult {
    const issues: KeyRegionIssue[] = [];
    const keyRegions: KeyRegion[] = [];
    /** 直前までに採用されている調（movement をまたいで持続する） */
    let current: AdoptedKey | null = null;

    // `ResolvedStructure.movements` は曲順（通し小節番号の昇順）であることが契約。
    // ここで並べ替えて救うと、ScoreModelBuilder が例外にする構造を KeyRegionBuilder だけが
    // 受理してしまい、同じ入力に対する 2 コンポーネントの反応が食い違う
    /** ここまでに確定した通し小節番号の終端（movement 間の重複・逆順の検知に使う） */
    let previousEnd = 0;
    for (const movement of structure.movements) {
      if (movement.systems.length > 0) {
        const first = movementFirstMeasureIndex(movement);
        // movement の小節範囲が重なる／曲順が逆転していると KeyRegion の昇順制約が壊れる。
        // ScoreModelBuilder と同じ契約・同じ文言で早期に落とし、原因の movement を特定できるようにする
        if (first < previousEnd) {
          throw new Error(
            `ResolvedStructure の movement 間で通し小節番号が重複しています: ` +
              `${first} < ${previousEnd}`,
          );
        }
        previousEnd = movementEndMeasureIndex(movement, previousEnd);
      }
      current = this.collectMovement(artifacts, movement, current, keyRegions, issues);
    }

    this.ensureHeadRegion(keyRegions);
    return { keyRegions, issues };
  }

  /**
   * 制約「先頭要素は曲頭（measureIndex=0, offset=0）に必ず存在する」を保証する
   *
   * 実データでは曲頭に調号宣言がない（victoria は通し 28 小節目、divisi は 48 小節目が初出）。
   * 最初の宣言が既定と**同じ調**だった場合は、区間を分けず先頭へ寄せる。
   * 単純に既定を前置きすると、転調していないのに同じ調の KeyRegion が 2 つ並び、
   * 転調点 UI（F-6）が存在しない転調点を描いてしまう
   * （曲頭の調号が「なし」＝ハ長調の楽譜で必ず起きる）
   */
  private ensureHeadRegion(keyRegions: KeyRegion[]): void {
    const head = keyToRegion(DEFAULT_KEY, 0);
    /* v8 ignore start -- 既定値は必ず表に存在するため到達しない防御ガード */
    if (head === null) {
      throw new Error('unreachable: 既定の調号から主音を解決できません');
    }
    /* v8 ignore stop */
    const first = keyRegions[0];
    if (first === undefined) {
      keyRegions.push(head);
      return;
    }
    if (first.start.measureIndex === 0) {
      return;
    }
    if (sameTonic(first, head)) {
      // 曲頭からこの調が有効だったとみなし、区間の開始を曲頭へ移す
      keyRegions[0] = { ...first, id: head.id, start: head.start };
      return;
    }
    keyRegions.unshift(head);
  }

  /**
   * 1 movement 分の調号を走査し、変化点で KeyRegion を追加する
   *
   * 確定構造が割り当てた小節範囲の外にある MusicXML の小節は無視する。
   * 範囲外の小節に KeyRegion を作ると次の movement の小節番号を追い越し、昇順制約が壊れるため
   *
   * @returns この movement の終わりで有効な調（次の movement へ持続させる）
   */
  private collectMovement(
    artifacts: OmrArtifacts,
    movement: ResolvedMovement,
    initial: AdoptedKey | null,
    keyRegions: KeyRegion[],
    issues: KeyRegionIssue[],
  ): AdoptedKey | null {
    const musicXml = artifacts.movements[movement.musicXmlIndex]?.musicXml;
    if (musicXml === undefined) {
      // ResolvedStructure と artifacts の不整合は認識エラーではなく呼び出し側の契約違反。
      // ScoreModelBuilder.build() と同じ条件・同じ分類で落とす（両者は同じ入力を取るため、
      // 片方だけが黙って読み飛ばすと壊れた構造が「正常」として通ってしまう）
      throw new Error(`ResolvedStructure が指す MusicXML がありません: ${movement.musicXmlIndex}`);
    }
    // 段を持たない movement は小節を 1 つも持たない＝調号の走査対象がないだけで、構造としては正常
    if (movement.systems.length === 0) {
      return initial;
    }
    const firstMeasureIndex = movementFirstMeasureIndex(movement);
    const endMeasureIndex = movementEndMeasureIndex(movement, firstMeasureIndex);
    const declarations = declarationsByPart(musicXml.parts);
    const measureCount = localMeasureCount(musicXml);

    /** パートID → その時点で有効な調号（宣言のないパートは前の値が持続する） */
    const effective = new Map<string, AdoptedKey>();
    // 前の movement から持続している調を全パートの初期値として置く。これを省くと、
    // 新しい movement で一部のパートだけが先に宣言したときに**そのパートだけが母数**になり、
    // 食い違っているのに「全会一致」と誤認して KeyRegion を確定してしまう
    if (initial !== null) {
      for (const part of musicXml.parts) {
        effective.set(part.id, initial);
      }
    }
    let current = initial;

    for (let local = 0; local < measureCount; local += 1) {
      const measureIndex = firstMeasureIndex + local;
      if (measureIndex >= endMeasureIndex) {
        break;
      }
      let declaredHere = false;
      for (const [partId, byMeasure] of declarations) {
        const declared = byMeasure.get(local);
        if (declared === undefined) {
          continue;
        }
        declaredHere = true;
        if (!declared.valid) {
          issues.push({
            kind: 'unsupportedKeySignature',
            measureIndex,
            partId,
            fifths: declared.fifths,
          });
          continue;
        }
        effective.set(partId, declared.key);
      }

      const adopted = vote(effective);
      if (adopted === null) {
        continue;
      }
      if (declaredHere) {
        this.reportConflict(effective, adopted, measureIndex, issues);
      }
      if (current === null || !sameKey(current, adopted)) {
        const region = keyToRegion(adopted, measureIndex);
        /* v8 ignore start -- 採用値は範囲検証済みのため region が null にならない防御ガード */
        if (region === null) {
          continue;
        }
        /* v8 ignore stop */
        keyRegions.push(region);
        current = adopted;
      }
    }
    return current;
  }

  /**
   * その小節で 2 種類以上の調号が有効なら報告する（多数決で 1 つに決めた事実を残す）
   *
   * **宣言のあった小節でだけ**呼ぶ。食い違いは解消されるまで持続するため、
   * 全小節で報告すると同じ事実が数百件に膨らみ、確認画面（F-2）の表示材料として使えなくなる
   */
  private reportConflict(
    effective: Map<string, AdoptedKey>,
    adopted: AdoptedKey,
    measureIndex: number,
    issues: KeyRegionIssue[],
  ): void {
    const distinct = new Set([...effective.values()].map((key) => key.fifths));
    if (distinct.size < 2) {
      return;
    }
    const fifthsByPart: Record<string, number> = {};
    for (const [partId, key] of effective) {
      fifthsByPart[partId] = key.fifths;
    }
    issues.push({
      kind: 'keySignatureConflict',
      measureIndex,
      fifthsByPart,
      adopted: adopted.fifths,
    });
  }
}
