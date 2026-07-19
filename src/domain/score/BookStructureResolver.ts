import type {
  ResolvedMovement,
  ResolvedStructure,
  ResolvedSystem,
} from '../../shared/types/ResolvedStructure';
import type { MusicXmlSystemLayout, ParsedMusicXml } from './MusicXmlParser';
import type { BookPageRef, OmrPageContent } from './OmrSheetParser';
import { groupMovements } from './OmrSheetParser';
import type { OmrArtifacts } from './ScoreModelBuilder';

/**
 * 譜表構造の問題（例外にせず検出結果として返す。StructureConfirm 画面の表示材料）
 *
 * 機能設計書「エラーハンドリング」＝ 部分失敗は全体を失敗にしない。すべて位置情報を持つため、
 * 確認画面がそのままハイライト位置として使える
 */
export type StructureIssue =
  | {
      kind: 'movementCountMismatch';
      /** book.xml の movement 分割数 */
      omrMovementCount: number;
      /** Audiveris が出力した MusicXML の数 */
      musicXmlCount: number;
    }
  | {
      kind: 'pageCountMismatch';
      movementIndex: number;
      omrPageCount: number;
      xmlPageCount: number;
    }
  | {
      kind: 'systemCountMismatch';
      movementIndex: number;
      pageIndex: number;
      omrSystemCount: number;
      xmlSystemCount: number;
    }
  | {
      kind: 'systemMeasureCountMismatch';
      movementIndex: number;
      pageIndex: number;
      systemIndex: number;
      /** .omr の stack 数 */
      omrStackCount: number;
      /** MusicXML の段レイアウト上の小節数（こちらを採用する） */
      xmlMeasureCount: number;
    }
  | {
      kind: 'inconsistentSystemStaffCount';
      movementIndex: number;
      pageIndex: number;
      /** ページ内の段ごとの譜表数（不揃い＝段の検出が疑わしい） */
      staffCounts: number[];
    }
  | {
      kind: 'pageCorrespondenceMismatch';
      /** book.xml が列挙するページ数 */
      bookPageCount: number;
      /** 実際に sheet XML を持つページ数 */
      artifactPageCount: number;
    };

/** 確認画面（StructureConfirm）でのユーザー判断 */
export type StructureDecision =
  /** 段の小節数を上書きする */
  | { kind: 'systemMeasureCount'; pageIndex: number; systemIndex: number; measureCount: number }
  /** movement（ページ群）に対応づける MusicXML を上書きする */
  | { kind: 'movementAssignment'; movementIndex: number; musicXmlIndex: number };

/** movement（book.xml のページ群）→ MusicXML の割当と実体のあるページ */
interface MovementPlan {
  movementIndex: number;
  musicXmlIndex: number;
  /** 実体のあるページのみ（book.xml に載っていても sheet XML がないページは除く） */
  pages: { pageIndex: number; content: OmrPageContent }[];
}

/** 段の小節数上書きを (page, system) で引くためのキー */
function systemKey(pageIndex: number, systemIndex: number): string {
  return `${pageIndex}:${systemIndex}`;
}

/** movement の論理小節数（パート間で最大値。通し小節番号の累積に使う） */
function measureCountOf(musicXml: ParsedMusicXml): number {
  return musicXml.parts.reduce((max, part) => Math.max(max, part.measures.length), 0);
}

/** 段レイアウトを「ページ順 → 段順」の二次元に並べ替える */
function groupLayoutByPage(layout: readonly MusicXmlSystemLayout[]): MusicXmlSystemLayout[][] {
  const pages: MusicXmlSystemLayout[][] = [];
  for (const entry of layout) {
    const page = (pages[entry.pageIndex] ??= []);
    page[entry.systemIndex] = entry;
  }
  return pages;
}

/**
 * book.xml のページ列と `artifacts.pages` を序数で対応づけてよいかを判定する
 *
 * `artifacts.pages` は sheet XML を持つページだけを連結した配列なので、book.xml のページ数と
 * 一致するときに限り「k 番目 ↔ k 番目」の対応が成立する。数が違う場合、どのページが欠けたかは
 * この情報だけでは決められない（`assembleArtifacts` がページに sheet 番号を持たないため）。
 * そのときは**推測でアンカーせず** stack 数へフォールバックし、`pageCorrespondenceMismatch` で報告する
 */
function arePagesAligned(artifacts: OmrArtifacts, bookPages: BookPageRef[]): boolean {
  return bookPages.length === artifacts.pages.length;
}

