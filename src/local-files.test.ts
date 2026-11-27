import assert from 'node:assert/strict';
import {
  lstat, mkdtemp, readFile, readlink, realpath, rm, symlink, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { saveAttachmentLocally } from './local-files.js';

// os.tmpdir() reads TMPDIR (POSIX) or TEMP/TMP (Windows) on every call, so each test gets
// its own empty temp dir and leaves nothing behind, whatever the machine's /tmp looks like
const tempEnv = ['TMPDIR', 'TEMP', 'TMP'] as const;
const savedEnv = Object.fromEntries(tempEnv.map((key) => [key, process.env[key]]));
let sandbox: string;

test.beforeEach(async () => {
  sandbox = await realpath(await mkdtemp(join(tmpdir(), 'kaiten-local-files-test-')));
  for (const key of tempEnv) process.env[key] = sandbox;
});

test.afterEach(async () => {
  for (const key of tempEnv) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await rm(sandbox, { recursive: true, force: true });
});

const rootName = () => {
  const uid = process.getuid?.();
  return uid === undefined ? 'kaiten-mcp-files' : `kaiten-mcp-files-${uid}`;
};

test('saves an attachment under the card and file id, replacing an older copy', async () => {
  const first = await saveAttachmentLocally(1, 'uid-1', 'ПЛАН.md', Buffer.from('one'));
  assert.equal(first, join(sandbox, rootName(), '1', 'uid-1', 'ПЛАН.md'));
  const second = await saveAttachmentLocally(1, 'uid-1', 'ПЛАН.md', Buffer.from('two'));
  assert.equal(second, first);
  assert.equal(await readFile(second, 'utf8'), 'two');
});

test('a hostile file name stays inside the attachment folder', async () => {
  const saved = await saveAttachmentLocally(1, '../uid-2', '../../x.txt', Buffer.from('x'));
  assert.equal(saved, join(sandbox, rootName(), '1', '_uid-2', '_.._x.txt'));
});

test('something planted at the shared folder path falls back to a private folder', {
  skip: process.platform === 'win32' && 'the Windows temp dir is per user',
}, async () => {
  await writeFile(join(sandbox, rootName()), 'not a folder');
  const saved = await saveAttachmentLocally(1, 'uid-4', 'a.txt', Buffer.from('a'));
  assert.ok(saved.startsWith(sandbox));
  assert.ok(!saved.startsWith(join(sandbox, rootName())));
  assert.equal(await readFile(saved, 'utf8'), 'a');
});

test('files are private and a planted symlink is replaced, not followed', {
  skip: process.platform === 'win32' && 'POSIX modes and symlinks',
}, async () => {
  const saved = await saveAttachmentLocally(1, 'uid-3', 'a.txt', Buffer.from('a'));
  assert.equal((await lstat(saved)).mode & 0o777, 0o600);
  assert.equal((await lstat(join(sandbox, rootName()))).mode & 0o077, 0);

  const victim = join(sandbox, 'victim');
  await writeFile(victim, 'keep');
  await symlink(victim, join(dirname(saved), 'b.txt'));
  const replaced = await saveAttachmentLocally(1, 'uid-3', 'b.txt', Buffer.from('b'));
  assert.equal(await readFile(victim, 'utf8'), 'keep');
  assert.equal((await lstat(replaced)).isSymbolicLink(), false);
  await assert.rejects(readlink(replaced));
});
