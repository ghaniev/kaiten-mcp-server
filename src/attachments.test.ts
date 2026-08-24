import assert from 'node:assert/strict';
import test from 'node:test';
import type { KaitenFile } from './kaiten-client.js';
import {
  inferImageMimeType,
  isSafeImageDownloadUrl,
  listCardAttachments,
  resolveDownloadedImageMimeType,
  selectCardImages,
  validateImageSize,
} from './attachments.js';

const files: KaitenFile[] = [
  {
    id: 1,
    name: 'screen.png',
    size: 1024,
    type: 1,
    mime_type: 'image/png',
  },
  {
    id: 2,
    uid: 'comment-image',
    name: 'feedback.JPG',
    size: '2048',
    type: 8,
    comment_id: 42,
  },
  {
    id: 3,
    name: 'requirements.pdf',
    type: 1,
    mime_type: 'application/pdf',
  },
  {
    id: 4,
    name: 'deleted.webp',
    deleted: true,
  },
];

test('lists image attachments from cards and comments', () => {
  assert.deepEqual(listCardAttachments(files, true), [
    {
      id: '1',
      name: 'screen.png',
      size: 1024,
      mime_type: 'image/png',
      comment_id: null,
      source: 'card',
      type: 1,
      is_image: true,
    },
    {
      id: 'comment-image',
      name: 'feedback.JPG',
      size: 2048,
      mime_type: 'image/jpeg',
      comment_id: '42',
      source: 'comment',
      type: 8,
      is_image: true,
    },
  ]);
});

test('selects requested images by numeric ID or UID and respects limit', () => {
  assert.deepEqual(
    selectCardImages(files, ['comment-image', 1], 1).map((file) => file.id),
    [1],
  );
  assert.deepEqual(
    selectCardImages(files, ['comment-image'], 5).map((file) => file.id),
    [2],
  );
});

test('infers supported MIME types and rejects non-image responses', () => {
  assert.equal(inferImageMimeType(files[1]), 'image/jpeg');
  assert.equal(
    resolveDownloadedImageMimeType(files[0], 'image/png; charset=binary'),
    'image/png',
  );
  assert.throws(
    () => resolveDownloadedImageMimeType(files[0], 'text/html'),
    /Unsupported image MIME type/,
  );
});

test('enforces declared and downloaded image size limits', () => {
  assert.doesNotThrow(() => validateImageSize(files[0], 1024, 2048));
  assert.throws(
    () => validateImageSize(files[1], 1, 1024),
    /exceeds the 1024-byte image limit/,
  );
  assert.throws(
    () => validateImageSize(files[0], 4096, 2048),
    /exceeds the 2048-byte image limit/,
  );
});

test('allows HTTPS file hosts and rejects local or private-network URLs', () => {
  assert.equal(isSafeImageDownloadUrl('https://files.example.com/a.png'), true);
  assert.equal(isSafeImageDownloadUrl('http://files.example.com/a.png'), false);
  assert.equal(isSafeImageDownloadUrl('https://localhost/a.png'), false);
  assert.equal(isSafeImageDownloadUrl('https://127.0.0.1/a.png'), false);
  assert.equal(isSafeImageDownloadUrl('https://192.168.1.2/a.png'), false);
  assert.equal(isSafeImageDownloadUrl('not-a-url'), false);
});
