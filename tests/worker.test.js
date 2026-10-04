import { test } from "node:test";
import assert from "node:assert/strict";
import { signToken, verifyToken, hashCode, ipHash, TOKEN_TTL } from "../src/auth.js";
import { normaliseCode, formatCode, randomCode, slugify, safeEqual, CODE_ALPHABET, londonParts, addDays } from "../src/util.js";
import { roleView } from "../src/views.js";
import { readJson, MAX_BODY, CSP } from "../src/http.js";
import { SEEDS, SEED_ORDER, buildDemo, demoStatements } from "../src/seeds/index.js";
import { simStep, runStep } from "../src/sim.js";
import { rng } from "../src/seeds/lib.js";
import { toSql } from "../scripts/lib.js";
import { validate } from "../public/core/model.js";
import { champion } from "../public/core/standings.js";
import { tally } from "../public/core/votes.js";
import { decision } from "../public/core/boxing.js";

const NOW = Date.parse("2026-10-04T12:00:00Z");

// ---- codes ----
test("codes are case-insensitive and ignore dashes and spaces; look-alike characters are refused", () => {
  assert.equal(normaliseCode("abcd-efgh-jkmn"), "ABCDEFGHJKMN");
  assert.equal(normaliseCode(" ABCD EFGH JKMN "), "ABCDEFGHJKMN");
  assert.equal(normaliseCode("ABCD-EFGH-JKM"), null, "too short");
  assert.equal(normaliseCode("ABCD-EFGH-JKMNP"), null, "too long");
  for (const bad of ["I", "L", "O", "0", "1"]) assert.equal(normaliseCode(`ABCD-EFGH-JKM${bad}`), null, bad);
  assert.equal(normaliseCode(12345), null);
  assert.equal(normaliseCode("A".repeat(500)), null);
  assert.equal(normaliseCode("ABCDEFGHJKMNPQRS", 16), "ABCDEFGHJKMNPQRS");
});

test("generated codes use the alphabet and format as 4-4-4", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const c = randomCode(12);
    assert.equal(c.length, 12);
    assert.ok([...c].every((ch) => CODE_ALPHABET.includes(ch)));
    assert.match(formatCode(c), /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.equal(normaliseCode(formatCode(c)), c);
    seen.add(c);
  }
  assert.ok(seen.size > 190, "codes should not repeat");
});

test("code hashes depend on the secret and ignore how the code was typed", async () => {
  const a = await hashCode("secret-one", normaliseCode("abcd-efgh-jkmn"));
  assert.equal(a, await hashCode("secret-one", normaliseCode("ABCD EFGH JKMN")));
  assert.notEqual(a, await hashCode("secret-two", "ABCDEFGHJKMN"));
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("a connection hash changes with the day and the address, and never contains the address", async () => {
  const a = await ipHash("s", "203.0.113.5", NOW);
  assert.equal(a, await ipHash("s", "203.0.113.5", NOW + 1000));
  assert.notEqual(a, await ipHash("s", "203.0.113.5", NOW + 86400000));
  assert.notEqual(a, await ipHash("s", "203.0.113.6", NOW));
  assert.ok(!a.includes("203"));
});

test("safeEqual compares strings and bytes without caring about length order", () => {
  assert.ok(safeEqual("abc", "abc"));
  assert.ok(!safeEqual("abc", "abd"));
  assert.ok(!safeEqual("abc", "abcd"));
  assert.ok(!safeEqual("", "a"));
  assert.ok(safeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2])));
});

// ---- tokens ----
test("a token verifies, carries its payload, and expires", async () => {
  const payload = { e: "evt1", r: "referee", s: "R1", c: "code1", x: NOW + TOKEN_TTL };
  const t = await signToken("sekrit", payload);
  assert.deepEqual(await verifyToken("sekrit", t, NOW), payload);
  assert.equal(await verifyToken("sekrit", t, payload.x), null, "expired at the stroke");
  assert.equal(await verifyToken("sekrit", t, payload.x + 1), null);
});

