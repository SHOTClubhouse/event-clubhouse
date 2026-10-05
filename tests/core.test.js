import { test } from "node:test";
import assert from "node:assert/strict";
import { blankEvent, validate, publicView, playerLabel, streamInfo, addMins, consentText, terms } from "../public/core/model.js";
import { generate, roundRobin, snakeGroups, seedOrder, bracket, checkOptions } from "../public/core/generator.js";
import { standings, resolve, champion, winnerOf, tables } from "../public/core/standings.js";
import { decision, judgeCard, cardsComplete, resultText, nextState } from "../public/core/boxing.js";
import { applyOps, allowed } from "../public/core/ops.js";
import { checkVote, tally, openTargets } from "../public/core/votes.js";

const teams = (n) => Array.from({ length: n }, (_, i) => ({ id: `T${i + 1}`, name: `Team ${i + 1}` }));
const admin = { role: "admin", id: null };

function footballEvent(n = 8, opts = {}) {
  const d = blankEvent({ slug: "test-cup", name: "Test Cup", sport: "football", date: "2026-10-10" });
  d.pitches = [{ id: "P1", name: "Pitch 1", stream: { url: null, on: false, label: "" } }, { id: "P2", name: "Pitch 2", stream: { url: null, on: false, label: "" } }];
  d.officials = [{ id: "R1", name: "Ref One", role: "referee", pitch: "P1" }, { id: "R2", name: "Ref Two", role: "referee", pitch: "P2" }];
  const g = generate({ teams: teams(n), format: "groups-knockout", groups: 2, advance: 2, start: "10:00", gameMins: 8, gapMins: 2, pitches: ["P1", "P2"], refs: ["R1", "R2"], minRest: 1, ...opts });
  assert.ok(g.ok, JSON.stringify(g.errors));
  d.divisions[0].teams = g.teams.map((t, i) => ({ ...t, players: [{ id: "p1", number: 7, name: `Sam Smith${i}` }, { id: "p2", number: 10, name: "Alex Jones" }] }));
  d.fixtures = g.fixtures;
  return d;
}

// ---- Model ----
test("a blank event and a generated football event both pass validation", () => {
  assert.deepEqual(validate(blankEvent({ slug: "abc", name: "ABC" })), []);
  assert.deepEqual(validate(footballEvent()), []);
});

test("validation catches the mistakes that would break a live day", () => {
  const d = footballEvent();
  d.fixtures[0].home = d.fixtures[0].away;
  d.fixtures[1].homeScore = 3;
  d.fixtures[2].state = "ft";
  d.slug = "Bad Slug";
  const e = validate(d).join(" | ");
  assert.match(e, /cannot play itself/);
  assert.match(e, /both scores or neither/);
  assert.match(e, /full time needs a score/);
  assert.match(e, /slug/);
});

test("fans never see full names: number, name or both, per the event", () => {
  const p = { id: "p1", number: 7, name: "Sam Smith" };
  assert.equal(playerLabel(p, "number"), "#7");
  assert.equal(playerLabel(p, "name"), "Sam");
  assert.equal(playerLabel(p, "both"), "#7 Sam");
  const d = footballEvent();
  d.settings.voteBy = "name";
  const v = JSON.stringify(publicView(d));
  assert.ok(!v.includes("Smith"), "surname leaked");
  assert.ok(!v.includes("Jones"), "surname leaked");
  assert.ok(!v.includes("Ref One"), "official surname leaked");
});

test("judges' cards stay hidden until the bout is done", () => {
  const d = boxingEvent();
  d.scorecards = { B1: { J1: { 1: [10, 9] } } };
  assert.equal(publicView(d).scorecards.B1, undefined);
  d.card.bouts[0].state = "done"; d.card.bouts[0].round = 3; d.card.bouts[0].result = { method: "KO", winner: "red", round: 1 };
  assert.ok(publicView(d).scorecards.B1);
});

