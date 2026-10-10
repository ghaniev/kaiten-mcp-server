import type {
  ChecklistItemFields,
  KaitenCard,
  KaitenChecklist,
  KaitenChecklistItem,
  KaitenClient,
} from './kaiten-client.js';
import { describeError } from './card-ops.js';

// ============================================
// CARD CHECKLISTS
// ============================================
//
// Shapes checked against the live API on 2026-10-10 (read-only):
// • Checklists come embedded in GET /cards/{id} as `checklists`; the key is
//   absent — not [] — on a card without them, and in /cards search rows.
//   There is no endpoint that lists the checklists of a card.
// • Every item carries `checked_by` and `responsible` as full user objects with
//   ~2 KB base64 avatars each, so items are always projected.
// • Items and checklists order by `sort_order` (a float); the array order of
//   the response is not the display order.

export interface ProjectedChecklistItem {
  id: number;
  text: string;
  checked: boolean;
  checked_by: { id: number; full_name: string | null } | null;
  checked_at: string | null;
  responsible: { id: number; full_name: string | null } | null;
  due_date: string | null;
  sort_order: number | null;
}

export interface ProjectedChecklist {
  id: number;
  name: string;
  done: number;
  total: number;
  sort_order: number | null;
  items: ProjectedChecklistItem[];
}

export interface ChecklistSummary {
  id: number;
  name: string;
  done: number;
  total: number;
}

function bySortOrder(a: { sort_order?: number | null }, b: { sort_order?: number | null }): number {
  return (a.sort_order ?? Number.MAX_VALUE) - (b.sort_order ?? Number.MAX_VALUE);
}

function userRef(user: any, fallbackId: number | null | undefined) {
  if (user && user.id !== undefined) return { id: user.id, full_name: user.full_name ?? null };
  return typeof fallbackId === 'number' ? { id: fallbackId, full_name: null } : null;
}

function liveItems(checklist: KaitenChecklist | any): KaitenChecklistItem[] {
  const items: KaitenChecklistItem[] = Array.isArray(checklist?.items) ? checklist.items : [];
  return items.filter((item) => item && !item.deleted).sort(bySortOrder);
}

export function projectChecklistItem(item: KaitenChecklistItem | any): ProjectedChecklistItem {
  return {
    id: item?.id,
    text: item?.text ?? '',
    checked: !!item?.checked,
    checked_by: item?.checked ? userRef(item?.checked_by, item?.checker_id) : null,
    checked_at: item?.checked ? item?.checked_at ?? null : null,
    responsible: userRef(item?.responsible, item?.responsible_id),
    due_date: item?.due_date ?? null,
    sort_order: typeof item?.sort_order === 'number' ? item.sort_order : null,
  };
}

export function projectChecklist(checklist: KaitenChecklist | any): ProjectedChecklist {
  const items = liveItems(checklist).map(projectChecklistItem);
  return {
    id: checklist?.id,
    name: checklist?.name ?? '',
    done: items.filter((i) => i.checked).length,
    total: items.length,
    sort_order: typeof checklist?.sort_order === 'number' ? checklist.sort_order : null,
    items,
  };
}

export function projectChecklists(checklists: KaitenChecklist[] | null | undefined): ProjectedChecklist[] {
  if (!Array.isArray(checklists)) return [];
  return checklists
    .filter((c) => c && !c.deleted)
    .sort(bySortOrder)
    .map(projectChecklist);
}

/** Progress only — for list views, where item texts would not pay for themselves. */
export function summarizeChecklists(checklists: KaitenChecklist[] | null | undefined): ChecklistSummary[] {
  return projectChecklists(checklists).map(({ id, name, done, total }) => ({ id, name, done, total }));
}

