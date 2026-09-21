import assert from 'node:assert/strict';
import test from 'node:test';
import { AxiosError, type AxiosRequestConfig, type AxiosResponse } from 'axios';

// kaiten-client validates the environment when it is imported.
process.env.KAITEN_API_URL = process.env.KAITEN_API_URL || 'https://example.kaiten.ru/api/latest';
process.env.KAITEN_API_TOKEN = process.env.KAITEN_API_TOKEN || 'test-token-0123456789abcdef';
process.env.KAITEN_MAX_CONCURRENT_REQUESTS = '20';
process.env.KAITEN_LOG_ENABLED = 'false';

const { KaitenClient, KAITEN_PAGE_SIZE } = await import('./kaiten-client.js');

interface Recorded {
  method: string;
  url: string;
  params: URLSearchParams;
  body: any;
  headers: Record<string, any>;
}

/**
 * A fake HTTP layer. Kaiten is mimicked where it matters: a list endpoint never
 * answers with more than 100 rows, whatever `limit` asks for.
 */
function makeClient(handler: (req: Recorded) => { status: number; data: any }) {
  const requests: Recorded[] = [];
  const adapter = async (config: AxiosRequestConfig): Promise<AxiosResponse> => {
    const raw = String(config.url || '');
    const [path, search] = raw.split('?');
    const params = new URLSearchParams(search || '');
    for (const [key, value] of Object.entries((config.params || {}) as Record<string, any>)) {
      if (value !== undefined) params.set(key, String(value));
    }
    const req: Recorded = {
      method: (config.method || 'get').toLowerCase(),
      url: path,
      params,
      body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data,
      headers: (config.headers || {}) as Record<string, any>,
    };
    requests.push(req);

    const result = handler(req);
    const response = {
      data: result.data,
      status: result.status,
      statusText: 'OK',
      headers: {},
      config: config as any,
    } as AxiosResponse;

    if (result.status >= 400) {
      throw new AxiosError('Request failed', String(result.status), config as any, null, response);
    }
    return response;
  };

  return {
    requests,
    client: new KaitenClient('https://example.kaiten.ru/api/latest', 'test-token-0123456789abcdef', { adapter }),
  };
}

/** N cards, served page by page, capped at 100 per response like the real API. */
function cardPageServer(total: number) {
  return (req: Recorded) => {
    const limit = Math.min(Number(req.params.get('limit') || 10), KAITEN_PAGE_SIZE);
    const skip = Number(req.params.get('skip') || 0);
    const data = Array.from({ length: Math.max(0, Math.min(limit, total - skip)) }, (_, i) => ({
      id: skip + i + 1,
      title: `Card ${skip + i + 1}`,
    }));
    return { status: 200, data };
  };
}

test('a board of 250 cards does not look like a board of 100', async () => {
  const { client, requests } = makeClient(cardPageServer(250));

  const paged = await client.searchCardsPaged({ board_id: 7 }, 200);

  assert.equal(paged.items.length, 200);
  assert.equal(paged.has_more, true, 'there are 250 cards, so 200 is not all of them');
  assert.equal(paged.next_offset, 200);
  assert.deepEqual(paged.items.map((c) => c.id).slice(0, 3), [1, 2, 3]);
  assert.equal(paged.items[199].id, 200);
  // No request ever asks for more than the cap, because the cap is silent.
  for (const req of requests) {
    assert.ok(Number(req.params.get('limit')) <= KAITEN_PAGE_SIZE);
  }
});

test('reading a list to the end reports has_more false', async () => {
  const { client } = makeClient(cardPageServer(250));
  const paged = await client.searchCardsPaged({ board_id: 7 }, 300);

  assert.equal(paged.items.length, 250);
  assert.equal(paged.has_more, false);
  assert.equal(paged.next_offset, null);
  assert.equal(paged.requests, 3);
});

test('a small page is one request and no extra round trip', async () => {
  const { client, requests } = makeClient(cardPageServer(250));
  const paged = await client.searchCardsPaged({ board_id: 7 }, 10);

  assert.equal(paged.items.length, 10);
  assert.equal(paged.requests, 1);
  assert.equal(paged.has_more, true);
  assert.equal(paged.next_offset, 10);
  // 11 rows asked for, 10 returned: the extra row is how has_more is known.
  assert.equal(requests[0].params.get('limit'), '11');
});

test('paging continues from an explicit skip', async () => {
  const { client, requests } = makeClient(cardPageServer(250));
  const paged = await client.searchCardsPaged({ board_id: 7, skip: 200 }, 100);

  assert.equal(paged.items.length, 50);
  assert.equal(paged.has_more, false);
  assert.equal(requests[0].params.get('skip'), '200');
});

test('board cards go through /cards, because /boards/{id}/cards is a 404', async () => {
  const { client, requests } = makeClient((req) => {
    if (req.url === '/boards/7/cards') return { status: 404, data: '' };
    return cardPageServer(5)(req);
  });

  const cards = await client.getCardsFromBoard(7, 5);
  assert.equal(cards.length, 5);
  assert.equal(requests[0].url, '/cards');
  assert.equal(requests[0].params.get('board_id'), '7');
});