test("stream links: YouTube and Twitch embed, video files play, Veo pages are buttons", () => {
  assert.equal(streamInfo({ on: true, url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }).kind, "youtube");
  assert.equal(streamInfo({ on: true, url: "https://twitch.tv/exampleclub" }).kind, "twitch");
  assert.equal(streamInfo({ on: true, url: "https://c.veocdn.com/x/live.m3u8" }).format, "hls");
  assert.equal(streamInfo({ on: true, url: "https://app.veo.co/matches/abc/" }).kind, "link");
  assert.equal(streamInfo({ on: false, url: "https://twitch.tv/x" }), null);
  assert.equal(streamInfo({ on: true, url: "javascript:alert(1)" }), null);
});

// ---- Generator ----
test("round robin: every pairing exactly once, nobody twice in a round", () => {
  for (const n of [3, 4, 5, 6, 7, 8]) {
    const ids = teams(n).map((t) => t.id);
    const rounds = roundRobin(ids);
    const pairs = rounds.flat().map((p) => [...p].sort().join("-"));
    assert.equal(pairs.length, (n * (n - 1)) / 2);
    assert.equal(new Set(pairs).size, pairs.length);
    rounds.forEach((r) => { const s = r.flat(); assert.equal(new Set(s).size, s.length); });
  }
});

test("snake seeding spreads the top seeds across groups", () => {
  const g = snakeGroups(teams(8), 2).map((t) => t.group).join("");
  assert.equal(g, "ABBAABBA");
});

test("bracket: top two seeds can only meet in the final; group winners avoid their own group", () => {
  assert.deepEqual(seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  const r = bracket(["1st Group A", "1st Group B", "2nd Group A", "2nd Group B"], true);
  assert.deepEqual(r[0].map((m) => `${m.home} v ${m.away}`), ["1st Group A v 2nd Group B", "1st Group B v 2nd Group A"]);
  assert.deepEqual(r[1].map((m) => m.stage), ["Third place", "Final"]);
  assert.equal(r[1][1].home, "Winner Semi-final 1");
});

test("knockout with byes: 6 teams, the top two seeds go straight to the semis", () => {
  const r = bracket(["T1", "T2", "T3", "T4", "T5", "T6"]);
  assert.equal(r[0].length, 2);
  assert.ok(r[0].every((m) => /^Round 1 game \d$/.test(m.stage)));
  const semis = r[1].flatMap((m) => [m.home, m.away]);
  assert.ok(semis.includes("T1") && semis.includes("T2"));
  assert.equal(r[2][0].stage, "Final");
});

function scheduleChecks(fx, minRest, slotMins, start) {
  const slot = (t) => { const [h, m] = t.split(":").map(Number); const [sh, sm] = start.split(":").map(Number); return (h * 60 + m - sh * 60 - sm) / slotMins; };
  const bySlot = {};
  fx.filter((f) => !f.stage).forEach((f) => { (bySlot[f.time] = bySlot[f.time] || []).push(f); });
  Object.values(bySlot).forEach((games) => {
    const s = games.flatMap((g) => [g.home, g.away]);
    assert.equal(new Set(s).size, s.length, "a team plays twice in one slot");
    assert.equal(new Set(games.map((g) => g.pitch)).size, games.length, "two games on one pitch at once");
  });
  const last = {};
  fx.filter((f) => !f.stage).sort((a, b) => a.time.localeCompare(b.time)).forEach((f) => {
    [f.home, f.away].forEach((t) => { if (last[t] != null) assert.ok(slot(f.time) - last[t] - 1 >= minRest, `${t} not rested at ${f.time}`); last[t] = slot(f.time); });
  });
}

test("groups and knockouts across two pitches: rest, no clashes, everyone plays the same number", () => {
  const g = generate({ teams: teams(12), format: "groups-knockout", groups: 2, advance: 2, start: "13:00", gameMins: 8, gapMins: 2, pitches: ["P1", "P2"], refs: ["R1", "R2"], minRest: 1, thirdPlace: true });
  assert.ok(g.ok);
  assert.equal(g.summary.groupGames, 30);
  assert.deepEqual(g.summary.perTeam, { min: 5, max: 5 });
  assert.equal(g.summary.knockoutGames, 4);
  scheduleChecks(g.fixtures, 1, 10, "13:00");
  const ko = g.fixtures.filter((f) => f.stage);
  const lastGroup = Math.max(...g.fixtures.filter((f) => !f.stage).map((f) => f.time.replace(":", "")));
  assert.ok(ko.every((f) => Number(f.time.replace(":", "")) > lastGroup), "knockouts before the groups finished");
  assert.deepEqual(ko.map((f) => f.id), ["SF1", "SF2", "3P", "F"]);
  assert.ok(g.fixtures.every((f) => f.ref === (f.pitch === "P1" ? "R1" : "R2")));
});

test("London 26 shape: one pitch alternates groups A, B, A, B", () => {
  const g = generate({ teams: teams(12), format: "groups-knockout", groups: 2, advance: 2, start: "13:00", gameMins: 8, gapMins: 2, pitches: ["P1"], minRest: 2 });
  assert.ok(g.ok);
  const grp = Object.fromEntries(g.teams.map((t) => [t.id, t.group]));
  const seq = g.fixtures.filter((f) => !f.stage).map((f) => grp[f.home]);
  let alternations = 0;
  for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) alternations++;
  assert.ok(alternations >= seq.length - 3, `groups should alternate: ${seq.join("")}`);
  scheduleChecks(g.fixtures, 2, 10, "13:00");
});

