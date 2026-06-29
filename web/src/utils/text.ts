// Shared text utilities for ITHub-decoded content. ITHub stores Chinese as
// HTML entities on read (`&#x67E5;` for 查, `&#65;` for A, plus named like
// `&amp;`). The old per-component regex copies were inconsistent — this is
// the single source of truth.

export function decodeHtmlEntities(s: string): string {
  return s
    // Hex entities (preferred form — ITHub uses these for non-ASCII).
    // MUST be base-16: e.g. `&#x5B89;` = 安.
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    // Decimal entities.
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    // Named entities ITHub actually emits.
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

// Combined: decode entities + strip HTML tags + normalize whitespace.
// Matches the old `stripHtml` helper that lived in TicketTimeline.tsx but
// factored out so KbPage can reuse it.
export function stripHtml(s: string): string {
  return decodeHtmlEntities(s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}