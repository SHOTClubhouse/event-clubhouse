// End-to-end check of the API against a running local dev server.
//
//   npx wrangler dev --local --persist-to .wrangler/state     (in another terminal)
//   npm run db:local && npm run seed:local
//   node tests/e2e/api.mjs [http://127.0.0.1:8787]
//
// Needs SHOT_ADMIN: from the environment, or from .dev.vars. Creates its own organiser and events
// (unique names each run) and resets the futsal demo. Safe to run repeatedly. Prints PASS or FAIL for every step and
// exits 1 if any step fails.

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { generate } from "../../public/core/generator.js";

const base = (process.argv[2] || "http://127.0.0.1:8787").replace(/\/$/, "");
const vars = existsSync(new URL("../../.dev.vars", import.meta.url)) ? Object.fromEntries(readFileSync(new URL("../../.dev.vars", import.meta.url), "utf8").split(/\r?\n/).map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]])) : {};
const SHOT_ADMIN = process.env.SHOT_ADMIN || vars.SHOT_ADMIN;
const stamp = Date.now().toString(36);
// Cloudflare sets CF-Connecting-IP itself in production. Locally the script sets its own, a fresh
// one each run, so this run's rate limits (failed sign-ins, registrations) start from zero and
// the script can be run again straight away.
const ip = `198.51.100.${Math.floor(Math.random() * 250) + 1}`;

async function call(method, path, { body, token, headers = {}, raw } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { "CF-Connecting-IP": ip, ...(body !== undefined && !raw ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    redirect: "manual",
  });
  const type = res.headers.get("Content-Type") || "";
  const data = res.status === 204 ? null : type.includes("json") ? await res.json() : await res.text();
  return { status: res.status, data, headers: res.headers };
}

const results = [];
async function step(name, fn) {
  try {
    const out = await fn();
    results.push({ name, ok: true, note: out === "skip" ? "SKIP" : "" });
  } catch (e) {
    results.push({ name, ok: false, note: String(e && e.message ? e.message : e).split("\n")[0].slice(0, 220) });
  }
}

const S = {}; // state shared between steps
const voter = () => `e2e-${stamp}-${Math.random().toString(36).slice(2, 12)}`.padEnd(20, "x");
const ok = (r, status = 200) => assert.equal(r.status, status, `expected ${status}, got ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`);

// ---------------------------------------------------------------- demos

await step("list demo events with their public codes", async () => {
  const r = await call("GET", "/api/demo");
  ok(r);
  assert.deepEqual(r.data.events.map((e) => e.slug), ["beach-soccer-cup", "futsal-finals", "sixes-league-night", "fight-night"]);
  const beach = r.data.events[0];
  assert.equal(beach.live, true);
  assert.equal(r.data.events[3].live, true);
  assert.ok(beach.blurb.length > 20);
  assert.ok(beach.codes.every((c) => /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(c.code) && c.role && c.label));
  S.demo = Object.fromEntries(r.data.events.map((e) => [e.slug, e]));
});

await step("the public events list shows listed events, demos first", async () => {
  const r = await call("GET", "/api/events");
  ok(r);
  assert.ok(r.data.events.length >= 4);
  assert.ok(r.data.events.slice(0, 4).every((e) => e.demo));
  assert.ok(r.data.events.every((e) => e.slug && e.name && e.sport && e.theme));
});

await step("sign in with the demo admin code (typed in lower case with spaces)", async () => {
  const code = S.demo["futsal-finals"].codes.find((c) => c.role === "admin").code;
  const r = await call("POST", "/api/auth", { body: { code: code.toLowerCase().replace(/-/g, " ") } });
  ok(r);
  assert.equal(r.data.role, "admin");
  assert.equal(r.data.event.slug, "futsal-finals");
  S.futsalAdmin = r.data.token;
  const full = await call("GET", "/api/events/futsal-finals/full", { token: S.futsalAdmin });
  ok(full);
  assert.ok(full.data.event.divisions[0].teams[0].players[0].name.includes(" "), "organiser sees full names");
  assert.equal(full.data.event.private, undefined);
  assert.equal(typeof full.data.counts.registrations, "number");
});

await step("a wrong code gives the plain-English 401", async () => {
  const r = await call("POST", "/api/auth", { body: { code: "ZZZZ-ZZZZ-ZZZZ" } });
  ok(r, 401);
  assert.equal(r.data.error, "That code didn't work. Check it and try again.");
  assert.equal((await call("POST", "/api/auth", { body: { code: 42 } })).status, 401);
  assert.equal((await call("POST", "/api/auth", { body: "nope", raw: true, headers: { "Content-Type": "application/json" } })).status, 400);
  assert.equal((await call("POST", "/api/auth", { body: "{}", raw: true, headers: { "Content-Type": "text/plain" } })).status, 415);
});