test("rest is enforced even when it leaves a slot empty: 4 teams, 2 pitches", () => {
  const g = generate({ teams: teams(4), format: "league", start: "10:00", gameMins: 8, gapMins: 2, pitches: ["P1", "P2"], minRest: 1 });
  assert.ok(g.ok);
  scheduleChecks(g.fixtures, 1, 10, "10:00");
  assert.deepEqual([...new Set(g.fixtures.map((f) => f.time))], ["10:00", "10:20", "10:40"]);
  const tight = generate({ teams: teams(4), format: "league", start: "10:00", gameMins: 8, gapMins: 2, pitches: ["P1", "P2"], minRest: 0 });
  assert.deepEqual([...new Set(tight.fixtures.map((f) => f.time))], ["10:00", "10:10", "10:20"]);
});

test("no wasted slots: 8 teams, 2 groups, 2 pitches, rest 1 fits the 12 group games into 6 slots", () => {
  const g = generate({ teams: teams(8), format: "groups-knockout", groups: 2, advance: 2, start: "10:00", gameMins: 10, gapMins: 2, pitches: ["P1", "P2"], minRest: 1 });
  assert.ok(g.ok);
  scheduleChecks(g.fixtures, 1, 12, "10:00");
  const times = [...new Set(g.fixtures.filter((f) => !f.stage).map((f) => f.time))];
  assert.equal(times.length, 6, `group stage used ${times.join(", ")}`);
  assert.equal(times.sort().at(-1), "11:00", `gaps in the group stage: ${times.join(", ")}`);
});

test("league, double round robin and straight knockout all generate", () => {
  const l = generate({ teams: teams(5), format: "league", legs: 2, start: "09:00", gameMins: 12, gapMins: 3, pitches: ["P1"], minRest: 0 });
  assert.ok(l.ok);
  assert.equal(l.fixtures.length, 20);
  const k = generate({ teams: teams(16), format: "knockout", start: "09:00", gameMins: 10, gapMins: 0, pitches: ["P1", "P2", "P3", "P4"], minRest: 0 });
  assert.ok(k.ok);
  assert.equal(k.fixtures.length, 15);
  assert.equal(k.fixtures.at(-1).stage, "Final");
});

test("generator options explain what's wrong in plain English", () => {
  assert.match(checkOptions({ format: "groups-knockout", teams: teams(9), groups: 3, advance: 2, start: "10:00", gameMins: 8, pitches: ["P1"] }).join(" "), /needs to be 2, 4, 8, 16 or 32/);
  assert.match(checkOptions({ format: "league", teams: teams(1), start: "25:00", gameMins: 8, pitches: [] }).join(" "), /at least two teams/);
});

