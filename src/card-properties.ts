import type { KaitenClient } from './kaiten-client.js';

// ============================================
// CARD CUSTOM PROPERTIES
// ============================================
//
// A card keeps its custom fields as `properties: {id_<propertyId>: value}`.
// Shapes seen on the live API (2026-10-10):
// • select (single and multi): an array of select-option ids, e.g. [3001].
//   The text lives in /company/custom-properties/{id}/select-values.
// • user: on GET /cards/{id} an array of user ids — often of deactivated
//   accounts, found only with /users?include_inactive=true; on /cards search
//   rows an array of full user objects, base64 avatars included.
// • date: {date: "2026-06-12", time: null, tzOffset: null}.
// • string / number / email / checkbox / formula: the value itself.
// Some properties answer 403 to the token (another space's private field);
// they are shown under their raw key instead of being dropped.

export interface PropertyDefinition {
  id: number;
  name: string;
  type: string;
  multi_select: boolean;
}

/** The subset of KaitenClient the resolver needs; a fake in tests. */
export type PropertySource = Pick<KaitenClient, 'getCustomProperties' | 'getCustomPropertySelectValues' | 'getUsersByIds'>;

const PROPERTY_KEY = /^id_(\d+)$/;

export function parsePropertyKey(key: string): number | null {
  const match = PROPERTY_KEY.exec(key);
  return match ? Number(match[1]) : null;
}

function asIdList(value: unknown): number[] {
  const list = Array.isArray(value) ? value : [value];
  return list.filter((v): v is number => typeof v === 'number');
}

function formatDate(value: any): string | null {
  if (!value || typeof value !== 'object') return typeof value === 'string' ? value : null;
  if (!value.date) return null;
  return value.time ? `${value.date} ${value.time}` : value.date;
}

function formatUser(u: any, names: Map<number, string>): string | null {
  if (typeof u === 'number') return names.get(u) ?? `user ${u}`;
  if (u && typeof u === 'object') return u.full_name || u.username || (u.id !== undefined ? names.get(u.id) ?? `user ${u.id}` : null);
  return null;
}

/** A value that came in an unknown shape, minus anything that looks like an avatar. */
function plainValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(plainValue);
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/avatar|initials/.test(k)) continue;
      result[k] = plainValue(v);
    }
    return result;
  }
  return value;
}

export class PropertyResolver {
  private definitions = new Map<number, PropertyDefinition | null>();
  private definitionsLoadedAt = 0;
  private options = new Map<number, Map<number, string>>();
  private userNames = new Map<number, string>();

  constructor(private source: PropertySource, private ttlMs = 300_000) {}

  /** Drops everything learned so far (renamed fields, new options). */
  invalidate(): void {
    this.definitions.clear();
    this.options.clear();
    this.userNames.clear();
    this.definitionsLoadedAt = 0;
  }

  private async loadUserNames(ids: number[], signal?: AbortSignal): Promise<void> {
    const missing = [...new Set(ids)].filter((id) => !this.userNames.has(id));
    if (missing.length === 0) return;
    try {
      const users = await this.source.getUsersByIds(missing, signal);
      for (const u of users) {
        if (u?.id !== undefined && u.full_name) this.userNames.set(u.id, u.full_name);
      }
    } catch {
      // Fall through: unresolved users are shown by id.
    }
  }

  private async loadDefinitions(ids: number[], signal?: AbortSignal): Promise<void> {
    const expired = Date.now() - this.definitionsLoadedAt > this.ttlMs;
    if (expired) {
      this.definitions.clear();
      this.options.clear();
      this.userNames.clear();
    }
    const missing = ids.filter((id) => !this.definitions.has(id));
    if (missing.length === 0) return;

    const found = await this.source.getCustomProperties(missing, signal);
    for (const def of found) {
      this.definitions.set(def.id, {
        id: def.id,
        name: def.name,
        type: def.type,
        multi_select: !!def.multi_select,
      });
    }
    // Not returned = no access or deleted. Remember that, or every card read
    // would ask again.
    for (const id of missing) {
      if (!this.definitions.has(id)) this.definitions.set(id, null);
    }
    if (expired) this.definitionsLoadedAt = Date.now();
  }

  private async loadOptions(propertyId: number, optionIds: number[], signal?: AbortSignal): Promise<Map<number, string>> {
    let known = this.options.get(propertyId);
    if (!known) {
      known = new Map();
      this.options.set(propertyId, known);
    }
    const missing = optionIds.filter((id) => !known!.has(id));
    if (missing.length > 0) {
      try {
        const values = await this.source.getCustomPropertySelectValues(propertyId, missing, signal);
        for (const v of values) known.set(v.id, v.value);
      } catch {
        // Fall through: unresolved options are shown by id below.
      }
    }
    return known;
  }

  /**
   * `{id_101: [3001]}` → `{"Version": "1.0.0"}`.
   *
   * Two fields with the same name (it happens: a string and a select can both
   * be called "Template") get the property id appended to stay apart.
   * Never throws: a failed lookup leaves the raw key and value in place.
   */
  async resolve(properties: Record<string, unknown> | null | undefined, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (!properties || typeof properties !== 'object') return {};
    const entries = Object.entries(properties).filter(([, v]) => v !== null && v !== undefined);
    if (entries.length === 0) return {};

    const ids = entries.map(([k]) => parsePropertyKey(k)).filter((id): id is number => id !== null);
    try {
      await this.loadDefinitions(ids, signal);
    } catch {
      // Definitions unavailable: every field falls back to its raw key.
    }

    const result: Record<string, unknown> = {};
    for (const [key, raw] of entries) {
      const id = parsePropertyKey(key);
      const def = id !== null ? this.definitions.get(id) : null;
      if (!def) {
        result[key] = plainValue(raw);
        continue;
      }

      let value: unknown;
      switch (def.type) {
        case 'select': {
          const optionIds = asIdList(raw);
          const known = await this.loadOptions(def.id, optionIds, signal);
          const names = optionIds.map((o) => known.get(o) ?? `#${o}`);
          value = def.multi_select ? names : names.length <= 1 ? names[0] ?? null : names;
          break;
        }
        case 'user': {
          const list = Array.isArray(raw) ? raw : [raw];
          await this.loadUserNames(list.filter((u): u is number => typeof u === 'number'), signal);
          const names = list.map((u) => formatUser(u, this.userNames)).filter((v): v is string => !!v);
          value = names.length === 1 ? names[0] : names;
          break;
        }
        case 'date':
          value = formatDate(raw);
          break;
        default:
          value = plainValue(raw);
      }

      const name = def.name in result ? `${def.name} (id ${def.id})` : def.name;
      result[name] = value;
    }
    return result;
  }
}
