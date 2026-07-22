/**
 * 同梱リソース取得スクリプト（配布ビルド用）
 *
 * Windows 版 Audiveris（jpackage 製 MSI。JRE21 を同梱）をバージョン・SHA-256 固定で
 * ダウンロード・検証し、app-image（`Audiveris.exe` ＋ `app/` ＋ `runtime/`）を
 * `resources/audiveris/win/` へ配置する。electron-builder はここを `extraResources` で同梱する。
 *
 * 「audiveris は完全固定」（docs/architecture.md）に従い、更新時はバージョンと SHA-256 を
 * 同時に差し替え、統合テストのフィクスチャ再生成をセットで行うこと。
 *
 * 実行: `npm run fetch-resources`（`--force` で既存配置を無視して再取得）
 *
 * 展開について:
 * - Windows では `msiexec /a`（管理インストール抽出。管理者権限不要）で app-image を取り出す。
 * - Linux/macOS では `msiextract`（msitools）があれば使う。無ければ案内して中断する
 *   （本 devcontainer は msitools を導入できないため、コンテナではダウンロード＋検証まで到達し、
 *   展開は Windows 実機／CI（windows ランナー）に委ねる）。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { get } from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 固定する Audiveris のバージョンと Windows 配布アセット（GitHub Releases） */
const AUDIVERIS_VERSION = '5.6.1';
const ASSET_NAME = `Audiveris-${AUDIVERIS_VERSION}-windows-x86_64.msi`;
const ASSET_URL = `https://github.com/Audiveris/audiveris/releases/download/${AUDIVERIS_VERSION}/${ASSET_NAME}`;
/** ダウンロード物の完全性検証（取り違え・改ざんの検知。更新時はバージョンと同時に差し替え） */
const ASSET_SHA256 = '92ef67bafc99fef922b4115af726f09ae8ab8e66305570573e4a2a36096ec687';

/** jpackage app-image のランチャ名（この存在で app root を特定する） */
const LAUNCHER_NAME = 'Audiveris.exe';
/**
 * 配置完了マーカー（配置の**最後**に作る）
 *
 * 冪等スキップ判定はこのマーカーの有無で行う。`Audiveris.exe` 単体の存在で判定すると、
 * コピー途中で中断された場合に `runtime/`（同梱JRE）欠落の壊れた配置を「完了」と誤認し得る。
 */
const DONE_MARKER = '.fetch-complete';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(scriptDir, '..');
const cacheDir = join(rootDir, 'resources', '.cache');
const destDir = join(rootDir, 'resources', 'audiveris', 'win');

/** SHA-256 を 16 進小文字で返す */
export async function sha256(filePath: string): Promise<string> {
  const buf = await readFile(filePath);
  return createHash('sha256').update(buf).digest('hex');
}

/** URL をファイルへ保存する（301/302/303/307/308 のリダイレクトを追従する） */
function download(url: string, destFile: string, redirects = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error(`リダイレクトが多すぎます: ${url}`));
      return;
    }
    const request = get(url, (res: IncomingMessage) => {
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location !== undefined) {
        res.resume(); // 本文を捨ててソケットを解放
        const next = new URL(location, url).toString();
        download(next, destFile, redirects + 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error(`ダウンロード失敗 (HTTP ${status}): ${url}`));
        return;
      }
      const file = createWriteStream(destFile);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', reject);
    });
    request.on('error', reject);
  });
}

/** キャッシュに検証済み MSI を用意して絶対パスを返す（ハッシュ一致なら再ダウンロードしない） */
async function ensureMsi(): Promise<string> {
  await mkdir(cacheDir, { recursive: true });
  const msiPath = join(cacheDir, ASSET_NAME);
  if (existsSync(msiPath) && (await sha256(msiPath)) === ASSET_SHA256) {
    console.log(`[fetch-resources] キャッシュ済み MSI を使用: ${msiPath}`);
    return msiPath;
  }
  console.log(`[fetch-resources] ダウンロード中: ${ASSET_URL}`);
  await download(ASSET_URL, msiPath);
  const actual = await sha256(msiPath);
  if (actual !== ASSET_SHA256) {
    await rm(msiPath, { force: true });
    throw new Error(
      `SHA-256 不一致で中断しました。\n  expected: ${ASSET_SHA256}\n  actual:   ${actual}`,
    );
  }
  console.log('[fetch-resources] SHA-256 検証 OK');
  return msiPath;
}