test("a tampered, forged or malformed token is refused", async () => {
  const t = await signToken("sekrit", { e: "evt1", r: "coach", s: "T1", c: "c1", x: NOW + 1000 });
  const [body, sig] = t.split(".");
  const forged = Buffer.from(JSON.stringify({ e: "evt1", r: "admin", s: null, c: "c1", x: NOW + 1000 })).toString("base64url");
  assert.equal(await verifyToken("sekrit", `${forged}.${sig}`, NOW), null, "role swapped");
  assert.equal(await verifyToken("sekrit", `${body}.${sig.slice(0, -2)}AA`, NOW), null, "signature changed");
  assert.equal(await verifyToken("other", t, NOW), null, "wrong secret");
  for (const junk of ["", "abc", "a.b.c", `${body}.`, `.${sig}`, null, undefined, 42, "x".repeat(5000)]) assert.equal(await verifyToken("sekrit", junk, NOW), null);
  const noExpiry = await signToken("sekrit", { e: "evt1" });
  assert.equal(await verifyToken("sekrit", noExpiry, NOW), null, "a token without an expiry is never valid");
});

// ---- slugs and time ----
test("slugify makes web addresses the model accepts", () => {
  assert.equal(slugify("Beach Soccer Cup 2026!"), "beach-soccer-cup-2026");
  assert.equal(slugify("  Café & Crêpes  "), "cafe-and-crepes");
  assert.equal(slugify("---"), "");
  assert.equal(slugify("a".repeat(100)).length, 40);
  assert.ok(!slugify(`${"a".repeat(39)} b`).endsWith("-"));
});

