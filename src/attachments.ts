import type { KaitenFile } from './kaiten-client.js';

const imageMimeTypes = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const imageMimeTypesByExtension: Record<string, string> = {
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export interface CardAttachmentSummary {
  id: string;
  name: string;
  size: number | null;
  mime_type: string | null;
  comment_id: string | null;
  source: string;
  type: number | null;
  is_image: boolean;
}

export function normalizeMimeType(value?: string | null): string | null {
  const mimeType = value?.split(';', 1)[0]?.trim().toLowerCase();
  return mimeType || null;
}

export function inferImageMimeType(file: KaitenFile): string | null {
  const declaredMimeType = normalizeMimeType(file.mime_type);
  if (declaredMimeType && imageMimeTypes.has(declaredMimeType)) {
    return declaredMimeType;
  }

  const extension = file.name.split('.').pop()?.toLowerCase();
  return extension ? imageMimeTypesByExtension[extension] || null : null;
}

export function fileSizeInBytes(file: KaitenFile): number | null {
  if (file.size === undefined || file.size === null) return null;
  const size = Number(file.size);
  return Number.isFinite(size) && size >= 0 ? size : null;
}

export function listCardAttachments(
  files: KaitenFile[] = [],
  imagesOnly = false,
): CardAttachmentSummary[] {
  return files
    .filter((file) => !file.deleted)
    .filter((file) => !imagesOnly || inferImageMimeType(file) !== null)
    .map((file) => ({
      id: String(file.uid || file.id),
      name: file.name,
      size: fileSizeInBytes(file),
      mime_type: normalizeMimeType(file.mime_type) || inferImageMimeType(file),
      comment_id: file.comment_id == null ? null : String(file.comment_id),
      source: file.entity_type || (file.comment_id == null ? 'card' : 'comment'),
      type: file.type ?? null,
      is_image: inferImageMimeType(file) !== null,
    }));
}

export function selectCardImages(
  files: KaitenFile[] = [],
  fileIds: Array<string | number> | undefined,
  limit: number,
): KaitenFile[] {
  const requestedIds = fileIds?.length
    ? new Set(fileIds.map(String))
    : null;

  return files
    .filter((file) => !file.deleted && inferImageMimeType(file) !== null)
    .filter((file) => {
      if (!requestedIds) return true;
      return requestedIds.has(String(file.id)) ||
        (file.uid != null && requestedIds.has(String(file.uid)));
    })
    .slice(0, limit);
}

export function validateFileSize(
  file: KaitenFile,
  actualSize: number,
  maxBytes: number,
  limitKind: 'image' | 'file' = 'image',
): void {
  const declaredSize = fileSizeInBytes(file);
  if (
    (declaredSize !== null && declaredSize > maxBytes) ||
    actualSize > maxBytes
  ) {
    throw new Error(`${file.name} exceeds the ${maxBytes}-byte ${limitKind} limit`);
  }
}

export function resolveDownloadedImageMimeType(
  file: KaitenFile,
  contentType?: string | null,
): string {
  const responseMimeType = normalizeMimeType(contentType);
  if (responseMimeType && responseMimeType !== 'application/octet-stream') {
    if (!imageMimeTypes.has(responseMimeType)) {
      throw new Error(`Unsupported image MIME type: ${responseMimeType}`);
    }
    return responseMimeType;
  }

  const inferredMimeType = inferImageMimeType(file);
  if (!inferredMimeType) {
    throw new Error(`Unsupported image type: ${file.name}`);
  }
  return inferredMimeType;
}

export function isSafeImageDownloadUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  const hostname = url.hostname.toLowerCase();
  const unsafeHostname = hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '::1' ||
    hostname.startsWith('fc') ||
    hostname.startsWith('fd') ||
    hostname.startsWith('fe80:') ||
    /^(10|127)\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^169\.254\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);

  return url.protocol === 'https:' && !unsafeHostname;
}

export function findCardFile(
  files: KaitenFile[] = [],
  fileId: string | number,
): KaitenFile | undefined {
  const requestedId = String(fileId);
  return files.find((file) => !file.deleted && (
    String(file.id) === requestedId ||
    (file.uid != null && String(file.uid) === requestedId)
  ));
}

/**
 * Returns the file as text when it is valid UTF-8 without NUL bytes, otherwise null.
 * Content sniffing, not the MIME type: Kaiten leaves mime_type empty for most uploads.
 */
export function decodeTextFile(data: Buffer): string | null {
  if (data.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/^﻿/, '');
  } catch {
    return null;
  }
}

// Names Windows refuses as a file, whatever the extension (con.txt is as bad as con)
const windowsReservedNames = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;

/**
 * Keeps a Kaiten file name usable as a single local path segment on Linux, macOS and Windows:
 * no separators or characters Windows rejects, no leading dots (hidden files, `..`), no trailing
 * dots or spaces (Windows drops them), no reserved device names, and short enough that the
 * whole temp path stays under the Windows 260-character limit.
 */
export function safeLocalFileName(name: string, maxLength = 120): string {
  const trimEdges = (value: string) => value.trim().replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  let cleaned = trimEdges(name.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_'));
  if (!cleaned) return 'file';
  if (windowsReservedNames.test(cleaned.split('.')[0].trim())) cleaned = `_${cleaned}`;

  const chars = Array.from(cleaned);
  if (chars.length <= maxLength) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  const extension = dot > 0 && cleaned.length - dot <= 16 ? cleaned.slice(dot) : '';
  const stem = Array.from(extension ? cleaned.slice(0, dot) : cleaned)
    .slice(0, maxLength - extension.length)
    .join('');
  return trimEdges(stem) + extension;
}

export interface TextSlice {
  text: string;
  start: number;
  end: number;
  total: number;
}

/**
 * Cuts a page out of a text file by UTF-16 offsets (what next_offset reports) without
 * splitting a surrogate pair, so an emoji on the boundary moves whole to the next page.
 */
export function sliceText(text: string, offset: number, maxChars: number): TextSlice {
  const isHighSurrogate = (i: number) => {
    const code = text.charCodeAt(i);
    return code >= 0xd800 && code <= 0xdbff;
  };
  const isLowSurrogate = (i: number) => {
    const code = text.charCodeAt(i);
    return code >= 0xdc00 && code <= 0xdfff;
  };

  let start = Math.min(offset, text.length);
  if (start > 0 && isLowSurrogate(start) && isHighSurrogate(start - 1)) start--;
  let end = Math.min(start + maxChars, text.length);
  if (end > start + 1 && isHighSurrogate(end - 1) && isLowSurrogate(end)) end--;

  return { text: text.slice(start, end), start, end, total: text.length };
}
