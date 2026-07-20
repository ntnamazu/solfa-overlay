import type { Zippable } from 'fflate';
import { unzipSync, zip, zipSync } from 'fflate';

/**
 * zip の安全な読み書き（データレイヤーの基礎部品）
 *
 * `.omr` / `.mxl`（OMR 成果物）と `.solfaproj`（プロジェクトファイル）はいずれも zip で、
 * **どちらも外部から受け取り得る入力**である。パストラバーサル拒否のような防御は
 * 1 箇所に集約する（片方だけ強化されて片方が取り残される事故を構造的に防ぐ）
 */

/** zip の展開・エントリ名検証の失敗。呼び出し側が各レイヤーのエラーへ翻訳する */
export class ZipError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ZipError';
  }
}

/**
 * エントリ名が安全か（パストラバーサルでないか）を判定する
 *
 * セキュリティ要件（機能設計書・アーキテクチャ設計書「入力検証」）: 絶対パスや `..`
 * セグメントを含むエントリを拒否する。展開はメモリ上だが、名前を信頼して扱う経路を
 * 一切作らないための防御
 */
export function isSafeEntryName(name: string): boolean {
  // Windows 由来の区切りも同一視して判定する
  const segments = name.split(/[/\\]/);
  if (segments.some((segment) => segment === '..')) {
    return false;
  }
  // 絶対パス（POSIX の先頭 '/' / Windows のドライブレター）を拒否
  if (name.startsWith('/') || name.startsWith('\\') || /^[A-Za-z]:/.test(name)) {
    return false;
  }
  return true;
}

/**
 * zip バイト列を展開し、エントリ名 → 内容のマップを返す
 *
 * ディレクトリエントリ（名前が '/' で終わる）は除外する。パストラバーサルは拒否する。
 *
 * @throws ZipError 展開に失敗、またはパストラバーサルなエントリを含む場合
 */
export function unzipEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(bytes);
  } catch (cause) {
    throw new ZipError('zip の展開に失敗しました', { cause });
  }
  const entries = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(raw)) {
    if (name.endsWith('/')) {
      continue; // ディレクトリエントリ
    }
    if (!isSafeEntryName(name)) {
      throw new ZipError(`不正なエントリ名（パストラバーサル）: ${name}`);
    }
    entries.set(name, data);
  }
  return entries;
}

/**
 * エントリ名 → 内容のマップを zip バイト列にする
 *
 * 書き出し側でもエントリ名を検証する。生成した `.solfaproj` を他のツールが展開する
 * 可能性があるため、こちらから危険な名前を出さない
 *
 * @throws ZipError 危険なエントリ名を含む場合
 */
export function zipEntries(entries: ReadonlyMap<string, Uint8Array>): Uint8Array {
  try {
    return zipSync(toZippable(entries));
  } catch (cause) {
    if (cause instanceof ZipError) {
      throw cause;
    }
    /* v8 ignore next -- fflate は検証済みの入力で失敗しないが、握りつぶさず翻訳する */
    throw new ZipError('zip の生成に失敗しました', { cause });
  }
}

/**
 * `zipEntries` の非同期版（**書き込み経路はこちらを使う**）
 *
 * `zipSync` は数十MBの deflate を同期で回すため、Main プロセスで呼ぶと
 * その間 IPC が止まり画面が固まる。アーキテクチャ設計書のパフォーマンス要件
 * 「プロジェクト自動保存 = UI非ブロック」を満たすには非同期版が要る。
 * 自動保存は訂正のたびに走るので、ここが同期だと訂正操作そのものが引っかかる
 *
 * @throws ZipError 危険なエントリ名を含む場合・生成に失敗した場合
 */
// async にすることで、エントリ名の検証失敗も同期 throw ではなく reject に揃う
// （呼び出し側が try/catch と .catch の両方を書かなくて済む）
export async function zipEntriesAsync(
  entries: ReadonlyMap<string, Uint8Array>,
): Promise<Uint8Array> {
  const zippable = toZippable(entries);
  return new Promise((resolve, reject) => {
    zip(zippable, (error, data) => {
      if (error) {
        /* v8 ignore next -- 検証済みの入力では発生しないが、握りつぶさず翻訳する */
        reject(new ZipError('zip の生成に失敗しました', { cause: error }));
        return;
      }
      resolve(data);
    });
  });
}

/**
 * fflate へ渡す形へ変換する（エントリ名の検証と圧縮レベルの決定）
 *
 * **既に圧縮済みのデータは再圧縮しない**（`level: 0`）。同梱する `source.pdf` と
 * `.omr` / `.mxl` はいずれも内部で deflate 済みで、掛け直しても縮まらないどころか
 * CPU 時間だけを食う。保存のたびに数十MBを deflate し直していたのがこれで消える
 */
function toZippable(entries: ReadonlyMap<string, Uint8Array>): Zippable {
  const zippable: Zippable = {};
  for (const [name, data] of entries) {
    if (!isSafeEntryName(name)) {
      throw new ZipError(`不正なエントリ名（パストラバーサル）: ${name}`);
    }
    zippable[name] = [data, { level: isPrecompressed(name) ? 0 : 6 }];
  }
  return zippable;
}

/** 中身が既に圧縮済みで、再圧縮しても縮まらないエントリか */
function isPrecompressed(name: string): boolean {
  return /\.(pdf|omr|mxl)$/i.test(name);
}