await step("every demo role signs in and sees the right view", async () => {
  const sign = async (slug, role) => {
    const c = S.demo[slug].codes.find((x) => x.role === role);
    const r = await call("POST", "/api/auth", { body: { code: c.code } });
    ok(r);
    return { ...r.data, view: (await call("GET", `/api/events/${slug}/full`, { token: r.data.token })).data };
  };
  const ref = await sign("beach-soccer-cup", "referee");
  assert.equal(ref.view.me.role, "referee");
  assert.ok(ref.view.me.pitch);
  const coach = await sign("beach-soccer-cup", "coach");
  assert.equal(coach.view.me.teamId, coach.subject);
  assert.ok(coach.view.squad.length >= 6 && coach.view.squad[0].name.includes(" "));
  const judge = await sign("fight-night", "judge");
  assert.equal(judge.view.me.role, "judge");
});

// ---------------------------------------------------------------- organiser and event set-up

await step("SHOT admin creates an organiser; without the header it is refused", async () => {
  assert.ok(SHOT_ADMIN, "SHOT_ADMIN is needed (environment or .dev.vars)");
  assert.equal((await call("POST", "/api/shot/organisers", { body: { name: "X" } })).status, 403);
  assert.equal((await call("POST", "/api/shot/organisers", { body: { name: "X" }, headers: { "X-Shot-Admin": "wrong" } })).status, 403);
  const r = await call("POST", "/api/shot/organisers", { body: { name: `E2E Organiser ${stamp}` }, headers: { "X-Shot-Admin": SHOT_ADMIN } });
  ok(r);
  assert.match(r.data.key, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  S.orgKey = r.data.key;
});

await step("the organiser signs in and creates a football event with a first admin code", async () => {
  assert.equal((await call("POST", "/api/auth/organiser", { body: { key: "ZZZZ-ZZZZ-ZZZZ-ZZZZ" } })).status, 401);
  const s = await call("POST", "/api/auth/organiser", { body: { key: S.orgKey } });
  ok(s);
  S.orgToken = s.data.token;
  assert.equal((await call("POST", "/api/events", { body: { name: "No token", sport: "football" } })).status, 401);
  assert.equal((await call("POST", "/api/events", { token: S.orgToken, body: { name: "", sport: "football" } })).status, 400);
  assert.equal((await call("POST", "/api/events", { token: S.orgToken, body: { name: "Bad sport", sport: "chess" } })).status, 400);
  const r = await call("POST", "/api/events", { token: S.orgToken, body: { name: `E2E Cup ${stamp}`, sport: "football", date: "2026-11-14" } });
  ok(r);
  S.slug = r.data.slug;
  assert.equal(S.slug, `e2e-cup-${stamp}`);
  assert.match(r.data.adminCode, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){2}$/);
  assert.equal(r.data.event.phase, "pre");
  const again = await call("POST", "/api/events", { token: S.orgToken, body: { name: `E2E Cup ${stamp}`, sport: "football" } });
  ok(again);
  assert.notEqual(again.data.slug, S.slug, "a taken slug gets a suffix");
  const taken = await call("POST", "/api/events", { token: S.orgToken, body: { name: "x y z", sport: "football", slug: S.slug } });
  ok(taken, 409);
  const mine = await call("GET", "/api/organiser/events", { token: S.orgToken });
  ok(mine);
  assert.ok(mine.data.events.some((e) => e.slug === S.slug));
  const a = await call("POST", "/api/auth", { body: { code: r.data.adminCode } });
  ok(a);
  S.admin = a.data.token;
});

await step("a new event is unlisted and is not in the public list", async () => {
  const list = await call("GET", "/api/events");
  assert.ok(!list.data.events.some((e) => e.slug === S.slug));
  ok(await call("GET", `/api/events/${S.slug}`));
});

const ops = (token, list, status = 200) => call("POST", `/api/events/${S.slug}/ops`, { token, body: { ops: list } }).then((r) => { ok(r, status); return r; });

