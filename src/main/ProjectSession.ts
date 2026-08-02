import { regenerateAnnotations } from '../domain/annotations/AnnotationManager';
import { renderOverlay } from '../domain/render/OverlayRenderer';
import { buildPageInfos } from '../domain/render/pageInfo';
import { BookStructureResolver } from '../domain/score/BookStructureResolver';
import type { StructureIssue } from '../domain/score/BookStructureResolver';
import type { BookPageRef, PageGeometry } from '../domain/score/OmrSheetParser';
import { parseBookXml } from '../domain/score/OmrSheetParser';
import { ScoreModelBuilder } from '../domain/score/ScoreModelBuilder';
import type { BuildIssue, OmrArtifacts } from '../domain/score/ScoreModelBuilder';
import { buildConfirmationItems, mergeCorrections } from '../domain/score/confirmationItems';
import { KeyRegionBuilder } from '../domain/solfa/KeyRegionBuilder';
import type { KeyRegionIssue } from '../domain/solfa/KeyRegionBuilder';
import { SolfaEngine, applyDegrees } from '../domain/solfa/SolfaEngine';
import type { SolfaPreviewRow } from '../shared/ipc/contract';
import type { AnnotationIssue, PageInfoIssue, RenderIssue } from '../shared/types/Issues';
import type { KeyRegionDecision } from '../shared/types/KeyRegion';
import type { OmrProgress } from '../shared/types/OmrProgress';
import type { OmrRawArtifacts } from '../shared/types/OmrRawArtifacts';
import type { Project } from '../shared/types/Project';
import type { ProjectSettings } from '../shared/types/ProjectSettings';
import type { ScoreModel } from '../shared/types/ScoreModel';
import type { StructureDecision } from '../shared/types/StructureDecision';
import { ProjectStore } from '../storage/ProjectStore';
import { writeExportPdf } from '../storage/writeExportPdf';
import { ConfirmationRequiredError } from './errors';
import { OmrRunner } from './omr/OmrRunner';
import { assembleArtifacts, assemblePageGeometry, unzipEntries } from './omr/omrArchive';

/**
 * 解析パイプラインの編成レイヤー（アーキテクチャ設計書「レイヤー構成」）
 *
 * domain の純粋関数群（構造解決 → 照合 → 確認項目 → 調文脈 → 階名）を**呼ぶ順序**と、
 * ユーザー判断（decisions・訂正）の保持だけを担う。判断ロジックは持たず、
 * ファイル I/O は storage、子プロセスは OmrRunner に委ねる。
 *
 * 「確認 → 再構築」ループの中心。訂正が入るたびにパイプライン全体を頭から流し直す
 * （差分更新は状態の食い違いを生む。実測でも 1 曲の再解析は数百 ms で足りる）
 */

/** 解析の結果と、ユーザーに提示すべき問題点 */
export interface SessionSnapshot {
  project: Project;
  /** 保存先（未保存なら null）。UI が「上書き保存」と「名前を付けて保存」を分けるのに使う */
  filePath: string | null;
  /** 構造解決で見つかった問題（StructureConfirm 画面で提示する） */
  structureIssues: StructureIssue[];
  /** 照合で見つかった問題（音高不一致など） */
  buildIssues: BuildIssue[];
  /** 調文脈で見つかった問題（調号の食い違いなど） */
  keyRegionIssues: KeyRegionIssue[];
  /** ページ寸法を確定できなかったページ（該当ページは注釈を描けない） */
  pageIssues: PageInfoIssue[];
  /** 注釈生成で見つかった問題（配置不能・孤立注釈など） */
  annotationIssues: AnnotationIssue[];
  /** Editor の階名プレビュー（先頭の一定小節まで） */
  preview: SolfaPreviewRow[];
  /**
   * 対象が見つからず適用されなかった訂正
   *
   * 「訂正したのに反映されない」を無言で起こさないための報告。`KeyRegionDecision` は
   * `unmatchedKeyDecision` として、構造・音部記号はここで返す（3 経路で反応を揃える）
   */
  unmatchedCorrections: UnmatchedCorrection[];
}

/** 適用先が見つからなかった訂正 1 件 */
export type UnmatchedCorrection =
  { kind: 'clef'; itemId: string } | { kind: 'structure'; pageIndex: number; systemIndex: number };