// ---- Standings ----
test("tables, placeholders and the champion fill in from scores", () => {
  const d = footballEvent(8);
  d.fixtures.filter((f) => !f.stage).forEach((f, i) => Object.assign(f, { state: "ft", homeScore: (i % 3) + 1, awayScore: i % 2, ftAt: 1 }));
  const div = d.divisions[0];
  const t = tables(div, d.fixtures, d.settings.points);
  assert.equal(t.length, 2);
  const sf1 = d.fixtures.find((f) => f.id === "SF1");
  const home = resolve(div, d.fixtures, sf1.home, d.settings.points);
  assert.ok(home === null || div.teams.some((x) => x.id === home));
  if (home) {
    const sf2 = d.fixtures.find((f) => f.id === "SF2");
    Object.assign(sf1, { state: "ft", homeScore: 2, awayScore: 2, pens: "away" });
    Object.assign(sf2, { state: "ft", homeScore: 1, awayScore: 0 });
    const fin = d.fixtures.find((f) => f.id === "F");
    Object.assign(fin, { state: "ft", homeScore: 3, awayScore: 1 });
    const c = champion(div, d.fixtures, d.settings.points);
    assert.equal(c.how, "Won the final");
    assert.equal(c.id, resolve(div, d.fixtures, sf1.away, d.settings.points));
  }
  assert.equal(winnerOf({ state: "ft", homeScore: 1, awayScore: 1, pens: "home" }), "home");
});

test("custom points: win 2, draw 1", () => {
  const rows = standings([{ id: "A", name: "A" }, { id: "B", name: "B" }], [{ home: "A", away: "B", state: "ft", homeScore: 1, awayScore: 0 }], { win: 2, draw: 1, loss: 0 });
  assert.equal(rows[0].pts, 2);
});

// ---- Boxing ----
function boxingEvent() {
  const d = blankEvent({ slug: "fight-night", name: "Fight Night", sport: "boxing", date: "2026-10-10" });
  d.officials = [{ id: "J1", name: "Judge One", role: "judge" }, { id: "J2", name: "Judge Two", role: "judge" }, { id: "J3", name: "Judge Three", role: "judge" }, { id: "R1", name: "Referee", role: "referee" }];
  d.card.bouts = [{ id: "B1", order: 1, title: "Main event", weight: "Middleweight", rounds: 3, roundMins: 2, scoring: "judges", judges: ["J1", "J2", "J3"], red: { name: "Red Fighter", club: "Red ABC" }, blue: { name: "Blue Fighter", club: "Blue ABC" }, state: "scheduled", round: 0, result: null }];
  d.settings.vote.open = true;
  return d;
}

test("10-point must: decisions are unanimous, split, majority or a draw", () => {
  const b = boxingEvent().card.bouts[0];
  const cards = (a, bb, c) => ({ B1: { J1: a, J2: bb, J3: c } });
  const R = { 1: [10, 9], 2: [10, 9], 3: [10, 9] }, B = { 1: [9, 10], 2: [9, 10], 3: [9, 10] }, E = { 1: [10, 10], 2: [10, 10], 3: [10, 10] };
  assert.equal(decision(b, cards(R, R, R)).kind, "unanimous");
  assert.equal(decision(b, cards(R, R, B)).kind, "split");
  assert.equal(decision(b, cards(R, R, E)).kind, "majority");
  assert.equal(decision(b, cards(R, B, E)).winner, null);
  assert.equal(judgeCard(cards(R, R, R), "B1", "J1").red, 30);
});