await step("admin sets up teams, pitches, referees and squads, then generates the knockout with the generator", async () => {
  const teams = [1, 2, 3, 4].map((n) => ({ id: `T${n}`, name: `Team ${n}` }));
  const setup = [
    { op: "pitch.add", id: "P2", name: "Pitch 2" },
    { op: "official.add", id: "R1", name: "Ref One", role: "referee", pitch: "P1" },
    { op: "official.add", id: "R2", name: "Ref Two", role: "referee", pitch: "P2" },
    { op: "official.add", id: "J1", name: "Judge One", role: "judge" },
    ...teams.map((t) => ({ op: "team.add", division: "main", id: t.id, name: t.name })),
    ...teams.map((t) => ({ op: "team.players", division: "main", id: t.id, players: [{ number: 7, name: `Sam ${t.name}` }, { number: 9, name: `Alex ${t.name}` }] })),
    { op: "settings.set", voteBy: "number" },
    { op: "vote.open", open: true },
    { op: "phase.set", phase: "live" },
  ];
  await ops(S.admin, setup);
  const g = generate({ teams, format: "knockout", start: "10:00", gameMins: 8, gapMins: 2, pitches: ["P1", "P2"], refs: ["R1", "R2"], minRest: 1 });
  assert.ok(g.ok, JSON.stringify(g.errors));
  const r = await ops(S.admin, [{ op: "fixtures.replace", division: "main", format: "knockout", fixtures: g.fixtures }]);
  assert.deepEqual(r.data.event.fixtures.map((f) => f.id), ["SF1", "SF2", "F"]);
  S.sf = Object.fromEntries(r.data.event.fixtures.map((f) => [f.id, f]));
  assert.equal(S.sf.SF1.pitch, "P1");
  assert.equal(S.sf.SF2.pitch, "P2");
  S.rev = r.data.rev;
});

await step("admin issues referee, judge and coach codes, and they work", async () => {
  const make = async (body) => { const r = await call("POST", `/api/events/${S.slug}/codes`, { token: S.admin, body }); ok(r); assert.match(r.data.code, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){2}$/); const s = await call("POST", "/api/auth", { body: { code: r.data.code } }); ok(s); return { ...r.data, ...s.data }; };
  const r1 = await make({ role: "referee", subject: "R1", label: "Ref One" });
  const r2 = await make({ role: "referee", subject: "R2", label: "Ref Two" });
  const j1 = await make({ role: "judge", subject: "J1", label: "Judge One" });
  const c1 = await make({ role: "coach", subject: "T1", label: "Coach T1" });
  Object.assign(S, { ref1: r1.token, ref2: r2.token, judge: j1.token, coach: c1.token, coachCode: c1.id });
  assert.equal((await call("POST", `/api/events/${S.slug}/codes`, { token: S.admin, body: { role: "referee", subject: "NOPE", label: "x" } })).status, 400);
  assert.equal((await call("POST", `/api/events/${S.slug}/codes`, { token: S.admin, body: { role: "wizard" } })).status, 400);
  assert.equal((await call("POST", `/api/events/${S.slug}/codes`, { token: S.ref1, body: { role: "referee", subject: "R1", label: "x" } })).status, 403);
  const list = await call("GET", `/api/events/${S.slug}/codes`, { token: S.admin });
  ok(list);
  assert.equal(list.data.codes.length, 5);
  assert.ok(list.data.codes.every((c) => c.created_at && typeof c.revoked === "boolean"));
});

await step("referees score, go full time and settle a level knockout game on penalties", async () => {
  const live = await call("POST", `/api/events/${S.slug}/ops`, { token: S.ref1, body: { ops: [{ op: "fixture.score", id: "SF1", home: 1, away: 1 }] } });
  ok(live);
  assert.equal(live.data.event.fixtures.find((f) => f.id === "SF1").state, "live");
  assert.ok(live.data.rev > S.rev);
  assert.equal(live.data.me.id, "R1");
  const early = await call("POST", `/api/events/${S.slug}/ops`, { token: S.ref1, body: { ops: [{ op: "fixture.pens", id: "SF1", side: "home" }] } });
  ok(early, 422);
  S.sf1Live = true;
});

await step("two referees saving at once on different games both land (compare-and-swap)", async () => {
  let rounds = 12;
  for (let i = 1; i <= rounds; i++) {
    const [a, b] = await Promise.all([
      call("POST", `/api/events/${S.slug}/ops`, { token: S.ref1, body: { ops: [{ op: "fixture.score", id: "SF1", home: i, away: 1 }] } }),
      call("POST", `/api/events/${S.slug}/ops`, { token: S.ref2, body: { ops: [{ op: "fixture.score", id: "SF2", home: 0, away: i }] } }),
    ]);
    ok(a); ok(b);
  }
  const r = await call("GET", `/api/events/${S.slug}`);
  const f = Object.fromEntries(r.data.event.fixtures.map((x) => [x.id, x]));
  assert.deepEqual([f.SF1.homeScore, f.SF1.awayScore, f.SF2.homeScore, f.SF2.awayScore], [rounds, 1, 0, rounds]);
  await ops(S.ref1, [{ op: "fixture.score", id: "SF1", home: 2, away: 2 }]);
});

