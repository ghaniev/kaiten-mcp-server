import { randomBytes } from 'node:crypto';
import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { safeLocalFileName } from './attachments.js';

// One private fallback folder per process, so a broken shared root does not leave a new
// temp folder behind on every call
let fallbackRoot: Promise<string> | undefined;

/**
 * Folder for attachments saved by kaiten_get_card_file.
 *
 * On Linux and macOS the temp dir is shared by all users, and a predictable path there lets
 * another user plant a symlink, a file, or read the files. So the folder is per uid, mode 0700,
 * and used only if it is a real directory owned by us with no group/other access; anything
 * else (including mkdir failing on whatever was planted there) falls back to a private mkdtemp
 * folder. On Windows the temp dir is already per user (%LOCALAPPDATA%\Temp), there is no uid
 * and modes are ignored, so the plain folder is used.
 */
async function attachmentsRoot(): Promise<string> {
  const uid = process.getuid?.();
  const root = join(
    tmpdir(),
    uid === undefined ? 'kaiten-mcp-files' : `kaiten-mcp-files-${uid}`,
  );

  try {
    await mkdir(root, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return privateFallbackRoot();
  }
  try {
    const stat = await lstat(root);
    const isPrivate = uid === undefined ||
      (stat.uid === uid && (stat.mode & 0o077) === 0);
    if (stat.isDirectory() && !stat.isSymbolicLink() && isPrivate) return root;
  } catch {
    // Removed between mkdir and lstat: treat as not ours
  }
  return privateFallbackRoot();
}

function privateFallbackRoot(): Promise<string> {
  fallbackRoot ??= mkdtemp(join(tmpdir(), 'kaiten-mcp-files-'));
  return fallbackRoot;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Windows refuses to replace a file that is open (a PDF the user opened from an earlier
// path) or briefly locked by an antivirus scan of the fresh .part file
const transientRenameCodes = new Set(['EPERM', 'EBUSY', 'EACCES']);

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !transientRenameCodes.has(code) || attempt >= 4) throw error;
      await sleep(50 * 2 ** attempt);
    }
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Saves an attachment as <root>/<card id>/<file id>/<name> and returns the path.
 * Writes to a fresh temp name first (O_EXCL, 0600) and renames over the target, so a repeat
 * download replaces the old copy and an existing symlink at the target is replaced, not followed.
 * If the old copy cannot be replaced (still open on Windows), the file is saved as "name (2).ext".
 */
export async function saveAttachmentLocally(
  cardId: number,
  fileKey: string,
  fileName: string,
  data: Buffer,
): Promise<string> {
  const dir = join(await attachmentsRoot(), String(cardId), safeLocalFileName(fileKey, 40));
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const name = safeLocalFileName(fileName);
  const target = join(dir, name);
  const partial = join(dir, `.${randomBytes(6).toString('hex')}.part`);
  try {
    await writeFile(partial, data, { flag: 'wx', mode: 0o600 });
    try {
      await renameWithRetry(partial, target);
      return target;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !transientRenameCodes.has(code)) throw error;
    }

    const extension = extname(name);
    const stem = name.slice(0, name.length - extension.length);
    for (let copy = 2; copy <= 20; copy++) {
      const candidate = join(dir, `${stem} (${copy})${extension}`);
      if (await pathExists(candidate)) continue;
      await rename(partial, candidate);
      return candidate;
    }
    throw new Error(`Could not save ${name}: ${target} and its numbered copies are in use`);
  } finally {
    await rm(partial, { force: true });
  }
}
