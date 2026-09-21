import assert from 'node:assert/strict';
import test from 'node:test';

// card-ops pulls KAITEN_PAGE_SIZE out of kaiten-client, which validates the
// environment at import time. Fill it in before the module graph loads.
process.env.KAITEN_API_URL = process.env.KAITEN_API_URL || 'https://example.kaiten.ru/api/latest';
process.env.KAITEN_API_TOKEN = process.env.KAITEN_API_TOKEN || 'test-token-0123456789abcdef';
process.env.KAITEN_LOG_ENABLED = 'false';

const {
  addCardParticipant,
  bulkSetResponsible,
  bulkUpdateCards,
  findCardsByUser,
  listCardMembers,
  planReorder,
  planSortOrder,
  removeCardMember,
  setCardResponsible,
} = await import('./card-ops.js');

// ============================================
// ORDERING (pure)
// ============================================

const column = [
  { id: 10, sort_order: 1 },
  { id: 20, sort_order: 2 },
  { id: 30, sort_order: 3 },
];

test('placing a card before another lands between its neighbours', () => {
  const plan = planSortOrder(99, column, { before_card_id: 30 });
  assert.equal(plan.sort_order, 2.5);
  assert.deepEqual(plan.warnings, []);
});

test('placing a card after another lands between it and the next', () => {
  assert.equal(planSortOrder(99, column, { after_card_id: 10 }).sort_order, 1.5);
});

test('before the first / after the last steps outside the range', () => {
  assert.equal(planSortOrder(99, column, { before_card_id: 10 }).sort_order, 0);
  assert.equal(planSortOrder(99, column, { after_card_id: 30 }).sort_order, 4);
});

test('top and bottom are computed from the column, not invented', () => {
  assert.equal(planSortOrder(99, column, { position: 'top' }).sort_order, 0);
  assert.equal(planSortOrder(99, column, { position: 'bottom' }).sort_order, 4);
});

test('an explicit sort_order is passed through untouched', () => {
  assert.equal(planSortOrder(99, column, { sort_order: 42.5 }).sort_order, 42.5);
});

test('the card being moved is ignored when looking for neighbours', () => {
  // Card 20 moved before 30: its own slot must not become its own neighbour.
  assert.equal(planSortOrder(20, column, { before_card_id: 30 }).sort_order, 2);
});

test('cards sharing a sort_order make the position ambiguous, and it is said out loud', () => {
  const tied = [
    { id: 10, sort_order: 20 },
    { id: 20, sort_order: 20 },
    { id: 30, sort_order: 30 },
  ];
  const plan = planSortOrder(99, tied, { before_card_id: 20 });
  assert.equal(plan.warnings.length, 1);
  assert.match(plan.warnings[0], /share sort_order/);
  assert.match(plan.warnings[0], /kaiten_reorder_cards/);
});

test('an anchor from another column is an error, not a silent no-op', () => {
  assert.throws(() => planSortOrder(99, column, { before_card_id: 777 }), /not in the same column/);
});

test('an empty column falls back to 1 and says so', () => {
  const plan = planSortOrder(99, [], { position: 'top' });
  assert.equal(plan.sort_order, 1);
  assert.equal(plan.warnings.length, 1);
});

test('reordering reuses the slots the cards already occupy', () => {
  // Cards sitting at 47.98 / 49.11 / 50.37 keep those three positions, so
  // cards that were not listed do not get jumped over.
  const current = new Map<number, number>([[1, 49.11], [2, 47.98], [3, 50.37]]);
  assert.deepEqual(planReorder([3, 1, 2], current), [
    { card_id: 3, sort_order: 47.98 },
    { card_id: 1, sort_order: 49.11 },
    { card_id: 2, sort_order: 50.37 },
  ]);
});

test('start_at renumbers from scratch', () => {
  const current = new Map<number, number>([[1, 49.11], [2, 47.98]]);
  assert.deepEqual(planReorder([1, 2], current, { start_at: 10, step: 5 }), [
    { card_id: 1, sort_order: 10 },
    { card_id: 2, sort_order: 15 },
  ]);
});

test('a card with no known slot degrades to a clean sequence', () => {
  const current = new Map<number, number | undefined>([[1, 5], [2, undefined]]);
  assert.deepEqual(planReorder([2, 1], current), [
    { card_id: 2, sort_order: 5 },
    { card_id: 1, sort_order: 6 },
  ]);
});