await step("votes: accepted, changed, rejected without the age tick or for a bad pick", async () => {
  const pub = (await call("GET", `/api/events/${S.slug}`)).data.event;
  const sf1 = pub.fixtures.find((f) => f.id === "SF1");
  const choiceA = `${sf1.home}.p1`, choiceB = `${sf1.away}.p2`;
  const v = voter();
  const base = { voter: v, target: "g:SF1", choice: choiceA, over13: true };
  const first = await call("POST", `/api/events/${S.slug}/votes`, { body: base });
  ok(first);
  assert.deepEqual(first.data.mine, { target: "g:SF1", choice: choiceA, reason: null });
  assert.equal(first.data.tally.total, 1);
  const changed = await call("POST", `/api/events/${S.slug}/votes`, { body: { ...base, choice: choiceB } });
  ok(changed);
  assert.equal(changed.data.mine.choice, choiceB);
  assert.equal(changed.data.tally.total, 1, "changing a vote does not add one");
  assert.equal(changed.data.tally.leaders[0].choice, choiceB);
  const noAge = await call("POST", `/api/events/${S.slug}/votes`, { body: { ...base, voter: voter(), over13: undefined } });
  ok(noAge, 400);
  assert.equal(noAge.data.error, "Voting is for people aged 13 and over.");
  ok(await call("POST", `/api/events/${S.slug}/votes`, { body: { ...base, voter: voter(), choice: "T9.p1" } }), 400);
  ok(await call("POST", `/api/events/${S.slug}/votes`, { body: { ...base, voter: "short" } }), 400);
  ok(await call("POST", `/api/events/${S.slug}/votes`, { body: { ...base, voter: voter(), target: "g:NOPE" } }), 400);
  const bot = await call("POST", `/api/events/${S.slug}/votes`, { body: { ...base, voter: voter(), website: "http://spam" } });
  ok(bot);
  const t = await call("GET", `/api/events/${S.slug}/votes`);
  ok(t);
  assert.equal(t.data.total, 1, "the bot's vote was not stored");
  assert.ok(t.data.now.some((x) => x.target === "g:SF1"));
  S.vote = { voter: v, sf1, choiceB };
});

await step("voting closes after the lock, and switches off with the vote switch", async () => {
  await ops(S.admin, [{ op: "settings.set", lockSecs: 0 }]);
  await ops(S.ref1, [{ op: "fixture.state", id: "SF1", state: "ft" }, { op: "fixture.pens", id: "SF1", side: "home" }]);
  const r = await call("POST", `/api/events/${S.slug}/votes`, { body: { voter: S.vote.voter, target: "g:SF1", choice: S.vote.choiceB, over13: true } });
  ok(r, 409);
  assert.match(r.data.error, /closed/);
  await ops(S.admin, [{ op: "vote.open", open: false }]);
  const off = await call("POST", `/api/events/${S.slug}/votes`, { body: { voter: voter(), target: "g:SF2", choice: "T1.p1", over13: true } });
  ok(off, 409);
  assert.equal(off.data.error, "Voting isn't open right now.");
});

await step("full time and penalties show on the public event", async () => {
  const f = (await call("GET", `/api/events/${S.slug}`)).data.event.fixtures.find((x) => x.id === "SF1");
  assert.deepEqual([f.state, f.homeScore, f.awayScore, f.pens], ["ft", 2, 2, "home"]);
});

await step("permissions: coaches and referees cannot do what is not theirs", async () => {
  const send = (token, op) => call("POST", `/api/events/${S.slug}/ops`, { token, body: { ops: [op] } });
  assert.equal((await send(S.coach, { op: "fixture.score", id: "SF2", home: 9, away: 9 })).status, 403);
  assert.equal((await send(S.ref1, { op: "team.add", division: "main", id: "T9", name: "Nope" })).status, 403);
  assert.equal((await send(S.judge, { op: "fixture.score", id: "SF2", home: 9, away: 9 })).status, 403);
  assert.equal((await send(S.ref1, { op: "phase.set", phase: "post" })).status, 403);
  assert.equal((await send(undefined, { op: "fixture.score", id: "SF2", home: 9, away: 9 })).status, 401);
  assert.equal((await send("not.a.token", { op: "fixture.score", id: "SF2", home: 9, away: 9 })).status, 401);
  assert.equal((await send(S.admin, { op: "no.such.op" })).status, 400);
  const own = await send(S.coach, { op: "team.players", division: "main", id: "T1", players: [{ id: "p1", number: 7, name: "Sam Team 1" }, { id: "p2", number: 9, name: "Alex Team 1" }, { id: "p3", number: 11, name: "New Player" }] });
  ok(own);
  assert.equal(own.data.squad.length, 3);
  const other = await send(S.coach, { op: "team.players", division: "main", id: "T2", players: [] });
  ok(other, 409);
  assert.equal(other.data.error, "You can only edit your own squad.");
  const sf2 = (await call("GET", `/api/events/${S.slug}`)).data.event.fixtures.find((f) => f.id === "SF2");
  assert.equal(sf2.homeScore, 0, "refused changes saved nothing");
  assert.equal((await call("POST", `/api/events/${S.slug}/ops`, { token: S.admin, body: { ops: [] } })).status, 400);
});

