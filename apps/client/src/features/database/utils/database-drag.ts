import { extractPageSlugId } from '@/lib';

export const DOCMOST_PAGE_MIME = 'application/x-docmost-page';
export const DOCMOST_DATABASE_RECORD_MIME = 'application/x-docmost-database-record';

export interface DocmostPageDragPayload {
  pageId?: string;
  slugId?: string;
  title?: string;
  icon?: string | null;
  sourceDatabaseId?: string;
  sourceRecordId?: string;
}

export interface DocmostDatabaseRecordDragPayload {
  recordId?: string;
  sourceDatabaseId?: string;
}

declare global {
  interface Window {
    __docmostPageDragPayload?: DocmostPageDragPayload | null;
    __docmostDatabaseRecordDragPayload?: DocmostDatabaseRecordDragPayload | null;
  }
}

export function pageSlugIdFromDragText(value: string) {
  const candidate = value
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#'));

  if (!candidate) return null;
  if (!candidate.includes('/p/')) return null;

  const withoutHash = candidate.split('#')[0];
  return extractPageSlugId(withoutHash);
}

export function setActivePageDragPayload(payload: DocmostPageDragPayload | null) {
  if (typeof window === 'undefined') return;
  window.__docmostPageDragPayload = payload;
}

export function setActiveDatabaseRecordDragPayload(
  payload: DocmostDatabaseRecordDragPayload | null,
) {
  if (typeof window === 'undefined') return;
  window.__docmostDatabaseRecordDragPayload = payload;
}

export function clearDocmostDragPayloads() {
  if (typeof window === 'undefined') return;
  window.__docmostPageDragPayload = null;
  window.__docmostDatabaseRecordDragPayload = null;
}

export function setDocmostPageDragData(
  dataTransfer: DataTransfer,
  payload: DocmostPageDragPayload,
  plainText?: string,
) {
  dataTransfer.effectAllowed = 'move';
  dataTransfer.setData(DOCMOST_PAGE_MIME, JSON.stringify(payload));
  if (plainText) {
    dataTransfer.setData('text/plain', plainText);
    dataTransfer.setData('text/uri-list', plainText);
  }
  setActivePageDragPayload(payload);
}

export function parseDocmostPageDragPayload(
  dataTransfer?: DataTransfer | null,
): DocmostPageDragPayload | null {
  if (dataTransfer) {
    const rawPayload = dataTransfer.getData(DOCMOST_PAGE_MIME);
    if (rawPayload) {
      try {
        return JSON.parse(rawPayload) as DocmostPageDragPayload;
      } catch {
        // Keep parsing URL/plain text fallbacks.
      }
    }

    const html = dataTransfer.getData('text/html');
    const htmlPayload = html ? pagePayloadFromHtml(html) : null;
    if (htmlPayload) return htmlPayload;

    const uriList = dataTransfer.getData('text/uri-list');
    const uriSlugId = uriList ? pageSlugIdFromDragText(uriList) : null;
    if (uriSlugId) return { pageId: uriSlugId, slugId: uriSlugId };

    const plainText = dataTransfer.getData('text/plain');
    const slugId = plainText ? pageSlugIdFromDragText(plainText) : null;
    if (slugId) return { pageId: slugId, slugId };
  }

  return typeof window === 'undefined' ? null : window.__docmostPageDragPayload ?? null;
}

function pagePayloadFromHtml(html: string): DocmostPageDragPayload | null {
  if (!html.trim()) return null;

  try {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const mention = document.querySelector<HTMLElement>(
      '[data-entity-type="page"][data-slug-id], [data-type="mention"][data-entity-type="page"][data-slug-id]',
    );

    if (mention) {
      const slugId = mention.getAttribute('data-slug-id') || undefined;
      const pageId = mention.getAttribute('data-entity-id') || slugId;
      if (pageId || slugId) {
        return {
          pageId,
          slugId,
          title: mention.getAttribute('data-label') || mention.textContent?.trim() || undefined,
        };
      }
    }

    const pageLink = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
      .map((link) => ({
        slugId: pageSlugIdFromDragText(link.href),
        title: link.textContent?.trim(),
      }))
      .find((item) => item.slugId);

    if (pageLink?.slugId) {
      return {
        pageId: pageLink.slugId,
        slugId: pageLink.slugId,
        title: pageLink.title || undefined,
      };
    }
  } catch {
    return null;
  }

  return null;
}

export function setDocmostDatabaseRecordDragData(
  dataTransfer: DataTransfer,
  payload: DocmostDatabaseRecordDragPayload,
) {
  dataTransfer.setData(DOCMOST_DATABASE_RECORD_MIME, JSON.stringify(payload));
  setActiveDatabaseRecordDragPayload(payload);
}

export function parseDocmostDatabaseRecordDragPayload(
  dataTransfer?: DataTransfer | null,
): DocmostDatabaseRecordDragPayload | null {
  if (dataTransfer) {
    const rawRecord = dataTransfer.getData(DOCMOST_DATABASE_RECORD_MIME);
    if (rawRecord) {
      try {
        return JSON.parse(rawRecord) as DocmostDatabaseRecordDragPayload;
      } catch {
        return { recordId: rawRecord };
      }
    }
  }

  return typeof window === 'undefined'
    ? null
    : window.__docmostDatabaseRecordDragPayload ?? null;
}

export function hasDocmostPageLikeDrag(dataTransfer: DataTransfer) {
  return (
    dataTransfer.types.includes(DOCMOST_DATABASE_RECORD_MIME) ||
    dataTransfer.types.includes(DOCMOST_PAGE_MIME) ||
    dataTransfer.types.includes('text/uri-list') ||
    dataTransfer.types.includes('text/plain') ||
    Boolean(typeof window !== 'undefined' && window.__docmostPageDragPayload)
  );
}
