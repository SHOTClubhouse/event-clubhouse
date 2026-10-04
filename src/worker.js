// SHOT Event Clubhouse: the Worker. Serves the static site, the JSON API (docs/API.md) and the
// scheduled demo simulation. The rules (validation, ops, votes) are the modules in public/core/,
// imported unchanged.

import { blankEvent, validate, publicView, consentText, SPORTS, SLUG, DATE } from "../public/core/model.js";
import { applyOps } from "../public/core/ops.js";
import { checkVote } from "../public/core/votes.js";
import { HttpError, json, fail, noContent, readJson, MAX_DOC_BODY, secureHtml, isHtml, notFoundPage } from "./http.js";
import { signToken, verifyToken, hashCode, ipHash, bearer, overLimit, noteAttempt, pruneAttempts, TOKEN_TTL } from "./auth.js";
import { normaliseCode, formatCode, randomCode, randomId, randomSlugPart, slugify, safeEqual, londonParts } from "./util.js";
import { loadEvent, currentRev, mutateEvent } from "./events.js";
import { roleView } from "./views.js";
import { tallyFor, existingVote, recentNewVotes, upsertVote, forget } from "./votes.js";
import { SEEDS, SEED_ORDER } from "./seeds/index.js";
import { resetDemo, simulateAll, isNightlyReset, resetAllDemos } from "./demo.js";

const WRONG_CODE = "That code didn't work. Check it and try again.";
const NOT_FOUND = "We can't find that event.";
const ROLES = ["admin", "referee", "judge", "coach"];
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

const secret = (env) => { if (!env.SECRET) throw new HttpError(500, "This server isn't set up yet."); return env.SECRET; };
const text = (v, max) => (typeof v === "string" && v.trim().length > 0 && v.trim().length <= max ? v.trim() : null);

async function connection(request, env, now) {
  return ipHash(secret(env), request.headers.get("CF-Connecting-IP") || "local", now);
}

// ---------------------------------------------------------------- auth helpers

async function staffActor(env, request, row, roles, now) {
  const token = bearer(request);
  if (!token) throw new HttpError(401, "Sign in with your access code to continue.");
  const p = await verifyToken(secret(env), token, now);
  if (!p || p.e !== row.id || !p.c) throw new HttpError(401, "Your sign-in has expired. Sign in again with your access code.");
  // codes are re-checked on every call, so revoking one takes effect straight away
  const code = await env.DB.prepare("SELECT id, role, subject, label FROM codes WHERE id = ? AND event_id = ? AND revoked = 0").bind(p.c, row.id).first();
  if (!code || code.role !== p.r) throw new HttpError(401, "Your access has been withdrawn. Ask the organiser for a new code.");
  if (roles && !roles.includes(code.role)) throw new HttpError(403, "You don't have permission to do that.");
  return { role: code.role, subject: code.subject, label: code.label, codeId: code.id };
}

async function organiserActor(env, request, now) {
  const token = bearer(request);
  if (!token) throw new HttpError(401, "Sign in with your organiser key to continue.");
  const p = await verifyToken(secret(env), token, now);
  if (!p || !p.o) throw new HttpError(401, "Your sign-in has expired. Sign in again with your organiser key.");
  const o = await env.DB.prepare("SELECT id, name FROM organisers WHERE id = ? AND revoked = 0").bind(p.o).first();
  if (!o) throw new HttpError(401, "Your access has been withdrawn. Ask SHOT for a new key.");
  return o;
}

async function limited(env, bucket, ip, windowMs, max, now, message) {
  if (await overLimit(env.DB, bucket, ip, windowMs, max, now)) throw new HttpError(429, message);
}

// ---------------------------------------------------------------- public

async function demoList(env) {
  const { results } = await env.DB.prepare("SELECT slug, doc FROM events WHERE demo = 1 AND listed = 1").all();
  const bySlug = Object.fromEntries(results.map((r) => [r.slug, JSON.parse(r.doc)]));
  const events = SEED_ORDER.filter((s) => bySlug[s]).map((slug) => {
    const seed = SEEDS[slug], doc = bySlug[slug];
    return {
      slug, name: doc.name, sport: doc.sport, phase: doc.phase, live: !!seed.sim || doc.phase === "live", blurb: seed.blurb,
      codes: seed.codes.map((c) => ({ role: c.role, label: c.label, code: formatCode(c.code) })),
    };
  });
  return json({ events });
}