test("a bout runs start, rounds, judges' cards, decision; fans vote each round", () => {
  let d = boxingEvent();
  const ref = { role: "referee", id: "R1" };
  const step = (ops, actor, now) => { const r = applyOps(d, ops, actor, now); assert.ok(r.ok, r.error); d = r.doc; };
  step([{ op: "bout.action", id: "B1", action: "start" }], ref, 1000);
  assert.equal(openTargets(d, 1000)[0].target, "r:B1:1");
  const v = checkVote({ voter: "x".repeat(20), target: "r:B1:1", choice: "red", reason: "pressure", over13: true }, d, 1500);
  assert.ok(v.ok);
  const early = applyOps(d, [{ op: "score.round", bout: "B1", round: 1, red: 10, blue: 9 }], { role: "judge", id: "J1" }, 1500);
  assert.match(early.error, /once it has ended/);
  for (let n = 1; n <= 3; n++) {
    if (n > 1) step([{ op: "bout.action", id: "B1", action: "next-round" }], ref, n * 10000);
    step([{ op: "bout.action", id: "B1", action: "end-round" }], ref, n * 10000 + 5000);
    ["J1", "J2", "J3"].forEach((j) => step([{ op: "score.round", bout: "B1", round: n, red: 10, blue: j === "J3" ? 10 : 9 }], { role: "judge", id: j }, n * 10000 + 6000));
  }
  assert.ok(cardsComplete(d.card.bouts[0], d.scorecards));
  assert.equal(applyOps(d, [{ op: "score.round", bout: "B1", round: 1, red: 10, blue: 9 }], { role: "judge", id: "J9" }).error, "You're not judging this bout.");
  step([{ op: "bout.result", id: "B1", method: "PTS" }], ref, 40000);
  const b = d.card.bouts[0];
  assert.equal(b.state, "done");
  assert.equal(b.result.winner, "red");
  assert.equal(b.result.kind, "majority");
  assert.equal(resultText(b), "Red Fighter wins on points (majority decision).");
  // Round 3's vote stays open for lockSecs after the round ended, then closes.
  assert.ok(openTargets(d, 35000 + 59000).some((t) => t.target === "r:B1:3"));
  assert.ok(!openTargets(d, 35000 + 61000).some((t) => t.target === "r:B1:3"));
  const t = tally([{ target: "r:B1:1", choice: "red", reason: "pressure", n: 3 }, { target: "r:B1:1", choice: "blue", reason: null, n: 1 }], d, 99999);
  assert.equal(t.rounds[0].red, 3);
  assert.equal(t.rounds[0].reasons.red.pressure, 3);
  assert.equal(t.fighters[0].name, "Red Fighter");
});

test("a stoppage records the method and round", () => {
  let d = boxingEvent();
  const ref = { role: "referee", id: "R1" };
  d = applyOps(d, [{ op: "bout.action", id: "B1", action: "start" }], ref, 1).doc;
  const r = applyOps(d, [{ op: "bout.result", id: "B1", method: "TKO", winner: "blue" }], ref, 2);
  assert.ok(r.ok);
  assert.equal(resultText(r.doc.card.bouts[0]), "Blue Fighter wins by technical knockout in round 1.");
  assert.equal(nextState(r.doc.card.bouts[0], "next-round").error, "End the round first.");
});

// ---- Ops and permissions ----
test("referees score and coaches edit only their own squad; nobody else can set up", () => {
  const d = footballEvent();
  const f = d.fixtures[0];
  const ref = { role: "referee", id: "R1" };
  const r = applyOps(d, [{ op: "fixture.score", id: f.id, home: 1, away: 0 }, { op: "fixture.state", id: f.id, state: "ft" }], ref, 5000);
  assert.ok(r.ok);
  const g = r.doc.fixtures[0];
  assert.equal(g.state, "ft"); assert.equal(g.ftAt, 5000);
  assert.equal(applyOps(d, [{ op: "team.add", division: "main", name: "X" }], ref).status, 403);
  const own = d.divisions[0].teams[0].id, other = d.divisions[0].teams[1].id;
  const coach = { role: "coach", id: own };
  assert.ok(applyOps(d, [{ op: "team.players", division: "main", id: own, players: [{ number: 9, name: "New Player" }] }], coach).ok);
  assert.match(applyOps(d, [{ op: "team.players", division: "main", id: other, players: [] }], coach).error, /own squad/);
  assert.ok(allowed("coach").includes("team.players") && !allowed("coach").includes("fixture.score"));
});

test("a batch is all or nothing, and a bad result never saves", () => {
  const d = footballEvent();
  const r = applyOps(d, [{ op: "fixture.score", id: d.fixtures[0].id, home: 1, away: 0 }, { op: "fixture.score", id: d.fixtures[1].id, home: 100, away: 0 }], admin);
  assert.equal(r.ok, false);
  assert.match(r.error, /0 to 99/);
});

