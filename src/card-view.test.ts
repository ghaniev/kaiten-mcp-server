import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cardUrl,
  describeState,
  findResponsible,
  projectCard,
  projectBoard,
  projectCardBrief,
  projectKaitenUser,
  projectCards,
  projectMember,
  renderCardLine,
  stripAvatars,
  webBaseUrl,
} from './card-view.js';

const ctx = { baseUrl: 'https://acme.kaiten.ru', defaultSpaceId: 792695 };

// An avatar on a real card is a ~2 KB base64 data URI, carried by the owner,
// by every member, and again by every member of every child card.
const AVATAR = 'data:image/png;base64,' + 'A'.repeat(1900);

function user(id: number, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    uid: `uid-${id}`,
    full_name: name,
    email: `${name.toLowerCase().replace(' ', '.')}@example.com`,
    username: name.toLowerCase().replace(' ', '_'),
    avatar_initials_url: AVATAR,
    avatar_uploaded_url: 'https://files.kaiten.ru/' + 'b'.repeat(60),
    initials: 'XX',
    avatar_type: 3,
    lng: 'ru',
    timezone: 'UTC',
    theme: 'dark',
    activated: true,
    ...extra,
  };
}

function childCard(id: number) {
  return {
    id,
    title: `Child ${id}`,
    state: 1,
    board_id: 1708030,
    column_id: 5904902,
    sort_order: id,
    owner: user(959050, 'Owner Person'),
    members: [user(1009880, 'Member Person', { card_id: id, user_id: 1009880, type: 2 })],
    path_data: { some: 'breadcrumbs'.repeat(40) },
  };
}

const rawCard: any = {
  id: 63413390,
  uid: 'card-uid',
  title: 'Камера: скорость возврата',
  description: 'Полное описание карточки, которое обычно занимает несколько килобайт.',
  state: 2,
  board_id: 1708030,
  column_id: 5904903,
  lane_id: 2129734,
  owner_id: 959050,
  type_id: 77,
  size: 8,
  size_unit: 'ч',
  size_text: '8 ч',
  sort_order: 12.5,
  asap: true,
  blocked: true,
  archived: false,
  due_date: '2026-10-01T12:00:00.000Z',
  updated: '2026-09-20T09:00:00.000Z',
  parents_count: 1,
  children_count: 6,
  children_done: 2,
  space_id: 792695,
  owner: user(959050, 'Owner Person'),
  board: { id: 1708030, title: 'Flutter WiP', space_id: 792695 },
  column: { id: 5904903, title: 'In progress' },
  lane: { id: 2129734, title: 'Default' },
  type: { id: 77, name: 'Task' },
  tags: [{ name: 'flutter' }, { name: 'camera' }],
  members: [
    user(1009880, 'Gadel Zagrutdinov', { card_id: 63413390, user_id: 1009880, type: 2 }),
    user(1008106, 'Ilya Kotelnikov', { card_id: 63413390, user_id: 1008106, type: 1 }),
  ],
  children: [childCard(1), childCard(2), childCard(3)],
  parents: [childCard(9)],
  path_data: { breadcrumbs: 'x'.repeat(1800) },
};

test('the projection is an order of magnitude smaller than the raw card', () => {
  const rawBytes = JSON.stringify(rawCard).length;
  const projectedBytes = JSON.stringify(projectCard(rawCard, ctx)).length;

  assert.ok(rawBytes > 20000, `fixture should be realistically heavy, got ${rawBytes}`);
  assert.ok(
    projectedBytes < 1000,
    `projection should stay under 1 KB, got ${projectedBytes}`
  );
  assert.ok(rawBytes / projectedBytes > 20, `expected a 20x cut, got ${(rawBytes / projectedBytes).toFixed(1)}x`);
});

test('no avatar ever reaches the answer, in any mode', () => {
  const projected = JSON.stringify(projectCard(rawCard, ctx, { description: true }));
  assert.equal(projected.includes('data:image'), false);
  assert.equal(projected.includes('avatar'), false);

  // verbose mode keeps the whole object but still drops avatars, including the
  // ones nested in children and parents.
  const verbose = JSON.stringify(stripAvatars(rawCard));
  assert.equal(verbose.includes('data:image'), false);
  assert.equal(verbose.includes('avatar_uploaded_url'), false);
  assert.equal(verbose.includes('files.kaiten.ru'), false);
  // ...and keeps the fields that are the point of asking for verbose
  assert.ok(verbose.includes('"children"'));
  assert.ok(verbose.includes('Gadel Zagrutdinov'));
});

test('the responsible is the member with type 2, not the owner', () => {
  const projected = projectCard(rawCard, ctx);
  assert.deepEqual(projected.responsible, { id: 1009880, full_name: 'Gadel Zagrutdinov' });
  assert.deepEqual(projected.owner, { id: 959050, full_name: 'Owner Person' });
  assert.deepEqual(
    projected.members.map((m) => [m.id, m.role]),
    [[1009880, 'responsible'], [1008106, 'member']]
  );
  assert.deepEqual(findResponsible(rawCard), { id: 1009880, full_name: 'Gadel Zagrutdinov' });
});

test('a card without a responsible reports null instead of guessing', () => {
  const card = { ...rawCard, members: [rawCard.members[1]] };
  assert.equal(projectCard(card, ctx).responsible, null);
  assert.equal(findResponsible(card), null);
  assert.equal(findResponsible({ id: 1, title: 'x' }), null);
});