test('users page the same way, and say when more are left', async () => {
  const { client } = makeClient((req) => {
    assert.equal(req.url, '/users');
    const limit = Math.min(Number(req.params.get('limit') || 10), KAITEN_PAGE_SIZE);
    const offset = Number(req.params.get('offset') || 0);
    const total = 186;
    return {
      status: 200,
      data: Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => ({
        id: offset + i + 1,
        full_name: `User ${offset + i + 1}`,
      })),
    };
  });

  const all = await client.getUsersPaged({ limit: 300 });
  assert.equal(all.items.length, 186);
  assert.equal(all.has_more, false);

  const firstFifty = await client.getUsersPaged({ limit: 50 });
  assert.equal(firstFifty.items.length, 50);
  assert.equal(firstFifty.has_more, true);
  assert.equal(firstFifty.next_offset, 50);
});

test('member endpoints use the documented paths and bodies', async () => {
  const { client, requests } = makeClient((req) => {
    if (req.method === 'patch' && req.body?.type === 1) {
      // The live API: a responsible cannot be demoted to a plain member.
      return { status: 400, data: { message: 'Member.type should be >= 2' } };
    }
    return { status: 200, data: req.method === 'get' ? [{ id: 5, type: 2 }] : { id: 5, type: req.body?.type } };
  });

  await client.getCardMembers(42);
  await client.addCardMember(42, 5, 2);
  await client.updateCardMember(42, 5, 2);
  await client.removeCardMember(42, 5);

  assert.deepEqual(
    requests.map((r) => `${r.method} ${r.url}`),
    [
      'get /cards/42/members',
      'post /cards/42/members',
      'patch /cards/42/members/5',
      'delete /cards/42/members/5',
    ]
  );
  assert.deepEqual(requests[1].body, { user_id: 5, type: 2 });
  assert.deepEqual(requests[2].body, { type: 2 });

  await assert.rejects(client.updateCardMember(42, 5, 1), (error: any) => {
    assert.equal(error.status, 400);
    assert.match(JSON.stringify(error.details), /Member.type should be >= 2/);
    return true;
  });
});

test('blockers are added by reason or by card, and released by RECORD id', async () => {
  const { client, requests } = makeClient((req) => ({
    status: 200,
    data: req.method === 'get' ? [{ id: 900, released: false }] : { id: 900, released: req.method === 'delete' },
  }));

  await client.getCardBlockers(42);
  await client.addCardBlocker(42, { reason: 'ждём макеты' });
  await client.addCardBlocker(42, { blocker_card_id: 777 });
  await client.removeCardBlocker(42, 900);

  assert.deepEqual(
    requests.map((r) => `${r.method} ${r.url}`),
    [
      'get /cards/42/blockers',
      'post /cards/42/blockers',
      'post /cards/42/blockers',
      'delete /cards/42/blockers/900',
    ]
  );
  assert.deepEqual(requests[1].body, { reason: 'ждём макеты' });
  assert.deepEqual(requests[2].body, { blocker_card_id: 777 });
});

test('boards are renamed through the space path', async () => {
  const { client, requests } = makeClient(() => ({ status: 200, data: { id: 3, title: 'New' } }));
  await client.updateBoard(99, 3, { title: 'New' });
  assert.equal(requests[0].method, 'patch');
  assert.equal(requests[0].url, '/spaces/99/boards/3');
});

test('clearing a due date sends null, not an absent field', async () => {
  const { client, requests } = makeClient(() => ({ status: 200, data: { id: 1, due_date: null } }));
  await client.updateCard(1, { due_date: null });
  assert.equal(requests[0].body.due_date, null);
  assert.ok('due_date' in requests[0].body);
  assert.ok(requests[0].headers['Idempotency-Key'], 'writes carry an idempotency key');
});

test('a 500 on the way is retried, not surfaced', async () => {
  let attempts = 0;
  const { client } = makeClient(() => {
    attempts++;
    if (attempts === 1) return { status: 500, data: { message: 'Internal Server Error' } };
    return { status: 200, data: { id: 1, title: 'Card' } };
  });

  const card = await client.updateCard(1, { title: 'Card' });
  assert.equal(card.title, 'Card');
  assert.equal(attempts, 2, 'the first attempt failed with 500 and was retried');
});

test('a 404 is not retried — it will not get better', async () => {
  let attempts = 0;
  const { client } = makeClient(() => {
    attempts++;
    return { status: 404, data: { message: 'Not found' } };
  });

  await assert.rejects(client.getCard(1), (error: any) => {
    assert.equal(error.status, 404);
    return true;
  });
  assert.equal(attempts, 1);
});

test('stopping at the request cap is reported as has_more, not as the end', async () => {
  // Otherwise the cap turns into exactly the silent truncation this function
  // was written to prevent.
  const { client } = makeClient(cardPageServer(10000));
  const paged = await client.searchCardsPaged({ board_id: 7 }, 1000, undefined, 3);

  assert.equal(paged.requests, 3);
  assert.equal(paged.items.length, 300);
  assert.equal(paged.has_more, true);
  assert.equal(paged.next_offset, 300);
});

test('a caller-supplied idempotency key reaches the request', async () => {
  const { client, requests } = makeClient(() => ({ status: 200, data: { id: 1 } }));
  await client.updateCard(1, { title: 'x', idempotency_key: 'my-key-42' });
  await client.createCard({ title: 'x', board_id: 2, idempotency_key: 'my-key-43' });

  assert.equal(requests[0].headers['Idempotency-Key'], 'my-key-42');
  assert.equal(requests[1].headers['Idempotency-Key'], 'my-key-43');
  // and the key itself is not sent as a card field
  assert.equal('idempotency_key' in requests[0].body, false);
});
