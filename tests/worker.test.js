import { test } from "node:test";
import assert from "node:assert/strict";
import { signToken, verifyToken, hashCode, ipHash, connectionKey, TOKEN_TTL } from "../src/auth.js";
import { normaliseCode, formatCode, randomCode, slugify, safeEqual, CODE_ALPHABET, londonParts, addDays } from "../src/util.js";
import { roleView } from "../src/views.js";
import { readJson, MAX_BODY, CSP } from "../src/http.js";
import { SEEDS, SEED_ORDER, buildDemo, demoStatements } from "../src/seeds/index.js";
import { simStep, runStep } from "../src/sim.js";
import { rng, recipeErrors, codesFor } from "../src/seeds/lib.js";
import { toSql } from "../scripts/lib.js";
import { validate, publicView } from "../public/core/model.js";
import { applyOps } from "../public/core/ops.js";
import { leaderboard, segmentsDone } from "../public/core/fitness.js";
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
  assert.equal(SEED_ORDER.length, 6);
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
  doc.fixtures.filter((f) => !f.stage).forEach((f) => { f.homeScore = 1; f.awayScore = 1; f.goals = []; f.state = "ft"; });
  const s = simStep(doc, NOW, rng(4));
  const edits = s.batches.flatMap((b) => b.ops).filter((o) => o.op === "fixture.edit");
  assert.ok(edits.length >= 4, "the semi-finals get their teams");
  const r = runStep(doc, NOW, rng(4));
  assert.deepEqual(r.errors, []);
});

// ---- the demo follows the real clock, with believable scores ----
test("football demo times follow London now, scores look like small-sided football, and quiet ticks do not re-time", () => {
  const rand = rng(31);
  let doc = buildDemo("beach-soccer-cup", NOW).doc;
  const wasFt = new Set();
  const totals = [];
  let ticks = 0, timingTicks = 0, resets = 0;
  const minOf = (ms) => { const p = londonParts(ms); return p.hour * 60 + p.minute; };
  const delta = (hhmm, ms) => { const [h, m] = hhmm.split(":").map(Number); let d = (h * 60 + m - minOf(ms)) % 1440; if (d < -720) d += 1440; if (d >= 720) d -= 1440; return d; };
  for (let t = NOW; t < NOW + minutes(500); t += 20000) {
    ticks++;
    const step = simStep(doc, t, rand);
    if (step.batches.some((b) => b.ops.some((o) => o.op === "fixture.edit" && o.time))) timingTicks++;
    const r = runStep(doc, t, rng(t));
    if (step.reset || r.reset) { resets++; doc = buildDemo("beach-soccer-cup", t).doc; wasFt.clear(); continue; }
    doc = runStep(doc, t, rng(t)).doc;
    doc.fixtures.forEach((f) => {
      const d = delta(f.time, t);
      if (f.state === "scheduled") assert.ok(d >= -5, `${f.id} scheduled for ${f.time} is ${-d} minutes behind now`);
      if (f.state === "live") assert.ok(d <= 0 && d >= -6, `${f.id} live game timed ${f.time}, ${-d} minutes from now`);
      if (f.state === "ft" && !wasFt.has(f.id)) { wasFt.add(f.id); totals.push(f.homeScore + f.awayScore); }
    });
  }
  assert.ok(resets >= 8);
  assert.ok(totals.length > 100, `games played: ${totals.length}`);
  const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
  assert.ok(mean >= 2.5 && mean <= 5, `mean goals ${mean}`);
  assert.ok(Math.max(...totals) <= 8, `max goals ${Math.max(...totals)}`);
  assert.ok(Math.min(...totals) <= 1 && Math.max(...totals) >= 6, "a spread of scorelines");
  assert.ok(timingTicks < ticks / 3, `re-timed on ${timingTicks} of ${ticks} ticks`);
});

test("a game is timed at the real clock when it starts, and games to come run forward at about five minutes each, knockouts last", () => {
  const rand = rng(8);
  const doc = buildDemo("beach-soccer-cup", NOW + minutes(37)).doc; // built 37 minutes later: starts at that time
  const t = NOW + minutes(37);
  const hhmm = londonParts(t).hhmm;
  assert.equal(doc.fixtures.find((f) => f.state === "scheduled").time, hhmm, "the first game still to play starts now");
  const later = t + minutes(90); // London 14:37 in the summer-time offset
  const r = runStep(doc, later, rand);
  assert.deepEqual(r.errors, []);
  const live = r.doc.fixtures.filter((f) => f.state === "live");
  assert.equal(live.length, 2);
  live.forEach((f) => assert.equal(f.time, londonParts(later).hhmm));
  const toMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const p1 = r.doc.fixtures.filter((f) => f.pitch === "P1" && f.state === "scheduled");
  p1.slice(0, 3).forEach((f, i) => assert.equal(toMin(f.time) - toMin(londonParts(later).hhmm), 5 + i * 5));
  const lastGroup = Math.max(...r.doc.fixtures.filter((f) => !f.stage).map((f) => toMin(f.time)));
  r.doc.fixtures.filter((f) => f.stage).forEach((f) => assert.ok(toMin(f.time) > lastGroup, `${f.stage} after the groups`));
  const final = r.doc.fixtures.find((f) => f.stage === "Final");
  r.doc.fixtures.filter((f) => /^Semi/.test(f.stage || "")).forEach((f) => assert.ok(toMin(f.time) < toMin(final.time)));
  // nothing changed on the next quiet tick, so nothing is re-timed
  const quiet = simStep(r.doc, later + 20000, rand);
  assert.ok(!quiet.batches.some((b) => b.ops.some((o) => o.op === "fixture.edit")));
});