/** OMR 成果物一式（生バイト列と、そこから組み立てた解析用の構造） */
interface LoadedOmr {
  raw: OmrRawArtifacts;
  artifacts: OmrArtifacts;
  bookPages: BookPageRef[];
  /** 注釈の配置に使う記号の矩形。`artifacts.pages` と同じ順・同じ長さ */
  geometry: PageGeometry[];
}

/** PDF 出力の結果（Editor へ返す要約） */
export interface ExportResult {
  outPath: string;
  /** 実際に描いた注釈の数 */
  drawnCount: number;
  /** 配置を解決できなかった注釈の数（人手調整の目安） */
  unresolvedPlacements: number;
  renderIssues: RenderIssue[];
}

/**
 * OMR 実行器の最小インターフェース（`OmrRunner` の必要部分だけ）
 *
 * `ChildLike` / `SpawnFn` と同じ方針。Audiveris 非搭載の環境でも、既知の成果物を返す
 * 擬似実行器を注入してパイプラインの編成そのものを検証できるようにする
 */
export interface OmrRunnerLike {
  run(
    pdfPath: string,
    onProgress: (progress: OmrProgress) => void,
  ): Promise<{ artifacts: OmrArtifacts; raw: OmrRawArtifacts }>;
  cancel(): void;
}

export class ProjectSession {
  private readonly store: ProjectStore;
  private readonly runner: OmrRunnerLike;
  private readonly resolver = new BookStructureResolver();
  private readonly builder = new ScoreModelBuilder();
  private readonly keyRegionBuilder = new KeyRegionBuilder();
  private readonly engine = new SolfaEngine();

  private omr: LoadedOmr | null = null;
  private sourcePdf: Uint8Array | null = null;
  private project: Project | null = null;
  private path: string | null = null;
  private unmatched: UnmatchedCorrection[] = [];
  /**
   * 直近の解析が報告した問題
   *
   * 承認（`completeConfirmation`）は解析を流し直さないが、スナップショットは返す。
   * ここに残しておかないと空配列を返すことになり、UI が「問題なし」と誤って表示する
   */
  private lastIssues: Pick<
    SessionSnapshot,
    'structureIssues' | 'buildIssues' | 'keyRegionIssues' | 'annotationIssues'
  > = { structureIssues: [], buildIssues: [], keyRegionIssues: [], annotationIssues: [] };
  /** ページ寸法の確定で出た問題（解析のたびには変わらないため別に保持する） */
  private pageIssues: PageInfoIssue[] = [];
  /** Editor の階名プレビュー（承認時にも同じ内容を返せるよう保持する） */
  private preview: SolfaPreviewRow[] = [];
  private pendingSave: ReturnType<typeof setTimeout> | null = null;
  /**
   * 進行中の保存（直列化用）
   *
   * `cancelPendingSave` はタイマーしか止められない。**すでに走り出した保存**と
   * 明示保存が重なると、世代ローテーションが二重に走って `.bak` が壊れるため、
   * 保存は必ず 1 本の鎖につないで順番に実行する
   */
  private saveChain: Promise<unknown> = Promise.resolve();
  private readonly autoSaveDelayMs: number;

  constructor(deps?: { store?: ProjectStore; runner?: OmrRunnerLike; autoSaveDelayMs?: number }) {
    this.store = deps?.store ?? new ProjectStore();
    this.runner = deps?.runner ?? new OmrRunner();
    // アーキテクチャ設計書「プロジェクト自動保存」の 300ms デバウンス
    this.autoSaveDelayMs = deps?.autoSaveDelayMs ?? 300;
  }

  /** 現在開いているプロジェクトファイルのパス（未保存なら null） */
  get filePath(): string | null {
    return this.path;
  }

  /**
   * PDF を取り込み、OMR を実行して解析する（F-1）
   *
   * この時点ではまだファイルに書かない。OMR に失敗したときに中身のない
   * プロジェクトファイルを残さないため、保存は明示的な `save` に委ねる
   */
  async importPdf(
    pdfPath: string,
    onProgress: (progress: OmrProgress) => void,
  ): Promise<SessionSnapshot> {
    const sourcePdf = await this.store.readSourcePdf(pdfPath);
    const { artifacts, raw } = await this.runner.run(pdfPath, onProgress);
    // 状態を触る前に、失敗し得る処理（book.xml の取り出し・ページ寸法の確定）を全て終わらせる
    const omr = loadOmr(raw, artifacts);
    const { project, pageIssues } = await this.withPageInfos(this.store.create(), omr, sourcePdf);

    this.adopt({ project, omr, sourcePdf, path: null, pageIssues });
    return this.analyze();
  }

