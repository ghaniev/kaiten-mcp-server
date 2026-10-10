import assert from 'node:assert/strict';
import test from 'node:test';

// checklists pulls describeError out of card-ops, which imports kaiten-client,
// which validates the environment at import time.
process.env.KAITEN_API_URL = process.env.KAITEN_API_URL || 'https://example.kaiten.ru/api/latest';
process.env.KAITEN_API_TOKEN = process.env.KAITEN_API_TOKEN || 'test-token-0123456789abcdef';
process.env.KAITEN_LOG_ENABLED = 'false';

const {
  appendChecklistItems,
  createChecklistWithItems,
  findItemChecklist,
  projectChecklists,
  renderChecklistsMarkdown,
  summarizeChecklists,
  updateChecklistItems,
} = await import('./checklists.js');
const {
  AddChecklistItemsSchema,
  CreateChecklistSchema,
  UpdateChecklistItemSchema,
  UpdateChecklistSchema,
} = await import('./schemas.js');

const AVATAR = 'data:image/png;base64,' + 'A'.repeat(2000);
const jane = { id: 7, full_name: 'Jane Doe', avatar_initials_url: AVATAR, initials: 'JD' };

// Shaped like a live GET /cards/{id} answer: items out of display order, one
// deleted item, full user objects with avatars on checked items.
const card = {
  id: 100,
  checklists: [
    {
      id: 2,
      name: 'Second',
      sort_order: 2,
      items: [{ id: 21, text: 'only', sort_order: 1, checked: false }],
    },
    {
      id: 1,
      name: 'First',
      sort_order: 1,
      items: [
        { id: 12, text: 'b', sort_order: 2, checked: false, responsible_id: 7, responsible: jane, due_date: '2026-10-20' },
        { id: 11, text: 'a', sort_order: 1, checked: true, checker_id: 7, checked_by: jane, checked_at: '2026-10-01T00:00:00Z' },
        { id: 13, text: 'gone', sort_order: 3, checked: true, deleted: true },
      ],
    },
  ],
};

// ============================================
// PROJECTION (pure)
// ============================================

test('checklists and items come out in display order, deleted items dropped', () => {
  const [first, second] = projectChecklists(card.checklists as any);
  assert.equal(first.name, 'First');
  assert.equal(second.name, 'Second');
  assert.deepEqual(first.items.map((i) => i.id), [11, 12]);
  assert.equal(first.done, 1);
  assert.equal(first.total, 2);
});

test('items carry user names, never avatars', () => {
  const [first] = projectChecklists(card.checklists as any);
  const json = JSON.stringify(first);
  assert.ok(!json.includes('base64'));
  assert.deepEqual(first.items[0].checked_by, { id: 7, full_name: 'Jane Doe' });
  assert.deepEqual(first.items[1].responsible, { id: 7, full_name: 'Jane Doe' });
});

test('an unchecked item reports no checker even if the API left one behind', () => {
  const [item] = projectChecklists([{ id: 1, name: 'x', items: [{ id: 1, text: 't', checked: false, checker_id: 7, checked_at: '2026-01-01' }] }] as any)[0].items;
  assert.equal(item.checked_by, null);
  assert.equal(item.checked_at, null);
});

test('a card without the checklists key projects to an empty list', () => {
  assert.deepEqual(projectChecklists(undefined), []);
  assert.deepEqual(summarizeChecklists(undefined), []);
});

