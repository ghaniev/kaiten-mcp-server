import assert from 'node:assert/strict';
import { lstat, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { saveAttachmentLocally } from './local-files.js';

const cardId = 900000000 + Math.floor(Math.random() * 1000000);
const victim = join(tmpdir(), `kaiten-victim-${cardId}`);
let cardDir: string | undefined;

test.after(async () => {
  if (cardDir) await rm(cardDir, { recursive: true, force: true });
  await rm(victim, { force: true });
});

test('saves an attachment under the card and file id, replacing an older copy', async () => {
  const first = await saveAttachmentLocally(cardId, 'uid-1', 'ПЛАН.md', Buffer.from('one'));
  assert.ok(first.startsWith(tmpdir()));
  assert.ok(first.endsWith(join(String(cardId), 'uid-1', 'ПЛАН.md')));
  cardDir = dirname(dirname(first));
  const second = await saveAttachmentLocally(cardId, 'uid-1', 'ПЛАН.md', Buffer.from('two'));
  assert.equal(second, first);
  assert.equal(await readFile(second, 'utf8'), 'two');
});

test('a hostile file name stays inside the attachment folder', async () => {
  const saved = await saveAttachmentLocally(cardId, '../uid-2', '../../x.txt', Buffer.from('x'));
  assert.ok(saved.endsWith(join(String(cardId), '_uid-2', '_.._x.txt')));
});

test('files are private and a planted symlink is replaced, not followed', {
  skip: process.platform === 'win32' && 'POSIX modes and symlinks',
}, async () => {
  const saved = await saveAttachmentLocally(cardId, 'uid-3', 'a.txt', Buffer.from('a'));
  assert.equal((await lstat(saved)).mode & 0o777, 0o600);
  assert.equal((await lstat(dirname(dirname(dirname(saved))))).mode & 0o077, 0);

  await writeFile(victim, 'keep');
  await symlink(victim, join(dirname(saved), 'b.txt'));
  const replaced = await saveAttachmentLocally(cardId, 'uid-3', 'b.txt', Buffer.from('b'));
  assert.equal(await readFile(victim, 'utf8'), 'keep');
  assert.equal((await lstat(replaced)).isSymbolicLink(), false);
  await assert.rejects(readlink(replaced));
});
