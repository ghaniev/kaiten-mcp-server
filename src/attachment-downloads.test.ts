import assert from 'node:assert/strict';
import test from 'node:test';
import axios, { AxiosError } from 'axios';
import type { KaitenCard, KaitenFile } from './kaiten-client.js';

process.env.KAITEN_API_URL = 'https://example.kaiten.ru/api/latest';
process.env.KAITEN_API_TOKEN = 'test-token-0123456789abcdef';
process.env.KAITEN_MAX_IMAGE_BYTES = '1024';
process.env.KAITEN_MAX_FILE_BYTES = '2048';
process.env.KAITEN_LOG_ENABLED = 'false';

const { KaitenClient, KaitenError } = await import('./kaiten-client.js');
const card: KaitenCard = { id: 1, uid: 'card-uid', title: 'Test card' };
const file: KaitenFile = { id: 2, name: 'screen.png', url: 'https://files.example.com/screen.png' };
const client = () => new KaitenClient(process.env.KAITEN_API_URL!, process.env.KAITEN_API_TOKEN!);

test('existing image downloads keep MIME, size limits, cancellation and unauthenticated requests', async (t) => {
  const data = Buffer.from('image');
  const get = t.mock.method(axios, 'get', async () => ({ data, headers: { 'content-type': 'image/png; charset=binary' } }) as any);
  const signal = new AbortController().signal;
  const image = await client().downloadCardImage(card, file, signal);
  assert.equal(image.mimeType, 'image/png');
  assert.deepEqual(image.data, data);
  const [url, options] = get.mock.calls[0].arguments;
  assert.equal(url, file.url);
  assert.equal(options?.signal, signal);
  assert.equal(options?.maxRedirects, 0);
  assert.equal(options?.maxContentLength, 1024);
  assert.equal(options?.maxBodyLength, 1024);
  assert.equal(options?.headers?.Authorization, undefined);
  assert.equal(options?.headers?.Accept, 'image/png,image/jpeg,image/webp,image/gif');
});

test('file downloads use their own limit while the existing image limit stays enforced', async (t) => {
  const data = Buffer.alloc(1500);
  const get = t.mock.method(axios, 'get', async () => ({ data, headers: { 'content-type': 'application/octet-stream' } }) as any);
  const api = client();
  const downloaded = await api.downloadCardFile(card, { ...file, size: 1500 });
  assert.deepEqual(downloaded.data, data);
  assert.equal(downloaded.contentType, 'application/octet-stream');
  assert.equal(get.mock.calls[0].arguments[1]?.maxContentLength, 2048);
  await assert.rejects(api.downloadCardImage(card, { ...file, size: 1500 }), /1024-byte image limit/);
  assert.equal(get.mock.callCount(), 1, 'declared oversized images are rejected before download');
  await assert.rejects(api.downloadCardImage(card, file), /1024-byte image limit/);
  await assert.rejects(api.downloadCardFile(card, { ...file, size: 2049 }), /2048-byte file limit/);
});

test('both download tools reject private URLs before making a request', async (t) => {
  const get = t.mock.method(axios, 'get', async () => { throw new Error('Unexpected network request'); });
  const api = client();
  const privateFile = { ...file, url: 'https://127.0.0.1/private' };
  await assert.rejects(api.downloadCardImage(card, privateFile), /Unsafe file download URL/);
  await assert.rejects(api.downloadCardFile(card, privateFile), /Unsafe file download URL/);
  assert.equal(get.mock.callCount(), 0);
});

test('existing image tools still reject non-image responses', async (t) => {
  t.mock.method(axios, 'get', async () => ({ data: Buffer.from('<html>'), headers: { 'content-type': 'text/html' } }) as any);
  await assert.rejects(client().downloadCardImage(card, file), /Unsupported image MIME type/);
});

test('file-host errors keep HTTP status with a short body instead of a byte dump', async (t) => {
  t.mock.method(axios, 'get', async () => {
    throw new AxiosError('Request failed', undefined, undefined, undefined, {
      status: 403, data: Buffer.from('denied '.repeat(100)), headers: {}, statusText: 'Forbidden', config: {} as any,
    });
  });
  await assert.rejects(client().downloadCardFile(card, file), (error: unknown) => {
    assert.ok(error instanceof KaitenError);
    assert.equal(error.status, 403);
    assert.match(error.message, /HTTP 403/);
    assert.equal(typeof error.details.body, 'string');
    assert.ok(error.details.body.length <= 200);
    return true;
  });
});