test("goal totals: mean about 3.5, never above 8", () => {
  const rand = rng(77);
  const totals = [];
  for (let i = 0; i < 4000; i++) {
    const doc = buildDemo("beach-soccer-cup", NOW).doc;
    const s = simStep({ ...doc, private: undefined }, NOW + i, rand);
    totals.push(s.sim.pitches.P1.goals.length);
  }
  const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
  assert.ok(mean > 3.1 && mean < 3.7, `mean ${mean}`);
  assert.ok(Math.max(...totals) <= 8);
});

test("rate limits key IPv4 by address and IPv6 by its /64", () => {
  assert.equal(connectionKey("203.0.113.9"), "203.0.113.9");
  assert.equal(connectionKey("2001:db8:1:2:aaaa::1"), "2001:db8:1:2::/64");
  assert.equal(connectionKey("2001:0db8:0001:0002:ffff:ffff:ffff:ffff"), "2001:db8:1:2::/64");
  assert.equal(connectionKey("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(connectionKey("::1"), "0:0:0:0::/64");
  assert.equal(connectionKey("local"), "local");
});

test("a prospect's recipe rebuilds the live demo in their format, and survives a reset", () => {
  const now = Date.parse("2026-10-05T10:00:00Z");
  const recipe = { teams: ["North", "East", "South", "West", "Central", "Coast"], format: "league", pitches: ["Court 1", "Court 2", "Court 3"], gameMins: 8, terms: { place: "court", score: "goal", discipline: "Futsal" }, squad: [5, 7] };
  const { doc } = buildDemo("beach-soccer-cup", now, { slug: "p-abcdefghij", name: "Prospect Cup", accent: "#123456", recipe });
  assert.deepEqual(validate(doc), []);
  assert.equal(doc.divisions[0].format, "league");
  assert.equal(doc.divisions[0].teams.length, 6);
  assert.equal(doc.fixtures.length, 15);
  assert.deepEqual(doc.pitches.map((p) => p.name), ["Court 1", "Court 2", "Court 3"]);
  assert.equal(doc.officials.filter((o) => o.role === "referee").length, 3);
  assert.equal(doc.settings.terms.discipline, "Futsal");
  assert.ok(doc.divisions[0].teams.every((t) => t.players.length >= 5 && t.players.length <= 7));
  assert.deepEqual(doc.private.demo.overrides.recipe, recipe);
  const codes = codesFor(doc);
  assert.deepEqual(codes.map((c) => c.label), ["Organiser", "Referee, Court 1", "Referee, Court 2", "Referee, Court 3", "Coach, North", "Coach, East"]);
  // the public demo is unchanged when no recipe is given
  const plain = buildDemo("beach-soccer-cup", now).doc;
  assert.equal(plain.divisions[0].teams.length, 8);
  assert.equal(plain.pitches.length, 2);
});

test("a boxing recipe sets the card, rounds and judges", () => {
  const now = Date.parse("2026-10-05T19:00:00Z");
  const recipe = { name: "Amateur Show", bouts: [{ title: "Bout 1", rounds: 3, roundMins: 3 }, { title: "Bout 2", rounds: 3, roundMins: 3 }, { title: "Main event", rounds: 3, roundMins: 3, weight: "Heavyweight" }], judges: 5, terms: { discipline: "Amateur boxing" } };
  const { doc } = buildDemo("fight-night", now, { slug: "p-boxboxboxb", name: "Prospect Night", accent: "#aa0000", recipe });
  assert.deepEqual(validate(doc), []);
  assert.equal(doc.card.bouts.length, 3);
  assert.ok(doc.card.bouts.every((b) => b.rounds === 3 && b.roundMins === 3 && b.judges.length === 5));
  assert.equal(doc.card.bouts[2].weight, "Heavyweight");
  assert.deepEqual(codesFor(doc).map((c) => c.label), ["Organiser", "Judge 1", "Judge 2", "Judge 3", "Judge 4", "Judge 5", "Referee and timekeeper"]);
});

test("recipe problems are reported in plain words", () => {
  assert.deepEqual(recipeErrors("football", { teams: ["A", "B"] }), []);
  assert.ok(recipeErrors("football", { teams: ["A"] }).length);
  assert.ok(recipeErrors("football", { slug: "x" }).some((e) => /not something/.test(e)));
  assert.ok(recipeErrors("boxing", { judges: 2 }).length);
  assert.ok(recipeErrors("boxing", { bouts: [] }).length);
});

// ---- fitness demos ----
test("the fitness demos have the shapes the contract asks for", () => {
  const race = buildDemo("fitness-race", NOW).doc;
  assert.deepEqual([race.sport, race.phase, race.comp.ranking], ["fitness", "live", "time"]);
  assert.equal(race.comp.segments.length, 16);
  assert.deepEqual(race.comp.segments.map((s) => s.name.split(" ")[0] === "Run"), Array.from({ length: 16 }, (_, i) => i % 2 === 0), "a run, then a station, eight times");
  assert.ok(race.comp.segments.every((s) => s.measure === "time"));
  assert.deepEqual(race.comp.categories.map((c) => [c.name, c.size]), [["Open Women", 1], ["Open Men", 1], ["Pro Women", 1], ["Pro Men", 1], ["Doubles Mixed", 2]]);
  assert.equal(race.comp.heats.length, 16);
  assert.ok(race.comp.heats.every((h) => h.state === "scheduled" && race.comp.entries.filter((n) => n.heat === h.id).length === 10));
  assert.equal(race.comp.entries.length, 160);
  assert.equal(Math.min(...race.comp.entries.map((n) => n.bib)), 101);
  assert.ok(race.comp.entries.every((n) => n.name.split(" & ").length === (race.comp.categories.find((c) => c.id === n.category).size === 2 ? 2 : 1)));
  assert.equal(race.comp.heats[0].time, londonParts(NOW).hhmm, "the first wave is timed at the London clock now");
  assert.deepEqual([race.pitches, race.divisions, race.fixtures, race.card.bouts], [[], [], [], []]);
  assert.deepEqual([race.settings.vote.open, race.settings.terms.place], [true, "arena"]);

  const games = buildDemo("fitness-games", NOW).doc;
  assert.deepEqual([games.comp.ranking, games.comp.segments.map((s) => s.measure)], ["placings", ["kg", "time", "reps"]]);
  assert.deepEqual(games.comp.categories.map((c) => c.size), [1, 1, 2]);
  assert.equal(games.comp.heats.length, 8);
  assert.ok(games.comp.heats.every((h) => games.comp.entries.filter((n) => n.heat === h.id).length === 8));
  assert.equal(games.settings.terms.place, "floor");

  for (const slug of ["fitness-race", "fitness-games"]) {
    const { seed, doc } = buildDemo(slug, NOW);
    assert.deepEqual([seed.kind, seed.recipes, seed.sim], ["fitness", true, "fitness"]);
    assert.deepEqual(seed.codes.map((c) => [c.role, c.subject]), [["admin", null], ["referee", "R1"], ["referee", "R2"]]);
    assert.deepEqual(seed.codes.slice(1).map((c) => c.label), ["Timekeeper, Floor 1", "Timekeeper, Floor 2"]);
    assert.ok(seed.codes.every((c) => c.code.startsWith(slug === "fitness-race" ? "FTR" : "FTG") && /^[A-HJKMNP-Z2-9]{12}$/.test(c.code)), "12 characters from the code alphabet");
    assert.ok(!seed.codes.some((c) => c.role === "coach"), "no coach codes");
    assert.deepEqual(codesFor(doc).map((c) => [c.role, c.subject, c.label]), seed.codes.map((c) => [c.role, c.subject, c.label]));
    const text = JSON.stringify(doc).toLowerCase();
    for (const brand of ["hyrox", "crossfit", "concept2", "peloton", "nike", "adidas", "reebok"]) assert.ok(!text.includes(brand), brand);
  }
  assert.deepEqual(SEED_ORDER.slice(-2), ["fitness-race", "fitness-games"]);
  assert.deepEqual(SEED_ORDER.slice(0, 4), ["beach-soccer-cup", "futsal-finals", "sixes-league-night", "fight-night"]);
});

test("a fitness recipe sets the format, the heats and the wording, and survives a reset", () => {
  const now = Date.parse("2026-10-05T10:00:00Z");
  const recipe = { name: "Club Games", ranking: "placings", segments: [{ name: "Lift", measure: "kg" }, "Row"], categories: ["Women", "Men", { name: "Pairs", size: 2 }], heats: 4, perHeat: 6, gapMins: 5, terms: { place: "floor", discipline: "Club games" } };
  assert.deepEqual(recipeErrors("fitness", recipe), []);
  const { doc } = buildDemo("fitness-race", now, { slug: "p-abcdefghij", name: "Prospect Games", accent: "#123456", recipe });
  assert.deepEqual(validate(doc), []);
  assert.deepEqual(doc.comp.segments.map((s) => [s.id, s.name, s.measure]), [["S1", "Lift", "kg"], ["S2", "Row", "time"]]);
  assert.deepEqual(doc.comp.categories.map((c) => [c.id, c.name, c.size]), [["C1", "Women", 1], ["C2", "Men", 1], ["C3", "Pairs", 2]]);
  assert.equal(doc.comp.heats.length, 4);
  assert.deepEqual(doc.comp.heats.map((h) => h.category), ["C1", "C2", "C3", "C1"], "heats take the categories in turn");
  assert.equal(doc.comp.entries.length, 24);
  assert.ok(doc.comp.entries.filter((n) => n.category === "C3").every((n) => n.name.includes(" & ")));
  assert.deepEqual(doc.comp.heats.map((h) => h.time), ["10:00", "10:05", "10:10", "10:15"].map((t) => t.replace(/^10/, londonParts(now).hhmm.slice(0, 2))));
  assert.deepEqual([doc.name, doc.settings.terms.place, doc.settings.terms.discipline], ["Prospect Games", "floor", "Club games"]);
  assert.deepEqual(doc.private.demo.overrides.recipe, recipe);
  assert.deepEqual(codesFor(doc).map((c) => c.label), ["Organiser", "Timekeeper, Floor 1", "Timekeeper, Floor 2"]);
  // a timed race has only time segments, whatever the recipe says
  const timed = buildDemo("fitness-games", now, { slug: "p-abcdefghij", name: "Timed", accent: "#123456", recipe: { ranking: "time" } }).doc;
  assert.deepEqual(validate(timed), []);
  assert.ok(timed.comp.segments.every((s) => s.measure === "time"));
  // with no recipe the public demo is unchanged
  assert.equal(buildDemo("fitness-race", now).doc.comp.entries.length, 160);
  // and a prospect's copy is simulated like the demo it came from
  let d = doc;
  const rand = rng(2);
  for (let t = now; t < now + minutes(30); t += 20000) { const r = runStep(d, t, rand); assert.deepEqual(r.errors, []); if (r.reset) break; d = r.doc; }
  assert.ok(d.comp.heats.some((h) => h.state !== "scheduled"));
});

test("fitness recipe problems are reported in plain words", () => {
  assert.deepEqual(recipeErrors("fitness", { heats: 8, perHeat: 8, gapMins: 6, segments: ["Run"], categories: [{ name: "Open", size: 4 }] }), []);
  assert.ok(recipeErrors("fitness", { ranking: "fastest" }).some((e) => /recipe.ranking/.test(e)));
  assert.ok(recipeErrors("fitness", { segments: [] }).length);
  assert.ok(recipeErrors("fitness", { segments: Array.from({ length: 21 }, () => "x") }).length);
  assert.ok(recipeErrors("fitness", { segments: [{ name: "Lift", measure: "stone" }] }).length);
  assert.ok(recipeErrors("fitness", { categories: [{ name: "Open", size: 3 }] }).length);
  assert.ok(recipeErrors("fitness", { categories: [""] }).length);
  assert.ok(recipeErrors("fitness", { heats: 0 }).length);
  assert.ok(recipeErrors("fitness", { heats: 2.5 }).length);
  assert.ok(recipeErrors("fitness", { perHeat: 51 }).length);
  assert.ok(recipeErrors("fitness", { gapMins: 31 }).length);
  assert.ok(recipeErrors("fitness", { heats: 40, perHeat: 30 }).some((e) => /800/.test(e)));
  assert.ok(recipeErrors("fitness", { slug: "x" }).some((e) => /not something/.test(e)));
  assert.ok(recipeErrors("fitness", { teams: ["A", "B"] }).some((e) => /not something/.test(e)), "football keys are not fitness keys");
});

test("fitness role views: the public sees labels, timekeepers and the organiser see full names", () => {
  const doc = buildDemo("fitness-race", NOW).doc;
  doc.private = { sim: { secret: true } };
  const people = doc.comp.entries.flatMap((n) => n.name.split(" & "));
  const everyone = (v) => JSON.stringify(v);
  const pub = publicView(doc);
  people.forEach((p) => { assert.ok(!everyone(pub).includes(p), `${p} reached the public view`); assert.ok(!everyone(pub).includes(p.split(" ")[1]), `${p} surname reached the public view`); });
  const referee = roleView(doc, 3, { role: "referee", subject: "R1", label: "Timekeeper, Floor 1" });
  assert.deepEqual(referee.me, { id: "R1", name: doc.officials[0].name, role: "referee", pitch: null });
  assert.deepEqual(referee.event.comp.entries.map((n) => n.name), doc.comp.entries.map((n) => n.name), "full names for the timekeeper");
  assert.ok(referee.event.comp.entries.every((n) => /^#\d+ \S+/.test(n.label)));
  assert.equal(referee.event.private, undefined);
  assert.ok(!everyone(referee).includes("secret"));
  const admin = roleView(doc, 3, { role: "admin", subject: null, label: "Organiser" });
  assert.equal(admin.event.comp.entries[0].name, doc.comp.entries[0].name);
  assert.equal(admin.event.private, undefined);
  const judge = roleView(doc, 3, { role: "judge", subject: "J1", label: "Judge" });
  assert.ok(!everyone(judge).includes(doc.comp.entries[0].name), "only the timekeeper and organiser get names");
  const coach = roleView(doc, 3, { role: "coach", subject: "T1", label: "Coach" });
  assert.deepEqual(coach.squad, []);
  assert.ok(!everyone(coach).includes(doc.comp.entries[0].name));
});

// ---- the fitness simulation ----
const minOf = (ms) => { const p = londonParts(ms); return p.hour * 60 + p.minute; };
const deltaMins = (hhmm, ms) => { const [h, m] = hhmm.split(":").map(Number); let d = (h * 60 + m - minOf(ms)) % 1440; if (d < -720) d += 1440; if (d >= 720) d -= 1440; return d; };

function fitnessRun(slug, mins, seed, tickSecs = 20) {
  let doc = buildDemo(slug, NOW).doc;
  const rand = rng(seed);
  const log = { resets: 0, firstReset: null, errors: [], votes: 0, ticks: 0, quiet: 0, timing: 0, live: new Set(), maxLive: 0, finished: 0, dnf: 0, dns: 0, lastDoc: null, durations: {}, finishTimes: [], scored: new Set(), badVotes: 0, regress: 0, boards: 0 };
  for (let t = NOW; t < NOW + minutes(mins); t += tickSecs * 1000) {
    log.ticks++;
    const step = simStep(doc, t, rng(t));
    if (step.batches.some((b) => b.ops.some((o) => o.op === "heat.edit"))) log.timing++;
    const r = runStep(doc, t, rng(t));
    if (r.reset) { log.resets++; log.firstReset ??= (t - NOW) / 60000; doc = buildDemo(slug, t).doc; continue; }
    log.errors.push(...r.errors);
    assert.deepEqual(validate(r.doc), [], `${slug} at ${(t - NOW) / 60000} min`);
    if (!step.batches.length && !step.sim.resetAt) { log.quiet++; assert.equal(JSON.stringify(r.doc), JSON.stringify(doc), "a quiet tick writes nothing"); }
    r.votes.forEach((v) => {
      const h = doc.comp.heats.find((x) => `h:${x.id}` === v.target); // votes are drawn from the document the step started with
      const n = doc.comp.entries.find((x) => x.id === v.choice);
      if (!h || h.state !== "live" || !n || n.heat !== h.id || n.state === "dns" || !/^sim-voter-\d{6}$/.test(v.voter) || v.ip_hash !== "sim") log.badVotes++;
    });
    log.votes += r.votes.length;
    r.doc.comp.entries.forEach((n, i) => n.results.forEach((v, k) => { const was = doc.comp.entries[i].results[k]; if (was != null && was !== v) log.regress++; }));
    r.doc.comp.heats.forEach((h, i) => {
      if (h.state === "live") log.live.add(h.id);
      if (h.state === "done" && doc.comp.heats[i].state === "live") log.durations[h.id] = (h.endedAt - h.startedAt) / 60000;
    });
    log.maxLive = Math.max(log.maxLive, r.doc.comp.heats.filter((h) => h.state === "live").length);
    const states = (s) => r.doc.comp.entries.filter((n) => n.state === s).length;
    log.finished = Math.max(log.finished, states("finished")); log.dnf = Math.max(log.dnf, states("dnf")); log.dns = Math.max(log.dns, states("dns"));
    r.doc.comp.categories.forEach((c) => { if (leaderboard(r.doc, c.id).some((row) => row.rank != null)) log.boards++; });
    r.doc.comp.heats.forEach((h) => { const done = Math.max(...r.doc.comp.entries.filter((n) => n.heat === h.id).map((n) => segmentsDone(n))); log.scored.add(`${h.state}:${done}`); });
    doc = r.doc;
    log.lastDoc = doc;
  }
  return { doc, log };
}

test("the fitness race simulation: waves go out, splits are posted and only ever go up, finishers appear, votes come in, and it resets", () => {
  const { log } = fitnessRun("fitness-race", 100, 21);
  assert.deepEqual(log.errors, []);
  assert.equal(log.regress, 0, "a posted result never changes");
  assert.equal(log.badVotes, 0, "fan votes go to athletes in live heats");
  assert.equal(log.live.size, 16, "every wave goes out");
  assert.ok(log.maxLive >= 4 && log.maxLive <= 7, `waves on the course at once: ${log.maxLive}`);
  assert.ok(log.finished >= 120, `finishers: ${log.finished}`);
  assert.ok(log.dnf >= 1 && log.dns >= 1, `dnf ${log.dnf}, dns ${log.dns}`);
  assert.ok(log.boards > 500, "the leaderboards fill");
  assert.ok(log.votes > 1000, `votes: ${log.votes}`);
  assert.ok(log.resets >= 1 && log.firstReset > 80 && log.firstReset <= 95, `first reset at ${log.firstReset} minutes`);
  assert.ok(log.quiet >= 5, `quiet ticks: ${log.quiet}`);
  const spans = Object.values(log.durations);
  assert.ok(spans.length >= 15 && spans.every((m) => m >= 10 && m <= 24), `a wave is over in about 15 to 20 minutes: ${spans.map((m) => m.toFixed(1))}`);
});

test("race splits look like a real race: finish times of about 55 to 100 minutes, runs of 4 to 6 minutes, stations of 3 to 8", () => {
  const rand = rng(8);
  let doc = buildDemo("fitness-race", NOW).doc;
  const finishes = [], legs = [];
  const seen = new Set();
  for (let t = NOW; t < NOW + minutes(88); t += 20000) {
    const r = runStep(doc, t, rand);
    if (r.reset) break;
    doc = r.doc;
    doc.comp.entries.filter((n) => n.state === "finished" && !seen.has(n.id)).forEach((n) => {
      seen.add(n.id);
      finishes.push(n.results[15]);
      n.results.forEach((v, k) => legs.push([k, v - (k ? n.results[k - 1] : 0)]));
    });
  }
  assert.ok(finishes.length >= 100);
  assert.ok(Math.min(...finishes) >= 54 * 60 && Math.max(...finishes) <= 102 * 60, `finish times ${Math.min(...finishes)} to ${Math.max(...finishes)} s`);
  const runs = legs.filter(([k]) => k % 2 === 0).map(([, s]) => s), stations = legs.filter(([k]) => k % 2 === 1).map(([, s]) => s);
  assert.ok(Math.min(...runs) >= 4 * 60 * 0.6 && Math.max(...runs) <= 6 * 60 * 1.2, `runs ${Math.min(...runs)} to ${Math.max(...runs)} s`);
  assert.ok(Math.min(...stations) >= 3 * 60 * 0.6 && Math.max(...stations) <= 8 * 60 * 1.2, `stations ${Math.min(...stations)} to ${Math.max(...stations)} s`);
  assert.equal(new Set(finishes).size > 50, true, "a spread of times");
});

test("the workout games simulation: heats go out, workouts are scored in turn, placings fill, and it resets", () => {
  const { log, doc } = fitnessRun("fitness-games", 70, 4);
  assert.deepEqual(log.errors, []);
  assert.equal(log.regress, 0);
  assert.equal(log.badVotes, 0);
  assert.equal(log.live.size, 8, "every heat goes out");
  assert.ok(log.maxLive >= 1 && log.maxLive <= 3, `heats on the floor at once: ${log.maxLive}`);
  assert.ok(log.votes > 200, `votes: ${log.votes}`);
  assert.ok(log.resets >= 1 && log.firstReset > 50 && log.firstReset < 70, `first reset at ${log.firstReset} minutes`);
  assert.ok(log.quiet > 50);
  for (const part of ["live:0", "live:1", "live:2", "live:3", "done:3"]) assert.ok(log.scored.has(part), `a heat was seen ${part}: ${[...log.scored]}`);
  assert.ok(!log.scored.has("scheduled:1"), "nothing is scored before the heat starts");
  assert.ok(log.boards > 100);
  assert.ok(doc.comp.entries.length === 64);
});

test("games scores sit in a believable range for each measure", () => {
  const rand = rng(12);
  let doc = buildDemo("fitness-games", NOW).doc;
  for (let t = NOW; t < NOW + minutes(56); t += 20000) { const r = runStep(doc, t, rand); if (r.reset) break; doc = r.doc; }
  const range = (k, size) => { const v = doc.comp.entries.filter((n) => n.results[k] != null && doc.comp.categories.find((c) => c.id === n.category).size === size).map((n) => n.results[k]); return [Math.min(...v), Math.max(...v), v.length]; };
  const [kgLo, kgHi, kgN] = range(0, 1), [pkgLo, pkgHi] = range(0, 2), [tLo, tHi] = range(1, 1), [rLo, rHi] = range(2, 1);
  assert.ok(kgN >= 30 && kgLo >= 60 && kgHi <= 140, `kg ${kgLo} to ${kgHi}`);
  assert.ok(pkgLo > kgLo && pkgHi > kgHi, "pairs lift more between them");
  assert.ok(tLo >= 300 && tHi <= 560, `time ${tLo} to ${tHi}`);
  assert.ok(rLo >= 50 && rHi <= 130, `reps ${rLo} to ${rHi}`);
  assert.ok(doc.comp.entries.every((n) => n.results.every((v) => v == null || Number.isInteger(v))));
});

test("fitness demo times follow London now: the heat starting is timed at this minute, those to come run forward at the gap", () => {
  for (const [slug, gap] of [["fitness-race", 4], ["fitness-games", 6]]) {
    const rand = rng(31);
    let doc = buildDemo(slug, NOW).doc;
    let ticks = 0, timing = 0;
    for (let t = NOW; t < NOW + minutes(50); t += 20000) {
      ticks++;
      const step = simStep(doc, t, rng(t));
      if (step.batches.some((b) => b.ops.some((o) => o.op === "heat.edit"))) timing++;
      const r = runStep(doc, t, rand);
      if (r.reset) break;
      doc = r.doc;
      const scheduled = doc.comp.heats.filter((h) => h.state === "scheduled");
      scheduled.forEach((h) => assert.ok(deltaMins(h.time, t) >= 0, `${slug} ${h.name} to come is timed ${h.time}, ${-deltaMins(h.time, t)} minutes ago`));
      scheduled.slice(1).forEach((h, i) => assert.equal((deltaMins(h.time, t) - deltaMins(scheduled[i].time, t) + 1440) % 1440, gap, `${slug} heats to come are ${gap} minutes apart`));
      doc.comp.heats.filter((h) => h.state === "live").forEach((h) => { const d = deltaMins(h.time, t); assert.ok(d <= 0 && d >= -26, `${slug} live ${h.name} timed ${h.time}, ${-d} minutes from now`); });
      doc.comp.heats.filter((h) => h.state === "done").forEach((h) => assert.equal(h.time, londonParts(h.startedAt).hhmm, "a heat that has started keeps the minute it started"));
    }
    assert.ok(timing < ticks / 3, `${slug} re-timed on ${timing} of ${ticks} ticks`);
  }
});

test("the fitness simulation is pure, and every change uses the right actor", () => {
  let doc = buildDemo("fitness-race", NOW).doc;
  const before = JSON.stringify(doc);
  const a = simStep(doc, NOW, rng(9));
  assert.equal(JSON.stringify(doc), before, "the document is not touched");
  assert.deepEqual(a, simStep(doc, NOW, rng(9)), "the same randomness gives the same step");
  const rand = rng(3);
  const seen = new Set();
  for (let t = NOW; t < NOW + minutes(40); t += 20000) {
    const s = simStep(doc, t, rand);
    s.batches.forEach((b) => b.ops.forEach((o) => {
      seen.add(o.op);
      if (["heat.edit"].includes(o.op)) assert.deepEqual(b.actor, { role: "admin", id: null });
      else { assert.equal(b.actor.role, "referee"); assert.ok(doc.officials.some((x) => x.id === b.actor.id && x.role === "referee")); }
    }));
    doc = runStep(doc, t, rand).doc;
  }
  for (const op of ["heat.start", "heat.end", "result.set", "heat.edit"]) assert.ok(seen.has(op), op);
});

test("the fitness simulation resets about five minutes after the last heat, and after a long stall", () => {
  let doc = buildDemo("fitness-games", NOW).doc;
  doc.comp.heats.forEach((h) => { h.state = "done"; h.startedAt = NOW - 600000; h.endedAt = NOW - 300000; });
  doc.comp.entries.forEach((n) => { n.state = "finished"; n.results = [100, 300, 90]; });
  const s1 = simStep(doc, NOW, rng(1));
  assert.ok(!s1.reset && s1.sim.resetAt >= NOW + minutes(5) && s1.sim.resetAt <= NOW + minutes(5.6));
  doc = { ...doc, private: { sim: s1.sim } };
  assert.ok(!simStep(doc, NOW + minutes(4.9), rng(1)).reset);
  assert.ok(simStep(doc, NOW + minutes(5.7), rng(1)).reset);
  const stalled = { ...buildDemo("fitness-race", NOW).doc, private: { sim: { v: 1, progressAt: NOW, resetAt: null } } };
  assert.ok(simStep(stalled, NOW + minutes(11), rng(1)).reset);
});

test("the fitness simulation copes with an organiser's edits mid-run", () => {
  const rand = rng(5);
  let doc = buildDemo("fitness-race", NOW).doc;
  const admin = { role: "admin", id: null };
  for (let t = NOW; t < NOW + minutes(30); t += 20000) {
    if (t === NOW + minutes(10)) {
      // the organiser starts a wave by hand, drops an athlete and adds one
      const next = doc.comp.heats.find((h) => h.state === "scheduled");
      const edit = applyOps(doc, [{ op: "heat.start", id: next.id }, { op: "entry.add", name: "Late Entrant", category: next.category, heat: next.id }, { op: "entry.remove", id: doc.comp.entries.find((n) => n.heat === next.id).id }], admin, t);
      assert.equal(edit.ok, true, JSON.stringify(edit));
      doc = edit.doc;
    }
    const r = runStep(doc, t, rand);
    assert.deepEqual(r.errors, [], `at ${(t - NOW) / 60000} min`);
    if (r.reset) break;
    assert.deepEqual(validate(r.doc), []);
    doc = r.doc;
  }
  assert.ok(doc.comp.heats.filter((h) => h.state !== "scheduled").length >= 7);
});

test("a two-ring juniors card runs a bout in each ring at once, with no fan votes", () => {
  const start = Date.parse("2026-10-05T09:00:00Z");
  const recipe = { name: "Junior Championships", rings: ["Ring A", "Ring B"], juniors: true, judges: 3, bouts: Array.from({ length: 6 }, (_, i) => ({ title: `Bout ${i + 1}`, rounds: 3, roundMins: 2 })) };
  let { doc } = buildDemo("fight-night", start, { slug: "p-ringringri", name: "Junior Champs", accent: "#d02045", recipe });
  assert.deepEqual(validate(doc), []);
  assert.deepEqual(doc.card.bouts.map((b) => b.pitch), ["P1", "P2", "P1", "P2", "P1", "P2"]);
  assert.deepEqual(codesFor(doc).filter((c) => c.role === "referee").map((c) => c.label), ["Referee, Ring A", "Referee, Ring B"]);
  const rand = rng(77);
  let both = false, votes = 0, errors = 0;
  for (let t = start; t < start + 60 * 60000; t += 20000) {
    const r = runStep(doc, t, rand);
    if (r.reset) break;
    errors += r.errors.length;
    votes += r.votes.length;
    doc = r.doc;
    const live = doc.card.bouts.filter((b) => b.state === "live" || b.state === "break");
    assert.ok(live.length <= 2);
    assert.ok(new Set(live.map((b) => b.pitch)).size === live.length, "never two bouts at once in one ring");
    if (live.length === 2) both = true;
  }
  assert.equal(errors, 0);
  assert.ok(both, "both rings were busy at the same time");
  assert.equal(votes, 0);
  assert.ok(doc.card.bouts.filter((b) => b.state === "done").length >= 4);
});

test("a recipe with several divisions shares the pitches and keeps every game id unique", () => {
  const now = Date.parse("2026-10-05T10:00:00Z");
  const t = (p, n) => Array.from({ length: n }, (_, i) => `${p} ${i + 1}`);
  const recipe = { divisions: [{ name: "Draw A", teams: t("North", 16), format: "knockout" }, { name: "Draw B", teams: t("South", 16), format: "knockout" }], pitches: ["Pitch 1", "Pitch 2", "Pitch 3", "Pitch 4"], gameMins: 12, thirdPlace: false };
  const { doc } = buildDemo("beach-soccer-cup", now, { slug: "p-drawdrawdr", name: "Cup", accent: "#e8f21d", recipe });
  assert.deepEqual(validate(doc), []);
  assert.deepEqual(doc.divisions.map((v) => [v.name, v.teams.length]), [["Draw A", 16], ["Draw B", 16]]);
  assert.equal(new Set(doc.fixtures.map((f) => f.id)).size, doc.fixtures.length);
  assert.equal(doc.fixtures.length, 30);
  const pitchesOf = (id) => new Set(doc.fixtures.filter((f) => f.division === id).map((f) => f.pitch));
  assert.deepEqual([...pitchesOf("D1")].sort(), ["P1", "P3"]);
  assert.deepEqual([...pitchesOf("D2")].sort(), ["P2", "P4"]);
  // the sim plays a knockout draw through to its final
  let d = doc; const rand = rng(5);
  for (let at = now; at < now + 4 * 60 * 60000; at += 20000) { const r = runStep(d, at, rand); if (r.reset) break; assert.equal(r.errors.length, 0); d = r.doc; }
  assert.ok(d.fixtures.filter((f) => f.stage === "Final").every((f) => f.state === "ft"), "both finals played");
});

test("every demo carries a clubhouse preview with no prices, and juniors demos have no personal posts", () => {
  const now = Date.parse("2026-10-05T10:00:00Z");
  for (const key of SEED_ORDER) {
    const { doc } = buildDemo(key, now);
    assert.equal(doc.clubhouse.on, true, key);
    assert.ok(doc.clubhouse.tiers.every((t) => t.price === null), key);
    assert.match(doc.clubhouse.culture.playlist, /^https:\/\/open\.spotify\.com\//);
  }
  const j = buildDemo("beach-soccer-cup", now, { slug: "p-juniorjuni", name: "U14 Cup", accent: "#e4232b", recipe: { juniors: true, clubhouse: { intro: "Our clubhouse." } } }).doc;
  assert.equal(j.clubhouse.intro, "Our clubhouse.");
  assert.ok(j.clubhouse.community.posts.every((p) => p.who === "Organiser" || p.who === "Sandstorm"));
  assert.ok(!JSON.stringify(j.clubhouse).includes("person"));
  assert.match(CSP, /frame-src[^;]*https:\/\/open\.spotify\.com/);
});
