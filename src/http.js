// Responses, errors, body limits and security headers.

export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

export const MAX_BODY = 256 * 1024;
export const MAX_DOC_BODY = 1024 * 1024;

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers },
  });
}

export const noContent = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
export const fail = (status, error, extra = {}) => json({ error, ...extra }, status);

// Reads a JSON object body, refusing anything over the cap (checked on the header and again
// while reading, because the header can lie or be missing).
export async function readJson(request, max = MAX_BODY) {
  const tooBig = () => new HttpError(413, "That is too much to send in one go.");
  const unreadable = () => new HttpError(400, "We could not read that. Refresh the page and try again.");
  if (!/^application\/json\b/i.test(request.headers.get("Content-Type") || "")) throw new HttpError(415, "Send the details as JSON.");
  if (Number(request.headers.get("Content-Length")) > max) throw tooBig();
  const chunks = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) { reader.cancel().catch(() => {}); throw tooBig(); }
      chunks.push(value);
    }
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.length; }
  let body;
  try { body = JSON.parse(new TextDecoder().decode(all) || "null"); } catch (e) { throw unreadable(); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw unreadable();
  return body;
}

export const CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://shotclubhouse.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' https:",
  "frame-src 'self' https://www.youtube-nocookie.com https://player.twitch.tv https://open.spotify.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

// Adds the security headers to an HTML response (and noindex for unlisted events).
export function secureHtml(res, { noindex = false } = {}) {
  const out = new Response(res.body, res);
  out.headers.set("X-Content-Type-Options", "nosniff");
  out.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  out.headers.set("Content-Security-Policy", CSP);
  out.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  if (noindex) out.headers.set("X-Robots-Tag", "noindex");
  return out;
}

export const isHtml = (res) => /text\/html/i.test(res.headers.get("Content-Type") || "");

export function notFoundPage() {
  const body = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Event not found | SHOT Event Clubhouse</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#020304;color:#fff;font:16px/1.5 Inter,system-ui,sans-serif;text-align:center;padding:24px}h1{font-family:Anton,Impact,sans-serif;text-transform:uppercase;font-weight:400;font-size:2rem;margin:0 0 8px}a{color:#1abc9c;display:inline-block;min-height:44px;line-height:44px}</style></head><body><main><h1>We can't find that event</h1><p>Check the link, or try one of the live demos.</p><a href="/demo/">See the demo events</a></main></body></html>`;
  return secureHtml(new Response(body, { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }), { noindex: true });
}