  /** 実行中の OMR をキャンセルする */
  cancelOmr(): void {
    this.runner.cancel();
  }

  /**
   * 保存済みプロジェクトを開く
   *
   * 同梱された OMR 成果物から解析をやり直す。`score` / `keyRegions` は保存されているが
   * **正は decisions 側**であり、認識ロジックを改善したあとでもユーザー判断を活かした
   * 最新の解析結果を得られるようにする（機能設計書「Project エンティティ」）
   */
  async open(path: string): Promise<SessionSnapshot> {
    const archive = await this.store.load(path);
    // 先に組み立て切ってから差し替える。途中で throw すると
    // 「新しい PDF ＋ 古いプロジェクト」という混ざった状態が残り、
    // 次の保存で元のファイルへ別のプロジェクトの PDF を書き込んでしまう
    const omr = loadOmr(archive.omr, assembleArtifacts(archive.omr));
    // 保存済みの `pages` をそのまま使わず組み立て直す。`score` / `keyRegions` と同じく
    // 解析結果のキャッシュであり、認識ロジックを改善した後は最新の値を使いたいため
    const { project, pageIssues } = await this.withPageInfos(
      archive.project,
      omr,
      archive.sourcePdf,
    );

    this.adopt({ project, omr, sourcePdf: archive.sourcePdf, path, pageIssues });
    return this.analyze();
  }

  /**
   * 元PDF と `.omr` からページ寸法を確定し、プロジェクトへ載せる
   *
   * セッションの状態は触らない（`adopt` が全フィールドを一度に差し替える約束のため）
   */
  private async withPageInfos(
    project: Project,
    omr: LoadedOmr,
    sourcePdf: Uint8Array,
  ): Promise<{ project: Project; pageIssues: PageInfoIssue[] }> {
    const { pages, issues } = await buildPageInfos(sourcePdf, omr.geometry, omr.bookPages);
    return { project: { ...project, pages }, pageIssues: issues };
  }

  /**
   * セッションの対象を差し替える（全フィールドを一度に入れ替える）
   *
   * 個別に代入すると、途中で失敗したときに新旧が混ざった状態が残る
   */
  private adopt(state: {
    project: Project;
    omr: LoadedOmr;
    sourcePdf: Uint8Array;
    path: string | null;
    pageIssues: PageInfoIssue[];
  }): void {
    this.cancelPendingSave(); // 前のプロジェクト向けの保存予約を持ち越さない
    this.project = state.project;
    this.omr = state.omr;
    this.sourcePdf = state.sourcePdf;
    this.path = state.path;
    this.pageIssues = state.pageIssues;
    this.unmatched = [];
  }

  /**
   * プロジェクトを保存する
   *
   * @param path - 保存先。省略時は開いているファイルへ上書きする
   * @throws Error 保存先が未指定のまま省略された場合（名前を付けて保存が必要）
   */
  save(path?: string): Promise<Project> {
    this.cancelPendingSave(); // 明示保存が予約分を兼ねる（同じ内容を二重に書かない）
    return this.enqueueSave(path);
  }

  /**
   * 保存を直列の鎖につないで実行する
   *
   * 世代ローテーションは「本体 → bak1 → bak2 → bak3」という**共有状態の書き換え**なので、
   * 2 本が同時に走ると世代が二重にずれて内容が重複・欠落する。
   * 先行する保存の成否にかかわらず鎖は続ける（1 回の失敗で以降の保存が死なないように）
   */
  private enqueueSave(path?: string): Promise<Project> {
    const queued = this.saveChain.then(
      () => this.writeNow(path),
      () => this.writeNow(path),
    );
    // 鎖自体は失敗を飲み込む（この Promise は順序制御専用で、結果は呼び出し側が受け取る）
    this.saveChain = queued.catch(() => undefined);
    return queued;
  }