// ============================================
// MEMBERS (fake client)
// ============================================

interface Call { method: string; args: any[] }

function fakeClient(state: {
  members?: any[];
  onPost?: (userId: number, type: number, members: any[]) => any[];
  onPatch?: (userId: number, type: number, members: any[]) => any[];
  cards?: Record<number, any>;
  pages?: any[][];
  failFor?: number[];
}) {
  const calls: Call[] = [];
  let members = state.members ? [...state.members] : [];
  const client: any = {
    calls,
    getCardMembers: async () => {
      calls.push({ method: 'getCardMembers', args: [] });
      return members.map((m) => ({ ...m }));
    },
    addCardMember: async (cardId: number, userId: number, type: number) => {
      calls.push({ method: 'addCardMember', args: [cardId, userId, type] });
      members = state.onPost
        ? state.onPost(userId, type, members)
        : [...members.filter((m) => m.id !== userId), { id: userId, full_name: `User ${userId}`, type }];
      return members.find((m) => m.id === userId);
    },
    updateCardMember: async (cardId: number, userId: number, type: number) => {
      calls.push({ method: 'updateCardMember', args: [cardId, userId, type] });
      members = state.onPatch
        ? state.onPatch(userId, type, members)
        : members.map((m) => (m.id === userId ? { ...m, type } : m));
      return members.find((m) => m.id === userId);
    },
    removeCardMember: async (cardId: number, userId: number) => {
      calls.push({ method: 'removeCardMember', args: [cardId, userId] });
      members = members.filter((m) => m.id !== userId);
    },
    updateCard: async (cardId: number, params: any) => {
      calls.push({ method: 'updateCard', args: [cardId, params] });
      if (state.failFor?.includes(cardId)) {
        const error: any = new Error('Kaiten server error');
        error.status = 500;
        throw error;
      }
      return { id: cardId, ...(state.cards?.[cardId] || {}), ...params };
    },
    searchCards: async (params: any) => {
      calls.push({ method: 'searchCards', args: [params] });
      const page = (state.pages || []).shift() || [];
      return page;
    },
  };
  return client;
}

test('assigning a responsible repairs the role when POST ignored the type', () => {
  // The trap from the live API: POST {type: 2} stores type 1.
  return (async () => {
    const client = fakeClient({
      members: [],
      onPost: (userId) => [{ id: userId, full_name: 'New Person', type: 1 }],
    });
    const result = await setCardResponsible(client, 555, 77);

    const methods = client.calls.map((c: Call) => c.method);
    assert.deepEqual(methods, [
      'getCardMembers',
      'addCardMember',
      'getCardMembers',
      'updateCardMember',
      'getCardMembers',
    ]);
    assert.deepEqual(client.calls[3].args, [555, 77, 2]);
    assert.equal(result.responsible?.id, 77);
    assert.equal(result.responsible?.role, 'responsible');
    assert.deepEqual(result.warnings, []);
  })();
});

test('a new responsible reports who was demoted, without PATCHing them down', async () => {
  const client = fakeClient({
    members: [{ id: 11, full_name: 'Old Person', type: 2 }],
    // Kaiten demotes the previous responsible by itself.
    onPost: (userId, type, members) => [
      ...members.map((m) => (m.type === 2 ? { ...m, type: 1 } : m)),
      { id: userId, full_name: 'New Person', type },
    ],
  });
  const result = await setCardResponsible(client, 555, 77);

  assert.equal(result.responsible?.id, 77);
  assert.equal(result.demoted?.id, 11);
  assert.equal(result.demoted?.role, 'member');
  // The explicit demotion PATCH answers 400 "Member.type should be >= 2",
  // so it must never be attempted.
  assert.equal(
    client.calls.some((c: Call) => c.method === 'updateCardMember' && c.args[1] === 11),
    false
  );
});

test('assigning the person who is already responsible changes nothing', async () => {
  const client = fakeClient({ members: [{ id: 77, full_name: 'Same Person', type: 2 }] });
  const result = await setCardResponsible(client, 555, 77);
  assert.deepEqual(client.calls.map((c: Call) => c.method), ['getCardMembers']);
  assert.equal(result.responsible?.id, 77);
  assert.equal(result.demoted, null);
});

