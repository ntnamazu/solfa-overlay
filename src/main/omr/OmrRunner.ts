import { spawn as nodeSpawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OmrArtifacts } from '../../domain/score/ScoreModelBuilder';
import type { OmrProgress } from '../../shared/types/OmrProgress';
import type { OmrRawArtifacts } from '../../shared/types/OmrRawArtifacts';
import { buildAudiverisArgs, buildAudiverisEnv, parseProgressLine } from './audiverisCommand';
import { AudiverisNotFoundError, OmrRunError } from './errors';
import { assembleArtifacts } from './omrArchive';

/** Audiveris が見つからないとき（ENOENT）に UI へ出す、行動可能な案内メッセージ */
const AUDIVERIS_NOT_FOUND_MESSAGE =
  'Audiveris が見つかりません。Audiveris をインストールして PATH を通すか、環境変数 ' +
  'SOLFA_AUDIVERIS_PATH に実行ファイルのパスを設定してください。手軽に試すには Dev Container ' +
  'での起動もできます（README 参照）。';

/** spawn 失敗が「実行ファイル不在（ENOENT）」かを判定する */
function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

/**
 * 子プロセスの最小インターフェース（node:child_process の ChildProcess の必要部分だけ）
 *
 * これを DI（差し替え可能）にすることで、Audiveris 非搭載の環境でも擬似プロセスを注入して
 * run / cancel / 進捗通知のロジックを単体テストできる。
 */
export interface ChildLike {
  stdout: { on(event: 'data', listener: (chunk: Buffer | string) => void): void } | null;
  on(event: 'error', listener: (error: Error) => void): void;
  on(event: 'close', listener: (code: number | null) => void): void;
  kill(signal?: NodeJS.Signals): boolean;
}

/** 子プロセス起動関数の型（既定は node:child_process の spawn を包んだもの） */
export type SpawnFn = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; shell: false },
) => ChildLike;

const DEFAULT_SPAWN: SpawnFn = (command, args, options) => nodeSpawn(command, args, options);

/** 出力ディレクトリから `.mxl` を movement 順に並べるためのキー（`<name>.mvtN.mxl` の N。無ければ 0） */
function movementOrder(fileName: string): number {
  const match = /\.mvt(\d+)\.mxl$/i.exec(fileName);
  return match === null ? 0 : Number.parseInt(match[1] ?? '', 10);
}

/**
 * Audiveris をヘッドレス子プロセスとして実行し、成果物を `OmrArtifacts` に組み立てる（F-1 後半）
 *
 * 副作用（子プロセス・一時ファイル）の入口。純粋ロジック（コマンド組み立て・zip 展開・照合）は
 * audiverisCommand / omrArchive / domain パーサへ委譲する。
 *
 * 注: 実 Audiveris の起動確認はホスト実機での手動検証とする（コンテナに Audiveris/JRE 非搭載）。
 */
export class OmrRunner {
  private readonly spawn: SpawnFn;
  private readonly audiverisPath: string;
  private child: ChildLike | null = null;
  private canceled = false;
  private running = false;

  constructor(deps?: { spawn?: SpawnFn; audiverisPath?: string }) {
    this.spawn = deps?.spawn ?? DEFAULT_SPAWN;
    // 解決順: 明示指定 → 環境変数 SOLFA_AUDIVERIS_PATH → 既定のコマンド名（PATH 解決）。
    // 自前調達（任意の場所に install）と devcontainer 同梱（PATH の audiveris）の
    // どちらのルートでも同じ入口で場所を指定できるようにする。配布時は
    // 同梱バイナリの絶対パスを明示指定して差し替える。
    this.audiverisPath = deps?.audiverisPath ?? process.env.SOLFA_AUDIVERIS_PATH ?? 'audiveris';
  }

