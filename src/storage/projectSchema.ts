import { z } from 'zod';
import type { Project } from '../shared/types/Project';
import { ProjectFileError } from './errors';

/**
 * `project.json` の構造検証（Zod）
 *
 * プロジェクトファイルは**外部入力でもある**（他人が作ったファイルを開ける）ため、
 * 読込時に必ずこのスキーマを通す（開発ガイドライン「外部データは unknown で受けて Zod で絞る」）
 */

/**
 * project.json のスキーマ版数
 *
 * - v1: 初版
 * - v2: `keyChanges`（転調点の指定 F-6）を追加。版数を上げたのは、v1 のまま足すと旧アプリが
 *   未知のフィールドとして黙って捨て（Zod の既定）、旧アプリで開いて保存しただけで
 *   ユーザーの転調点が消えるため。v2 なら旧アプリは「新しいバージョンのアプリで作成された
 *   ファイル」として安全に失敗する（アーキテクチャ設計書「前方互換」）
 */
export const SCHEMA_VERSION = 2;

/** 最初に存在する版数。これ未満は「アプリが知らない形式」として拒否する */
const FIRST_SCHEMA_VERSION = 1;

const pitchStepSchema = z.enum(['A', 'B', 'C', 'D', 'E', 'F', 'G']);

const pitchSchema = z.object({
  step: pitchStepSchema,
  alter: z.number(),
  octave: z.number().int(),
});

const solfaDegreeSchema = z.object({
  degree: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
    z.literal(7),
  ]),
  alteration: z.number(),
});

const pageAnchorSchema = z.object({
  pageIndex: z.number().int(),
  x: z.number(),
  y: z.number(),
});

const staffRefSchema = z.object({
  pageIndex: z.number().int(),
  systemIndex: z.number().int(),
  staffIndex: z.number().int(),
  partId: z.string().nullable(),
});

const noteEventSchema = z.object({
  id: z.string(),
  partId: z.string(),
  measureIndex: z.number().int(),
  pitch: pitchSchema,
  head: pageAnchorSchema,
  solfa: solfaDegreeSchema.nullable(),
});

const scoreModelSchema = z.object({
  parts: z.array(z.object({ id: z.string(), name: z.string(), staves: z.array(staffRefSchema) })),
  systems: z.array(
    z.object({
      pageIndex: z.number().int(),
      systemIndex: z.number().int(),
      firstMeasureIndex: z.number().int(),
      measureCount: z.number().int(),
    }),
  ),
  measures: z.array(
    z.object({
      partId: z.string(),
      index: z.number().int(),
      status: z.enum(['matched', 'skipped']),
      notes: z.array(noteEventSchema),
    }),
  ),
});

const confirmationStateSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      kind: z.literal('clef'),
      partId: z.string().nullable(),
      detected: z.string(),
      corrected: z.string().nullable(),
      staffRefs: z.array(staffRefSchema),
      clipRect: z.object({
        pageIndex: z.number().int(),
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
      }),
      mismatchCount: z.number().int(),
    }),
  ),
  completedAt: z.string().nullable(),
});

const modeSchema = z.enum(['major', 'minor']);

const keyRegionSchema = z.object({
  id: z.string(),
  start: z.object({ measureIndex: z.number().int(), offset: z.number() }),
  tonicStep: pitchStepSchema,
  tonicAlter: z.number(),
  mode: modeSchema,
  source: z.enum(['auto', 'user']),
});

const keyRegionDecisionSchema = z.object({
  measureIndex: z.number().int(),
  fifths: z.number().int().optional(),
  mode: modeSchema.optional(),
});

const keyChangeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('set'),
    measureIndex: z.number().int(),
    fifths: z.number().int(),
    mode: modeSchema,
  }),
  z.object({ kind: z.literal('remove'), measureIndex: z.number().int() }),
]);

const structureDecisionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('systemMeasureCount'),
    pageIndex: z.number().int(),
    systemIndex: z.number().int(),
    measureCount: z.number().int(),
  }),
  z.object({
    kind: z.literal('movementAssignment'),
    movementIndex: z.number().int(),
    musicXmlIndex: z.number().int(),
  }),
]);

const annotationSchema = z.object({
  id: z.string(),
  layer: z.enum(['solfa', 'chordRole']),
  anchor: pageAnchorSchema,
  noteId: z.string().nullable(),
  text: z.string().nullable(),
  origin: z.enum(['auto', 'manual']),
  deleted: z.boolean(),
});

const projectSettingsSchema = z.object({
  syllableSystem: z.enum(['kodaly', 'tonicSolfa']),
  minorBasis: z.enum(['la', 'do']),
  diatonicColor: z.string(),
  chromaticColor: z.string(),
  fontFamily: z.string(),
  fontSizePt: z.number(),
});

