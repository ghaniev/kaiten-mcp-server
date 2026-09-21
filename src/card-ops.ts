import type {
  KaitenCard,
  KaitenCardMember,
  KaitenClient,
  SearchCardsParams,
  UpdateCardParams,
} from './kaiten-client.js';
import { KAITEN_PAGE_SIZE } from './kaiten-client.js';
import { PLAIN_MEMBER_TYPE, RESPONSIBLE_TYPE, projectMember, type ProjectedMember } from './card-view.js';

// ============================================
// CARD OPERATIONS
// ============================================
//
// Everything here is verified against https://vibegames.kaiten.ru on
// 2026-09-21 with throwaway cards that were deleted afterwards. The rules that
// shaped the code:
//
// • POST /cards/{id}/members does not always store the `type` it was given:
//   posting {type: 1} to a card with no responsible yields a type-2 member.
//   So every role change is read back and repaired with PATCH.
// • PATCH /cards/{id}/members/{userId} {type: 1} answers
//   400 "Member.type should be >= 2" — a responsible cannot be demoted to an
//   ordinary participant, only removed from the card.
// • `state` follows the column type: PATCH {state: 3} on a queue column is
//   accepted (200) and ignored. Done means moving to a done-type column.
// • `size`/`size_unit` are ignored on write; only `size_text` is stored, and it
//   backfills the other two ("8 ч" → size 8, size_unit "ч").

export interface MemberOpResult {
  card_id: number;
  members: ProjectedMember[];
  responsible: ProjectedMember | null;
  /** Who lost the responsible role because of this call, if anyone. */
  demoted: ProjectedMember | null;
  warnings: string[];
}

function toProjected(members: KaitenCardMember[]): ProjectedMember[] {
  return (members || []).map(projectMember);
}

function findResponsibleMember(members: ProjectedMember[]): ProjectedMember | null {
  return members.find((m) => m.type >= RESPONSIBLE_TYPE) || null;
}

/**
 * Makes `userId` the responsible person (member with type 2) of the card.
 *
 * POST first, then read back, then PATCH if the role did not stick — the API
 * has been seen to keep the old type. The previous responsible is reported as
 * `demoted`: Kaiten downgrades them by itself, and trying to PATCH them down
 * explicitly fails with 400.
 */
export async function setCardResponsible(
  client: KaitenClient,
  cardId: number,
  userId: number,
  signal?: AbortSignal
): Promise<MemberOpResult> {
  const warnings: string[] = [];
  const before = toProjected(await client.getCardMembers(cardId, signal));
  const previous = findResponsibleMember(before);

  if (previous && previous.id === userId) {
    return { card_id: cardId, members: before, responsible: previous, demoted: null, warnings };
  }

  try {
    await client.addCardMember(cardId, userId, RESPONSIBLE_TYPE, signal);
  } catch (error: any) {
    // A 4xx here can simply mean "already a member", and PATCH still works.
    // Anything else (404, 403, 5xx, network) is a real failure and must not be
    // turned into a warning.
    const status = error?.status ?? error?.response?.status;
    if (status !== 400 && status !== 409 && status !== 422) throw error;
    warnings.push(`POST /cards/${cardId}/members answered ${status} ${error?.message || error}; falling back to PATCH`);
  }

  let after = toProjected(await client.getCardMembers(cardId, signal));
  let target = after.find((m) => m.id === userId) || null;

  if (!target || target.type < RESPONSIBLE_TYPE) {
    // The documented trap: POST silently kept the old role, PATCH fixes it.
    await client.updateCardMember(cardId, userId, RESPONSIBLE_TYPE, signal);
    after = toProjected(await client.getCardMembers(cardId, signal));
    target = after.find((m) => m.id === userId) || null;
  }

  if (!target) {
    throw new Error(
      `User ${userId} is not a member of card ${cardId} after POST and PATCH — the user probably has no access to this space`
    );
  }
  if (target.type < RESPONSIBLE_TYPE) {
    // Reporting success here would name the PREVIOUS responsible in the answer
    // and count the card as assigned in a bulk run. It is a failure.
    throw new Error(
      `Kaiten kept user ${userId} at member type ${target.type} on card ${cardId} after POST and PATCH — ` +
      `the responsible was not changed`
    );
  }

  const demotedNow = previous && previous.id !== userId
    ? after.find((m) => m.id === previous.id) || null
    : null;

  return {
    card_id: cardId,
    members: after,
    responsible: findResponsibleMember(after),
    demoted: demotedNow,
    warnings,
  };
}