async function eventList(env) {
  const { results } = await env.DB.prepare("SELECT doc, demo FROM events WHERE listed = 1").all();
  const events = results.map((r) => {
    const d = JSON.parse(r.doc);
    return { slug: d.slug, name: d.name, sport: d.sport, date: d.date, venue: d.venue, phase: d.phase, demo: !!r.demo, theme: d.theme };
  });
  events.sort((a, b) => (b.demo - a.demo) || String(b.date || "").localeCompare(String(a.date || "")) || a.name.localeCompare(b.name));
  return json({ events });
}

const wantsCurrent = (url, rev) => { const q = url.searchParams.get("rev"); return q !== null && /^\d+$/.test(q) && Number(q) === rev; };

async function publicEvent(env, url, slug) {
  const rev = await currentRev(env.DB, slug);
  if (rev === null) return fail(404, NOT_FOUND);
  if (wantsCurrent(url, rev)) return noContent();
  const row = await loadEvent(env.DB, slug);
  if (!row) return fail(404, NOT_FOUND);
  return json({ rev: row.rev, event: publicView(row.doc) });
}

async function votesGet(env, row, now) {
  return json(await tallyFor(env.DB, row, now));
}

async function votesPost(env, request, row, now) {
  const body = await readJson(request);
  const checked = checkVote(body, row.doc, now);
  if (!checked.ok) return fail(checked.status, checked.error);
  if (checked.drop) return json({ ok: true });
  const ip = await connection(request, env, now);
  const v = checked.vote;
  if (!(await existingVote(env.DB, row.id, v.voter, v.target)) && (await recentNewVotes(env.DB, ip, now - 60000)) >= 60) {
    return fail(429, "That's a lot of votes from one connection. Wait a minute and try again.");
  }
  await upsertVote(env.DB, row.id, v, ip, now).run();
  forget(row.id);
  return json({ ok: true, mine: { target: v.target, choice: v.choice, reason: v.reason }, tally: await tallyFor(env.DB, row, now, { fresh: true }) });
}

async function register(env, request, row, now) {
  const body = await readJson(request);
  if (typeof body.website === "string" && body.website.trim()) return json({ ok: true }); // bots fill the hidden field
  const ip = await connection(request, env, now);
  await limited(env, "reg", ip, 60000, 10, now, "Too many sign-ups from this connection. Wait a minute and try again.");
  await noteAttempt(env.DB, "reg", ip, now);
  const firstName = text(body.firstName, 40);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!firstName) return fail(400, "Add your first name (up to 40 characters).");
  if (email.length > 254 || !EMAIL.test(email)) return fail(400, "That email address doesn't look right. Check it and try again.");
  if (body.over13 !== true) return fail(400, "Pre-registration is for people aged 13 and over.");
  if (body.consent !== true) return fail(400, "Tick the box to say you're happy to hear from us.");
  const consent = consentText(row.doc); // the exact sentence the fan page showed
  const r = await env.DB.prepare("INSERT OR IGNORE INTO registrations (id, event_id, first_name, email, consent, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(randomId(), row.id, firstName, email, consent, ip, now).run();
  return json(r.meta.changes === 1 ? { ok: true } : { ok: true, already: true });
}

// ---------------------------------------------------------------- staff

async function fullView(env, row, actor) {
  let counts;
  if (actor.role === "admin") {
    const [reg, votes] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS n FROM registrations WHERE event_id = ?").bind(row.id).first(),
      env.DB.prepare("SELECT COUNT(*) AS n FROM votes WHERE event_id = ?").bind(row.id).first(),
    ]);
    counts = { registrations: reg.n, votes: votes.n };
    return { ...roleView(row.doc, row.rev, actor, counts), demo: !!row.demo };
  }
  return roleView(row.doc, row.rev, actor, counts);
}

async function full(env, request, url, row, now) {
  const actor = await staffActor(env, request, row, null, now);
  if (wantsCurrent(url, row.rev)) return noContent();
  return json(await fullView(env, row, actor));
}