test('a user who never becomes a member is an error, not a success', async () => {
  const client = fakeClient({ members: [], onPost: (_u, _t, members) => members });
  await assert.rejects(setCardResponsible(client, 555, 77), /not a member of card 555/);
});

test('adding a plain member reports the promotion Kaiten does behind your back', async () => {
  // Verified live: POST {type: 1} to a card with no responsible yields type 2,
  // and PATCHing back down is rejected.
  const client = fakeClient({
    members: [],
    onPost: (userId) => [{ id: userId, full_name: 'Someone', type: 2 }],
  });
  const result = await addCardParticipant(client, 555, 77);
  assert.equal(result.responsible?.id, 77);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /RESPONSIBLE/);
  assert.equal(client.calls.some((c: Call) => c.method === 'updateCardMember'), false);
});

test('adding a plain member to a card that already has a responsible is quiet', async () => {
  const client = fakeClient({ members: [{ id: 11, full_name: 'Boss', type: 2 }] });
  const result = await addCardParticipant(client, 555, 77);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.responsible?.id, 11);
  assert.equal(result.members.find((m) => m.id === 77)?.role, 'member');
});

test('removing a member reads the list back', async () => {
  const client = fakeClient({ members: [{ id: 77, full_name: 'Someone', type: 2 }] });
  const result = await removeCardMember(client, 555, 77);
  assert.deepEqual(result.members, []);
  assert.equal(result.responsible, null);
  assert.deepEqual(result.warnings, []);
});

test('listing members marks exactly one responsible', async () => {
  const client = fakeClient({
    members: [
      { id: 11, full_name: 'A', type: 1 },
      { id: 22, full_name: 'B', type: 2 },
    ],
  });
  const result = await listCardMembers(client, 555);
  assert.equal(result.responsible?.id, 22);
  assert.deepEqual(result.members.map((m) => m.role), ['member', 'responsible']);
});

// ============================================
// BULK
// ============================================

test('a failing card does not take the rest of the batch down', async () => {
  const client = fakeClient({ failFor: [2] });
  const result = await bulkUpdateCards(client, [1, 2, 3], { column_id: 9 });
  assert.equal(result.updated, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.results.find((r) => r.card_id === 2)?.ok, false);
  assert.match(result.results.find((r) => r.card_id === 2)!.error!, /500/);
});

test('a state that did not stick is reported, because Kaiten answers 200 anyway', async () => {
  const client = fakeClient({ cards: { 1: { state: 1 } } });
  // The fake echoes the patch, so force the mismatch the API produces when the
  // column is not a done column.
  client.updateCard = async (cardId: number) => ({ id: cardId, state: 1 });
  const result = await bulkUpdateCards(client, [1], { state: 3 });
  assert.equal(result.updated, 1);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /state is 1, not 3/);
  assert.match(result.warnings[0], /column type/);
});

test('a size_text that did not stick is reported', async () => {
  const client = fakeClient({});
  client.updateCard = async (cardId: number) => ({ id: cardId, size_text: null });
  const result = await bulkUpdateCards(client, [1], { size_text: '8 ч' });
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /size_text came back as null/);
});

test('bulk responsible runs the full dance per card and isolates failures', async () => {
  const perCard = new Map<number, any[]>([[1, []], [2, []], [3, []]]);
  const client: any = {
    getCardMembers: async (cardId: number) => [...(perCard.get(cardId) || [])],
    addCardMember: async (cardId: number, userId: number, type: number) => {
      if (cardId === 2) {
        // The card exists, but POST is refused — PATCH still works.
        const error: any = new Error('space.card.update permission is required');
        error.status = 400;
        throw error;
      }
      if (cardId === 3) {
        const error: any = new Error('Card not found');
        error.status = 404;
        throw error;
      }
      perCard.set(cardId, [{ id: userId, full_name: 'X', type }]);
      return {};
    },
    updateCardMember: async (cardId: number, userId: number, type: number) => {
      if (cardId === 3) {
        const error: any = new Error('Card not found');
        error.status = 404;
        throw error;
      }
      perCard.set(cardId, [{ id: userId, full_name: 'X', type }]);
      return {};
    },
  };

  const result = await bulkSetResponsible(client, [1, 2, 3], 77);
  assert.equal(result.updated, 2);
  assert.equal(result.failed, 1);

  // Card 2's POST failed but the PATCH fallback made the role stick, and the
  // warning survives into the answer instead of being swallowed.
  const second = result.results.find((r) => r.card_id === 2)!;
  assert.equal(second.ok, true);
  assert.equal(second.responsible?.id, 77);
  assert.match(second.warnings!.join(' '), /permission is required/);

  const third = result.results.find((r) => r.card_id === 3)!;
  assert.equal(third.ok, false);
  assert.match(third.error!, /404: Card not found/);
});