test("regenerating fixtures is refused once a game has started", () => {
  const d = footballEvent();
  const started = applyOps(d, [{ op: "fixture.score", id: d.fixtures[0].id, home: 1, away: 0 }], admin).doc;
  assert.match(applyOps(started, [{ op: "fixtures.replace", division: "main", fixtures: [] }], admin).error, /have started/);
});

// ---- Football voting ----
test("football vote: only players in a live game, by number, locks a minute after full time", () => {
  let d = footballEvent();
  d.settings.vote.open = true;
  const f = d.fixtures[0];
  const homePlayer = `${f.home}.p1`;
  assert.equal(checkVote({ voter: "v".repeat(20), target: `g:${f.id}`, choice: homePlayer, over13: true }, d, 0).status, 409);
  d = applyOps(d, [{ op: "fixture.state", id: f.id, state: "live" }], admin, 1000).doc;
  const open = openTargets(d, 1000)[0];
  assert.equal(open.sides[0].players[0].label, "#7");
  assert.ok(checkVote({ voter: "v".repeat(20), target: `g:${f.id}`, choice: homePlayer, over13: true }, d, 1000).ok);
  assert.equal(checkVote({ voter: "v".repeat(20), target: `g:${f.id}`, choice: homePlayer, over13: false }, d, 1000).status, 400);
  assert.equal(checkVote({ voter: "v".repeat(20), target: `g:${f.id}`, choice: "T99.p1", over13: true }, d, 1000).status, 400);
  d = applyOps(d, [{ op: "fixture.state", id: f.id, state: "ft" }], admin, 10000).doc;
  assert.ok(checkVote({ voter: "v".repeat(20), target: `g:${f.id}`, choice: homePlayer, over13: true }, d, 69000).ok);
  assert.equal(checkVote({ voter: "v".repeat(20), target: `g:${f.id}`, choice: homePlayer, over13: true }, d, 71000).status, 409);
  const t = tally([{ target: `g:${f.id}`, choice: homePlayer, reason: null, n: 4 }], d, 71000);
  assert.equal(t.leaders[0].votes, 4);
  assert.equal(t.leaders[0].label, "#7");
});

test("the consent sentence names the partner, or the event when there isn't one", () => {
  const d = blankEvent({ slug: "x-cup", name: "X Cup" });
  assert.equal(consentText(d), "X Cup and SHOT Clubhouse can email me about X Cup, future events and the clubhouse. I can unsubscribe at any time.");
  d.theme.partner = "X Promotions";
  assert.match(consentText(d), /^X Promotions and SHOT Clubhouse can email me about X Cup,/);
});

test("time helpers wrap midnight", () => { assert.equal(addMins("23:55", 10), "00:05"); });

test("ids that are JavaScript prototype keys are refused and never pollute objects", () => {
  const d = blankEvent({ slug: "fight-night", name: "Fight Night", sport: "boxing", date: "2026-10-10" });
  const admin = { role: "admin", id: null };
  const add = (id) => ({ op: "bout.add", id, red: { name: "Red" }, blue: { name: "Blue" } });
  for (const id of ["__proto__", "constructor", "prototype"]) {
    const r = applyOps(d, [add(id), { op: "score.round", bout: id, judge: "J1", round: 1, red: 10, blue: 9 }], admin);
    assert.equal(r.ok, false, id);
  }
  assert.equal({}.J1, undefined);
  assert.equal(Object.prototype["1"], undefined);
  const bad = { ...d, divisions: [{ id: "constructor", name: "X", format: "league", teams: [] }] };
  assert.ok(validate(bad).length > 0);
  const ref = { ...d, fixtures: [{ id: "X1", division: "constructor", time: "10:00", home: "A", away: "B", state: "scheduled", homeScore: null, awayScore: null }] };
  assert.doesNotThrow(() => validate(ref));
  assert.ok(validate(ref).length > 0);
});

