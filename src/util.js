// Small shared helpers: WebCrypto, access codes, slugs, London time. No Worker-only APIs, so the
// scripts and the tests import this file too.

export const enc = new TextEncoder();
export const dec = new TextDecoder();

export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function toB64u(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64u(str) {
  if (typeof str !== "string" || !/^[A-Za-z0-9_-]*$/.test(str)) throw new Error("bad base64url");
  const pad = "=".repeat((4 - (str.length % 4)) % 4);
  const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(text) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text))));
}

export async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

// Constant-time comparison: always walks the longer input, never exits early.
export function safeEqual(a, b) {
  const x = typeof a === "string" ? enc.encode(a) : a;
  const y = typeof b === "string" ? enc.encode(b) : b;
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// ---- Access codes: characters from an alphabet without I, L, O, 0, 1 ----
export function randomCode(len = 12) {
  let out = "";
  const limit = 256 - (256 % CODE_ALPHABET.length); // reject the top bytes so every character is equally likely
  while (out.length < len) {
    for (const b of crypto.getRandomValues(new Uint8Array(len * 2))) {
      if (b < limit && out.length < len) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return out;
}

// Case-insensitive, dashes and spaces ignored. Returns the bare code or null.
export function normaliseCode(input, len = 12) {
  if (typeof input !== "string" || input.length > 64) return null;
  const s = input.toUpperCase().replace(/[\s-]/g, "");
  return new RegExp(`^[${CODE_ALPHABET}]{${len}}$`).test(s) ? s : null;
}

export const formatCode = (s) => s.match(/.{1,4}/g).join("-");

export const randomId = (bytes = 9) => toB64u(crypto.getRandomValues(new Uint8Array(bytes)));

const SLUG_CHARS = "abcdefghjkmnpqrstuvwxyz23456789"; // 31 characters, nothing easily misread
export function randomSlugPart(n) {
  let out = "";
  const limit = 256 - (256 % SLUG_CHARS.length);
  while (out.length < n) {
    for (const b of crypto.getRandomValues(new Uint8Array(n * 2))) {
      if (b < limit && out.length < n) out += SLUG_CHARS[b % SLUG_CHARS.length];
    }
  }
  return out;
}

export function slugify(name) {
  return String(name || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 40).replace(/-+$/, "");
}

// ---- London time ----
const LONDON = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function londonParts(ms) {
  const p = Object.fromEntries(LONDON.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), hhmm: `${p.hour}:${p.minute}` };
}

export function addDays(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
