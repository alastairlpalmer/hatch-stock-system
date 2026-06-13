/**
 * Build a Content-Disposition: attachment header value that is always safe to
 * pass to res.setHeader — Node throws ERR_INVALID_CHAR if a header value
 * contains any non-ASCII (e.g. an en-dash in a filename), which 500s the
 * request. We emit an ASCII-only `filename="…"` fallback plus an RFC 5987
 * `filename*=UTF-8''…` with the real (percent-encoded) name for modern browsers.
 */
export function contentDispositionAttachment(filename) {
  const name = String(filename || 'download');
  // ASCII fallback: replace anything outside printable ASCII, and strip quotes/
  // backslashes that would break the quoted-string.
  const ascii = name.normalize('NFKD').replace(/[^\x20-\x7E]/g, '-').replace(/["\\]/g, '');
  const encoded = encodeURIComponent(name);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