test("validate reports malformed data instead of throwing", () => {
  const d = blankEvent({ slug: "x-cup", name: "X Cup" });
  for (const k of ["pitches", "officials", "divisions", "fixtures", "updates"]) {
    const bad = { ...d, [k]: [null] };
    assert.doesNotThrow(() => validate(bad), k);
    assert.ok(validate(bad).length > 0, k);
  }
});

test("team ids are unique across divisions, so a coach code can only ever mean one team", () => {
  const d = blankEvent({ slug: "x-cup", name: "X Cup" });
  d.divisions = [
    { id: "D1", name: "Men", format: "league", teams: [{ id: "T1", name: "A", players: [] }] },
    { id: "D2", name: "Women", format: "league", teams: [{ id: "T1", name: "B", players: [] }] },
  ];
  assert.ok(validate(d).some((e) => /team T1/.test(e)));
});

test("an event's words: football by default, courts and points when set, checked when saved", () => {
  const d = blankEvent({ slug: "x-cup", name: "X Cup" });
  assert.deepEqual([terms(d).place, terms(d).places, terms(d).Score, terms(d).diff.abbr], ["pitch", "pitches", "Goal", "GD"]);
  assert.equal(terms(blankEvent({ slug: "f", name: "F", sport: "boxing" })).place, "ring");
  d.settings.terms = { place: "court", score: "point", discipline: "Dodgeball" };
  assert.deepEqual([terms(d).Places, terms(d).scores, terms(d).diff.abbr, terms(d).discipline], ["Courts", "points", "PD", "Dodgeball"]);
  assert.deepEqual(validate(d), []);
  d.settings.terms.place = "pool";
  assert.ok(validate(d).some((e) => /terms.place/.test(e)));
  const r = applyOps(blankEvent({ slug: "y-cup", name: "Y" }), [{ op: "settings.set", terms: { place: "cage", score: "goal", discipline: "Street football" } }], { role: "admin", id: null });
  assert.equal(r.ok, true);
  assert.equal(terms(r.doc).Place, "Cage");
});

test("a juniors event shows team names only, boxers by first name, and never opens a vote", () => {
  const g = generate({ teams: [{ id: "T1", name: "Ayr" }, { id: "T2", name: "Bute" }], format: "league", start: "10:00", gameMins: 10, pitches: ["P1"], division: "main" });
  const d = blankEvent({ slug: "u14-cup", name: "U14 Cup" });
  d.divisions[0].teams = g.teams.map((t, i) => ({ ...t, players: [{ id: "p1", number: 7 + i, name: "Sam Brown" }] }));
  d.divisions[0].format = "league";
  d.fixtures = g.fixtures.map((f) => ({ ...f, state: "live", homeScore: 0, awayScore: 0 }));
  d.settings.vote = { open: true };
  assert.equal(openTargets(d, 0).length, 1);
  d.settings.juniors = true;
  assert.deepEqual(validate(d), []);
  assert.equal(openTargets(d, 0).length, 0);
  assert.equal(checkVote({ voter: "v-123456789012", over13: true, target: `g:${d.fixtures[0].id}`, choice: "T1.p1" }, d, 0).ok, false);
  const pub = publicView(d);
  assert.ok(pub.divisions[0].teams.every((t) => t.players.length === 0));
  assert.ok(!JSON.stringify(pub).includes("Brown"));
  const b = blankEvent({ slug: "junior-champs", name: "Junior Champs", sport: "boxing" });
  b.card.bouts = [{ id: "B1", order: 1, title: "Bout 1", weight: "", rounds: 3, roundMins: 2, scoring: "none", judges: [], red: { name: "Amy Stone", club: "Ely ABC" }, blue: { name: "Kai Reed", club: "Hull ABC" }, state: "scheduled", round: 0, result: null }];
  b.settings.juniors = true;
  const pb = publicView(b);
  assert.deepEqual([pb.card.bouts[0].red.name, pb.card.bouts[0].red.club], ["Amy", "Ely ABC"]);
  assert.ok(!JSON.stringify(pb).includes("Stone"));
  d.settings.juniors = "yes";
  assert.ok(validate(d).some((e) => /juniors/.test(e)));
});
