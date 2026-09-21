import type { KaitenCard, KaitenUser } from './kaiten-client.js';

// ============================================
// COMPACT CARD PROJECTION
// ============================================
//
// A raw Kaiten card is 8-77 KB: base64 avatars (~2 KB per user, repeated for
// owner, every member and every member of every child card), full `children` and
// `parents` card objects, `path_data`, and dozens of service fields. An agent
// needs none of it, so every tool that returns a card returns this projection.
// Avatars are stripped even in verbose mode — they are never useful.

export const RESPONSIBLE_TYPE = 2;
export const PLAIN_MEMBER_TYPE = 1;

/** Keys holding base64 data URIs or avatar links. Dropped everywhere, always. */
export const AVATAR_KEYS = [
  'avatar_initials_url',
  'avatar_uploaded_url',
  'avatar_type',
  'initials',
];

export interface CardViewContext {
  /** Kaiten web base URL, e.g. https://acme.kaiten.ru (no /api/latest). */
  baseUrl: string;
  defaultSpaceId?: number;
}

export interface ProjectedUser {
  id: number;
  full_name: string | null;
}

export interface ProjectedMember extends ProjectedUser {
  role: 'responsible' | 'member';
  type: number;
}

export interface ProjectedCard {
  id: number;
  title: string;
  url: string;
  state: number | null;
  state_name: string;
  board: { id: number | null; title: string | null };
  column: { id: number | null; title: string | null };
  lane: { id: number | null; title: string | null };
  owner: ProjectedUser | null;
  responsible: ProjectedUser | null;
  members: ProjectedMember[];
  due_date: string | null;
  size_text: string | null;
  asap: boolean;
  blocked: boolean;
  archived: boolean;
  type: { id: number | null; name: string | null } | null;
  tags: string[];
  sort_order: number | null;
  parents_count: number;
  children_count: number;
  children_done: number;
  updated: string | null;
  description?: string | null;
}

const STATE_NAMES: Record<number, string> = {
  1: 'queued',
  2: 'in_progress',
  3: 'done',
};

export function describeState(state: number | null | undefined): string {
  if (state === null || state === undefined) return 'unknown';
  return STATE_NAMES[state] || `unknown(${state})`;
}

/** Strips the Kaiten web base URL out of an API URL. */
export function webBaseUrl(apiUrl: string): string {
  return apiUrl.replace(/\/api\/latest\/?$/, '');
}

export function cardUrl(card: Partial<KaitenCard>, ctx: CardViewContext): string {
  const spaceId = card.space_id || card.board?.space_id || ctx.defaultSpaceId || '';
  return `${ctx.baseUrl}/space/${spaceId}/card/${card.id}`;
}

export function projectUser(user: any): ProjectedUser | null {
  if (!user) return null;
  const id = user.id ?? user.user_id;
  if (id === undefined || id === null) return null;
  return { id, full_name: user.full_name ?? null };
}

/**
 * Card membership. `type: 2` is the responsible person (the one the workload
 * reports count), `type: 1` is an ordinary participant. `owner` is who created
 * or requested the card and is a different thing entirely.
 */
export function projectMember(member: any): ProjectedMember {
  const type = typeof member?.type === 'number' ? member.type : PLAIN_MEMBER_TYPE;
  return {
    id: member?.id ?? member?.user_id,
    full_name: member?.full_name ?? null,
    role: type >= RESPONSIBLE_TYPE ? 'responsible' : 'member',
    type,
  };
}

export function projectMembers(members: any[] | undefined | null): ProjectedMember[] {
  if (!Array.isArray(members)) return [];
  return members.map(projectMember);
}

/** The responsible person of a card: the member with type 2, if any. */
export function findResponsible(card: Partial<KaitenCard> | any): ProjectedUser | null {
  const members = Array.isArray(card?.members) ? card.members : [];
  const responsible = members.find((m: any) => m?.type >= RESPONSIBLE_TYPE);
  return responsible ? { id: responsible.id ?? responsible.user_id, full_name: responsible.full_name ?? null } : null;
}

export interface ProjectCardOptions {
  /** Include the description (off by default: it can be tens of KB). */
  description?: boolean;
}

