// Tokens, code hashes and the rate limits that slow down guessing and spam.

import { enc, dec, toB64u, fromB64u, hmac, sha256Hex, safeEqual } from "./util.js";

export const TOKEN_TTL = 30 * 24 * 60 * 60 * 1000;

// token = base64url(payload) + "." + base64url(HMAC-SHA256(SECRET, base64url(payload)))
export async function signToken(secret, payload) {
  const body = toB64u(enc.encode(JSON.stringify(payload)));
  return `${body}.${toB64u(await hmac(secret, body))}`;
}

// Returns the payload, or null for anything forged, mangled or expired.
export async function verifyToken(secret, token, now = Date.now()) {
  if (typeof token !== "string" || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const expected = toB64u(await hmac(secret, parts[0]));
  if (!safeEqual(expected, parts[1])) return null;
  try {
    const payload = JSON.parse(dec.decode(fromB64u(parts[0])));
    if (!payload || typeof payload !== "object" || typeof payload.x !== "number" || payload.x <= now) return null;
    return payload;
  } catch (e) { return null; }
}

// Only this hash is stored. code must already be normalised (no dashes, upper case).
export const hashCode = (secret, code) => sha256Hex(`${secret}:${code}`);

// A connection, as a daily-rotating hash, so nobody's address is stored.
// The part of an address that identifies one connection for rate limits: the whole IPv4
// address, or the /64 network for IPv6 (one home or phone gets a whole /64 and can rotate
// through it).
export function connectionKey(ip) {
  if (typeof ip !== "string" || !ip.includes(":")) return ip;
  const [head, tail] = ip.toLowerCase().split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const full = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return `${full.slice(0, 4).map((x) => x.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

export const ipHash = (secret, ip, now = Date.now()) => sha256Hex(secret + ip + new Date(now).toISOString().slice(0, 10));

export const bearer = (request) => {
  const h = request.headers.get("Authorization") || "";
  return /^Bearer /i.test(h) ? h.slice(7).trim() : null;
};

// ---- Rate limits, kept in the attempts table under a prefix per purpose ----
export async function overLimit(db, bucket, ip, windowMs, max, now) {
  const r = await db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE ip_hash = ? AND at > ?").bind(`${bucket}:${ip}`, now - windowMs).first();
  return (r ? r.n : 0) >= max;
}

export const noteAttempt = (db, bucket, ip, now) => db.prepare("INSERT INTO attempts (ip_hash, at) VALUES (?, ?)").bind(`${bucket}:${ip}`, now).run();

export const pruneAttempts = (db, now) => db.prepare("DELETE FROM attempts WHERE at < ?").bind(now - 24 * 60 * 60 * 1000).run();