/** ディレクトリを再帰的に探索し、指定名のファイルを含む最初のディレクトリ（app root）を返す */
export async function findDirContaining(root: string, fileName: string): Promise<string | null> {
  const entries = await readdir(root, { withFileTypes: true });
  if (entries.some((e) => e.isFile() && e.name === fileName)) {
    return root;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const found = await findDirContaining(join(root, entry.name), fileName);
      if (found !== null) {
        return found;
      }
    }
  }
  return null;
}

/**
 * MSI を一時ディレクトリへ展開し、app root（Audiveris.exe を含む階層）と
 * 後始末用の一時ディレクトリを返す
 */
async function extractMsi(msiPath: string): Promise<{ appRoot: string; workDir: string }> {
  const workDir = await mkdtemp(join(tmpdir(), 'solfa-audiveris-'));
  if (process.platform === 'win32') {
    // 管理インストール抽出: インストールせずに TARGETDIR へ全ファイルを展開する（管理者権限不要）
    const result = spawnSync(
      'msiexec',
      ['/a', msiPath, '/qn', `TARGETDIR=${workDir}`],
      { stdio: 'inherit' },
    );
    if (result.status !== 0) {
      throw new Error(`msiexec による MSI 展開に失敗しました (status=${result.status ?? 'null'})`);
    }
  } else {
    // Linux/macOS: msitools の msiextract。未導入なら対処法を添えて中断する
    const probe = spawnSync('msiextract', ['--version']);
    if (probe.error !== undefined && (probe.error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        'MSI を展開できません（msiextract が見つかりません）。\n' +
          'Windows 実機/CI で実行するか、msitools を導入してください（例: apt-get install msitools）。\n' +
          'この devcontainer では展開まで到達しません（配布ビルドは Windows で行います）。',
      );
    }
    const result = spawnSync('msiextract', ['-C', workDir, msiPath], { stdio: 'inherit' });
    if (result.status !== 0) {
      throw new Error(`msiextract による MSI 展開に失敗しました (status=${result.status ?? 'null'})`);
    }
  }
  const appRoot = await findDirContaining(workDir, LAUNCHER_NAME);
  if (appRoot === null) {
    await rm(workDir, { recursive: true, force: true });
    throw new Error(
      `展開結果から ${LAUNCHER_NAME} を見つけられませんでした（MSI レイアウトの想定変更の可能性）。`,
    );
  }
  return { appRoot, workDir };
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  if (!force && existsSync(join(destDir, DONE_MARKER))) {
    console.log(`[fetch-resources] 既に配置済みのためスキップ: ${destDir}（再取得は --force）`);
    return;
  }

  const msiPath = await ensureMsi();
  console.log('[fetch-resources] MSI を展開中...');
  const { appRoot, workDir } = await extractMsi(msiPath);

  console.log(`[fetch-resources] app-image を配置: ${appRoot} → ${destDir}`);
  await rm(destDir, { recursive: true, force: true });
  await mkdir(destDir, { recursive: true });
  await cp(appRoot, destDir, { recursive: true });
  // 配置がすべて完了した最後にマーカーを書く（中断時に「完了」と誤認させないため）
  await writeFile(join(destDir, DONE_MARKER), `${ASSET_NAME}\n${ASSET_SHA256}\n`);
  await rm(workDir, { recursive: true, force: true }); // 一時展開ディレクトリの後始末

  console.log('[fetch-resources] 完了: 同梱 Audiveris(win) の準備ができました');
}

// スクリプトとして直接起動されたときのみ実行する（テストからの import では main を走らせない）
const invokedPath = process.argv[1] !== undefined ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error: unknown) => {
    console.error('[fetch-resources] エラー:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