// ============================================
// CARDS BY PERSON
// ============================================

function cardWith(id: number, members: Array<{ id: number; type: number }>, ownerId = 1) {
  return { id, title: `Card ${id}`, owner_id: ownerId, members };
}

test('"responsible" filters on member type, which the API cannot do server side', async () => {
  const page = [
    cardWith(1, [{ id: 77, type: 2 }]),
    cardWith(2, [{ id: 77, type: 1 }]),
    cardWith(3, [{ id: 77, type: 2 }, { id: 88, type: 1 }]),
    cardWith(4, [{ id: 88, type: 2 }]),
  ];
  const client = fakeClient({ pages: [page] });
  const result = await findCardsByUser(client, { user_id: 77, role: 'responsible', limit: 10 });

  assert.deepEqual(result.cards.map((c) => c.id), [1, 3]);
  assert.equal(result.scanned, 4);
  assert.equal(result.has_more, false);
  // The server-side filter must still be member_ids — that part Kaiten can do.
  assert.equal(client.calls[0].args[0].member_ids, '77');
});

test('role "member" excludes the responsible, "any" keeps both', async () => {
  const page = () => [cardWith(1, [{ id: 77, type: 2 }]), cardWith(2, [{ id: 77, type: 1 }])];

  const asMember = await findCardsByUser(fakeClient({ pages: [page()] }), {
    user_id: 77, role: 'member', limit: 10,
  });
  assert.deepEqual(asMember.cards.map((c) => c.id), [2]);

  const asAny = await findCardsByUser(fakeClient({ pages: [page()] }), {
    user_id: 77, role: 'any', limit: 10,
  });
  assert.deepEqual(asAny.cards.map((c) => c.id), [1, 2]);
});

test('role "owner" uses the server-side owner_id filter', async () => {
  const client = fakeClient({ pages: [[cardWith(1, [], 77), cardWith(2, [], 5)]] });
  const result = await findCardsByUser(client, { user_id: 77, role: 'owner', limit: 10 });
  assert.deepEqual(result.cards.map((c) => c.id), [1]);
  assert.equal(client.calls[0].args[0].owner_id, 77);
  assert.equal(client.calls[0].args[0].member_ids, undefined);
});

test('a scan that stopped early resumes at the first card it did not return', async () => {
  // A full page of 100 means the API had more to give. The 90 matches found in
  // that page beyond the limit must not be skipped by the follow-up call, so
  // next_offset is the position of the 11th match, not the end of the page.
  const full = (offset: number) =>
    Array.from({ length: 100 }, (_, i) => cardWith(offset + i, [{ id: 77, type: 2 }]));
  const client = fakeClient({ pages: [full(1), full(101), full(201)] });

  const result = await findCardsByUser(client, { user_id: 77, role: 'responsible', limit: 10 });
  assert.equal(result.cards.length, 10);
  assert.equal(result.has_more, true);
  assert.equal(result.next_offset, 10);
  assert.equal(result.requests, 1);
});

test('resuming skips nothing when the matches are scattered through the page', async () => {
  // Every third card matches: the 11th match sits at raw offset 30.
  const page = Array.from({ length: 100 }, (_, i) =>
    cardWith(i + 1, i % 3 === 0 ? [{ id: 77, type: 2 }] : [{ id: 88, type: 2 }])
  );
  const client = fakeClient({ pages: [page, []] });

  const result = await findCardsByUser(client, { user_id: 77, role: 'responsible', limit: 10 });
  assert.deepEqual(result.cards.map((c) => c.id), [1, 4, 7, 10, 13, 16, 19, 22, 25, 28]);
  assert.equal(result.has_more, true);
  assert.equal(result.next_offset, 30, 'card 31 is the first match that was not returned');
});