/**
 * Adds an ordinary participant (type 1).
 *
 * If the card has no responsible yet, Kaiten promotes the new member to type 2
 * whatever `type` says, and PATCHing back down is rejected. That is reported in
 * `warnings` instead of being papered over.
 */
export async function addCardParticipant(
  client: KaitenClient,
  cardId: number,
  userId: number,
  signal?: AbortSignal
): Promise<MemberOpResult> {
  const warnings: string[] = [];
  await client.addCardMember(cardId, userId, PLAIN_MEMBER_TYPE, signal);
  const after = toProjected(await client.getCardMembers(cardId, signal));
  const target = after.find((m) => m.id === userId) || null;

  if (!target) {
    // POST answered 200 and the member is not there: do not call that success.
    throw new Error(
      `User ${userId} is not a member of card ${cardId} after POST — the user probably has no access to this space`
    );
  }

  if (target.type >= RESPONSIBLE_TYPE) {
    warnings.push(
      `Kaiten made user ${userId} the RESPONSIBLE (type ${target.type}), not an ordinary member. ` +
      `That happens when the card had no responsible yet, and it cannot be undone by PATCH ` +
      `("Member.type should be >= 2") — remove the member if that is wrong.`
    );
  }

  return {
    card_id: cardId,
    members: after,
    responsible: findResponsibleMember(after),
    demoted: null,
    warnings,
  };
}

export async function removeCardMember(
  client: KaitenClient,
  cardId: number,
  userId: number,
  signal?: AbortSignal
): Promise<MemberOpResult> {
  await client.removeCardMember(cardId, userId, signal);
  const after = toProjected(await client.getCardMembers(cardId, signal));
  const warnings = after.some((m) => m.id === userId)
    ? [`User ${userId} is still listed as a member of card ${cardId}`]
    : [];
  return {
    card_id: cardId,
    members: after,
    responsible: findResponsibleMember(after),
    demoted: null,
    warnings,
  };
}

export async function listCardMembers(
  client: KaitenClient,
  cardId: number,
  signal?: AbortSignal
): Promise<MemberOpResult> {
  const members = toProjected(await client.getCardMembers(cardId, signal));
  return {
    card_id: cardId,
    members,
    responsible: findResponsibleMember(members),
    demoted: null,
    warnings: [],
  };
}

// ============================================
// ORDERING
// ============================================

export interface OrderTarget {
  before_card_id?: number;
  after_card_id?: number;
  position?: 'top' | 'bottom';
  sort_order?: number;
}

export interface OrderPlan {
  sort_order: number;
  warnings: string[];
}

/**
 * Picks a sort_order for `cardId` relative to the other cards of its column.
 *
 * `column` must be the cards of one column sorted ascending by sort_order —
 * the same order Kaiten shows. Cards sharing a sort_order (which happens) make
 * an exact insertion impossible; that is reported rather than guessed.
 */