  /** 実際の書き込み。呼び出しは `enqueueSave` 経由に限る（直列性の担保） */
  private async writeNow(path?: string): Promise<Project> {
    const { project, omr, sourcePdf } = this.require();
    const target = path ?? this.path;
    if (target === null) {
      throw new Error('保存先が指定されていません');
    }
    const saved = await this.store.save(target, project, sourcePdf, omr.raw);
    // 保存中に別の訂正が入っていることがあるため、updatedAt だけを取り込む
    // （project 全体を差し替えると、その訂正を巻き戻してしまう）
    this.project = { ...this.require().project, updatedAt: saved.updatedAt };
    this.path = target;
    return saved;
  }

  /** 譜表構造へのユーザー判断を差し替えて解析し直す（StructureConfirm 画面） */
  setStructureDecisions(decisions: readonly StructureDecision[]): SessionSnapshot {
    const { project, omr } = this.require();
    // 実在しない段への上書きは BookStructureResolver が黙って無視する。
    // 適用されなかったことを呼び出し側へ返さないと「訂正したのに変わらない」になる
    this.unmatched = decisions.flatMap((decision) =>
      decision.kind === 'systemMeasureCount' &&
      omr.artifacts.pages[decision.pageIndex]?.systems[decision.systemIndex] === undefined
        ? [
            {
              kind: 'structure' as const,
              pageIndex: decision.pageIndex,
              systemIndex: decision.systemIndex,
            },
          ]
        : [],
    );
    this.project = this.invalidateApproval({ ...project, structureDecisions: [...decisions] });
    return this.analyzeAndSave();
  }

  /**
   * 音部記号の訂正を差し替えて解析し直す（ClefKeyConfirm 画面）
   *
   * 受け取るのは `id` → 訂正値の対応。確認項目そのものは解析のたびに再生成されるため、
   * 呼び出し側が保持した項目をそのまま書き戻すと古い譜表参照が混ざり得る
   */
  setClefCorrections(corrections: ReadonlyMap<string, string | null>): SessionSnapshot {
    const { project } = this.require();
    const knownIds = new Set(project.confirmation.items.map((item) => item.id));
    this.unmatched = [...corrections.keys()]
      .filter((id) => !knownIds.has(id))
      .map((itemId) => ({ kind: 'clef' as const, itemId }));

    const items = project.confirmation.items.map((item) =>
      corrections.has(item.id) ? { ...item, corrected: corrections.get(item.id) ?? null } : item,
    );
    this.project = this.invalidateApproval({
      ...project,
      confirmation: { ...project.confirmation, items },
    });
    return this.analyzeAndSave();
  }

  /** 調文脈へのユーザー判断を差し替えて解析し直す（ClefKeyConfirm 画面の調区間表） */
  setKeyRegionDecisions(decisions: readonly KeyRegionDecision[]): SessionSnapshot {
    const { project } = this.require();
    // 一致しない decision は KeyRegionBuilder が unmatchedKeyDecision として報告する
    this.unmatched = [];
    this.project = this.invalidateApproval({ ...project, keyRegionDecisions: [...decisions] });
    return this.analyzeAndSave();
  }

  /** 設定（階名体系・短調基準・配色）を変更して解析し直す */
  setSettings(settings: ProjectSettings): SessionSnapshot {
    const { project } = this.require();
    this.unmatched = [];
    // 設定は「何を確認したか」を変えないため承認は無効化しない
    this.project = { ...project, settings };
    return this.analyzeAndSave();
  }

  /**
   * 確認を完了としてマークする（F-2 の承認）
   *
   * `completedAt` が入るまで階名の確定・PDF 出力へ進めない。承認は解析結果を変えないため
   * パイプラインは流し直さず、現在のスナップショットに印だけを付ける
   */
  completeConfirmation(now: Date = new Date()): SessionSnapshot {
    const { project } = this.require();
    this.project = {
      ...project,
      confirmation: { ...project.confirmation, completedAt: now.toISOString() },
    };
    this.scheduleAutoSave();
    // 承認は解析結果を変えないが、問題点まで消えるわけではない。
    // 空配列を返すと確認画面が「問題は見つかりませんでした」と偽って表示する
    return this.snapshot(this.lastIssues);
  }