  /**
   * PDF を OMR にかけ、成果物（MusicXML movements ＋ sheet ページ）を返す
   *
   * 組み立て済みの `artifacts` に加えて**生バイト列 `raw` も返す**。プロジェクトファイルへ
   * 同梱して OMR 再実行なしに再開するために必要で、一時ディレクトリは本メソッドの終了時に
   * 消えるため、ここで返さないと二度と取得できない
   *
   * @param pdfPath - 入力 PDF の絶対パス
   * @param onProgress - シート単位の進捗通知
   * @throws OmrRunError 起動・実行・出力収集の失敗、またはキャンセル
   */
  async run(
    pdfPath: string,
    onProgress: (progress: OmrProgress) => void,
  ): Promise<{ artifacts: OmrArtifacts; raw: OmrRawArtifacts }> {
    // 同一インスタンスの多重起動を防ぐ（可変状態 child/canceled の競合回避。IPC 誤多重起動対策）
    if (this.running) {
      throw new OmrRunError('OMR は既に実行中です');
    }
    this.running = true;
    const outputDir = await mkdtemp(join(tmpdir(), 'solfa-omr-'));
    try {
      await this.execAudiveris(pdfPath, outputDir, onProgress);
      const raw = await this.collectOutputs(outputDir);
      const artifacts = assembleArtifacts(raw);
      onProgress({ phase: 'completed', sheet: null, totalSheets: null, message: '' });
      return { artifacts, raw };
    } finally {
      this.child = null;
      this.running = false;
      await rm(outputDir, { recursive: true, force: true });
    }
  }

  /** 実行中の OMR をキャンセルする（子プロセスへ kill を送る） */
  cancel(): void {
    this.canceled = true;
    this.child?.kill();
  }

  /** 子プロセスを起動し、close/error を Promise 化する。stdout を行単位で進捗通知する */
  private execAudiveris(
    pdfPath: string,
    outputDir: string,
    onProgress: (progress: OmrProgress) => void,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.canceled = false;
      let child: ChildLike;
      try {
        child = this.spawn(this.audiverisPath, buildAudiverisArgs(pdfPath, outputDir), {
          env: buildAudiverisEnv(process.platform, process.env),
          shell: false, // ユーザー入力を引数配列で渡す（シェル経由を禁止）
        });
      } catch (cause) {
        // Node は環境により、実行ファイル不在（ENOENT）を同期例外／非同期 error
        // イベントのどちらでも出し得るため、ここでも不在を判定して案内へ振り分ける
        if (isNotFound(cause)) {
          reject(new AudiverisNotFoundError(AUDIVERIS_NOT_FOUND_MESSAGE, { cause }));
        } else {
          reject(new OmrRunError('Audiveris の起動に失敗しました', { cause }));
        }
        return;
      }
      this.child = child;
      // spawn 直後の 1 回（最初のログ受信まで）を starting として通知する
      onProgress({ phase: 'starting', sheet: null, totalSheets: null, message: '' });

      let buffer = '';
      child.stdout?.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? ''; // 最後の未改行断片は次チャンクへ持ち越す
        for (const line of lines) {
          const progress = parseProgressLine(line);
          if (progress !== null) {
            onProgress(progress);
          }
        }
      });

      child.on('error', (error) => {
        // 実行ファイル不在（ENOENT）は「エンジン未搭載」＝インストール/パス設定で直る問題。
        // 汎用の実行エラーと区別し、行動可能な案内を返す
        if (isNotFound(error)) {
          reject(new AudiverisNotFoundError(AUDIVERIS_NOT_FOUND_MESSAGE, { cause: error }));
        } else {
          reject(new OmrRunError('Audiveris の実行でエラーが発生しました', { cause: error }));
        }
      });

      child.on('close', (code) => {
        if (this.canceled) {
          reject(new OmrRunError('OMR がキャンセルされました'));
        } else if (code === 0) {
          resolve();
        } else {
          reject(new OmrRunError(`Audiveris が異常終了しました (exit code=${code})`));
        }
      });
    });
  }

  /** 出力ディレクトリから `.omr` と `.mxl`（movement 昇順）を読み出す */
  private async collectOutputs(outputDir: string): Promise<OmrRawArtifacts> {
    const names = await readdir(outputDir);
    const omrName = names.find((name) => name.toLowerCase().endsWith('.omr'));
    if (omrName === undefined) {
      throw new OmrRunError('Audiveris が .omr を出力しませんでした');
    }
    const mxlNames = names
      .filter((name) => name.toLowerCase().endsWith('.mxl'))
      .sort((a, b) => movementOrder(a) - movementOrder(b));
    if (mxlNames.length === 0) {
      throw new OmrRunError('Audiveris が .mxl を出力しませんでした');
    }
    const omr = new Uint8Array(await readFile(join(outputDir, omrName)));
    const movements = await Promise.all(
      mxlNames.map(async (name) => new Uint8Array(await readFile(join(outputDir, name)))),
    );
    return { omr, movements };
  }
}