export function planSortOrder(
  cardId: number,
  column: Array<{ id: number; sort_order?: number | null }>,
  target: OrderTarget
): OrderPlan {
  const warnings: string[] = [];
  if (typeof target.sort_order === 'number') {
    return { sort_order: target.sort_order, warnings };
  }

  const others = column.filter((c) => c.id !== cardId && typeof c.sort_order === 'number') as Array<{ id: number; sort_order: number }>;
  others.sort((a, b) => a.sort_order - b.sort_order);

  if (others.length === 0) {
    return { sort_order: 1, warnings: ['Column has no other card with a sort_order; using 1'] };
  }

  const first = others[0].sort_order;
  const last = others[others.length - 1].sort_order;

  if (target.position === 'top') return { sort_order: first - 1, warnings };
  if (target.position === 'bottom') return { sort_order: last + 1, warnings };

  const anchorId = target.before_card_id ?? target.after_card_id;
  const index = others.findIndex((c) => c.id === anchorId);
  if (index < 0) {
    throw new Error(`Card ${anchorId} is not in the same column as card ${cardId} (or has no sort_order)`);
  }

  const anchor = others[index].sort_order;
  const neighbour = target.before_card_id !== undefined ? others[index - 1] : others[index + 1];

  if (!neighbour) {
    // The anchor is the first or last card: step outside the range.
    return { sort_order: target.before_card_id !== undefined ? anchor - 1 : anchor + 1, warnings };
  }

  if (neighbour.sort_order === anchor) {
    warnings.push(
      `Cards ${neighbour.id} and ${anchorId} share sort_order ${anchor}, so the position is ambiguous — ` +
      `use kaiten_reorder_cards to renumber the column deterministically`
    );
    return { sort_order: target.before_card_id !== undefined ? anchor - 0.5 : anchor + 0.5, warnings };
  }

  const midpoint = (anchor + neighbour.sort_order) / 2;
  if (midpoint === anchor || midpoint === neighbour.sort_order) {
    // The gap between the two neighbours has been halved down to float
    // precision; another midpoint would land exactly on one of them.
    warnings.push(
      `Cards ${neighbour.id} and ${anchorId} are too close to insert between (${neighbour.sort_order} vs ${anchor}) — ` +
      `use kaiten_reorder_cards to renumber the column`
    );
  }
  return { sort_order: midpoint, warnings };
}

/**
 * Assigns sort_order values to an explicit sequence of cards.
 *
 * By default the cards keep the slots they already occupy in the column — the
 * existing sort_order values are collected, sorted, and handed back out in the
 * requested order, so nothing jumps over cards that were not listed. Pass
 * start_at/step to renumber from scratch instead.
 */
export function planReorder(
  cardIds: number[],
  current: Map<number, number | null | undefined>,
  options: { start_at?: number; step?: number } = {}
): Array<{ card_id: number; sort_order: number }> {
  const step = options.step ?? 1;

  if (options.start_at !== undefined) {
    return cardIds.map((id, i) => ({ card_id: id, sort_order: options.start_at! + i * step }));
  }

  const slots = cardIds
    .map((id) => current.get(id))
    .filter((v): v is number => typeof v === 'number')
    .sort((a, b) => a - b);

  if (slots.length < cardIds.length) {
    // Some card has no known sort_order: fall back to a clean sequence.
    const base = slots.length > 0 ? slots[0] : 1;
    return cardIds.map((id, i) => ({ card_id: id, sort_order: base + i * step }));
  }

  return cardIds.map((id, i) => ({ card_id: id, sort_order: slots[i] }));
}

// ============================================
// BULK OPERATIONS
// ============================================

export interface BulkItemResult {
  card_id: number;
  ok: boolean;
  card?: KaitenCard;
  error?: string;
}

export interface BulkResult {
  updated: number;
  failed: number;
  results: BulkItemResult[];
  warnings: string[];
}

/** PATCHes the same fields onto many cards, one card per request, isolating failures. */
export async function bulkUpdateCards(
  client: KaitenClient,
  cardIds: number[],
  params: UpdateCardParams,
  signal?: AbortSignal
): Promise<BulkResult> {
  const results: BulkItemResult[] = await Promise.all(
    cardIds.map(async (cardId): Promise<BulkItemResult> => {
      try {
        const card = await client.updateCard(cardId, { ...params }, signal);
        return { card_id: cardId, ok: true, card };
      } catch (error: any) {
        return { card_id: cardId, ok: false, error: describeError(error) };
      }
    })
  );

  const warnings: string[] = [];
  if (params.size_text !== undefined) {
    for (const r of results) {
      if (r.ok && r.card && (r.card as any).size_text !== params.size_text) {
        warnings.push(`Card ${r.card_id}: size_text came back as ${JSON.stringify((r.card as any).size_text)}, expected ${JSON.stringify(params.size_text)}`);
      }
    }
  }
  if (params.state !== undefined) {
    for (const r of results) {
      if (r.ok && r.card && r.card.state !== params.state) {
        warnings.push(
          `Card ${r.card_id}: state is ${r.card.state}, not ${params.state} — Kaiten derives state from the column type, ` +
          `so move the card to a column of that type (done = type 3)`
        );
      }
    }
  }

  return {
    updated: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
    warnings,
  };
}

