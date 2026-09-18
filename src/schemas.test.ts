import assert from 'node:assert/strict';
import test from 'node:test';
import { AddCardChildSchema, RemoveCardChildSchema, UpdateCardSchema } from './schemas.js';

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