test('a scan continued from next_offset picks up where the last one stopped', async () => {
  const page = Array.from({ length: 100 }, (_, i) => cardWith(i + 1, [{ id: 77, type: 2 }]));
  const client = fakeClient({ pages: [page.slice(10)] });

  const result = await findCardsByUser(client, { user_id: 77, role: 'responsible', limit: 10, skip: 10 });
  assert.deepEqual(result.cards.map((c) => c.id), [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  assert.equal(client.calls[0].args[0].skip, 10);
});

test('hitting the scan cap is reported as has_more, not as the end of the list', async () => {
  // 100 cards read, none of them matching, cap reached: the honest answer is
  // "nothing found so far", not "nothing exists".
  const page = Array.from({ length: 100 }, (_, i) => cardWith(i + 1, [{ id: 88, type: 2 }]));
  const client = fakeClient({ pages: [page, page] });

  const result = await findCardsByUser(client, { user_id: 77, role: 'responsible', limit: 10, max_scan: 100 });
  assert.equal(result.cards.length, 0);
  assert.equal(result.scanned, 100);
  assert.equal(result.has_more, true);
  assert.equal(result.next_offset, 100);
});

test('a short page ends the scan honestly', async () => {
  const client = fakeClient({ pages: [[cardWith(1, [{ id: 77, type: 2 }])]] });
  const result = await findCardsByUser(client, { user_id: 77, role: 'responsible', limit: 10 });
  assert.equal(result.has_more, false);
  assert.equal(result.next_offset, null);
});

test('a role that did not stick is an error, not a success naming the old owner', async () => {
  // Kaiten keeps the user at type 1 whatever we do: reporting the previous
  // responsible as "responsible" would be a lie, and a bulk run would count
  // the card as assigned.
  const client = fakeClient({
    members: [{ id: 11, full_name: 'Old Person', type: 2 }],
    onPost: (userId, _type, members) => [...members, { id: userId, full_name: 'New Person', type: 1 }],
    onPatch: (_userId, _type, members) => members,
  });
  await assert.rejects(setCardResponsible(client, 555, 77), /kept user 77 at member type 1/);
});

test('a member that never appeared is an error too', async () => {
  const client = fakeClient({ members: [], onPost: (_u, _t, members) => members });
  await assert.rejects(addCardParticipant(client, 555, 77), /not a member of card 555/);
});

test('a POST failure that is not a duplicate is not downgraded to a warning', async () => {
  const client = fakeClient({ members: [] });
  client.addCardMember = async () => {
    const error: any = new Error('Card not found');
    error.status = 404;
    throw error;
  };
  await assert.rejects(setCardResponsible(client, 555, 77), /Card not found/);
});

test('neighbours too close to split are reported instead of silently colliding', () => {
  const tight = [
    { id: 10, sort_order: 1 },
    { id: 20, sort_order: 1 + Number.EPSILON },
  ];
  const plan = planSortOrder(99, tight, { before_card_id: 20 });
  assert.equal(plan.warnings.length, 1);
  assert.match(plan.warnings[0], /too close to insert between/);
});

test('trimming matches off a fully read list still counts as has_more', async () => {
  // The whole list fits in one short page, but more cards matched than the
  // caller asked for: claiming the answer is complete would hide them.
  const page = Array.from({ length: 32 }, (_, i) => cardWith(i + 1, [{ id: 77, type: 2 }]));
  const client = fakeClient({ pages: [page] });

  const result = await findCardsByUser(client, { user_id: 77, role: 'responsible', limit: 3 });
  assert.equal(result.cards.length, 3);
  assert.equal(result.scanned, 32);
  assert.equal(result.has_more, true, '32 cards matched, 3 were returned');
  assert.equal(result.next_offset, 3);
});

test('a list that fits entirely inside the limit reports no more', async () => {
  const page = Array.from({ length: 5 }, (_, i) => cardWith(i + 1, [{ id: 77, type: 2 }]));
  const client = fakeClient({ pages: [page] });

  const result = await findCardsByUser(client, { user_id: 77, role: 'responsible', limit: 10 });
  assert.equal(result.cards.length, 5);
  assert.equal(result.has_more, false);
  assert.equal(result.next_offset, null);
});
