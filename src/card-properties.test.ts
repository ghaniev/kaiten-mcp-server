import assert from 'node:assert/strict';
import test from 'node:test';
import { PropertyResolver, parsePropertyKey } from './card-properties.js';

const DEFINITIONS = [
  { id: 1, name: 'Version', type: 'select', multi_select: false },
  { id: 2, name: 'Regions', type: 'select', multi_select: true },
  { id: 3, name: 'Reviewer', type: 'user' },
  { id: 4, name: 'QA date', type: 'date' },
  { id: 5, name: 'Link', type: 'string' },
  { id: 6, name: 'Budget', type: 'number' },
  { id: 7, name: 'Approved', type: 'checkbox' },
  { id: 8, name: 'Template', type: 'string' },
  { id: 9, name: 'Template', type: 'select', multi_select: false },
];

const OPTIONS: Record<number, Array<{ id: number; value: string }>> = {
  1: [{ id: 101, value: '1.0.0' }],
  2: [{ id: 201, value: 'North' }, { id: 202, value: 'South' }],
  9: [{ id: 901, value: 'Standard' }],
};

function fakeSource(opts: { failDefinitions?: boolean } = {}) {
  const calls = { definitions: [] as number[][], options: [] as Array<[number, number[]]>, users: [] as number[][] };
  return {
    calls,
    async getCustomProperties(ids: number[]) {
      calls.definitions.push(ids);
      if (opts.failDefinitions) throw new Error('boom');
      // Like the API: ids the token cannot see are simply not returned.
      return DEFINITIONS.filter((d) => ids.includes(d.id)) as any;
    },
    async getCustomPropertySelectValues(propertyId: number, ids: number[]) {
      calls.options.push([propertyId, ids]);
      return (OPTIONS[propertyId] || []).filter((o) => ids.includes(o.id));
    },
    async getUsersByIds(ids: number[]) {
      calls.users.push(ids);
      return [{ id: 1001, full_name: 'Jane Doe' }].filter((u) => ids.includes(u.id)) as any;
    },
  };
}

test('property keys parse to ids; anything else is not a property', () => {
  assert.equal(parsePropertyKey('id_101'), 101);
  assert.equal(parsePropertyKey('101'), null);
  assert.equal(parsePropertyKey('id_abc'), null);
});

test('every live value shape resolves to something readable', async () => {
  const resolver = new PropertyResolver(fakeSource());
  const result = await resolver.resolve({
    id_1: [101],
    id_2: [201, 202],
    id_3: [{ id: 42, full_name: 'Jane Doe', avatar_initials_url: 'data:image/png;base64,AAAA' }],
    id_4: { date: '2026-06-12', time: null, tzOffset: null },
    id_5: 'https://example.com/pr/1',
    id_6: 1500,
    id_7: true,
  });
  assert.deepEqual(result, {
    'Version': '1.0.0',
    'Regions': ['North', 'South'],
    'Reviewer': 'Jane Doe',
    'QA date': '2026-06-12',
    'Link': 'https://example.com/pr/1',
    'Budget': 1500,
    'Approved': true,
  });
});

test('a user field holding bare ids (GET /cards/{id}) resolves names, deactivated users included', async () => {
  const source = fakeSource();
  const resolver = new PropertyResolver(source);
  assert.deepEqual(await resolver.resolve({ id_3: [1001] }), { 'Reviewer': 'Jane Doe' });
  assert.deepEqual(await resolver.resolve({ id_3: [1001, 5] }), { 'Reviewer': ['Jane Doe', 'user 5'] });
  // 1001 is cached; only 5 is asked again.
  assert.deepEqual(source.calls.users, [[1001], [5]]);
});

test('a property the token cannot see keeps its raw key, minus avatars', async () => {
  const resolver = new PropertyResolver(fakeSource());
  const result = await resolver.resolve({ id_1: [101], id_4040: [{ id: 1, avatar_initials_url: 'x', full_name: 'A' }] });
  assert.equal(result['Version'], '1.0.0');
  assert.deepEqual(result.id_4040, [{ id: 1, full_name: 'A' }]);
});

test('an unknown select option is shown by id instead of disappearing', async () => {
  const resolver = new PropertyResolver(fakeSource());
  assert.deepEqual(await resolver.resolve({ id_1: [999] }), { 'Version': '#999' });
});

test('two fields with the same name both survive', async () => {
  const resolver = new PropertyResolver(fakeSource());
  const result = await resolver.resolve({ id_8: 'text', id_9: [901] });
  assert.deepEqual(result, { 'Template': 'text', 'Template (id 9)': 'Standard' });
});

test('definitions and options are cached, including the ones that were not found', async () => {
  const source = fakeSource();
  const resolver = new PropertyResolver(source);
  await resolver.resolve({ id_1: [101], id_4040: [1] });
  await resolver.resolve({ id_1: [101], id_4040: [1] });
  assert.equal(source.calls.definitions.length, 1);
  assert.equal(source.calls.options.length, 1);
  // Only what is new is asked for.
  await resolver.resolve({ id_2: [201] });
  assert.deepEqual(source.calls.definitions[1], [2]);
});

test('invalidate forgets everything', async () => {
  const source = fakeSource();
  const resolver = new PropertyResolver(source);
  await resolver.resolve({ id_1: [101] });
  resolver.invalidate();
  await resolver.resolve({ id_1: [101] });
  assert.equal(source.calls.definitions.length, 2);
});

test('a failed definitions request degrades to raw keys instead of failing the card', async () => {
  const resolver = new PropertyResolver(fakeSource({ failDefinitions: true }));
  assert.deepEqual(await resolver.resolve({ id_1: [101] }), { id_1: [101] });
});

test('no properties is an empty object, not an error', async () => {
  const resolver = new PropertyResolver(fakeSource());
  assert.deepEqual(await resolver.resolve(undefined), {});
  assert.deepEqual(await resolver.resolve({ id_1: null }), {});
});
