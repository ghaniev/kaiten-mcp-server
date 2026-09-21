import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AddCardChildSchema,
  BlockCardSchema,
  BulkMoveCardsSchema,
  BulkSetDueDateSchema,
  CreateCardSchema,
  FindCardsByUserSchema,
  RemoveCardChildSchema,
  ReorderCardsSchema,
  SetCardOrderSchema,
  SetCardResponsibleSchema,
  UnblockCardSchema,
  UpdateBoardSchema,
  UpdateCardSchema,
} from './schemas.js';

test('moving a card to another board demands a column from that board', () => {
  // Kaiten answers 400 to board_id alone, because the old column belongs to the
  // old board. Verified against the live API, so the check lives here instead.
  const withoutColumn = UpdateCardSchema.safeParse({ card_id: 1, board_id: 2 });
  assert.equal(withoutColumn.success, false);
  assert.match(withoutColumn.error!.issues[0].message, /column_id is required/);

  const withColumn = UpdateCardSchema.safeParse({ card_id: 1, board_id: 2, column_id: 3 });
  assert.equal(withColumn.success, true);
});

test('a column alone is still a plain move inside one board', () => {
  const result = UpdateCardSchema.safeParse({ card_id: 1, column_id: 3 });
  assert.equal(result.success, true);
});

test('owner cannot be cleared: the API requires an integer', () => {
  // Kaiten: "Card.owner_id should be integer". Reassigning is the only option,
  // so null must not look like a supported way to unassign.
  const result = UpdateCardSchema.safeParse({ card_id: 1, owner_id: null });
  assert.equal(result.success, false);
});

test('subtask link needs both ends and rejects stray keys', () => {
  assert.equal(AddCardChildSchema.safeParse({ card_id: 1, child_id: 2 }).success, true);
  assert.equal(AddCardChildSchema.safeParse({ card_id: 1 }).success, false);
  assert.equal(RemoveCardChildSchema.safeParse({ card_id: 1, child_id: 2 }).success, true);

  // Guards against the parent/child pair being passed under invented names.
  assert.equal(AddCardChildSchema.safeParse({ card_id: 1, child_id: 2, parent_id: 3 }).success, false);
});

test('subtask ids must be positive integers', () => {
  assert.equal(AddCardChildSchema.safeParse({ card_id: 1, child_id: 0 }).success, false);
  assert.equal(AddCardChildSchema.safeParse({ card_id: 1, child_id: -5 }).success, false);
  assert.equal(AddCardChildSchema.safeParse({ card_id: 1, child_id: 1.5 }).success, false);
});

test('a due date can be cleared with null, unlike an owner', () => {
  // The API accepts due_date: null and rejects owner_id: null.
  assert.equal(UpdateCardSchema.safeParse({ card_id: 1, due_date: null }).success, true);
  assert.equal(UpdateCardSchema.safeParse({ card_id: 1, due_date: '2026-10-01T12:00:00Z' }).success, true);
  assert.equal(UpdateCardSchema.safeParse({ card_id: 1, owner_id: null }).success, false);
});

test('estimates are accepted as size_text, the field Kaiten actually stores', () => {
  assert.equal(UpdateCardSchema.safeParse({ card_id: 1, size_text: '8 ч' }).success, true);
  assert.equal(CreateCardSchema.safeParse({ title: 'x', board_id: 1, size_text: '8 ч' }).success, true);
});

test('a card can be created with an assignee, which is a member and not the owner', () => {
  const parsed = CreateCardSchema.safeParse({
    title: 'x', board_id: 1, owner_id: 5, responsible_id: 7, member_ids: [8, 9],
  });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data!.responsible_id, 7);
  assert.deepEqual(parsed.data!.member_ids, [8, 9]);
});

test('responsible tools want both ends and nothing else', () => {
  assert.equal(SetCardResponsibleSchema.safeParse({ card_id: 1, user_id: 2 }).success, true);
  assert.equal(SetCardResponsibleSchema.safeParse({ card_id: 1 }).success, false);
  assert.equal(SetCardResponsibleSchema.safeParse({ card_id: 1, user_id: 2, type: 2 }).success, false);
});

test('blocking takes exactly one of reason or blocker card', () => {
  assert.equal(BlockCardSchema.safeParse({ card_id: 1, reason: 'ждём' }).success, true);
  assert.equal(BlockCardSchema.safeParse({ card_id: 1, blocker_card_id: 2 }).success, true);
  assert.equal(BlockCardSchema.safeParse({ card_id: 1 }).success, false);
  assert.equal(BlockCardSchema.safeParse({ card_id: 1, reason: 'x', blocker_card_id: 2 }).success, false);
});