export function projectCard(
  card: any,
  ctx: CardViewContext,
  options: ProjectCardOptions = {}
): ProjectedCard {
  const members = projectMembers(card?.members);
  const responsible = members.find((m) => m.role === 'responsible');

  const projected: ProjectedCard = {
    id: card?.id,
    title: card?.title ?? '',
    url: cardUrl(card ?? {}, ctx),
    state: card?.state ?? null,
    state_name: describeState(card?.state),
    board: { id: card?.board_id ?? null, title: card?.board?.title ?? null },
    column: { id: card?.column_id ?? null, title: card?.column?.title ?? null },
    lane: { id: card?.lane_id ?? null, title: card?.lane?.title ?? null },
    owner: projectUser(card?.owner) || (card?.owner_id ? { id: card.owner_id, full_name: null } : null),
    responsible: responsible ? { id: responsible.id, full_name: responsible.full_name } : null,
    members,
    due_date: card?.due_date ?? null,
    size_text: card?.size_text ?? null,
    asap: !!card?.asap,
    blocked: !!card?.blocked,
    archived: !!card?.archived,
    type: card?.type ? { id: card.type.id ?? card.type_id ?? null, name: card.type.name ?? null } : null,
    tags: Array.isArray(card?.tags) ? card.tags.map((t: any) => t?.name).filter(Boolean) : [],
    sort_order: typeof card?.sort_order === 'number' ? card.sort_order : null,
    parents_count: card?.parents_count ?? 0,
    children_count: card?.children_count ?? 0,
    children_done: card?.children_done ?? 0,
    updated: card?.updated ?? null,
  };

  if (options.description) {
    projected.description = card?.description ?? null;
  }

  return projected;
}

export interface BriefCard {
  id: number;
  title: string;
  state_name: string;
  board_id: number | null;
  column_id: number | null;
  due_date: string | null;
  size_text: string | null;
  responsible_id: number | null;
  blocked: boolean;
  url?: string;
}

/**
 * The one-line form used in bulk answers and child lists: enough to verify that
 * the write landed, small enough that 100 cards stay in the tens of KB.
 * Pass a context to add the card URL (worth its ~60 bytes in a list a human
 * will click through, not in a bulk result).
 */
export function projectCardBrief(card: any, ctx?: CardViewContext): BriefCard {
  const responsible = findResponsible(card);
  const brief: BriefCard = {
    id: card?.id,
    title: card?.title ?? '',
    state_name: describeState(card?.state),
    board_id: card?.board_id ?? null,
    column_id: card?.column_id ?? null,
    due_date: card?.due_date ?? null,
    size_text: card?.size_text ?? null,
    responsible_id: responsible ? responsible.id : null,
    blocked: !!card?.blocked,
  };
  if (ctx) brief.url = cardUrl(card ?? {}, ctx);
  return brief;
}

export function projectCards(
  cards: any[],
  ctx: CardViewContext,
  options: ProjectCardOptions = {}
): ProjectedCard[] {
  return (cards || []).map((card) => projectCard(card, ctx, options));
}

/**
 * Deep copy with every avatar field removed. Used for verbose responses: the
 * caller asked for the whole object, but base64 avatars are never part of it.
 */
export function stripAvatars<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripAvatars(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (AVATAR_KEYS.includes(key)) continue;
      result[key] = stripAvatars(item);
    }
    return result as unknown as T;
  }
  return value;
}

/**
 * A board without its cards. GET /boards/{id} embeds every card of the board:
 * 2.7 MB on a 43-card board, of which 2.68 MB is `cards`.
 */
export function projectBoard(board: any): any {
  return {
    id: board?.id,
    title: board?.title,
    description: board?.description ?? null,
    space_id: board?.space_id ?? null,
    locked: !!board?.locked,
    columns: Array.isArray(board?.columns)
      ? board.columns.map((c: any) => ({ id: c?.id, title: c?.title, type: c?.type, sort_order: c?.sort_order }))
      : [],
    lanes: Array.isArray(board?.lanes)
      ? board.lanes.map((l: any) => ({ id: l?.id, title: l?.title, sort_order: l?.sort_order }))
      : [],
    // Counts everything the API embedded, archived cards included.
    cards_total: Array.isArray(board?.cards) ? board.cards.length : undefined,
  };
}

export function projectKaitenUser(user: KaitenUser | any): any {
  return stripAvatars({
    id: user?.id,
    full_name: user?.full_name,
    email: user?.email,
    username: user?.username,
    activated: user?.activated,
  });
}

/** One-line card summary for list output. */
export function renderCardLine(card: ProjectedCard, index?: number): string {
  const prefix = index === undefined ? '' : `${index + 1}. `;
  const flags = [
    card.asap ? '⚡' : '',
    card.blocked ? '🚫' : '',
  ].join('');
  let line = `${prefix}[#${card.id}] ${card.title}${flags ? ' ' + flags : ''}\n`;
  line += `   ${card.board.title || card.board.id || 'n/a'} › ${card.column.title || card.column.id || 'n/a'}`;
  line += ` · ${card.state_name}`;
  if (card.due_date) line += ` · due ${card.due_date}`;
  if (card.size_text) line += ` · ${card.size_text}`;
  line += `\n`;
  line += `   responsible: ${card.responsible?.full_name || card.responsible?.id || '—'}`;
  line += ` · owner: ${card.owner?.full_name || card.owner?.id || '—'}`;
  if (card.members.length > 1) {
    line += ` · members: ${card.members.length}`;
  }
  line += `\n   ${card.url}\n`;
  return line;
}