async function ops(env, request, slug, now) {
  const row0 = await loadEvent(env.DB, slug);
  if (!row0) return fail(404, NOT_FOUND);
  const actor = await staffActor(env, request, row0, null, now);
  const body = await readJson(request);
  const who = { role: actor.role, id: actor.subject };
  const saved = await mutateEvent(env.DB, slug, (doc) => {
    const r = applyOps(doc, body.ops, who, now);
    return r.ok ? { doc: r.doc } : { error: { status: r.status, error: r.error, extra: { index: r.index } } };
  });
  if (!saved.ok) return fail(saved.status, saved.error, saved.extra || {});
  forget(row0.id);
  return json({ ok: true, ...(await fullView(env, { ...saved.row, doc: saved.doc, rev: saved.rev }, actor)) });
}

async function putDoc(env, request, slug, now) {
  const row0 = await loadEvent(env.DB, slug);
  if (!row0) return fail(404, NOT_FOUND);
  await staffActor(env, request, row0, ["admin"], now);
  const body = await readJson(request, MAX_DOC_BODY);
  if (!body.doc || typeof body.doc !== "object" || Array.isArray(body.doc) || !Number.isInteger(body.rev)) return fail(400, "Send the event and the version you loaded.");
  const saved = await mutateEvent(env.DB, slug, (_old, row) => {
    if (row.rev !== body.rev) return { error: { status: 409, error: "This event changed since you loaded it. Reload and try again." } };
    if (body.doc.slug !== row.slug) return { error: { status: 422, error: "The web address (slug) can't change." } };
    const doc = { ...body.doc };
    if (row.doc.private) doc.private = row.doc.private; else delete doc.private;
    const errs = validate(doc);
    if (errs.length) return { error: { status: 422, error: errs[0], extra: { errors: errs } } };
    return { doc };
  });
  if (!saved.ok) return fail(saved.status, saved.error, saved.extra || {});
  return json({ ok: true, rev: saved.rev });
}

async function codesList(env, row) {
  const { results } = await env.DB.prepare("SELECT id, role, subject, label, created_at, revoked FROM codes WHERE event_id = ? ORDER BY created_at, id").bind(row.id).all();
  return json({ codes: results.map((c) => ({ ...c, revoked: !!c.revoked })) });
}

async function codesCreate(env, request, row, now) {
  const body = await readJson(request);
  if (!ROLES.includes(body.role)) return fail(400, "Pick a role: admin, referee, judge or coach.");
  let subject = null, fallback = "";
  if (body.role === "referee" || body.role === "judge") {
    const o = row.doc.officials.find((x) => x.id === body.subject && x.role === body.role);
    if (!o) return fail(400, `Pick which ${body.role} this code is for. Add them to the event first.`);
    subject = o.id; fallback = o.name;
  } else if (body.role === "coach") {
    const t = row.doc.divisions.flatMap((v) => v.teams).find((x) => x.id === body.subject);
    if (!t) return fail(400, "Pick which team this code is for.");
    subject = t.id; fallback = t.name;
  } else fallback = "Organiser";
  const label = text(body.label, 60) || fallback;
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM codes WHERE event_id = ?").bind(row.id).first();
  if (n.n >= 300) return fail(409, "That's the most codes one event can have. Revoke some you no longer need.");
  const code = randomCode(12);
  const id = randomId();
  await env.DB.prepare("INSERT INTO codes (id, event_id, code_hash, role, subject, label, created_at, revoked) VALUES (?, ?, ?, ?, ?, ?, ?, 0)").bind(id, row.id, await hashCode(secret(env), code), body.role, subject, label, now).run();
  return json({ id, code: formatCode(code) });
}

async function codeRevoke(env, row, id) {
  if (row.demo) return fail(403, "Demo codes stay as they are. Use reset to put the demo back.");
  const existing = await env.DB.prepare("SELECT id, revoked FROM codes WHERE id = ? AND event_id = ?").bind(id, row.id).first();
  if (!existing) return fail(404, "We can't find that code.");
  if (existing.revoked) return json({ ok: true });
  // one statement, so the last admin code can never be revoked, even by two taps at once
  const r = await env.DB.prepare("UPDATE codes SET revoked = 1 WHERE id = ? AND event_id = ? AND (role != 'admin' OR (SELECT COUNT(*) FROM codes WHERE event_id = ? AND role = 'admin' AND revoked = 0 AND id != ?) > 0)").bind(id, row.id, row.id, id).run();
  if (r.meta.changes !== 1) return fail(409, "An event always needs one admin code. Issue another admin code first.");
  return json({ ok: true });
}