export async function bulkSetResponsible(
  client: KaitenClient,
  cardIds: number[],
  userId: number,
  signal?: AbortSignal
): Promise<{ updated: number; failed: number; results: Array<{ card_id: number; ok: boolean; responsible?: ProjectedMember | null; demoted?: ProjectedMember | null; error?: string; warnings?: string[] }> }> {
  const results = await Promise.all(
    cardIds.map(async (cardId) => {
      try {
        const res = await setCardResponsible(client, cardId, userId, signal);
        return {
          card_id: cardId,
          ok: true,
          responsible: res.responsible,
          demoted: res.demoted,
          warnings: res.warnings.length ? res.warnings : undefined,
        };
      } catch (error: any) {
        return { card_id: cardId, ok: false, error: describeError(error) };
      }
    })
  );
  return {
    updated: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

export function describeError(error: any): string {
  if (!error) return 'unknown error';
  const status = error.status || error.response?.status;
  const detail = error.details?.message || error.response?.data?.message || error.message || String(error);
  return status ? `${status}: ${detail}` : String(detail);
}

// ============================================
// CARDS BY PERSON
// ============================================

export type UserCardRole = 'responsible' | 'member' | 'any' | 'owner';

export interface FindCardsByUserParams extends SearchCardsParams {
  user_id: number;
  role: UserCardRole;
  limit: number;
  /** Hard cap on how many cards may be read while filtering. */
  max_scan?: number;
}

export interface FindCardsByUserResult {
  cards: KaitenCard[];
  scanned: number;
  has_more: boolean;
  next_offset: number | null;
  requests: number;
}

/**
 * Cards where a person is the responsible / a member / the owner.
 *
 * Kaiten's `member_ids` filter matches participants of any role, so the
 * responsible-only case is filtered client side on `members[].type === 2`.
 * The scan is paged and the result says whether it stopped early.
 */
export async function findCardsByUser(
  client: KaitenClient,
  params: FindCardsByUserParams,
  signal?: AbortSignal
): Promise<FindCardsByUserResult> {
  const { user_id, role, limit, max_scan = 500, ...filters } = params;

  const query: SearchCardsParams = { ...filters };
  if (role === 'owner') {
    query.owner_id = user_id;
  } else {
    query.member_ids = String(user_id);
  }

  const matches: KaitenCard[] = [];
  // Raw scan position of each match, so a resume starts at the first card that
  // was dropped — not at the end of the page it was found in, which would skip
  // every further match of that page.
  const matchOffsets: number[] = [];
  const startOffset = filters.skip || 0;
  let offset = startOffset;
  let scanned = 0;
  let requests = 0;
  let exhausted = false;

  while (matches.length < limit + 1 && scanned < max_scan) {
    const page = await client.searchCards({ ...query, limit: KAITEN_PAGE_SIZE, skip: offset }, signal);
    requests++;

    page.forEach((card, index) => {
      if (matchesRole(card, user_id, role)) {
        matches.push(card);
        matchOffsets.push(offset + index);
      }
    });

    scanned += page.length;
    offset += page.length;

    if (page.length < KAITEN_PAGE_SIZE) {
      exhausted = true;
      break;
    }
  }

  // More matches exist either because we trimmed some off the end of the list
  // we already read, or because the scan cap stopped us before the API ran out.
  const hasMore = matches.length > limit || (!exhausted && scanned >= max_scan);
  return {
    cards: matches.slice(0, limit),
    scanned,
    has_more: hasMore,
    // Resume at the first match we did not return, or at the end of the scan
    // when the cap stopped us before any extra match turned up.
    next_offset: hasMore ? (matchOffsets[limit] ?? offset) : null,
    requests,
  };
}

function matchesRole(card: KaitenCard, userId: number, role: UserCardRole): boolean {
  if (role === 'owner') return card.owner_id === userId;
  const members: any[] = Array.isArray(card.members) ? card.members : [];
  const entry = members.find((m) => (m?.id ?? m?.user_id) === userId);
  if (!entry) return false;
  if (role === 'any') return true;
  const type = typeof entry.type === 'number' ? entry.type : PLAIN_MEMBER_TYPE;
  return role === 'responsible' ? type >= RESPONSIBLE_TYPE : type < RESPONSIBLE_TYPE;
}