/**
 * book.xml の movement 分割を「movement → 通しページ index・対応 MusicXML」に展開する
 *
 * .mxl が movement 数より少ない場合は末尾 movement に寄せる（実データの誤分割対策）
 */
function planMovements(
  artifacts: OmrArtifacts,
  bookPages: BookPageRef[],
  decisions: readonly StructureDecision[],
): MovementPlan[] {
  const overrides = new Map<number, number>();
  for (const decision of decisions) {
    if (decision.kind === 'movementAssignment') {
      overrides.set(decision.movementIndex, decision.musicXmlIndex);
    }
  }
  const lastMusicXmlIndex = artifacts.movements.length - 1;
  let pageCursor = 0;
  return groupMovements(bookPages).map((bookGroup, movementIndex) => ({
    movementIndex,
    musicXmlIndex: overrides.get(movementIndex) ?? Math.min(movementIndex, lastMusicXmlIndex),
    // book.xml のページ順がそのまま OmrArtifacts.pages の順序（assembleArtifacts が保証）
    pages: bookGroup.flatMap(() => {
      const pageIndex = pageCursor++;
      const content = artifacts.pages[pageIndex];
      return content === undefined ? [] : [{ pageIndex, content }];
    }),
  }));
}

/** ページ 1 つ分の走査文脈（detect / resolve が同じ対応づけ規則を使うために共有する） */
interface PageContext {
  pageIndex: number;
  page: OmrPageContent;
  /** MusicXML 側の段数（対応づけできない場合は null） */
  xmlSystemCount: number | null;
  /**
   * アンカーに使ってよい MusicXML の段レイアウト。
   * ページ対応が壊れている、または段数が食い違う場合は null（＝アンカーしない）
   */
  xmlSystems: readonly MusicXmlSystemLayout[] | null;
}

/**
 * movement 内のページを、MusicXML 段レイアウトとの対応づけ込みで列挙する
 *
 * 対応づけの規則を 1 箇所に閉じ込めることで、detect が報告する内容と resolve が実際に採用する値が
 * 食い違わないようにする
 */
function pageContexts(
  plan: MovementPlan,
  musicXml: ParsedMusicXml | undefined,
  pagesAligned: boolean,
): PageContext[] {
  const layoutByPage = groupLayoutByPage(musicXml?.layout ?? []);
  return plan.pages.map(({ pageIndex, content: page }, pageOrdinal) => {
    const xmlSystems = pagesAligned ? layoutByPage[pageOrdinal] : undefined;
    // 段の対応づけも序数（k 番目の段 ↔ k 番目の段）で行うため、段数が違えば対応が保証されない
    const anchorable = xmlSystems !== undefined && xmlSystems.length === page.systems.length;
    return {
      pageIndex,
      page,
      xmlSystemCount: xmlSystems?.length ?? null,
      xmlSystems: anchorable ? xmlSystems : null,
    };
  });
}

/**
 * 譜表構造の検出・復元（機能設計書 BookStructureResolver）
 *
 * OMR の物理構造（book.xml のページ／movement 分割・sheet XML の段と stack）と、
 * MusicXML の段レイアウトを突き合わせて確定構造を作る。要点は
 * **段ごとの通し小節番号をここで確定させる**こと。ScoreModelBuilder が stack 数を累積すると、
 * ある段だけ stack が 1 つ多いといった検出のブレが以降の全小節へ波及する
 * （divisi 実データで 20 ページ中 2 段のズレが 561 小節の skip を生んでいた）
 *
 * zip 展開・ファイル I/O は行わない（パース済みの値を受け取る純粋なドメインロジック）
 */