  /**
   * 解析し直し、その結果の保存を予約する
   *
   * ユーザー操作による変更にだけ使う。`importPdf` / `open` 直後の解析で保存すると、
   * ファイルを開いただけでバックアップ世代を 1 つ消費してしまう
   */
  private analyzeAndSave(): SessionSnapshot {
    const snapshot = this.analyze();
    this.scheduleAutoSave();
    return snapshot;
  }

  /**
   * 承認を無効化する（訂正が入ったら確認をやり直させる）
   *
   * `completedAt` は「この解析結果を人が確認した」という記録であり、訂正後の解析結果は
   * 別物である。戻さないと、承認していない内容が承認済みとして保存・出力される
   */
  private invalidateApproval(project: Project): Project {
    if (project.confirmation.completedAt === null) {
      return project;
    }
    return { ...project, confirmation: { ...project.confirmation, completedAt: null } };
  }

  /**
   * 自動保存を予約する（アーキテクチャ設計書「プロジェクト自動保存」）
   *
   * 保存先が未確定（PDF を取り込んだ直後）のうちは書き込めないため何もしない。
   * 訂正のたびに数十MBを書くと操作が詰まるので、最後の訂正から一定時間まとめて 1 回書く
   */
  private scheduleAutoSave(): void {
    if (this.path === null) {
      return;
    }
    this.cancelPendingSave();
    this.pendingSave = setTimeout(() => {
      this.pendingSave = null;
      this.save().catch((error: unknown) => {
        // 自動保存の失敗で操作を止めない。次の明示保存で必ずユーザーへ伝わる
        console.error('自動保存に失敗しました:', error);
      });
    }, this.autoSaveDelayMs);
    // Node のイベントループを保存待ちで引き延ばさない（アプリ終了を妨げない）
    this.pendingSave.unref?.();
  }

  private cancelPendingSave(): void {
    if (this.pendingSave !== null) {
      clearTimeout(this.pendingSave);
      this.pendingSave = null;
    }
  }

  /** 書き切っていない自動保存があるか（終了処理が待つべきかの判断に使う） */
  get hasPendingSave(): boolean {
    return this.pendingSave !== null;
  }

  /** 予約済みの自動保存を今すぐ実行する（終了時・明示保存前に取りこぼさないため） */
  async flushPendingSave(): Promise<void> {
    if (this.pendingSave === null) {
      return;
    }
    this.cancelPendingSave();
    await this.save();
  }

  /**
   * 解析パイプラインを頭から流す
   *
   * 順序に意味がある: 確定構造がなければ照合できず、照合の不一致件数がなければ
   * 確認項目の警告表示（要確認かどうか）が決まらない。調文脈は照合結果に依存しないが、
   * 階名は照合済みの音符と調文脈の両方を要求する
   * （並び順は楽譜順に固定されており、照合結果には依存しない）
   */
  private analyze(): SessionSnapshot {
    const { project, omr } = this.require();

    const structureIssues = this.resolver.detect(omr.artifacts, omr.bookPages);
    const structure = this.resolver.resolve(
      omr.artifacts,
      omr.bookPages,
      project.structureDecisions,
    );
    const built = this.builder.build(omr.artifacts, structure, project.confirmation);

    // 確認項目は毎回作り直し、ユーザーの訂正値だけを id で引き継ぐ。
    // 保持し続けると認識結果が変わったときに古い譜表参照が残る
    const items = mergeCorrections(
      buildConfirmationItems(omr.artifacts, built.issues),
      project.confirmation.items,
    );

    const { keyRegions, issues: keyRegionIssues } = this.keyRegionBuilder.build(
      omr.artifacts,
      structure,
      project.keyRegionDecisions,
    );
    const degrees = this.engine.computeDegrees(
      built.score,
      keyRegions,
      project.settings.minorBasis,
    );
    const score = applyDegrees(built.score, degrees);

    // 注釈は階名が確定してからでないと作れない。既存の注釈を渡すことで、
    // 訂正で解析をやり直しても手動注釈と削除の記録が生き残る
    const { annotations, issues: annotationIssues } = regenerateAnnotations({
      score,
      geometry: omr.geometry,
      pages: project.pages,
      settings: project.settings,
      existing: project.annotations,
    });

    this.project = {
      ...project,
      score,
      confirmation: { ...project.confirmation, items },
      keyRegions,
      annotations,
    };
    this.lastIssues = {
      structureIssues,
      buildIssues: built.issues,
      keyRegionIssues,
      annotationIssues,
    };
    this.preview = buildPreview(score, project.settings, this.engine);
    return this.snapshot(this.lastIssues);
  }

