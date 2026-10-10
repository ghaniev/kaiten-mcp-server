import assert from 'node:assert/strict';
import test from 'node:test';

// card-tags-links pulls describeError out of card-ops, which imports
// kaiten-client, which validates the environment at import time.
process.env.KAITEN_API_URL = process.env.KAITEN_API_URL || 'https://example.kaiten.ru/api/latest';
process.env.KAITEN_API_TOKEN = process.env.KAITEN_API_TOKEN || 'test-token-0123456789abcdef';
process.env.KAITEN_LOG_ENABLED = 'false';

const { addCardTags, addExternalLink, projectExternalLinks, removeCardTags } = await import('./card-tags-links.js');
const { AddCardExternalLinkSchema, RemoveCardTagsSchema, UpdateCardExternalLinkSchema } = await import('./schemas.js');

// Company tags; /tags?query= is a substring match like the real one.
const COMPANY = [
  { id: 1, name: 'bug' },
  { id: 2, name: 'backend' },
  { id: 3, name: 'local' },
];

function fakeTags(onCard: Array<{ id: number; name: string }>, opts: { failName?: string } = {}) {
  const card = onCard.map((t) => ({ ...t, tag_id: t.id }));
  const calls: string[] = [];
  let nextId = 100;
  return {
    calls,
    async getCardTags() {
      calls.push('getCardTags');
      return card.map((t) => ({ ...t }));
    },
    async searchTags(query: string) {
      calls.push(`searchTags:${query}`);
      return COMPANY.filter((t) => t.name.includes(query.toLowerCase()));
    },
    async addCardTag(_cardId: number, name: string) {
      calls.push(`addCardTag:${name}`);
      if (name === opts.failName) throw Object.assign(new Error('Validation failed'), { status: 400 });
      const company = COMPANY.find((t) => t.name === name);
      const tag = { id: company?.id ?? nextId++, name, tag_id: company?.id };
      card.push({ ...tag, tag_id: tag.id });
      return tag;
    },
    async removeCardTag(_cardId: number, tagId: number) {
      calls.push(`removeCardTag:${tagId}`);
    },
  };
}

// ============================================
// TAGS
// ============================================

test('an existing tag is reused in its own spelling; an unknown one is flagged as new', async () => {
  const client = fakeTags([]);
  const result = await addCardTags(client as any, 1, ['Bug', 'release-1']);
  assert.deepEqual(result.added, [
    { id: 1, name: 'bug', new_tag: false },
    { id: 100, name: 'release-1', new_tag: true },
  ]);
  assert.ok(client.calls.includes('addCardTag:bug'), 'must not create "Bug" next to "bug"');
  assert.deepEqual(result.tags.map((t) => t.name), ['bug', 'release-1']);
});

test('a substring hit is not taken for the tag: "loc" is not "local"', async () => {
  const result = await addCardTags(fakeTags([]) as any, 1, ['loc']);
  assert.deepEqual(result.added, [{ id: 100, name: 'loc', new_tag: true }]);
});

test('tags already on the card and repeated names are skipped', async () => {
  const client = fakeTags([{ id: 3, name: 'local' }]);
  const result = await addCardTags(client as any, 1, ['LOCAL', 'bug', ' bug ']);
  assert.deepEqual(result.already_on_card, [{ id: 3, name: 'local' }]);
  assert.deepEqual(result.added.map((t) => t.name), ['bug']);
  assert.equal(client.calls.filter((c) => c.startsWith('addCardTag')).length, 1);
});

test('a rejected tag is reported and the rest are still added', async () => {
  const result = await addCardTags(fakeTags([], { failName: 'bug' }) as any, 1, ['bug', 'backend']);
  assert.deepEqual(result.added.map((t) => t.name), ['backend']);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].error, /^400: /);
});

test('nothing added means no second read of the card tags', async () => {
  const client = fakeTags([{ id: 3, name: 'local' }]);
  await addCardTags(client as any, 1, ['local']);
  assert.equal(client.calls.filter((c) => c === 'getCardTags').length, 1);
});

test('tags are removed by name or by id, by their tag id', async () => {
  const client = fakeTags([{ id: 1, name: 'bug' }, { id: 3, name: 'local' }]);
  const result = await removeCardTags(client as any, 1, ['BUG', 3, 'missing', 99]);
  assert.deepEqual(result.removed, [{ id: 1, name: 'bug' }, { id: 3, name: 'local' }]);
  assert.deepEqual(result.not_on_card, ['missing', 99]);
  assert.deepEqual(client.calls.filter((c) => c.startsWith('removeCardTag')), ['removeCardTag:1', 'removeCardTag:3']);
  assert.deepEqual(result.tags, []);
});

test('the same tag named twice is removed once', async () => {
  const client = fakeTags([{ id: 1, name: 'bug' }]);
  const result = await removeCardTags(client as any, 1, ['bug', 1]);
  assert.equal(result.removed.length, 1);
  assert.equal(client.calls.filter((c) => c.startsWith('removeCardTag')).length, 1);
});

// ============================================
// EXTERNAL LINKS
// ============================================

function fakeLinks(existing: Array<{ id: number; url: string; description?: string | null }>) {
  const calls: any[] = [];
  return {
    calls,
    async getCardExternalLinks() {
      return existing;
    },
    async addCardExternalLink(cardId: number, body: any) {
      calls.push(body);
      return { id: 50, card_id: cardId, ...body, created: 'x', uid: 'y' };
    },
  };
}

test('a link is added with its title, and only id/url/description come back', async () => {
  const client = fakeLinks([]);
  const result = await addExternalLink(client as any, 1, 'https://example.com/pr/1', 'PR #1');
  assert.deepEqual(result, {
    card_id: 1,
    link: { id: 50, url: 'https://example.com/pr/1', description: 'PR #1' },
    already_present: false,
  });
  assert.deepEqual(client.calls, [{ url: 'https://example.com/pr/1', description: 'PR #1' }]);
});

test('the same URL twice is not stacked: the existing link is returned', async () => {
  const client = fakeLinks([{ id: 7, url: 'https://example.com/pr/1', description: null }]);
  const result = await addExternalLink(client as any, 1, 'https://example.com/pr/1', 'retry');
  assert.equal(result.already_present, true);
  assert.equal(result.link.id, 7);
  assert.equal(client.calls.length, 0);
});

test('a card without links projects to an empty list', () => {
  assert.deepEqual(projectExternalLinks(undefined), []);
  assert.deepEqual(projectExternalLinks([{ id: 1, url: 'u', uid: 'x' } as any]), [{ id: 1, url: 'u', description: null }]);
});

test('link and tag schemas reject what the API would', () => {
  assert.throws(() => AddCardExternalLinkSchema.parse({ card_id: 1, url: 'not a url' }));
  assert.throws(() => AddCardExternalLinkSchema.parse({ card_id: 1, url: 'https://e.com', description: 'x'.repeat(513) }));
  assert.throws(() => UpdateCardExternalLinkSchema.parse({ card_id: 1, link_id: 2 }), /url or description/);
  assert.equal(UpdateCardExternalLinkSchema.parse({ card_id: 1, link_id: 2, description: null }).description, null);
  assert.deepEqual(RemoveCardTagsSchema.parse({ card_id: 1, tags: ['bug', 3] }).tags, ['bug', 3]);
  assert.throws(() => RemoveCardTagsSchema.parse({ card_id: 1, tags: [] }));
});
