import type { KaitenClient, KaitenExternalLink, KaitenTag } from './kaiten-client.js';
import { describeError } from './card-ops.js';

// ============================================
// CARD TAGS AND EXTERNAL LINKS
// ============================================
//
// Tags (live API, 2026-10-10):
// • POST /cards/{id}/tags {name} attaches a tag by NAME and creates the company
//   tag when none has that name — a typo silently becomes a new tag. So every
//   name is first looked up in /tags, and the answer says which tags are new.
// • /tags?query= is a substring match ("loc" finds "local"); exact matching is
//   done here, case-insensitively, reusing the existing spelling.
// • DELETE /cards/{id}/tags/{tagId} takes the company tag id; on a card's tag
//   list `id` and `tag_id` are both that id.
//
// External links carry {id, url, description}. GET /cards/{id} embeds them as
// `external_links`; /cards rows do not once relations are trimmed.

export interface ProjectedTag {
  id: number;
  name: string;
}

export interface ProjectedExternalLink {
  id: number;
  url: string;
  description: string | null;
}

export function projectExternalLink(link: KaitenExternalLink | any): ProjectedExternalLink {
  return { id: link?.id, url: link?.url ?? '', description: link?.description ?? null };
}

export function projectExternalLinks(links: KaitenExternalLink[] | null | undefined): ProjectedExternalLink[] {
  return Array.isArray(links) ? links.map(projectExternalLink) : [];
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
}

export interface AddTagsResult {
  card_id: number;
  /** Attached by this call; `new_tag` = the company tag did not exist before. */
  added: Array<ProjectedTag & { new_tag: boolean }>;
  already_on_card: ProjectedTag[];
  failed: Array<{ name: string; error: string }>;
  tags: ProjectedTag[];
}

export async function addCardTags(
  client: Pick<KaitenClient, 'getCardTags' | 'searchTags' | 'addCardTag'>,
  cardId: number,
  names: string[],
  signal?: AbortSignal
): Promise<AddTagsResult> {
  const current = await client.getCardTags(cardId, signal);
  const result: AddTagsResult = { card_id: cardId, added: [], already_on_card: [], failed: [], tags: [] };
  const seen = new Set<string>();

  for (const raw of names) {
    const name = raw.trim();
    const key = name.toLocaleLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);

    const onCard = current.find((t) => sameName(t.name, name));
    if (onCard) {
      result.already_on_card.push({ id: onCard.id, name: onCard.name });
      continue;
    }

    try {
      const existing: KaitenTag | undefined = (await client.searchTags(name, signal)).find((t) => sameName(t.name, name));
      // Reuse the existing spelling so "Bug" does not become a second tag next to "bug".
      const tag = await client.addCardTag(cardId, existing?.name ?? name, signal);
      result.added.push({ id: tag.id, name: tag.name, new_tag: !existing });
    } catch (error: any) {
      result.failed.push({ name, error: describeError(error) });
    }
  }

  const after = result.added.length > 0 ? await client.getCardTags(cardId, signal) : current;
  result.tags = after.map((t) => ({ id: t.id, name: t.name }));
  return result;
}

export interface RemoveTagsResult {
  card_id: number;
  removed: ProjectedTag[];
  not_on_card: Array<string | number>;
  failed: Array<{ tag: string | number; error: string }>;
  tags: ProjectedTag[];
}

/** Takes tag names (case-insensitive) or tag ids, as found on the card. */
export async function removeCardTags(
  client: Pick<KaitenClient, 'getCardTags' | 'removeCardTag'>,
  cardId: number,
  tags: Array<string | number>,
  signal?: AbortSignal
): Promise<RemoveTagsResult> {
  const current = await client.getCardTags(cardId, signal);
  const result: RemoveTagsResult = { card_id: cardId, removed: [], not_on_card: [], failed: [], tags: [] };
  const done = new Set<number>();

  for (const wanted of tags) {
    const tag = current.find((t) =>
      typeof wanted === 'number' ? t.id === wanted || t.tag_id === wanted : sameName(t.name, wanted)
    );
    if (!tag) {
      result.not_on_card.push(wanted);
      continue;
    }
    if (done.has(tag.id)) continue;
    done.add(tag.id);
    try {
      await client.removeCardTag(cardId, tag.tag_id ?? tag.id, signal);
      result.removed.push({ id: tag.id, name: tag.name });
    } catch (error: any) {
      result.failed.push({ tag: wanted, error: describeError(error) });
    }
  }

  result.tags = current.filter((t) => !result.removed.some((r) => r.id === t.id)).map((t) => ({ id: t.id, name: t.name }));
  return result;
}

/**
 * Attaches a link unless the card already has the same URL — an agent that
 * retries after a timeout must not stack duplicates.
 */
export async function addExternalLink(
  client: Pick<KaitenClient, 'getCardExternalLinks' | 'addCardExternalLink'>,
  cardId: number,
  url: string,
  description: string | undefined,
  signal?: AbortSignal
): Promise<{ card_id: number; link: ProjectedExternalLink; already_present: boolean }> {
  const existing = (await client.getCardExternalLinks(cardId, signal)).find((l) => l.url === url);
  if (existing) {
    return { card_id: cardId, link: projectExternalLink(existing), already_present: true };
  }
  const body: { url: string; description?: string } = { url };
  if (description !== undefined) body.description = description;
  const link = await client.addCardExternalLink(cardId, body, signal);
  return { card_id: cardId, link: projectExternalLink(link), already_present: false };
}