export class BookStructureResolver {
  /**
   * 構造上の問題を検出する（復元はしない）
   *
   * @param artifacts - パース済みの OMR 成果物
   * @param bookPages - book.xml のページ参照（`parseBookXml` の結果）
   */
  detect(artifacts: OmrArtifacts, bookPages: BookPageRef[]): StructureIssue[] {
    const issues: StructureIssue[] = [];
    const plans = planMovements(artifacts, bookPages, []);
    if (plans.length !== artifacts.movements.length) {
      issues.push({
        kind: 'movementCountMismatch',
        omrMovementCount: plans.length,
        musicXmlCount: artifacts.movements.length,
      });
    }
    const pagesAligned = arePagesAligned(artifacts, bookPages);
    if (!pagesAligned) {
      issues.push({
        kind: 'pageCorrespondenceMismatch',
        bookPageCount: bookPages.length,
        artifactPageCount: artifacts.pages.length,
      });
    }

    for (const plan of plans) {
      const musicXml = artifacts.movements[plan.musicXmlIndex]?.musicXml;
      if (musicXml === undefined) {
        continue; // 対応する MusicXML がない movement は movementCountMismatch で報告済み
      }
      const xmlPageCount = groupLayoutByPage(musicXml.layout).length;
      if (xmlPageCount !== plan.pages.length) {
        issues.push({
          kind: 'pageCountMismatch',
          movementIndex: plan.movementIndex,
          omrPageCount: plan.pages.length,
          xmlPageCount,
        });
      }
      for (const context of pageContexts(plan, musicXml, pagesAligned)) {
        const { pageIndex, page } = context;
        if (context.xmlSystemCount !== null && context.xmlSystemCount !== page.systems.length) {
          issues.push({
            kind: 'systemCountMismatch',
            movementIndex: plan.movementIndex,
            pageIndex,
            omrSystemCount: page.systems.length,
            xmlSystemCount: context.xmlSystemCount,
          });
        }
        for (const [systemIndex, system] of page.systems.entries()) {
          // resolve が実際にアンカーへ使う値とだけ突き合わせる（報告と採用値を食い違わせない）
          const xmlSystem = context.xmlSystems?.[systemIndex];
          if (xmlSystem !== undefined && xmlSystem.measureCount !== system.stacks.length) {
            issues.push({
              kind: 'systemMeasureCountMismatch',
              movementIndex: plan.movementIndex,
              pageIndex,
              systemIndex,
              omrStackCount: system.stacks.length,
              xmlMeasureCount: xmlSystem.measureCount,
            });
          }
        }
        // 同一ページ内で段ごとの譜表数が揃わないのは、段の検出が疑わしいことの明確な兆候
        // （声部の段階的入り・インチピットで実際に発生する）。自動補正はせず警告に留める
        const staffCounts = page.systems.map((system) => system.staves.length);
        if (new Set(staffCounts).size > 1) {
          issues.push({
            kind: 'inconsistentSystemStaffCount',
            movementIndex: plan.movementIndex,
            pageIndex,
            staffCounts,
          });
        }
      }
    }
    return issues;
  }

  /**
   * 確定構造を組み立てる
   *
   * 段の小節数は「ユーザー判断 → MusicXML の段レイアウト → OMR の stack 数」の順に決まるため、
   * 情報が欠けていても必ず構造を返せる
   *
   * @param decisions - 確認画面でのユーザー判断（省略時は検出結果をそのまま採用）
   */
  resolve(
    artifacts: OmrArtifacts,
    bookPages: BookPageRef[],
    decisions: readonly StructureDecision[] = [],
  ): ResolvedStructure {
    const measureCountOverrides = new Map<string, number>();
    for (const decision of decisions) {
      if (decision.kind === 'systemMeasureCount') {
        measureCountOverrides.set(
          systemKey(decision.pageIndex, decision.systemIndex),
          decision.measureCount,
        );
      }
    }

    const movements: ResolvedMovement[] = [];
    const pagesAligned = arePagesAligned(artifacts, bookPages);
    let globalMeasureBase = 0;
    for (const plan of planMovements(artifacts, bookPages, decisions)) {
      const musicXml = artifacts.movements[plan.musicXmlIndex]?.musicXml;
      const systems: ResolvedSystem[] = [];
      let cursor = 0;
      for (const { pageIndex, page, xmlSystems } of pageContexts(plan, musicXml, pagesAligned)) {
        for (const [systemIndex, system] of page.systems.entries()) {
          const measureCount = Math.max(
            0,
            measureCountOverrides.get(systemKey(pageIndex, systemIndex)) ??
              xmlSystems?.[systemIndex]?.measureCount ??
              system.stacks.length,
          );
          systems.push({
            pageIndex,
            systemIndex,
            firstMeasureIndex: globalMeasureBase + cursor,
            measureCount,
          });
          cursor += measureCount;
        }
      }
      movements.push({
        musicXmlIndex: plan.musicXmlIndex,
        pageIndices: plan.pages.map((page) => page.pageIndex),
        systems,
      });
      // 次 movement の起点は MusicXML の論理小節数で進める（OMR 側のページ欠落に影響されない）。
      // 段アンカーがそれを超える場合は段側を優先し、movement 間の小節番号の重なりを防ぐ
      globalMeasureBase += Math.max(cursor, musicXml === undefined ? 0 : measureCountOf(musicXml));
    }
    return { movements };
  }
}