test('the projection carries what a move or a report needs', () => {
  const p = projectCard(rawCard, ctx);
  assert.equal(p.id, 63413390);
  assert.equal(p.board.id, 1708030);
  assert.equal(p.board.title, 'Flutter WiP');
  assert.equal(p.column.id, 5904903);
  assert.equal(p.column.title, 'In progress');
  assert.equal(p.lane.id, 2129734);
  assert.equal(p.state, 2);
  assert.equal(p.state_name, 'in_progress');
  assert.equal(p.due_date, '2026-10-01T12:00:00.000Z');
  assert.equal(p.size_text, '8 ч');
  assert.equal(p.sort_order, 12.5);
  assert.equal(p.blocked, true);
  assert.equal(p.asap, true);
  assert.equal(p.parents_count, 1);
  assert.equal(p.children_count, 6);
  assert.equal(p.children_done, 2);
  assert.deepEqual(p.tags, ['flutter', 'camera']);
  assert.equal(p.url, 'https://acme.kaiten.ru/space/792695/card/63413390');
});

test('description is opt-in: it can be tens of KB on its own', () => {
  assert.equal('description' in projectCard(rawCard, ctx), false);
  assert.equal(projectCard(rawCard, ctx, { description: true }).description, rawCard.description);
});

test('card URL falls back from space_id to the board space to the default', () => {
  assert.equal(cardUrl({ id: 5, space_id: 1 } as any, ctx), 'https://acme.kaiten.ru/space/1/card/5');
  assert.equal(
    cardUrl({ id: 5, board: { id: 2, title: 'b', space_id: 42 } } as any, ctx),
    'https://acme.kaiten.ru/space/42/card/5'
  );
  assert.equal(cardUrl({ id: 5 } as any, ctx), 'https://acme.kaiten.ru/space/792695/card/5');
});

test('web base url is the api url without /api/latest', () => {
  assert.equal(webBaseUrl('https://acme.kaiten.ru/api/latest'), 'https://acme.kaiten.ru');
  assert.equal(webBaseUrl('https://acme.kaiten.ru/api/latest/'), 'https://acme.kaiten.ru');
});

test('member role names follow the type, unknown types default to member', () => {
  assert.equal(projectMember({ id: 1, type: 2 }).role, 'responsible');
  assert.equal(projectMember({ id: 1, type: 1 }).role, 'member');
  assert.equal(projectMember({ id: 1 }).role, 'member');
  assert.equal(projectMember({ user_id: 7, type: 2 }).id, 7);
});

test('state names cover the three Kaiten states', () => {
  assert.equal(describeState(1), 'queued');
  assert.equal(describeState(2), 'in_progress');
  assert.equal(describeState(3), 'done');
  assert.equal(describeState(undefined), 'unknown');
  assert.equal(describeState(9), 'unknown(9)');
});

test('list lines carry id, place, responsible and url', () => {
  const line = renderCardLine(projectCard(rawCard, ctx), 0);
  assert.match(line, /1\. \[#63413390\]/);
  assert.match(line, /Flutter WiP › In progress/);
  assert.match(line, /responsible: Gadel Zagrutdinov/);
  assert.match(line, /https:\/\/acme\.kaiten\.ru\/space\/792695\/card\/63413390/);
  assert.equal(line.includes('data:image'), false);
});

test('projectCards keeps order and survives empty input', () => {
  assert.deepEqual(projectCards([], ctx), []);
  const many = projectCards([rawCard, { ...rawCard, id: 2, title: 'second' }], ctx);
  assert.deepEqual(many.map((c) => c.id), [63413390, 2]);
});

test('the brief form is what bulk answers carry: verifiable but tiny', () => {
  const brief = projectCardBrief(rawCard);
  assert.equal(brief.id, 63413390);
  assert.equal(brief.state_name, 'in_progress');
  assert.equal(brief.column_id, 5904903);
  assert.equal(brief.responsible_id, 1009880);
  assert.equal(brief.size_text, '8 ч');
  assert.equal(brief.due_date, '2026-10-01T12:00:00.000Z');
  assert.ok(JSON.stringify(brief).length < 300, JSON.stringify(brief).length + ' bytes');
});

test('a board comes back without the cards Kaiten embeds in it', () => {
  // GET /boards/{id} inlines every card of the board: 2.7 MB on 43 cards.
  const board = {
    id: 1708030,
    title: 'Flutter WiP',
    description: null,
    locked: false,
    columns: [{ id: 1, title: 'To do', type: 1, sort_order: 1, extra: 'junk' }],
    lanes: [{ id: 2, title: 'Default', sort_order: 1, extra: 'junk' }],
    cards: [rawCard, rawCard, rawCard],
  };
  const projected = projectBoard(board);
  assert.equal(projected.cards_total, 3);
  assert.equal('cards' in projected, false);
  assert.deepEqual(projected.columns, [{ id: 1, title: 'To do', type: 1, sort_order: 1 }]);
  assert.ok(JSON.stringify(projected).length < 400);
});

test('a user comes back as an identity, not a permission matrix', () => {
  const projected = projectKaitenUser(user(1, 'Some One', { permissions: { a: 1 }, role: 3 }));
  assert.deepEqual(Object.keys(projected).sort(), ['activated', 'email', 'full_name', 'id', 'username']);
  assert.equal(JSON.stringify(projected).includes('avatar'), false);
});