test("London time handles summer time and date arithmetic", () => {
  assert.equal(londonParts(Date.parse("2026-07-01T12:30:00Z")).hhmm, "13:30");
  assert.equal(londonParts(Date.parse("2026-12-01T12:30:00Z")).hhmm, "12:30");
  assert.equal(londonParts(Date.parse("2026-10-24T23:30:00Z")).date, "2026-10-25");
  assert.equal(addDays("2026-10-30", 5), "2026-11-04");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

// ---- request bodies ----
test("a request body over the cap is refused, a normal one is read", async () => {
  const post = (body) => new Request("http://x/", { method: "POST", body, headers: { "Content-Type": "application/json" } });
  assert.deepEqual(await readJson(post('{"a":1}')), { a: 1 });
  await assert.rejects(readJson(post(JSON.stringify({ pad: "x".repeat(MAX_BODY) }))), (e) => e.status === 413);
  await assert.rejects(readJson(post("not json")), (e) => e.status === 400);
  await assert.rejects(readJson(post("[1,2]")), (e) => e.status === 400);
  await assert.rejects(readJson(post("")), (e) => e.status === 400);
  assert.deepEqual(await readJson(post(JSON.stringify({ pad: "x".repeat(MAX_BODY) })), 2 * MAX_BODY).then((b) => Object.keys(b)), ["pad"]);
});

test("the CSP allows what the pages need and nothing wider", () => {
  for (const must of ["https://cdnjs.cloudflare.com", "https://fonts.googleapis.com", "https://shotclubhouse.com", "https://www.youtube-nocookie.com", "https://player.twitch.tv", "object-src 'none'"]) assert.ok(CSP.includes(must), must);
  assert.ok(!/script-src[^;]*\*/.test(CSP));
});

// ---- seeds ----
test("every demo seed builds a valid event, with valid unique public codes that point at real people", async () => {
  const hashes = new Set();
  for (const slug of SEED_ORDER) {
    const { seed, doc, votes } = buildDemo(slug, NOW);
    assert.deepEqual(validate(doc), [], slug);
    assert.equal(doc.slug, slug);
    assert.equal(doc.private.demo.seed, slug);
    assert.ok(seed.codes.some((c) => c.role === "admin"), `${slug} has an admin code`);
    for (const c of seed.codes) {
      assert.ok(normaliseCode(c.code), `${slug} ${c.label}: ${c.code}`);
      assert.ok(!hashes.has(c.code), "codes are unique");
      hashes.add(c.code);
      if (c.role === "referee" || c.role === "judge") assert.ok(doc.officials.some((o) => o.id === c.subject && o.role === c.role), `${slug} ${c.label}`);
      if (c.role === "coach") assert.ok(doc.divisions[0].teams.some((t) => t.id === c.subject), `${slug} ${c.label}`);
    }
    votes.forEach((v) => assert.ok(v.voter.length >= 16));
  }
  assert.equal(SEED_ORDER.length, 4);
});

test("the demos have the shapes the brief asks for", () => {
  const beach = buildDemo("beach-soccer-cup", NOW).doc;
  assert.equal(beach.phase, "live");
  assert.equal(beach.divisions[0].teams.length, 8);
  assert.equal(beach.pitches.length, 2);
  assert.equal(beach.officials.length, 2);
  assert.ok(beach.fixtures.some((f) => f.stage === "Third place") && beach.fixtures.some((f) => f.stage === "Final"));
  assert.equal(beach.settings.voteBy, "number");
  assert.equal(beach.settings.vote.open, true);
  beach.divisions[0].teams.forEach((t) => assert.ok(t.players.length >= 6 && t.players.length <= 8 && t.players.every((p) => p.number != null && p.name.includes(" "))));

  const futsal = buildDemo("futsal-finals", NOW).doc;
  assert.equal(futsal.phase, "pre");
  assert.equal(futsal.divisions[0].teams.length, 12);
  assert.equal(futsal.pitches.length, 3);
  assert.equal(futsal.date, addDays(londonParts(NOW).date, 14));
  assert.equal(futsal.links.tickets, null);
  assert.equal(futsal.settings.voteBy, "both");
  assert.deepEqual(futsal.fixtures.filter((f) => f.stage).map((f) => f.stage).sort(), ["Final", "Quarter-final 1", "Quarter-final 2", "Quarter-final 3", "Quarter-final 4", "Semi-final 1", "Semi-final 2"]);

  const sixes = buildDemo("sixes-league-night", NOW);
  assert.equal(sixes.doc.phase, "post");
  assert.equal(sixes.doc.fixtures.length, 15);
  assert.ok(sixes.doc.fixtures.every((f) => f.state === "ft"));
  assert.ok(champion(sixes.doc.divisions[0], sixes.doc.fixtures, sixes.doc.settings.points));
  assert.ok(sixes.doc.updates.length >= 3 && sixes.doc.updates.length <= 4);
  assert.ok(sixes.doc.updates.some((u) => u.link && u.link.startsWith("https://events.shotclubhouse.com/")));
  const counts = Object.values(sixes.votes.reduce((m, v) => { const k = `${v.target}|${v.choice}`; m[k] = m[k] || { target: v.target, choice: v.choice, reason: null, n: 0 }; m[k].n++; return m; }, {}));
  const t = tally(counts, sixes.doc, NOW);
  assert.ok(t.leaders.length >= 5 && t.leaders[0].votes > t.leaders[t.leaders.length - 1].votes, "a leaderboard with a clear order");

  const fight = buildDemo("fight-night", NOW).doc;
  assert.equal(fight.card.bouts.length, 7);
  assert.equal(fight.officials.filter((o) => o.role === "judge").length, 3);
  assert.equal(fight.officials.filter((o) => o.role === "referee").length, 1);
  assert.equal(fight.card.bouts.filter((b) => b.scoring === "none").length, 1);
  const main = fight.card.bouts[6];
  assert.deepEqual([main.rounds, main.roundMins], [5, 2]);
  fight.card.bouts.slice(0, 6).forEach((b) => assert.deepEqual([b.rounds, b.roundMins], [3, 2]));
});

test("demo statements turn into plain SQL with quotes escaped", () => {
  const { doc, votes } = buildDemo("sixes-league-night", NOW);
  doc.about = "It's a good night";
  const sql = toSql(demoStatements({ id: "demo-x", slug: "sixes-league-night", doc, votes, codes: [{ id: "c1", hash: "h", role: "admin", subject: null, label: "O'Neil", }], listed: true, now: NOW }));
  assert.ok(sql.includes("It''s a good night"));
  assert.ok(sql.includes("'O''Neil'"));
  assert.ok(!sql.includes("?"));
  sql.split("\n").forEach((l) => assert.ok(l.endsWith(";")));
});

// ---- role views ----
function withScores() {
  const { doc } = buildDemo("fight-night", NOW);
  doc.private = { sim: { secret: true } };
  doc.scorecards = { B1: { J1: { 1: [10, 9] }, J2: { 1: [9, 10] } } };
  return doc;
}

test("admin sees the whole event except the server's private bookkeeping", () => {
  const doc = buildDemo("beach-soccer-cup", NOW).doc;
  const v = roleView(doc, 5, { role: "admin", subject: null, label: "Organiser" }, { registrations: 2, votes: 9 });
  assert.equal(v.rev, 5);
  assert.deepEqual(v.counts, { registrations: 2, votes: 9 });
  assert.equal(v.event.private, undefined);
  assert.ok(v.event.divisions[0].teams[0].players[0].name.includes(" "), "full names for the organiser");
});

test("a referee gets the public view and who they are", () => {
  const doc = buildDemo("beach-soccer-cup", NOW).doc;
  const v = roleView(doc, 3, { role: "referee", subject: "R2", label: "Referee, Pitch 2" });
  assert.deepEqual(v.me, { id: "R2", name: doc.officials[1].name, role: "referee", pitch: "P2" });
  const json = JSON.stringify(v.event);
  assert.ok(!json.includes(doc.divisions[0].teams[0].players[0].name), "no full player names");
  assert.equal(v.event.private, undefined);
  assert.equal(v.squad, undefined);
});

test("a judge sees their own cards before the bout is decided; the public and other judges do not see them", () => {
  const doc = withScores();
  const j1 = roleView(doc, 1, { role: "judge", subject: "J1", label: "Judge 1" });
  assert.deepEqual(j1.event.scorecards.B1, { J1: { 1: [10, 9] } });
  assert.deepEqual(j1.me, { id: "J1", name: doc.officials[0].name, role: "judge", pitch: null });
  const j3 = roleView(doc, 1, { role: "judge", subject: "J3", label: "Judge 3" });
  assert.equal(j3.event.scorecards.B1, undefined);
  const ref = roleView(doc, 1, { role: "referee", subject: "R1", label: "Ref" });
  assert.equal(ref.event.scorecards.B1, undefined);
  assert.equal(j1.event.private, undefined);
});

test("a coach gets their own squad in full and nobody else's", () => {
  const doc = buildDemo("beach-soccer-cup", NOW).doc;
  const v = roleView(doc, 2, { role: "coach", subject: "T1", label: "Coach" });
  assert.deepEqual(v.me, { teamId: "T1", division: "main" });
  assert.deepEqual(v.squad, doc.divisions[0].teams[0].players.map((p) => ({ id: p.id, number: p.number, name: p.name })));
  const other = doc.divisions[0].teams[1].players[0].name;
  assert.ok(!JSON.stringify(v).includes(other));
  assert.deepEqual(roleView(doc, 2, { role: "coach", subject: "NOPE", label: "x" }).squad, []);
});

// ---- the simulation ----
const minutes = (n) => n * 60000;

function simulate(slug, mins, seed, tickSecs = 20) {
  let doc = buildDemo(slug, NOW).doc;
  const rand = rng(seed);
  const log = { resets: 0, errors: [], votes: 0, revs: 0, ft: 0, done: 0, pens: 0, stoppages: 0, maxLive: 0, ids: new Set() };
  for (let t = NOW; t < NOW + minutes(mins); t += tickSecs * 1000) {
    const r = runStep(doc, t, rand);
    if (r.reset) { log.resets++; doc = buildDemo(slug, t).doc; continue; }
    log.errors.push(...r.errors);
    assert.deepEqual(validate(r.doc), [], `${slug} at ${(t - NOW) / 60000} min`);
    r.votes.forEach((v) => { assert.match(v.voter, /^sim-voter-\d{6}$/); assert.equal(v.ip_hash, "sim"); });
    log.votes += r.votes.length;
    if (JSON.stringify(r.doc) !== JSON.stringify(doc)) log.revs++;
    log.maxLive = Math.max(log.maxLive, r.doc.fixtures.filter((f) => f.state === "live").length, r.doc.card.bouts.filter((b) => b.state === "live" || b.state === "break").length);
    log.pens += r.doc.fixtures.filter((f) => f.pens).length > doc.fixtures.filter((f) => f.pens).length ? 1 : 0;
    log.stoppages += r.doc.card.bouts.filter((b) => b.result && ["KO", "TKO", "RSC", "RTD"].includes(b.result.method)).length > doc.card.bouts.filter((b) => b.result && ["KO", "TKO", "RSC", "RTD"].includes(b.result.method)).length ? 1 : 0;
    doc = r.doc;
  }
  return { doc, log };
}

test("the football simulation never produces an invalid event over 500 minutes, plays games and resets", () => {
  const { log, doc } = simulate("beach-soccer-cup", 500, 11);
  assert.deepEqual(log.errors, []);
  assert.ok(log.resets >= 8, `resets: ${log.resets}`);
  assert.ok(log.revs > 500, "the event keeps changing");
  assert.ok(log.votes > 1000, "fans keep voting");
  assert.ok(log.maxLive <= 2 && log.maxLive >= 2, "one live game per pitch, two pitches");
  assert.ok(log.pens >= 1, "a level knockout game goes to penalties at least once");
  assert.ok(doc.fixtures.length === 16);
});

test("the boxing simulation never produces an invalid event over 500 minutes, runs bouts and resets", () => {
  const { log } = simulate("fight-night", 500, 5);
  assert.deepEqual(log.errors, []);
  assert.ok(log.resets >= 7, `resets: ${log.resets}`);
  assert.ok(log.votes > 500);
  assert.equal(log.maxLive, 1, "one bout at a time");
  assert.ok(log.stoppages >= 1, "an occasional stoppage");
});

test("a football game starts, scores, reaches full time, and the next one starts about a minute later", () => {
  let doc = buildDemo("beach-soccer-cup", NOW).doc;
  const rand = rng(3);
  const events = [];
  for (let t = NOW; t < NOW + minutes(14); t += 5000) {
    const r = runStep(doc, t, rand);
    r.doc.fixtures.forEach((f, i) => { if (f.state !== doc.fixtures[i].state && f.pitch === "P1") events.push({ id: f.id, state: f.state, at: t }); });
    doc = r.doc;
  }
  const p1 = events.filter((e) => e.state !== "scheduled");
  assert.deepEqual(p1.slice(0, 4).map((e) => e.state), ["live", "ft", "live", "ft"]);
  assert.equal(p1[0].id, p1[1].id);
  assert.equal(p1[2].id, p1[3].id);
  assert.notEqual(p1[0].id, p1[2].id);
  const len = (p1[1].at - p1[0].at) / 60000, gap = (p1[2].at - p1[1].at) / 60000;
  assert.ok(len >= 2.8 && len <= 4.2, `game length ${len}`);
  assert.ok(gap >= 0.8 && gap <= 1.4, `gap ${gap}`);
});

test("a bout runs round by round: judges score after each round, then a decision, then the next bout", () => {
  let doc = buildDemo("fight-night", NOW).doc;
  const rand = rng(21);
  const seen = new Set();
  let firstResult = null;
  for (let t = NOW; t < NOW + minutes(12) && !firstResult; t += 5000) {
    const r = runStep(doc, t, rand);
    assert.deepEqual(r.errors, []);
    const b = r.doc.card.bouts[0];
    seen.add(b.state);
    if (b.state === "done") firstResult = b;
    doc = r.doc;
  }
  assert.ok(firstResult, "the opening bout finishes inside 12 minutes");
  assert.ok(seen.has("live") && seen.has("done"));
  if (firstResult.result.method === "PTS") {
    assert.ok(seen.has("break"), "rounds end with a break");
    const d = decision(firstResult, doc.scorecards);
    assert.equal(d.cards.every((c) => c.rounds.length === 3), true, "every judge scored every round");
    assert.equal(firstResult.result.winner, d.winner);
  } else assert.ok(["KO", "TKO", "RSC", "RTD"].includes(firstResult.result.method));
});

test("simStep is pure: it does not touch the document it is given and repeats with the same randomness", () => {
  const doc = buildDemo("beach-soccer-cup", NOW).doc;
  const before = JSON.stringify(doc);
  const a = simStep(doc, NOW, rng(9));
  assert.equal(JSON.stringify(doc), before);
  assert.deepEqual(a, simStep(doc, NOW, rng(9)));
  assert.ok(a.batches.length > 0 && a.batches.every((b) => b.actor && b.ops.length));
});

test("every change the simulation makes uses the right actor", () => {
  let doc = buildDemo("fight-night", NOW).doc;
  const rand = rng(2);
  const used = new Set();
  for (let t = NOW; t < NOW + minutes(30); t += 5000) {
    const s = simStep(doc, t, rand);
    s.batches.forEach((b) => b.ops.forEach((o) => used.add(`${b.actor.role}:${o.op}`)));
    doc = runStep(doc, t, rng(t)).doc;
  }
  assert.ok(used.has("referee:bout.action") && used.has("judge:score.round") && used.has("referee:bout.result"));
  assert.ok([...used].every((u) => !u.startsWith("coach:")));
});

test("the simulation resets about five minutes after the last game, and after a long stall", () => {
  let doc = buildDemo("beach-soccer-cup", NOW).doc;
  doc.fixtures.forEach((f) => { f.homeScore = 1; f.awayScore = 0; f.state = "ft"; });
  const s1 = simStep(doc, NOW, rng(1));
  assert.ok(!s1.reset && s1.sim.resetAt >= NOW + minutes(5) && s1.sim.resetAt <= NOW + minutes(5.6));
  doc = { ...doc, private: { sim: s1.sim } };
  assert.ok(!simStep(doc, NOW + minutes(4.9), rng(1)).reset);
  assert.ok(simStep(doc, NOW + minutes(5.7), rng(1)).reset);
  const stalled = { ...buildDemo("fight-night", NOW).doc, private: { sim: { v: 1, progressAt: NOW, resetAt: null } } };
  assert.ok(simStep(stalled, NOW + minutes(11), rng(1)).reset);
});

test("a knockout place that ties on every tie-break is settled by the organiser, so the day never stalls", () => {
  let doc = buildDemo("beach-soccer-cup", NOW).doc;
  // every group game finishes 1-1, so every team ties on points, goal difference and goals
  doc.fixtures.filter((f) => !f.stage).forEach((f) => { f.homeScore = 1; f.awayScore = 1; f.state = "ft"; });
  const s = simStep(doc, NOW, rng(4));
  const edits = s.batches.flatMap((b) => b.ops).filter((o) => o.op === "fixture.edit");
  assert.ok(edits.length >= 4, "the semi-finals get their teams");
  const r = runStep(doc, NOW, rng(4));
  assert.deepEqual(r.errors, []);
});