/** `- [x] text` lines, the way the checklist reads in the Kaiten UI. */
export function renderChecklistsMarkdown(checklists: ProjectedChecklist[]): string {
  let output = '';
  for (const checklist of checklists) {
    output += `\n### ${checklist.name} (${checklist.done}/${checklist.total}) · checklist_id: ${checklist.id}\n`;
    for (const item of checklist.items) {
      output += `- [${item.checked ? 'x' : ' '}] ${item.text}`;
      const extras = [
        item.responsible ? `→ ${item.responsible.full_name || item.responsible.id}` : '',
        item.due_date ? `due ${item.due_date}` : '',
        `item_id: ${item.id}`,
      ].filter(Boolean);
      output += ` _(${extras.join(' · ')})_\n`;
    }
  }
  return output;
}

/** The checklist an item belongs to, found in an already loaded card. */
export function findItemChecklist(card: KaitenCard | any, itemId: number): KaitenChecklist | null {
  const checklists: KaitenChecklist[] = Array.isArray(card?.checklists) ? card.checklists : [];
  return checklists.find((c) => liveItems(c).some((item) => item.id === itemId)) || null;
}

// ============================================
// OPERATIONS
// ============================================

export interface NewChecklistItem {
  text: string;
  checked?: boolean;
  due_date?: string;
  responsible_id?: number;
}

export interface ItemFailure {
  text?: string;
  item_id?: number;
  error: string;
}

export interface ChecklistOpResult {
  card_id: number;
  checklist: ProjectedChecklist;
  failed: ItemFailure[];
}

/**
 * Appends items in the order given. Each item gets an explicit sort_order past
 * the current last one, so the order does not depend on how the API places an
 * item that comes without one. Items go one at a time: a failure is reported
 * per item and does not stop the rest.
 */
export async function appendChecklistItems(
  client: KaitenClient,
  cardId: number,
  checklistId: number,
  items: NewChecklistItem[],
  signal?: AbortSignal,
  existing?: KaitenChecklist
): Promise<ChecklistOpResult> {
  const current = existing ?? await client.getChecklist(cardId, checklistId, signal);
  const orders = liveItems(current).map((i) => i.sort_order).filter((v): v is number => typeof v === 'number');
  let next = orders.length ? Math.max(...orders) + 1 : 1;

  const failed: ItemFailure[] = [];
  for (const item of items) {
    try {
      await client.addChecklistItem(cardId, checklistId, { ...item, sort_order: next }, signal);
      next += 1;
    } catch (error: any) {
      failed.push({ text: item.text, error: describeError(error) });
    }
  }

  const after = await client.getChecklist(cardId, checklistId, signal);
  return { card_id: cardId, checklist: projectChecklist(after), failed };
}

export async function createChecklistWithItems(
  client: KaitenClient,
  cardId: number,
  name: string,
  items: NewChecklistItem[],
  signal?: AbortSignal
): Promise<ChecklistOpResult> {
  const created = await client.createChecklist(cardId, { name }, signal);
  if (items.length === 0) {
    return { card_id: cardId, checklist: projectChecklist(created), failed: [] };
  }
  return appendChecklistItems(client, cardId, created.id, items, signal, { ...created, items: [] });
}

/**
 * Resolves the checklist of each item from one card read, so the caller only
 * needs item ids. Items that are not on the card are reported, not guessed.
 */
export async function updateChecklistItems(
  client: KaitenClient,
  cardId: number,
  itemIds: number[],
  fields: ChecklistItemFields,
  signal?: AbortSignal
): Promise<{ card_id: number; updated: ProjectedChecklistItem[]; failed: ItemFailure[] }> {
  const card = await client.getCard(cardId, signal);
  const updated: ProjectedChecklistItem[] = [];
  const failed: ItemFailure[] = [];

  for (const itemId of itemIds) {
    const checklist = findItemChecklist(card, itemId);
    if (!checklist) {
      failed.push({ item_id: itemId, error: `Item ${itemId} is not on card ${cardId}` });
      continue;
    }
    try {
      const item = await client.updateChecklistItem(cardId, checklist.id, itemId, fields, signal);
      updated.push(projectChecklistItem(item));
    } catch (error: any) {
      failed.push({ item_id: itemId, error: describeError(error) });
    }
  }

  return { card_id: cardId, updated, failed };
}
