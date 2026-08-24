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

export function validateImageSize(
  file: KaitenFile,
  actualSize: number,
  maxBytes: number,
): void {
  const declaredSize = fileSizeInBytes(file);
  if (declaredSize !== null && declaredSize > maxBytes) {
    throw new Error(`${file.name} exceeds the ${maxBytes}-byte image limit`);
  }
  if (actualSize > maxBytes) {
    throw new Error(`${file.name} exceeds the ${maxBytes}-byte image limit`);
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