await step("a refused batch changes nothing, even the ops before the bad one", async () => {
  const before = (await call("GET", `/api/events/${S.slug}/full`, { token: S.admin })).data;
  const r = await call("POST", `/api/events/${S.slug}/ops`, { token: S.admin, body: { ops: [{ op: "event.set", venue: "Changed venue" }, { op: "fixture.score", id: "NOPE", home: 1, away: 0 }] } });
  ok(r, 409);
  assert.equal(r.data.index, 1);
  const after = (await call("GET", `/api/events/${S.slug}/full`, { token: S.admin })).data;
  assert.equal(after.rev, before.rev);
  assert.equal(after.event.venue, before.event.venue);
});

await step("an oversized request body is refused", async () => {
  const r = await call("POST", `/api/events/${S.slug}/ops`, { token: S.admin, body: { ops: [{ op: "event.set", about: "x".repeat(300 * 1024) }] } });
  ok(r, 413);
});

await step("GET with ?rev= the current rev answers 204, an old one answers 200", async () => {
  const r = await call("GET", `/api/events/${S.slug}`);
  ok(r);
  const same = await call("GET", `/api/events/${S.slug}?rev=${r.data.rev}`);
  assert.equal(same.status, 204);
  assert.equal(same.data, null);
  assert.equal(same.headers.get("Cache-Control"), "no-store");
  ok(await call("GET", `/api/events/${S.slug}?rev=${r.data.rev - 1}`));
  assert.equal((await call("GET", `/api/events/${S.slug}/full?rev=${r.data.rev}`, { token: S.admin })).status, 204);
  assert.equal((await call("GET", `/api/events/${S.slug}/full?rev=${r.data.rev}`)).status, 401, "staff routes need a token even for a 204");
  assert.equal(r.headers.get("Cache-Control"), "no-store");
});

await step("admin import: PUT /doc needs the current rev, a valid event and the same slug", async () => {
  const full = (await call("GET", `/api/events/${S.slug}/full`, { token: S.admin })).data;
  const doc = { ...full.event, about: "Updated by import" };
  const put = (body, token = S.admin) => call("PUT", `/api/events/${S.slug}/doc`, { token, body });
  ok(await put({ doc, rev: full.rev - 1 }), 409);
  ok(await put({ doc: { ...doc, name: "" }, rev: full.rev }), 422);
  ok(await put({ doc: { ...doc, slug: "another-slug" }, rev: full.rev }), 422);
  ok(await put({ doc, rev: full.rev }, S.ref1), 403);
  const done = await put({ doc, rev: full.rev });
  ok(done);
  assert.equal(done.data.rev, full.rev + 1);
  assert.equal((await call("GET", `/api/events/${S.slug}`)).data.event.about, "Updated by import");
  ok(await put({ doc, rev: full.rev }), 409);
});