test('markdown renders checkboxes with the ids the write tools need', () => {
  const md = renderChecklistsMarkdown(projectChecklists(card.checklists as any));
  assert.match(md, /### First \(1\/2\) · checklist_id: 1/);
  assert.match(md, /- \[x\] a _\(item_id: 11\)_/);
  assert.match(md, /- \[ \] b _\(→ Jane Doe · due 2026-10-20 · item_id: 12\)_/);
});

test('an item is found in its checklist; a deleted or foreign one is not', () => {
  assert.equal(findItemChecklist(card, 12)?.id, 1);
  assert.equal(findItemChecklist(card, 21)?.id, 2);
  assert.equal(findItemChecklist(card, 13), null);
  assert.equal(findItemChecklist(card, 999), null);
  assert.equal(findItemChecklist({ id: 5 }, 12), null);
});

// ============================================
// OPERATIONS (fake client)
// ============================================

function fakeClient(opts: { failText?: string } = {}) {
  const calls: Array<{ op: string; args: any[] }> = [];
  const store = new Map<number, any>([[1, structuredClone(card.checklists[1])]]);
  let nextId = 500;
  const client = {
    calls,
    async getCard(cardId: number) {
      calls.push({ op: 'getCard', args: [cardId] });
      return structuredClone(card);
    },
    async getChecklist(cardId: number, checklistId: number) {
      calls.push({ op: 'getChecklist', args: [cardId, checklistId] });
      return structuredClone(store.get(checklistId));
    },
    async createChecklist(cardId: number, body: any) {
      calls.push({ op: 'createChecklist', args: [cardId, body] });
      const created = { id: 9, name: body.name, sort_order: 3 };
      store.set(9, { ...created, items: [] });
      return created;
    },
    async addChecklistItem(cardId: number, checklistId: number, body: any) {
      calls.push({ op: 'addChecklistItem', args: [cardId, checklistId, body] });
      if (body.text === opts.failText) {
        throw Object.assign(new Error('Validation failed'), { status: 400 });
      }
      const item = { id: nextId++, checked: false, ...body };
      store.get(checklistId).items.push(item);
      return item;
    },
    async updateChecklistItem(cardId: number, checklistId: number, itemId: number, body: any) {
      calls.push({ op: 'updateChecklistItem', args: [cardId, checklistId, itemId, body] });
      return { id: itemId, text: 'x', ...body };
    },
  };
  return client;
}

test('appended items get increasing sort_order past the current last item', async () => {
  const client = fakeClient();
  const result = await appendChecklistItems(client as any, 100, 1, [{ text: 'c' }, { text: 'd' }]);
  const orders = client.calls.filter((c) => c.op === 'addChecklistItem').map((c) => c.args[2].sort_order);
  // Live items are at 1 and 2; the deleted one at 3 does not count.
  assert.deepEqual(orders, [3, 4]);
  assert.deepEqual(result.checklist.items.map((i) => i.text), ['a', 'b', 'c', 'd']);
  assert.deepEqual(result.failed, []);
});

test('a rejected item is reported and the rest are still added, in order', async () => {
  const client = fakeClient({ failText: 'bad' });
  const result = await appendChecklistItems(client as any, 100, 1, [{ text: 'c' }, { text: 'bad' }, { text: 'd' }]);
  assert.deepEqual(result.checklist.items.map((i) => i.text), ['a', 'b', 'c', 'd']);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].text, 'bad');
  assert.match(result.failed[0].error, /^400: /);
  // No gap where the failed item would have gone.
  const added = result.checklist.items.slice(2).map((i) => i.sort_order);
  assert.deepEqual(added, [3, 4]);
});

test('create with items numbers them from 1 without reading the empty checklist', async () => {
  const client = fakeClient();
  const result = await createChecklistWithItems(client as any, 100, 'QA', [{ text: 'smoke' }, { text: 'regress', checked: true }]);
  assert.equal(result.checklist.id, 9);
  assert.deepEqual(result.checklist.items.map((i) => [i.text, i.checked]), [['smoke', false], ['regress', true]]);
  const ops = client.calls.map((c) => c.op);
  assert.deepEqual(ops, ['createChecklist', 'addChecklistItem', 'addChecklistItem', 'getChecklist']);
  assert.deepEqual(client.calls[1].args[2], { text: 'smoke', sort_order: 1 });
});

test('create without items is one request', async () => {
  const client = fakeClient();
  const result = await createChecklistWithItems(client as any, 100, 'Empty', []);
  assert.equal(client.calls.length, 1);
  assert.equal(result.checklist.total, 0);
});

test('bulk check resolves each item to its own checklist from one card read', async () => {
  const client = fakeClient();
  const result = await updateChecklistItems(client as any, 100, [12, 21, 999], { checked: true });
  assert.equal(client.calls.filter((c) => c.op === 'getCard').length, 1);
  const patches = client.calls.filter((c) => c.op === 'updateChecklistItem').map((c) => c.args.slice(1, 3));
  assert.deepEqual(patches, [[1, 12], [2, 21]]);
  assert.equal(result.updated.length, 2);
  assert.deepEqual(result.failed, [{ item_id: 999, error: 'Item 999 is not on card 100' }]);
});

// ============================================
// SCHEMAS
// ============================================

test('items accept plain strings and objects, in order', () => {
  const parsed = CreateChecklistSchema.parse({ card_id: 1, name: 'QA', items: ['a', { text: 'b', checked: true }] });
  assert.deepEqual(parsed.items, [{ text: 'a' }, { text: 'b', checked: true }]);
  assert.deepEqual(CreateChecklistSchema.parse({ card_id: 1, name: 'QA' }).items, []);
});

test('adding items needs at least one; empty text and bad dates are rejected', () => {
  assert.throws(() => AddChecklistItemsSchema.parse({ card_id: 1, checklist_id: 2, items: [] }));
  assert.throws(() => AddChecklistItemsSchema.parse({ card_id: 1, checklist_id: 2, items: [''] }));
  assert.throws(() => AddChecklistItemsSchema.parse({ card_id: 1, checklist_id: 2, items: [{ text: 'a', due_date: '20.10.2026' }] }));
});

test('an item update must change something; null clears due date and responsible', () => {
  assert.throws(() => UpdateChecklistItemSchema.parse({ card_id: 1, item_id: 2 }), /at least one field/);
  const cleared = UpdateChecklistItemSchema.parse({ card_id: 1, item_id: 2, due_date: null, responsible_id: null });
  assert.equal(cleared.due_date, null);
  assert.equal(cleared.responsible_id, null);
  assert.equal(UpdateChecklistItemSchema.parse({ card_id: 1, item_id: 2, checked: false }).checked, false);
});

test('a checklist update must change something', () => {
  assert.throws(() => UpdateChecklistSchema.parse({ card_id: 1, checklist_id: 2 }), /name or sort_order/);
});