const csvCell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

async function registrations(env, url, row) {
  const { results } = await env.DB.prepare("SELECT first_name, email, consent, created_at FROM registrations WHERE event_id = ? ORDER BY created_at, email").bind(row.id).all();
  if (url.searchParams.get("format") === "csv") {
    const lines = [["first_name", "email", "consent", "created_at"].join(",")].concat(results.map((r) => [r.first_name, r.email, r.consent, new Date(r.created_at).toISOString()].map(csvCell).join(",")));
    return new Response(`${lines.join("\r\n")}\r\n`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${row.slug}-registrations.csv"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  }
  return json({ count: results.length, rows: results });
}

// ---------------------------------------------------------------- organisers

async function signInOrganiser(env, request, now) {
  const body = await readJson(request);
  const ip = await connection(request, env, now);
  await limited(env, "auth", ip, 10 * 60000, 10, now, "Too many tries. Wait ten minutes and try again.");
  const key = normaliseCode(body.key, 16);
  const o = key ? await env.DB.prepare("SELECT id, name FROM organisers WHERE key_hash = ? AND revoked = 0").bind(await hashCode(secret(env), key)).first() : null;
  if (!o) { await noteAttempt(env.DB, "auth", ip, now); return fail(401, "That key didn't work. Check it and try again."); }
  return json({ token: await signToken(secret(env), { o: o.id, x: now + TOKEN_TTL }), organiser: { id: o.id, name: o.name } });
}

async function shotOrganiser(env, request, now) {
  const ip = await connection(request, env, now);
  await limited(env, "shot", ip, 10 * 60000, 10, now, "Too many tries. Wait ten minutes and try again.");
  const given = request.headers.get("X-Shot-Admin") || "";
  if (!env.SHOT_ADMIN || !safeEqual(given, env.SHOT_ADMIN)) { await noteAttempt(env.DB, "shot", ip, now); return fail(403, "That isn't allowed."); }
  const body = await readJson(request);
  const name = text(body.name, 80);
  if (!name) return fail(400, "Add the organiser's name (up to 80 characters).");
  const key = randomCode(16), id = randomId();
  await env.DB.prepare("INSERT INTO organisers (id, name, key_hash, created_at, revoked) VALUES (?, ?, ?, ?, 0)").bind(id, name, await hashCode(secret(env), key), now).run();
  return json({ id, key: formatCode(key) });
}

async function shotListing(env, request, slug) {
  const given = request.headers.get("X-Shot-Admin") || "";
  if (!env.SHOT_ADMIN || !safeEqual(given, env.SHOT_ADMIN)) return fail(403, "That isn't allowed.");
  const body = await readJson(request);
  if (typeof body.listed !== "boolean") return fail(400, "Say whether the event is listed: true or false.");
  const r = await env.DB.prepare("UPDATE events SET listed = ? WHERE slug = ?").bind(body.listed ? 1 : 0, slug).run();
  return r.meta.changes === 1 ? json({ ok: true, listed: body.listed }) : fail(404, NOT_FOUND);
}

async function organiserEvents(env, request, now) {
  const o = await organiserActor(env, request, now);
  const { results } = await env.DB.prepare("SELECT doc, listed, created_at FROM events WHERE organiser = ? ORDER BY created_at DESC").bind(o.id).all();
  return json({ events: results.map((r) => { const d = JSON.parse(r.doc); return { slug: d.slug, name: d.name, sport: d.sport, date: d.date, phase: d.phase, listed: !!r.listed, created_at: r.created_at }; }) });
}

// An organiser opens one of their own events without typing its admin code: the session is
// tied to the event's oldest live admin code, so revoking that code still ends it.
async function organiserSession(env, request, slug, now) {
  const o = await organiserActor(env, request, now);
  const row = await env.DB.prepare("SELECT id, slug, json_extract(doc, '$.name') AS name, json_extract(doc, '$.sport') AS sport FROM events WHERE slug = ? AND organiser = ?").bind(slug, o.id).first();
  if (!row) return fail(404, "That isn't one of your events.");
  const c = await env.DB.prepare("SELECT id, label FROM codes WHERE event_id = ? AND role = 'admin' AND revoked = 0 ORDER BY created_at LIMIT 1").bind(row.id).first();
  if (!c) return fail(409, "This event has no admin code left. Ask SHOT to restore access.");
  const token = await signToken(secret(env), { e: row.id, r: "admin", s: null, c: c.id, x: now + TOKEN_TTL });
  return json({ token, role: "admin", subject: null, label: c.label, event: { slug: row.slug, name: row.name, sport: row.sport } });
}

async function createEvent(env, request, now) {
  const o = await organiserActor(env, request, now);
  const body = await readJson(request);
  const name = text(body.name, 80);
  if (!name) return fail(400, "Give the event a name (up to 80 characters).");
  if (!SPORTS.includes(body.sport)) return fail(400, "Pick football or boxing.");
  let date = null;
  if (body.date != null && body.date !== "") {
    if (typeof body.date !== "string" || !DATE.test(body.date) || Number.isNaN(Date.parse(body.date))) return fail(400, "Use a date like 2026-10-31.");
    date = body.date;
  }
  const exists = async (s) => !!(await env.DB.prepare("SELECT 1 AS x FROM events WHERE slug = ?").bind(s).first());
  let slug;
  if (body.slug != null && body.slug !== "") {
    slug = String(body.slug);
    if (!SLUG.test(slug)) return fail(400, "Web addresses use 3 to 48 lower-case letters, numbers and dashes.");
    if (await exists(slug)) return fail(409, "That web address is taken. Try another.");
  } else {
    let base = slugify(name);
    if (base.length < 3) base = "event";
    slug = base;
    for (let i = 0; i < 5 && (await exists(slug)); i++) slug = `${base}-${randomSlugPart(4)}`;
    if (await exists(slug)) return fail(409, "We couldn't find a free web address. Try another name.");
  }
  const doc = blankEvent({ slug, name, sport: body.sport, date });
  const errs = validate(doc);
  if (errs.length) return fail(422, errs[0]);
  const id = randomId(), code = randomCode(12);
  try {
    await env.DB.batch([
      // unlisted until SHOT lists it: a new event is reached by its link only
      env.DB.prepare("INSERT INTO events (id, slug, organiser, demo, listed, doc, rev, created_at, updated_at) VALUES (?, ?, ?, 0, 0, ?, 1, ?, ?)").bind(id, slug, o.id, JSON.stringify(doc), now, now),
      env.DB.prepare("INSERT INTO codes (id, event_id, code_hash, role, subject, label, created_at, revoked) VALUES (?, ?, ?, 'admin', NULL, 'Organiser', ?, 0)").bind(randomId(), id, await hashCode(secret(env), code), now),
    ]);
  } catch (e) { return fail(409, "That web address is taken. Try another."); }
  return json({ slug, adminCode: formatCode(code), event: doc });
}

async function signIn(env, request, now) {
  const body = await readJson(request);
  const ip = await connection(request, env, now);
  await limited(env, "auth", ip, 10 * 60000, 10, now, "Too many tries. Wait ten minutes and try again.");
  const code = normaliseCode(body.code);
  const c = code ? await env.DB.prepare("SELECT c.id, c.role, c.subject, c.label, c.event_id, e.slug, json_extract(e.doc, '$.name') AS name, json_extract(e.doc, '$.sport') AS sport FROM codes c JOIN events e ON e.id = c.event_id WHERE c.code_hash = ? AND c.revoked = 0").bind(await hashCode(secret(env), code)).first() : null;
  if (!c) { await noteAttempt(env.DB, "auth", ip, now); return fail(401, WRONG_CODE); }
  const token = await signToken(secret(env), { e: c.event_id, r: c.role, s: c.subject, c: c.id, x: now + TOKEN_TTL });
  return json({ token, role: c.role, subject: c.subject, label: c.label, event: { slug: c.slug, name: c.name, sport: c.sport } });
}

// ---------------------------------------------------------------- routing

async function api(request, env, url, now) {
  const p = url.pathname.replace(/\/+$/, "").split("/").slice(1); // ["api", ...]
  const m = request.method;
  const allow = (...methods) => { if (!methods.includes(m)) throw new HttpError(405, "That isn't allowed here."); };
  const [, a, b, c, d] = p;

  if (a === "demo" && !b) { allow("GET"); return demoList(env); }
  if (a === "auth") {
    allow("POST");
    if (!b) return signIn(env, request, now);
    if (b === "organiser" && !c) return signInOrganiser(env, request, now);
  }
  if (a === "shot") {
    allow("POST");
    if (b === "organisers" && !c) return shotOrganiser(env, request, now);
    if (b === "events" && c && SLUG.test(c) && d === "listing") return shotListing(env, request, c);
  }
  if (a === "organiser" && b === "events" && !c) { allow("GET"); return organiserEvents(env, request, now); }
  if (a === "organiser" && b === "events" && c && SLUG.test(c) && d === "session" && p.length === 5) { allow("POST"); return organiserSession(env, request, c, now); }

  if (a === "events") {
    if (!b) {
      allow("GET", "POST");
      return m === "GET" ? eventList(env) : createEvent(env, request, now);
    }
    if (!SLUG.test(b)) return fail(404, NOT_FOUND);
    if (!c) { allow("GET"); return publicEvent(env, url, b); }

    if (c === "ops" && !d) { allow("POST"); return ops(env, request, b, now); }
    if (c === "doc" && !d) { allow("PUT"); return putDoc(env, request, b, now); }

    const row = await loadEvent(env.DB, b);
    if (!row) return fail(404, NOT_FOUND);
    if (c === "votes" && !d) { allow("GET", "POST"); return m === "GET" ? votesGet(env, row, now) : votesPost(env, request, row, now); }
    if (c === "register" && !d) { allow("POST"); return register(env, request, row, now); }
    if (c === "full" && !d) { allow("GET"); return full(env, request, url, row, now); }
    if (c === "codes") {
      await staffActor(env, request, row, ["admin"], now);
      if (!d) { allow("GET", "POST"); return m === "GET" ? codesList(env, row) : codesCreate(env, request, row, now); }
      const e = p[5];
      if (e === "revoke" && p.length === 6) { allow("POST"); return codeRevoke(env, row, d); }
    }
    if (c === "registrations" && !d) { allow("GET"); await staffActor(env, request, row, ["admin"], now); return registrations(env, url, row); }
    if (c === "reset" && !d) {
      allow("POST");
      await staffActor(env, request, row, ["admin"], now);
      if (!row.demo) return fail(403, "Only demo events can be reset.");
      return (await resetDemo(env.DB, row, now)) ? json({ ok: true }) : fail(409, "This demo can't be reset.");
    }
  }
  return fail(404, "Not found.");
}

async function eventPage(request, env, url, m) {
  const slug = m[1];
  const row = SLUG.test(slug) ? await env.DB.prepare("SELECT listed FROM events WHERE slug = ?").bind(slug).first() : null;
  if (!row) return notFoundPage();
  if (m[2] === undefined) return new Response(null, { status: 301, headers: { Location: `/e/${slug}/${url.search}` } });
  const asset = /^\/screen(\/|$)/.test(m[2]) ? "/screen/" : "/event/";
  const res = await env.ASSETS.fetch(new Request(new URL(asset, url), request));
  return secureHtml(res, { noindex: !row.listed });
}

async function route(request, env) {
  const url = new URL(request.url);
  const now = Date.now();
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    const res = await api(request, env, url, now);
    res.headers.set("Cache-Control", "no-store");
    return res;
  }
  if (request.method !== "GET" && request.method !== "HEAD") return fail(405, "That isn't allowed here.");
  const page = url.pathname.match(/^\/e\/([^/]+)(\/.*)?$/);
  if (page) return eventPage(request, env, url, page);
  const res = await env.ASSETS.fetch(request);
  return isHtml(res) ? secureHtml(res) : res;
}

async function cron(env) {
  const start = Date.now();
  if (isNightlyReset(start)) await resetAllDemos(env.DB, start);
  if (londonParts(start).minute === 30) await pruneAttempts(env.DB, start);
  const ticks = Math.min(6, Math.max(1, Number(env.SIM_TICKS) || 3));
  const gap = Number(env.SIM_TICK_MS) || 20000;
  for (let i = 0; i < ticks; i++) {
    if (i) await new Promise((r) => setTimeout(r, gap));
    await simulateAll(env.DB, Date.now());
  }
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (e) {
      if (e instanceof HttpError) return fail(e.status, e.message, e.extra || {});
      console.error(e && e.stack ? e.stack : e);
      return fail(500, "Something went wrong on our side. Try again in a moment.");
    }
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(cron(env).catch((e) => console.error("cron failed", e && e.stack ? e.stack : e)));
  },
};