await step("boxing: a bout runs, the judge sees their own card early, the public does not", async () => {
  const c = await call("POST", "/api/events", { token: S.orgToken, body: { name: `E2E Fights ${stamp}`, sport: "boxing" } });
  ok(c);
  const slug = c.data.slug;
  const admin = (await call("POST", "/api/auth", { body: { code: c.data.adminCode } })).data.token;
  const send = (token, list) => call("POST", `/api/events/${slug}/ops`, { token, body: { ops: list } });
  ok(await send(admin, [
    { op: "official.add", id: "R1", name: "Ref", role: "referee" },
    { op: "official.add", id: "J1", name: "Judge One", role: "judge" },
    { op: "bout.add", id: "B1", title: "Main event", rounds: 3, roundMins: 2, scoring: "judges", judges: ["J1"], red: { name: "Red Boxer", club: "Red BC" }, blue: { name: "Blue Boxer", club: "Blue BC" } },
    { op: "vote.open", open: true },
  ]));
  const mk = async (body) => (await call("POST", "/api/auth", { body: { code: (await call("POST", `/api/events/${slug}/codes`, { token: admin, body })).data.code } })).data.token;
  const ref = await mk({ role: "referee", subject: "R1", label: "Ref" });
  const judge = await mk({ role: "judge", subject: "J1", label: "Judge" });
  ok(await send(ref, [{ op: "bout.action", id: "B1", action: "start" }]));
  const early = await send(judge, [{ op: "score.round", bout: "B1", round: 1, red: 10, blue: 9 }]);
  ok(early, 409);
  ok(await send(ref, [{ op: "bout.action", id: "B1", action: "end-round" }]));
  const scored = await send(judge, [{ op: "score.round", bout: "B1", round: 1, red: 10, blue: 9 }]);
  ok(scored);
  assert.deepEqual(scored.data.event.scorecards.B1.J1[1], [10, 9]);
  const view = await call("GET", `/api/events/${slug}/full`, { token: judge });
  assert.deepEqual(view.data.event.scorecards.B1.J1[1], [10, 9]);
  const pub = await call("GET", `/api/events/${slug}`);
  assert.equal(pub.data.event.scorecards.B1, undefined, "cards are private until the bout is decided");
  const rv = await call("POST", `/api/events/${slug}/votes`, { body: { voter: voter(), target: "r:B1:1", choice: "red", reason: "power", over13: true } });
  ok(rv);
  assert.equal(rv.data.tally.rounds[0].red, 1);
  assert.equal(rv.data.tally.rounds[0].reasons.red.power, 1);
  ok(await call("POST", `/api/events/${slug}/votes`, { body: { voter: voter(), target: "r:B1:1", choice: "red", reason: "luck", over13: true } }), 400);
  ok(await send(ref, [{ op: "bout.result", id: "B1", method: "KO", winner: "red", round: 1 }]));
  assert.ok((await call("GET", `/api/events/${slug}`)).data.event.scorecards.B1, "cards show once the bout is done");
});

// ---------------------------------------------------------------- registration

await step("registration: ok, duplicate gives the same answer, bad input is refused, only admin can read it", async () => {
  const reg = (body) => call("POST", `/api/events/${S.slug}/register`, { body });
  const good = { firstName: "Sam", email: "Sam.E2E@Example.com", over13: true, consent: true };
  const first = await reg(good);
  ok(first);
  assert.deepEqual(first.data, { ok: true });
  const dup = await reg({ ...good, email: "sam.e2e@example.com" });
  ok(dup);
  assert.deepEqual(dup.data, { ok: true });
  ok(await reg({ ...good, email: "not-an-email" }), 400);
  ok(await reg({ ...good, email: "a@b" }), 400);
  ok(await reg({ ...good, firstName: "" }), 400);
  ok(await reg({ ...good, firstName: "x".repeat(41) }), 400);
  ok(await reg({ ...good, over13: false }), 400);
  ok(await reg({ ...good, consent: false }), 400);
  const bot = await reg({ ...good, email: "bot@example.com", website: "spam" });
  ok(bot);
  const list = await call("GET", `/api/events/${S.slug}/registrations`, { token: S.admin });
  ok(list);
  assert.equal(list.data.count, 1);
  assert.equal(list.data.rows[0].email, "sam.e2e@example.com");
  assert.equal(list.data.rows[0].consent, `E2E Cup ${stamp} and SHOT Clubhouse can email me about E2E Cup ${stamp}, future events and the clubhouse. I can unsubscribe at any time.`);
  const csv = await call("GET", `/api/events/${S.slug}/registrations?format=csv`, { token: S.admin });
  ok(csv);
  assert.match(csv.headers.get("Content-Type"), /text\/csv/);
  assert.match(csv.data, /^first_name,email,consent,created_at\r\nSam,sam\.e2e@example\.com,/);
  assert.equal((await call("GET", `/api/events/${S.slug}/registrations`, { token: S.ref1 })).status, 403);
  assert.equal((await call("GET", `/api/events/${S.slug}/registrations`)).status, 401);
});

// ---------------------------------------------------------------- codes

await step("revoking a code stops its token at once; the last admin code cannot be revoked", async () => {
  const before = await call("GET", `/api/events/${S.slug}/full`, { token: S.coach });
  ok(before);
  const rev = await call("POST", `/api/events/${S.slug}/codes/${S.coachCode}/revoke`, { token: S.admin });
  ok(rev);
  const after = await call("GET", `/api/events/${S.slug}/full`, { token: S.coach });
  ok(after, 401);
  assert.equal((await call("POST", `/api/events/${S.slug}/ops`, { token: S.coach, body: { ops: [{ op: "team.players", division: "main", id: "T1", players: [] }] } })).status, 401);
  const list = await call("GET", `/api/events/${S.slug}/codes`, { token: S.admin });
  assert.equal(list.data.codes.find((c) => c.id === S.coachCode).revoked, true);
  ok(await call("POST", `/api/events/${S.slug}/codes/nope/revoke`, { token: S.admin }), 404);
  const adminCode = list.data.codes.find((c) => c.role === "admin");
  const last = await call("POST", `/api/events/${S.slug}/codes/${adminCode.id}/revoke`, { token: S.admin });
  ok(last, 409);
  assert.match(last.data.error, /one admin code/);
  ok(await call("GET", `/api/events/${S.slug}/full`, { token: S.admin }));
});

