import { randomBytes } from 'node:crypto';
import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { safeLocalFileName } from './attachments.js';

/**
 * Folder for attachments saved by kaiten_get_card_file.
 *
 * On Linux and macOS the temp dir is shared by all users, and a predictable path there lets
 * another user plant a symlink or read the files. So the folder is per uid, mode 0700, and
 * used only if it is a real directory owned by us with no group/other access; otherwise a
 * fresh private mkdtemp folder is used instead. On Windows the temp dir is already per user
 * (%LOCALAPPDATA%\Temp), there is no uid and modes are ignored, so the plain folder is used.
 */
async function attachmentsRoot(): Promise<string> {
  const uid = process.getuid?.();
  const root = join(
    tmpdir(),
    uid === undefined ? 'kaiten-mcp-files' : `kaiten-mcp-files-${uid}`,
  );
  await mkdir(root, { recursive: true, mode: 0o700 });

  const stat = await lstat(root);
  const isPrivate = uid === undefined ||
    (stat.uid === uid && (stat.mode & 0o077) === 0);
  if (stat.isDirectory() && !stat.isSymbolicLink() && isPrivate) return root;
  return mkdtemp(join(tmpdir(), 'kaiten-mcp-files-'));
}

/**
 * Saves an attachment as <root>/<card id>/<file id>/<name> and returns the path.
 * Writes to a fresh temp name first (O_EXCL, 0600) and renames over the target, so a repeat
 * download replaces the old copy and an existing symlink at the target is replaced, not followed.
 */
export async function saveAttachmentLocally(
  cardId: number,
  fileKey: string,
  fileName: string,
  data: Buffer,
): Promise<string> {
  const dir = join(await attachmentsRoot(), String(cardId), safeLocalFileName(fileKey));
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const target = join(dir, safeLocalFileName(fileName));
  const partial = join(dir, `.${randomBytes(6).toString('hex')}.part`);
  await writeFile(partial, data, { flag: 'wx', mode: 0o600 });
  try {
    await rename(partial, target);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
  return target;
}