test('unblocking takes a blocker record id or all, not both', () => {
  assert.equal(UnblockCardSchema.safeParse({ card_id: 1, blocker_id: 900 }).success, true);
  assert.equal(UnblockCardSchema.safeParse({ card_id: 1, all: true }).success, true);
  assert.equal(UnblockCardSchema.safeParse({ card_id: 1 }).success, false);
  assert.equal(UnblockCardSchema.safeParse({ card_id: 1, blocker_id: 900, all: true }).success, false);
});

test('ordering takes exactly one anchor', () => {
  assert.equal(SetCardOrderSchema.safeParse({ card_id: 1, before_card_id: 2 }).success, true);
  assert.equal(SetCardOrderSchema.safeParse({ card_id: 1, position: 'top' }).success, true);
  assert.equal(SetCardOrderSchema.safeParse({ card_id: 1, sort_order: 2.5 }).success, true);
  assert.equal(SetCardOrderSchema.safeParse({ card_id: 1 }).success, false);
  assert.equal(SetCardOrderSchema.safeParse({ card_id: 1, before_card_id: 2, after_card_id: 3 }).success, false);
  assert.equal(SetCardOrderSchema.safeParse({ card_id: 1, position: 'middle' }).success, false);
});

test('reorder wants a non-empty list of cards', () => {
  assert.equal(ReorderCardsSchema.safeParse({ card_ids: [1, 2, 3] }).success, true);
  assert.equal(ReorderCardsSchema.safeParse({ card_ids: [] }).success, false);
  assert.equal(ReorderCardsSchema.safeParse({ card_ids: [1], start_at: 10, step: 5 }).success, true);
});

test('a bulk move needs a destination, and a board move needs its column', () => {
  assert.equal(BulkMoveCardsSchema.safeParse({ card_ids: [1], column_id: 2 }).success, true);
  assert.equal(BulkMoveCardsSchema.safeParse({ card_ids: [1] }).success, false);
  assert.equal(BulkMoveCardsSchema.safeParse({ card_ids: [1], board_id: 2 }).success, false);
  assert.equal(BulkMoveCardsSchema.safeParse({ card_ids: [1], board_id: 2, column_id: 3 }).success, true);
  assert.equal(BulkMoveCardsSchema.safeParse({ card_ids: [1], column_id: 2, state: 3 }).success, true);
  assert.equal(BulkMoveCardsSchema.safeParse({ card_ids: [1], column_id: 2, state: 4 }).success, false);
});

test('a bulk due date may be cleared, and the batch is capped at 100', () => {
  assert.equal(BulkSetDueDateSchema.safeParse({ card_ids: [1], due_date: null }).success, true);
  assert.equal(BulkSetDueDateSchema.safeParse({ card_ids: [1], due_date: '2026-10-01' }).success, true);
  assert.equal(BulkSetDueDateSchema.safeParse({ card_ids: [1] }).success, false);
  const tooMany = Array.from({ length: 101 }, (_, i) => i + 1);
  assert.equal(BulkSetDueDateSchema.safeParse({ card_ids: tooMany, due_date: null }).success, false);
});

test('finding cards by person defaults to the responsible role', () => {
  const parsed = FindCardsByUserSchema.safeParse({ user_id: 7 });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data!.role, 'responsible');
  assert.equal(FindCardsByUserSchema.safeParse({ user_id: 7, role: 'owner' }).success, true);
  assert.equal(FindCardsByUserSchema.safeParse({ user_id: 7, role: 'watcher' }).success, false);
});

test('renaming a board demands the space, because the short path 404s', () => {
  assert.equal(UpdateBoardSchema.safeParse({ space_id: 1, board_id: 2, title: 'New' }).success, true);
  assert.equal(UpdateBoardSchema.safeParse({ board_id: 2, title: 'New' }).success, false);
  assert.equal(UpdateBoardSchema.safeParse({ space_id: 1, board_id: 2 }).success, false);
});

test('a bigger limit is allowed now that lists page instead of truncating', () => {
  assert.equal(FindCardsByUserSchema.safeParse({ user_id: 7, limit: 300 }).success, true);
  assert.equal(FindCardsByUserSchema.safeParse({ user_id: 7, limit: 501 }).success, false);
});

test('a person scan can be resumed from the reported offset', () => {
  assert.equal(FindCardsByUserSchema.safeParse({ user_id: 7, skip: 100 }).success, true);
  assert.equal(FindCardsByUserSchema.safeParse({ user_id: 7, skip: -1 }).success, false);
});

test('a repeated card id is rejected: it would mean two PATCHes on one card', () => {
  assert.equal(BulkMoveCardsSchema.safeParse({ card_ids: [1, 2, 1], column_id: 3 }).success, false);
  assert.equal(ReorderCardsSchema.safeParse({ card_ids: [5, 5] }).success, false);
  assert.equal(ReorderCardsSchema.safeParse({ card_ids: [5, 6] }).success, true);
});