await step("a revoked code cannot sign in again", async () => {
  const fresh = await call("POST", `/api/events/${S.slug}/codes`, { token: S.admin, body: { role: "coach", subject: "T2", label: "Temp" } });
  ok(fresh);
  ok(await call("POST", "/api/auth", { body: { code: fresh.data.code } }));
  const list = await call("GET", `/api/events/${S.slug}/codes`, { token: S.admin });
  const id = list.data.codes.find((c) => c.label === "Temp").id;
  ok(await call("POST", `/api/events/${S.slug}/codes/${id}/revoke`, { token: S.admin }));
  ok(await call("POST", "/api/auth", { body: { code: fresh.data.code } }), 401);
});

await step("an admin code from one event does not work on another", async () => {
  const other = await call("POST", "/api/events", { token: S.orgToken, body: { name: `E2E Other ${stamp}`, sport: "football" } });
  ok(other);
  ok(await call("GET", `/api/events/${other.data.slug}/full`, { token: S.admin }), 401);
  ok(await call("GET", `/api/events/${other.data.slug}/codes`, { token: S.admin }), 401);
});

// ---------------------------------------------------------------- pages and headers

await step("/e/<slug>/ for an unlisted event is noindex, and carries the security headers", async () => {
  const r = await call("GET", `/e/${S.slug}/`);
  assert.equal(r.headers.get("X-Robots-Tag"), "noindex");
  assert.equal(r.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(r.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.match(r.headers.get("Content-Security-Policy"), /default-src 'self'/);
  const sub = await call("GET", `/e/${S.slug}/teams/T1`);
  assert.equal(sub.headers.get("X-Robots-Tag"), "noindex");
  const screen = await call("GET", `/e/${S.slug}/screen/`);
  assert.equal(screen.headers.get("X-Robots-Tag"), "noindex");
  const bare = await call("GET", `/e/${S.slug}`);
  assert.equal(bare.status, 301);
  assert.equal(bare.headers.get("Location"), `/e/${S.slug}/`);
  if (r.status !== 200) return "skip"; // the fan page (public/event/) is built by another workstream
  assert.match(r.headers.get("Content-Type"), /text\/html/);
});

await step("an unknown /e/ slug gives the 404 page", async () => {
  const r = await call("GET", "/e/no-such-event-here/");
  assert.equal(r.status, 404);
  assert.match(r.headers.get("Content-Type"), /text\/html/);
  assert.match(r.data, /can't find that event/);
  assert.equal((await call("GET", "/e/UPPER_case/")).status, 404);
});

await step("SHOT lists an event, which drops the noindex header", async () => {
  ok(await call("POST", `/api/shot/events/${S.slug}/listing`, { body: { listed: true } }), 403);
  ok(await call("POST", `/api/shot/events/${S.slug}/listing`, { body: { listed: true }, headers: { "X-Shot-Admin": SHOT_ADMIN } }));
  assert.ok((await call("GET", "/api/events")).data.events.some((e) => e.slug === S.slug));
  assert.equal((await call("GET", `/e/${S.slug}/`)).headers.get("X-Robots-Tag"), null);
  ok(await call("POST", `/api/shot/events/${S.slug}/listing`, { body: { listed: false }, headers: { "X-Shot-Admin": SHOT_ADMIN } }));
});

await step("API answers are JSON with no-store, and unknown routes are 404", async () => {
  for (const path of ["/api/demo", "/api/events", `/api/events/${S.slug}`, `/api/events/${S.slug}/votes`]) {
    const r = await call("GET", path);
    assert.match(r.headers.get("Content-Type"), /application\/json/, path);
    assert.equal(r.headers.get("Cache-Control"), "no-store", path);
  }
  const missing = await call("GET", "/api/events/no-such-event");
  ok(missing, 404);
  assert.equal(missing.data.error, "We can't find that event.");
  ok(await call("GET", "/api/nothing"), 404);
  ok(await call("DELETE", `/api/events/${S.slug}`), 405);
});

// ---------------------------------------------------------------- demos: reset and protection

await step("demo events: codes cannot be revoked, reset works for demo admins only", async () => {
  const codes = await call("GET", "/api/events/futsal-finals/codes", { token: S.futsalAdmin });
  ok(codes);
  ok(await call("POST", `/api/events/futsal-finals/codes/${codes.data.codes[0].id}/revoke`, { token: S.futsalAdmin }), 403);
  ok(await call("POST", `/api/events/${S.slug}/reset`, { token: S.admin }), 403);
  ok(await call("POST", "/api/events/futsal-finals/reset", { token: S.ref1 }), 401);
  const before = (await call("GET", "/api/events/futsal-finals")).data.rev;
  await call("POST", "/api/events/futsal-finals/ops", { token: S.futsalAdmin, body: { ops: [{ op: "event.set", name: "Changed by a visitor" }] } });
  assert.equal((await call("GET", "/api/events/futsal-finals")).data.event.name, "Changed by a visitor");
  ok(await call("POST", "/api/events/futsal-finals/reset", { token: S.futsalAdmin }));
  const after = await call("GET", "/api/events/futsal-finals");
  assert.equal(after.data.event.name, "Futsal Finals");
  assert.ok(after.data.rev > before);
  ok(await call("GET", "/api/events/futsal-finals/full", { token: S.futsalAdmin }));
});

await step("demo events keep no registrations and can't take links, video, logos or new codes", async () => {
  const r = await call("POST", "/api/events/futsal-finals/register", { body: { firstName: "Demo", email: `demo-${stamp}@example.com`, over13: true, consent: true } });
  ok(r);
  assert.deepEqual(r.data, { ok: true, demo: true });
  ok(await call("GET", "/api/events/futsal-finals/registrations", { token: S.futsalAdmin }), 403);
  ok(await call("POST", "/api/events/futsal-finals/codes", { token: S.futsalAdmin, body: { role: "admin" } }), 403);
  ok(await call("POST", "/api/events/futsal-finals/ops", { token: S.futsalAdmin, body: { ops: [{ op: "stream.set", url: "https://example.com/x.m3u8", on: true }] } }), 403);
  ok(await call("POST", "/api/events/futsal-finals/ops", { token: S.futsalAdmin, body: { ops: [{ op: "update.add", title: "Hi", link: "https://example.com" }] } }), 403);
  ok(await call("POST", "/api/events/futsal-finals/ops", { token: S.futsalAdmin, body: { ops: [{ op: "event.set", theme: { logo: "https://example.com/l.png" } }] } }), 403);
  const full = await call("GET", "/api/events/futsal-finals/full", { token: S.futsalAdmin });
  ok(await call("PUT", "/api/events/futsal-finals/doc", { token: S.futsalAdmin, body: { doc: full.data.event, rev: full.data.rev } }), 403);
  ok(await call("POST", "/api/events/futsal-finals/ops", { token: S.futsalAdmin, body: { ops: [{ op: "bout.add", id: "__proto__", red: { name: "R" }, blue: { name: "B" } }] } }), 400);
  const own = await call("POST", `/api/events/${S.slug}/ops`, { token: S.admin, body: { ops: [{ op: "stream.set", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", on: true }] } });
  ok(own);
  assert.equal(own.data.event.stream.on, true, "a real event still takes a stream link");
});

await step("the sixes demo has a player-of-the-night leaderboard and updates", async () => {
  const t = await call("GET", "/api/events/sixes-league-night/votes");
  ok(t);
  assert.equal(t.data.open, false);
  assert.ok(t.data.total > 50 && t.data.leaders.length >= 5);
  const e = await call("GET", "/api/events/sixes-league-night");
  assert.equal(e.data.event.phase, "post");
  assert.ok(e.data.event.updates.length >= 3);
});

// ---------------------------------------------------------------- rate limits (last: they lock this connection for a minute)

await step("registration is limited to 10 a minute per connection", async () => {
  let limited = 0;
  for (let i = 0; i < 14; i++) {
    const r = await call("POST", `/api/events/${S.slug}/register`, { body: { firstName: "Rate", email: `rate${i}-${stamp}@example.com`, over13: true, consent: true } });
    if (r.status === 429) { limited++; assert.match(r.data.error, /Wait a minute/); }
  }
  assert.ok(limited >= 1, "expected a 429 within 14 sign-ups");
});

// ---------------------------------------------------------------- report

for (const r of results) console.log(`${r.ok ? (r.note === "SKIP" ? "SKIP" : "PASS") : "FAIL"}  ${r.name}${r.ok ? "" : `\n      ${r.note}`}`);
const failed = results.filter((r) => !r.ok).length;
const skipped = results.filter((r) => r.ok && r.note === "SKIP").length;
console.log(`\n${results.length - failed - skipped} passed, ${failed} failed, ${skipped} skipped (${base})`);
process.exit(failed ? 1 : 0);