  private snapshot(
    issues: Pick<
      SessionSnapshot,
      'structureIssues' | 'buildIssues' | 'keyRegionIssues' | 'annotationIssues'
    >,
  ): SessionSnapshot {
    const { project } = this.require();
    return {
      project,
      filePath: this.path,
      ...issues,
      pageIssues: this.pageIssues,
      preview: this.preview,
      unmatchedCorrections: this.unmatched,
    };
  }

  /**
   * 注釈付きPDFを書き出す（F-4）
   *
   * @throws Error 承認前に呼ばれた場合（F-2 のゲート）
   * @throws ProjectFileError 書き出しに失敗した場合
   */
  async exportPdf(outPath: string): Promise<ExportResult> {
    const { project, sourcePdf } = this.require();
    if (project.confirmation.completedAt === null) {
      // 承認していない解析結果を印刷用に出すと、誤った階名を正しいものとして配ってしまう
      throw new ConfirmationRequiredError(
        '音部記号・調の確認が完了していません。確認画面で承認してください。',
      );
    }
    const rendered = await renderOverlay({ sourcePdf, project });
    await writeExportPdf(outPath, rendered.bytes);
    return {
      outPath,
      drawnCount: rendered.drawnCount,
      unresolvedPlacements: this.lastIssues.annotationIssues.filter(
        (issue) => issue.kind === 'placementUnresolved',
      ).length,
      renderIssues: rendered.issues,
    };
  }

  /** プロジェクトが開かれていることを保証する（未オープン時の操作は呼び出し側の誤り） */
  private require(): { project: Project; omr: LoadedOmr; sourcePdf: Uint8Array } {
    if (this.project === null || this.omr === null || this.sourcePdf === null) {
      throw new Error('プロジェクトが開かれていません');
    }
    return { project: this.project, omr: this.omr, sourcePdf: this.sourcePdf };
  }
}

/**
 * Editor のプレビューに出す小節数の上限
 *
 * divisi は 3,500 音符あり、全部を IPC で送って描くと画面が使い物にならない
 * （アーキテクチャ設計書「Editor のレンダリングはページ単位の遅延描画とする」）。
 * Phase 5 の Editor はテキスト表示のため、まず件数で頭打ちにする
 */
const PREVIEW_MEASURE_LIMIT = 24;

/**
 * 階名プレビューを組み立てる
 *
 * 度数＋変位から表示文字列を導くのは domain の仕事で、Renderer は domain を
 * import できない（ESLint で強制）。ここで文字列まで確定させて送る
 */
function buildPreview(
  score: ScoreModel,
  settings: ProjectSettings,
  engine: SolfaEngine,
): SolfaPreviewRow[] {
  const partNames = new Map(score.parts.map((part) => [part.id, part.name]));
  return score.measures
    .filter((measure) => measure.index < PREVIEW_MEASURE_LIMIT && measure.notes.length > 0)
    .sort((a, b) => a.index - b.index || (a.partId < b.partId ? -1 : 1))
    .map((measure) => ({
      partId: measure.partId,
      partName: partNames.get(measure.partId) ?? measure.partId,
      measureIndex: measure.index,
      syllables: measure.notes.map((note) =>
        note.solfa === null ? '?' : engine.toSyllable(note.solfa, settings),
      ),
    }));
}

/**
 * OMR 成果物から解析に使う構造を組み立てる
 *
 * `artifacts.pages` と `geometry` は同じシート順で作られる（`omrArchive` が保証する）
 */
function loadOmr(raw: OmrRawArtifacts, artifacts: OmrArtifacts): LoadedOmr {
  return {
    raw,
    artifacts,
    bookPages: readBookPages(raw),
    geometry: assemblePageGeometry(raw.omr),
  };
}

/** `.omr` から book.xml を取り出してページ参照を得る */
function readBookPages(raw: OmrRawArtifacts): BookPageRef[] {
  const bookXml = unzipEntries(raw.omr).get('book.xml');
  if (bookXml === undefined) {
    throw new Error('.omr に book.xml がありません');
  }
  return parseBookXml(Buffer.from(bookXml).toString('utf-8'));
}
