// Per-article version counter. Increments every time we successfully PUT
// content for an article (via /kb/publish Step 3 or /kb/publish + repair).
// Resets on Render restart — that's fine for the demo; users can see the
// counter grow during a session and rebuild on next publish.
//
// Version 1 = initial creation (after first POST + PUT in /kb/publish).
// Each subsequent PUT bumps. We don't try to be clever about "did the
// content actually change" — ITHub updates ModifiedUtc on any PUT, so the
// user-facing semantics match: every save = new version.

const versions = new Map<number, number>();

export function getVersion(articleId: number): number {
  return versions.get(articleId) ?? 0;
}

export function bumpVersion(articleId: number): number {
  const next = (versions.get(articleId) ?? 0) + 1;
  versions.set(articleId, next);
  return next;
}