/**
 * ページ寸法
 *
 * Phase 5 で `sourcePageIndex` / `interlinePx` を追加したが **`SCHEMA_VERSION` は 1 のまま**。
 * `PageInfo` は Phase 5 で初めて値が入るフィールドで、それ以前に保存され得る `.solfaproj` の
 * `pages` は必ず空配列である。要素の形が変わっても既存ファイルの読み込みは壊れない
 */
const pageInfoSchema = z.object({
  pageIndex: z.number().int(),
  sourcePageIndex: z.number().int(),
  widthPt: z.number(),
  heightPt: z.number(),
  omrImageWidthPx: z.number(),
  omrImageHeightPx: z.number(),
  interlinePx: z.number(),
});

export const projectSchema = z.object({
  schemaVersion: z.number().int(),
  id: z.string(),
  sourcePdf: z.string(),
  pages: z.array(pageInfoSchema),
  score: scoreModelSchema.nullable(),
  confirmation: confirmationStateSchema,
  structureDecisions: z.array(structureDecisionSchema),
  keyRegionDecisions: z.array(keyRegionDecisionSchema),
  // 1 小節につき指定は 1 件（`applyKeyChangeEdit` の前提）。重複すると set と remove のどちらが
  // 効くかが配列の順番しだいになるため、手で書き換えた・壊れたファイルは読み込み時に止める
  keyChanges: z
    .array(keyChangeSchema)
    .refine(
      (changes) => new Set(changes.map((change) => change.measureIndex)).size === changes.length,
      { message: '同じ小節に転調点の指定が複数あります' },
    ),
  keyRegions: z.array(keyRegionSchema),
  annotations: z.array(annotationSchema),
  settings: projectSettingsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * スキーマと `Project` 型が食い違っていないことをコンパイル時に強制する
 *
 * 双方向に代入可能であることを要求するため、**片方だけを変更すると型エラーになる**。
 * スキーマの更新漏れは実行時まで気づけない類のバグなので、型検査で先に落とす
 */
export const assertSchemaMatchesType = (value: z.infer<typeof projectSchema>): Project => value;
export const assertTypeMatchesSchema = (value: Project): z.infer<typeof projectSchema> => value;

/**
 * 未知の値を `Project` として検証する
 *
 * 版数の判定を構造検証より**先に**行う。新しい版で追加されたフィールドを持つファイルは
 * 構造検証にも失敗し得るため、先に構造エラーとして報告すると
 * 「アプリを更新すれば開ける」という正しい案内ができなくなる
 *
 * @throws ProjectFileError reason='version' アプリより新しい版数・存在しない版数
 * @throws ProjectFileError reason='schema' 構造が不正
 */
export function parseProject(value: unknown): Project {
  const version = readSchemaVersion(value);
  if (version > SCHEMA_VERSION) {
    throw new ProjectFileError(
      `新しいバージョンのアプリで作成されたファイルです（schemaVersion=${version}）`,
      'version',
    );
  }
  // 下限も見る。v1 が最初の版なので 0 以下は存在しない版数であり、
  // 素通しすると「移行経路のない未知の形式」を v1 とみなして読んでしまう
  if (version < FIRST_SCHEMA_VERSION) {
    throw new ProjectFileError(
      `対応していないファイル形式です（schemaVersion=${version}）`,
      'version',
    );
  }
  const result = projectSchema.safeParse(migrate(value, version));
  if (!result.success) {
    throw new ProjectFileError('project.json の構造が不正です', 'schema', {
      cause: result.error,
    });
  }
  return result.data;
}

/** 構造検証の前に版数だけを取り出す（不明なら現行版とみなして構造検証に委ねる） */
function readSchemaVersion(value: unknown): number {
  if (typeof value !== 'object' || value === null) {
    return SCHEMA_VERSION;
  }
  const version = (value as { schemaVersion?: unknown }).schemaVersion;
  return typeof version === 'number' ? version : SCHEMA_VERSION;
}

/**
 * 旧版のプロジェクトを現行版へ移行する（後方互換）
 *
 * 版を 1 つずつ進める（v1 → v2 → …）。各段は**その版で足したフィールドの既定値を埋めるだけ**にし、
 * 構造の検証は移行後の `projectSchema` に任せる（壊れた v1 は移行しても schema エラーになる）
 */
function migrate(value: unknown, version: number): unknown {
  // オブジェクトでない入力は版数も読めない（現行版とみなされる）。構造検証に委ねる
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  let migrated: object = value;
  if (version < 2) {
    migrated = migrateV1ToV2(migrated);
  }
  return migrated;
}

/** v1 → v2: 転調点の指定（`keyChanges`）は v1 に存在しないため空で始める */
function migrateV1ToV2(value: object): object {
  return { ...value, schemaVersion: 2, keyChanges: [] };
}
