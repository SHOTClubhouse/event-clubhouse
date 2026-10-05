import { test } from "node:test";
import assert from "node:assert/strict";
import { blankEvent, validate, publicView, playerLabel, streamInfo, addMins, consentText, terms, spotifyEmbed } from "../public/core/model.js";
import { generate, roundRobin, snakeGroups, seedOrder, bracket, checkOptions } from "../public/core/generator.js";
import { standings, resolve, champion, winnerOf, tables } from "../public/core/standings.js";
import { decision, judgeCard, cardsComplete, resultText, nextState } from "../public/core/boxing.js";
import { applyOps, allowed } from "../public/core/ops.js";
import { checkVote, tally, openTargets } from "../public/core/votes.js";
import { leaderboard, fmtTime, onCourse, nextHeats, entryLabel, segmentsDone, currentSegment } from "../public/core/fitness.js";

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

// ---- Fitness ----
const ref = { role: "referee", id: "R1" };
const seg = (id, name, measure = "time") => ({ id, name, measure });
const entry = (id, bib, category, results, state = "ready", heat = null, name = `Athlete ${bib}`) => ({ id, bib, name, club: "", category, heat, results, state });

function fitnessEvent(ranking = "time") {
  const d = blankEvent({ slug: "test-race", name: "Test Race", sport: "fitness", date: "2026-10-10" });
  d.officials = [{ id: "R1", name: "Tim Keeper", role: "referee", pitch: null }];
  d.comp.ranking = ranking;
  d.comp.segments = ranking === "time" ? [seg("S1", "Run 1"), seg("S2", "Station 1"), seg("S3", "Run 2")] : [seg("S1", "Strength", "kg"), seg("S2", "Engine"), seg("S3", "Metcon", "reps")];
  d.comp.categories = [{ id: "C1", name: "Open", size: 1 }, { id: "C2", name: "Doubles", size: 2 }];
  d.comp.heats = [
    { id: "H1", time: "10:00", name: "Wave 1", category: "C1", state: "scheduled", startedAt: null, endedAt: null },
    { id: "H2", time: "10:10", name: "Wave 2", category: null, state: "scheduled", startedAt: null, endedAt: null },
  ];
  const none = () => [null, null, null];
  d.comp.entries = [
    entry("A1", 101, "C1", none(), "ready", "H1", "Sam Smith"),
    entry("A2", 102, "C1", none(), "ready", "H1", "Alex Jones"),
    entry("A3", 103, "C1", none(), "ready", "H1", "Bo Brown"),
    entry("A4", 104, "C1", none(), "ready", "H2", "Cy Green"),
    entry("A5", 201, "C2", none(), "ready", "H2", "Dee White & Eli Black"),
  ];
  return d;
}
const go = (d, ops, actor = ref, now = 1000) => { const r = applyOps(d, ops, actor, now); assert.equal(r.ok, true, JSON.stringify(r)); return r.doc; };
const refused = (d, ops, status, actor = ref, now = 1000) => { const r = applyOps(d, ops, actor, now); assert.equal(r.ok, false, "should have been refused"); assert.equal(r.status, status, r.error); return r; };
const FIT_ADMIN = { role: "admin", id: null };

test("fitness: a blank event and a set-up event both pass validation, and the words default to an arena", () => {
  const blank = blankEvent({ slug: "new-race", name: "New Race", sport: "fitness" });
  assert.deepEqual(validate(blank), []);
  assert.deepEqual(blank.comp, { ranking: "time", segments: [], categories: [], heats: [], entries: [] });
  assert.deepEqual([blank.pitches, blank.divisions], [[], []]);
  assert.equal(terms(blank).place, "arena");
  blank.settings.terms = { place: "floor" };
  assert.deepEqual([validate(blank), terms(blank).Places], [[], "Floors"]);
  assert.deepEqual(validate(fitnessEvent("time")), []);
  assert.deepEqual(validate(fitnessEvent("placings")), []);
  assert.equal(blankEvent({ slug: "x-cup", name: "X Cup" }).comp, undefined, "football has no comp");
});

test("fitness validation catches what would break a live day", () => {
  const bad = (change, re) => { const d = fitnessEvent("time"); change(d.comp); const e = validate(d).join(" | "); assert.match(e, re); };
  bad((c) => { c.entries[1].bib = 101; }, /bib 101 used twice/);
  bad((c) => { c.entries[0].bib = 0; }, /bib is a whole number from 1 to 99999/);
  bad((c) => { c.entries[0].bib = 100000; }, /bib is a whole number/);
  bad((c) => { c.entries[0].category = "C9"; }, /unknown category/);
  bad((c) => { c.entries[0].heat = "H9"; }, /unknown heat/);
  bad((c) => { c.entries[4].heat = "H1"; }, /different category/);
  bad((c) => { c.heats[0].category = "C9"; }, /unknown category/);
  bad((c) => { c.entries[0].results = [null, null]; }, /one result/);
  bad((c) => { c.entries[0].results = [100, 50, null]; }, /faster than an earlier split/);
  bad((c) => { c.entries[0].results = [100, 200.5, null]; }, /whole seconds/);
  bad((c) => { c.entries[0].results = [100, 200, 100001]; }, /0 to 100000/);
  bad((c) => { c.entries[0].results = [-1, null, null]; }, /0 to 100000/);
  bad((c) => { c.entries[0].state = "lost"; }, /state one of/);
  bad((c) => { c.entries[1].id = "A1"; }, /duplicate id/);
  bad((c) => { c.entries[1].id = "__proto__"; }, /missing or duplicate id/);
  bad((c) => { c.segments[1].measure = "kg"; }, /only has time segments/);
  bad((c) => { c.segments = Array.from({ length: 21 }, (_, i) => seg(`S${i}`, "x")); }, /up to 20/);
  bad((c) => { c.categories[0].size = 3; }, /size is 1, 2, 4/);
  bad((c) => { c.heats[0].time = "25:00"; }, /time must be HH:MM/);
  bad((c) => { c.heats[0].state = "running"; }, /state one of/);
  bad((c) => { c.ranking = "fastest"; }, /ranking/);
  bad((c) => { c.entries = Array.from({ length: 801 }, (_, i) => entry(`E${i}`, i + 1, "C1", [null, null, null])); }, /up to 800/);
  const d = fitnessEvent("time"); d.comp = null;
  assert.match(validate(d).join(), /comp missing/);
  const placings = fitnessEvent("placings");
  placings.comp.entries[0].results = [100, 300.5, 50];
  assert.match(validate(placings).join(), /whole seconds/, "a placings time is whole seconds too");
  placings.comp.entries[0].results = [100.5, 300, 50];
  assert.deepEqual(validate(placings), [], "kg may have a decimal");
  placings.comp.entries[0].results = [100, 300, 40];
  assert.deepEqual(validate(placings), [], "placings scores need not go up");
  const malformed = fitnessEvent("time"); malformed.comp.entries = [null];
  assert.doesNotThrow(() => validate(malformed));
  assert.ok(validate(malformed).length > 0);
});

test("fitness: fmtTime reads hours, minutes and seconds", () => {
  assert.equal(fmtTime(3932), "1:05:32");
  assert.equal(fmtTime(247), "4:07");
  assert.equal(fmtTime(59), "0:59");
  assert.equal(fmtTime(0), "0:00");
  assert.equal(fmtTime(3600), "1:00:00");
  assert.equal(fmtTime(null), "-");
  assert.equal(fmtTime(NaN), "-");
});

test("fitness: a timed race ranks finishers, then runners by progress, then dnf, then dns", () => {
  const d = fitnessEvent("time");
  d.comp.entries = [
    entry("F1", 101, "C1", [100, 200, 3000], "finished"),
    entry("F2", 102, "C1", [90, 190, 2900], "finished"),
    entry("F3", 103, "C1", [95, 195, 3000], "finished"),
    entry("R1", 104, "C1", [100, 500, null], "racing"),
    entry("R2", 105, "C1", [100, 450, null], "racing"),
    entry("R3", 106, "C1", [100, null, null], "racing"),
    entry("X1", 107, "C1", [100, null, null], "dnf"),
    entry("X2", 108, "C1", [null, null, null], "dns"),
    entry("X3", 109, "C1", [null, null, null], "ready"),
    entry("O1", 201, "C2", [1, 2, 3], "finished"),
  ];
  const rows = leaderboard(d, "C1");
  assert.deepEqual(rows.map((r) => r.id), ["F2", "F1", "F3", "R2", "R1", "R3", "X3", "X1", "X2"]);
  assert.deepEqual(rows.map((r) => r.rank), [1, 2, 2, 4, 5, 6, null, null, null], "ties share a place; ready, dnf and dns are not ranked");
  assert.deepEqual(rows[0], { id: "F2", bib: 102, label: "#102", rank: 1, state: "finished", done: 3, total: 2900, points: null, last: 2900 });
  assert.deepEqual([rows[3].done, rows[3].total, rows[3].last], [2, null, 450]);
  assert.equal(leaderboard(d, "C2").length, 1, "each category has its own board");
  assert.deepEqual(leaderboard(d, "C9"), []);
});

test("fitness: placings add up ranks, ties share a rank, a missing score takes last place, lowest total wins", () => {
  const d = fitnessEvent("placings");
  d.comp.entries = [
    entry("E1", 101, "C1", [100, 300, 50], "finished"),
    entry("E2", 102, "C1", [100, 280, 40], "finished"),
    entry("E3", 103, "C1", [90, 280, null], "racing"),
    entry("E4", 104, "C1", [null, null, null], "ready"),
  ];
  const rows = leaderboard(d, "C1");
  assert.deepEqual(rows.map((r) => [r.id, r.points]), [["E2", 4], ["E1", 5], ["E3", 8], ["E4", 12]]);
  assert.deepEqual(rows.map((r) => r.rank), [1, 2, 3, null]);
  assert.deepEqual(rows.find((r) => r.id === "E1").ranks, [1, 3, 1], "kg: more is better and the 100 kg tie shares rank 1; time: less is better");
  assert.deepEqual(rows.find((r) => r.id === "E3").ranks, [3, 1, null]);
  assert.equal(rows.find((r) => r.id === "E2").last, 2);
});

test("fitness: a tie on points goes to the better last segment, then the lower bib; dns is never ranked", () => {
  const d = fitnessEvent("placings");
  d.comp.segments = [seg("S1", "A", "kg"), seg("S2", "B", "kg")];
  d.comp.entries = [entry("A", 101, "C1", [10, 5], "finished"), entry("B", 102, "C1", [5, 10], "finished")];
  assert.deepEqual(leaderboard(d, "C1").map((r) => [r.id, r.points, r.rank]), [["B", 3, 1], ["A", 3, 2]], "the last segment beats the bib");
  d.comp.entries = [entry("A", 105, "C1", [10, 10], "finished"), entry("B", 103, "C1", [10, 10], "finished"), entry("C", 104, "C1", [null, null], "dns")];
  assert.deepEqual(leaderboard(d, "C1").map((r) => [r.id, r.rank]), [["B", 1], ["A", 2], ["C", null]], "equal everything: lower bib first");
});

test("fitness: a leaderboard reads labels from the public view and from the full document", () => {
  const d = fitnessEvent("time");
  d.settings.voteBy = "both";
  assert.equal(leaderboard(d, "C1")[0].label, "#101 Sam");
  assert.equal(leaderboard(publicView(d), "C1")[0].label, "#101 Sam");
  assert.equal(leaderboard(d, "C2")[0].label, "#201 Dee & Eli");
});

test("fitness: segments done, current segment, who is on the course and what is next", () => {
  let d = fitnessEvent("time");
  assert.deepEqual([segmentsDone(d.comp.entries[0]), currentSegment(d.comp.entries[0])], [0, 0]);
  assert.deepEqual(nextHeats(d, 5).map((x) => x.heat.id), ["H1", "H2"]);
  assert.deepEqual(nextHeats(d, 1)[0].entries.map((e) => e.label), ["#101", "#102", "#103"]);
  assert.deepEqual(onCourse(d), []);
  d = go(d, [{ op: "heat.start", id: "H1" }, { op: "result.set", entry: "A1", segment: 0, value: 250 }, { op: "result.set", entry: "A1", segment: 1, value: 500 }]);
  assert.deepEqual([segmentsDone(d.comp.entries[0]), currentSegment(d.comp.entries[0])], [2, 2]);
  const live = onCourse(d);
  assert.equal(live.length, 1);
  assert.equal(live[0].heat.id, "H1");
  assert.deepEqual(live[0].entries.map((e) => [e.bib, e.done, e.current, e.last]), [[101, 2, 2, 500], [102, 0, 0, null], [103, 0, 0, null]]);
  assert.equal(live[0].entries[0].segment.name, "Run 2");
  assert.deepEqual(nextHeats(d, 5).map((x) => x.heat.id), ["H2"]);
  d = go(d, [{ op: "result.set", entry: "A1", segment: 2, value: 900 }]);
  assert.equal(onCourse(d)[0].entries[0].segment, null, "a finished athlete has no current segment");
});

test("fitness labels: bib, first names or both, pairs cut to first names", () => {
  const e = { bib: 101, name: "Sam Smith" }, p = { bib: 201, name: "Dee Anne White & Eli Black" };
  assert.deepEqual(["number", "name", "both"].map((v) => entryLabel(e, v)), ["#101", "Sam", "#101 Sam"]);
  assert.deepEqual(["number", "name", "both"].map((v) => entryLabel(p, v)), ["#201", "Dee & Eli", "#201 Dee & Eli"]);
  assert.equal(entryLabel({ bib: 7, name: "" }, "name"), "#7");
});

test("fitness: the public view carries labels and never a full name", () => {
  const d = fitnessEvent("time");
  for (const by of ["number", "name", "both"]) {
    d.settings.voteBy = by;
    const v = publicView(d);
    const json = JSON.stringify(v);
    for (const surname of ["Smith", "Jones", "Brown", "Green", "White", "Black", "Keeper"]) assert.ok(!json.includes(surname), `${by}: ${surname} leaked`);
    assert.ok(v.comp.entries.every((n) => !("name" in n)), "no name field");
    assert.deepEqual(Object.keys(v.comp.entries[0]).sort(), ["bib", "category", "club", "heat", "id", "label", "results", "state"]);
  }
  d.settings.voteBy = "number";
  assert.equal(publicView(d).comp.entries[4].label, "#201");
  d.settings.voteBy = "name";
  assert.equal(publicView(d).comp.entries[4].label, "Dee & Eli");
  assert.equal(d.comp.entries[0].name, "Sam Smith", "the document itself is not changed");
});

test("fitness: the public view of a full race stays small", () => {
  const d = blankEvent({ slug: "big-race", name: "Big Race", sport: "fitness" });
  d.comp.segments = Array.from({ length: 16 }, (_, i) => seg(`S${i + 1}`, `Segment ${i + 1}`));
  d.comp.categories = [{ id: "C1", name: "Open", size: 1 }];
  d.comp.heats = Array.from({ length: 16 }, (_, i) => ({ id: `H${i + 1}`, time: "10:00", name: `Wave ${i + 1}`, category: "C1", state: "done", startedAt: 1, endedAt: 2 }));
  d.comp.entries = Array.from({ length: 160 }, (_, i) => entry(`A${i + 1}`, 10001 + i, "C1", Array.from({ length: 16 }, (_, k) => 11111 + k * 100), "finished", `H${Math.floor(i / 10) + 1}`, "Firstname Surname"));
  d.settings.voteBy = "both";
  assert.deepEqual(validate(d), []);
  const size = JSON.stringify(publicView(d)).length;
  assert.ok(size < 150000, `public view is ${size} bytes`);
});

test("fitness ops: a timekeeper runs a heat and posts results; the rest is the organiser's", () => {
  let d = fitnessEvent("time");
  d = go(d, [{ op: "heat.start", id: "H1" }], ref, 5000);
  const h = d.comp.heats[0];
  assert.deepEqual([h.state, h.startedAt, h.endedAt], ["live", 5000, null]);
  assert.deepEqual(d.comp.entries.map((n) => n.state), ["racing", "racing", "racing", "ready", "ready"], "only the heat's ready entries start racing");
  d = go(d, [{ op: "result.set", entry: "A1", segment: 0, value: 240 }, { op: "entry.state", entry: "A2", state: "dns" }]);
  assert.deepEqual([d.comp.entries[0].results[0], d.comp.entries[1].state], [240, "dns"]);
  for (const op of [
    { op: "comp.set", ranking: "placings" }, { op: "heat.add", time: "11:00" }, { op: "heat.edit", id: "H1", time: "11:00" }, { op: "heat.remove", id: "H2" }, { op: "heat.reopen", id: "H1" },
    { op: "entry.add", name: "New Person", category: "C1" }, { op: "entry.edit", id: "A1", name: "Other" }, { op: "entry.remove", id: "A1" }, { op: "entries.replace", entries: [] },
  ]) refused(d, [op], 403);
  for (const actor of [{ role: "coach", id: "T1" }, { role: "judge", id: "J1" }, null]) {
    for (const op of [{ op: "heat.start", id: "H2" }, { op: "heat.end", id: "H1" }, { op: "result.set", entry: "A1", segment: 1, value: 300 }, { op: "entry.state", entry: "A1", state: "dnf" }]) refused(d, [op], 403, actor);
  }
  go(d, [{ op: "heat.end", id: "H1" }], FIT_ADMIN);
  const mine = (role) => allowed(role).filter((k) => /^(heat|result|entry|entries|comp)/.test(k)).sort();
  assert.deepEqual(mine("referee"), ["entry.state", "heat.end", "heat.start", "result.set"]);
  assert.ok(mine("admin").includes("entries.replace") && mine("admin").includes("heat.reopen") && mine("admin").includes("comp.set"));
  assert.deepEqual([mine("coach"), mine("judge")], [[], []]);
});

test("fitness ops: a heat starts once, ends once, and an organiser can reopen it", () => {
  let d = fitnessEvent("time");
  refused(d, [{ op: "heat.end", id: "H1" }], 409);
  refused(d, [{ op: "heat.start", id: "H9" }], 409);
  d = go(d, [{ op: "heat.start", id: "H1" }]);
  refused(d, [{ op: "heat.start", id: "H1" }], 409);
  refused(d, [{ op: "heat.reopen", id: "H1" }], 403);
  assert.match(refused(d, [{ op: "heat.reopen", id: "H1" }], 409, FIT_ADMIN).error, /Only a finished heat/);
  d = go(d, [{ op: "heat.end", id: "H1" }], ref, 9000);
  assert.equal(d.comp.heats[0].endedAt, 9000);
  refused(d, [{ op: "heat.end", id: "H1" }], 409);
  assert.match(refused(d, [{ op: "heat.start", id: "H1" }], 409).error, /reopen/);
  d = go(d, [{ op: "heat.reopen", id: "H1" }], FIT_ADMIN);
  assert.deepEqual([d.comp.heats[0].state, d.comp.heats[0].endedAt], ["live", null]);
  assert.deepEqual(d.comp.entries.slice(0, 3).map((n) => n.state), ["dnf", "dnf", "dnf"], "reopening does not bring dnf entries back; the organiser does that");
});

test("fitness ops: in a timed race splits only go up, and the last result finishes the athlete", () => {
  let d = go(fitnessEvent("time"), [{ op: "heat.start", id: "H1" }]);
  d = go(d, [{ op: "result.set", entry: "A1", segment: 0, value: 250 }, { op: "result.set", entry: "A1", segment: 1, value: 520 }]);
  assert.match(refused(d, [{ op: "result.set", entry: "A1", segment: 2, value: 400 }], 409).error, /faster than an earlier split/);
  assert.match(refused(d, [{ op: "result.set", entry: "A1", segment: 0, value: 600 }], 409).error, /slower than a later split/);
  d = go(d, [{ op: "result.set", entry: "A1", segment: 1, value: 250 }]);
  assert.equal(d.comp.entries[0].results[1], 250, "equal splits are fine");
  refused(d, [{ op: "result.set", entry: "A1", segment: 1, value: 250.5 }], 409);
  refused(d, [{ op: "result.set", entry: "A1", segment: 1, value: "300" }], 409);
  refused(d, [{ op: "result.set", entry: "A1", segment: 1 }], 409);
  refused(d, [{ op: "result.set", entry: "A1", segment: 3, value: 900 }], 409);
  refused(d, [{ op: "result.set", entry: "A1", segment: 1.5, value: 900 }], 409);
  refused(d, [{ op: "result.set", entry: "A1", segment: 1, value: 100001 }], 409);
  refused(d, [{ op: "result.set", entry: "A9", segment: 1, value: 300 }], 409);
  assert.equal(d.comp.entries[0].state, "racing");
  d = go(d, [{ op: "result.set", entry: "A1", segment: 2, value: 900 }]);
  assert.equal(d.comp.entries[0].state, "finished");
  d = go(d, [{ op: "result.set", entry: "A1", segment: 2, value: null }]);
  assert.deepEqual([d.comp.entries[0].results[2], d.comp.entries[0].state], [null, "racing"], "clearing the last result puts the athlete back on the course");
  const early = go(fitnessEvent("time"), [{ op: "result.set", entry: "A4", segment: 0, value: 100 }]);
  assert.equal(early.comp.entries[3].state, "racing", "a ready athlete with a result is racing");
});

test("fitness ops: in placings a score can be any number in range and the last one finishes the athlete", () => {
  let d = go(fitnessEvent("placings"), [{ op: "heat.start", id: "H1" }]);
  d = go(d, [{ op: "result.set", entry: "A1", segment: 2, value: 70 }, { op: "result.set", entry: "A1", segment: 0, value: 120.5 }, { op: "result.set", entry: "A1", segment: 1, value: 300 }]);
  assert.equal(d.comp.entries[0].state, "finished");
  refused(d, [{ op: "result.set", entry: "A1", segment: 1, value: 300.5 }], 409);
  refused(d, [{ op: "result.set", entry: "A1", segment: 0, value: -1 }], 409);
});

test("fitness ops: ending a heat finishes racing athletes who have every result and marks the rest dnf", () => {
  let d = go(fitnessEvent("time"), [{ op: "heat.start", id: "H1" }]);
  d = go(d, [
    { op: "result.set", entry: "A1", segment: 0, value: 100 }, { op: "result.set", entry: "A1", segment: 1, value: 200 }, { op: "result.set", entry: "A1", segment: 2, value: 300 },
    { op: "result.set", entry: "A2", segment: 0, value: 110 },
    { op: "entry.state", entry: "A1", state: "racing" },
  ]);
  d = go(d, [{ op: "entry.state", entry: "A3", state: "dns" }, { op: "heat.end", id: "H1" }], ref, 7000);
  assert.deepEqual(d.comp.entries.map((n) => n.state), ["finished", "dnf", "dns", "ready", "ready"]);
  assert.deepEqual(d.comp.entries[1].results, [110, null, null], "a dnf keeps the splits it has");
  assert.equal(d.comp.heats[0].state, "done");
  assert.equal(d.comp.heats[1].state, "scheduled");
  const rows = leaderboard(d, "C1");
  assert.deepEqual(rows.map((r) => [r.id, r.rank]), [["A1", 1], ["A4", null], ["A2", null], ["A3", null]]);
});

test("fitness ops: format changes are refused once results exist, unless forced, and resize the results", () => {
  let d = fitnessEvent("time");
  const more = [seg("S1", "Run 1"), seg("S2", "Station 1"), seg("S3", "Run 2"), { name: "Station 2" }];
  const grown = go(d, [{ op: "comp.set", segments: more }], FIT_ADMIN);
  assert.deepEqual(grown.comp.segments.map((s) => [s.id, s.measure]), [["S1", "time"], ["S2", "time"], ["S3", "time"], ["S4", "time"]], "new segments get an id and default to time");
  assert.ok(grown.comp.entries.every((n) => n.results.length === 4 && n.results.every((v) => v === null)));
  const placed = go(d, [{ op: "comp.set", ranking: "placings", segments: [{ name: "Lift", measure: "kg" }, { name: "Row", measure: "time" }, { name: "Reps", measure: "reps" }] }], FIT_ADMIN);
  assert.deepEqual([placed.comp.ranking, placed.comp.segments.map((s) => s.id)], ["placings", ["S1", "S2", "S3"]]);
  refused(d, [{ op: "comp.set", segments: [{ name: "Lift", measure: "kg" }] }], 422, FIT_ADMIN);
  refused(d, [{ op: "comp.set", ranking: "fastest" }], 409, FIT_ADMIN);
  refused(d, [{ op: "comp.set", segments: [null] }], 400, FIT_ADMIN);
  d = go(d, [{ op: "result.set", entry: "A1", segment: 0, value: 100 }]);
  assert.match(refused(d, [{ op: "comp.set", ranking: "placings" }], 409, FIT_ADMIN).error, /Results have been recorded/);
  assert.match(refused(d, [{ op: "entries.replace", entries: [] }], 409, FIT_ADMIN).error, /Results have been recorded/);
  const forced = go(d, [{ op: "comp.set", segments: [seg("S1", "Run 1"), seg("S2", "Station 1")], force: true }], FIT_ADMIN);
  assert.deepEqual(forced.comp.entries[0].results, [100, null], "forcing keeps what fits");
  const cleared = go(d, [{ op: "entries.replace", force: true, entries: [{ name: "Only One", category: "C1" }] }], FIT_ADMIN);
  assert.equal(cleared.comp.entries.length, 1);
});

test("fitness ops: the organiser sets up heats and athletes", () => {
  let d = fitnessEvent("time");
  d = go(d, [
    { op: "heat.add", time: "10:20", name: "Wave 3", category: "C2" },
    { op: "entry.add", name: "  New Person ", club: "Some Club", category: "C2", heat: "H3" },
    { op: "entry.add", name: "Another Person", category: "C1", bib: 500 },
  ], FIT_ADMIN);
  assert.deepEqual(d.comp.heats[2], { id: "H3", time: "10:20", name: "Wave 3", category: "C2", state: "scheduled", startedAt: null, endedAt: null });
  assert.deepEqual(d.comp.entries[5], { id: "A6", bib: 202, name: "New Person", club: "Some Club", category: "C2", heat: "H3", results: [null, null, null], state: "ready" });
  assert.equal(d.comp.entries[6].bib, 500);
  d = go(d, [{ op: "entry.edit", id: "A6", name: "Renamed Person", heat: "" }, { op: "heat.edit", id: "H3", time: "10:30", category: "" }], FIT_ADMIN);
  assert.deepEqual([d.comp.entries[5].name, d.comp.entries[5].heat, d.comp.heats[2].time, d.comp.heats[2].category], ["Renamed Person", null, "10:30", null]);
  assert.match(refused(d, [{ op: "entry.add", name: "Dup", category: "C1", bib: 101 }], 422, FIT_ADMIN).error, /bib 101 used twice/);
  assert.match(refused(d, [{ op: "entry.add", name: "Lost", category: "C9" }], 422, FIT_ADMIN).error, /unknown category/);
  assert.match(refused(d, [{ op: "entry.add", name: "Wrong heat", category: "C2", heat: "H1" }], 422, FIT_ADMIN).error, /different category/);
  assert.match(refused(d, [{ op: "heat.remove", id: "H1" }], 409, FIT_ADMIN).error, /Move them first/);
  d = go(d, [{ op: "heat.remove", id: "H3" }, { op: "entry.remove", id: "A7" }], FIT_ADMIN);
  assert.deepEqual([d.comp.heats.length, d.comp.entries.length], [2, 6]);
  const bulk = go(d, [{ op: "entries.replace", entries: [{ name: "One A", category: "C1", heat: "H1" }, { name: "Two B", category: "C1", heat: "H1", bib: 105 }, { name: "Three C", category: "C1" }] }], FIT_ADMIN);
  assert.deepEqual(bulk.comp.entries.map((n) => [n.id, n.bib]), [["A1", 106], ["A2", 105], ["A3", 107]], "bibs and ids never repeat in an import");
  const kept = go(d, [{ op: "entries.replace", entries: [{ name: "Smuggled", category: "C1", results: [1, 2, 3], state: "finished", sneaky: true }] }], FIT_ADMIN);
  assert.deepEqual(kept.comp.entries[0], { id: "A1", bib: 101, name: "Smuggled", club: "", category: "C1", heat: null, results: [null, null, null], state: "ready" }, "only known fields are kept");
});

test("fitness ops: fitness ops on a football event are refused, and ids that are prototype keys are never accepted", () => {
  assert.match(refused(footballEvent(), [{ op: "heat.start", id: "H1" }], 409, FIT_ADMIN).error, /isn't a fitness event/);
  const d = fitnessEvent("time");
  for (const id of ["__proto__", "constructor", "prototype"]) {
    refused(d, [{ op: "heat.start", id }], 400);
    refused(d, [{ op: "result.set", entry: id, segment: 0, value: 1 }], 400);
    refused(d, [{ op: "entry.state", entry: id, state: "dns" }], 400);
    refused(d, [{ op: "entry.add", id, name: "Bad Id", category: "C1" }], 400, FIT_ADMIN);
    refused(d, [{ op: "entry.add", name: "Bad Heat", category: "C1", heat: id }], 400, FIT_ADMIN);
    refused(d, [{ op: "entries.replace", entries: [{ id, name: "Bad Id", category: "C1" }] }], 400, FIT_ADMIN);
    refused(d, [{ op: "comp.set", segments: [{ id, name: "Bad", measure: "time" }] }], 400, FIT_ADMIN);
    refused(d, [{ op: "comp.set", categories: [{ id, name: "Bad", size: 1 }] }], 400, FIT_ADMIN);
    refused(d, [{ op: "heat.add", id, time: "10:00" }], 400, FIT_ADMIN);
  }
  assert.equal({}.polluted, undefined);
});

test("fitness vote: the favourite of a heat, open while it is live and a minute after, only for athletes in that heat", () => {
  const V = "v".repeat(20);
  const vote = (d, target, choice, now) => checkVote({ voter: V, target, choice, over13: true }, d, now);
  let d = fitnessEvent("time");
  d.settings.vote.open = true;
  assert.deepEqual(openTargets(d, 0), []);
  assert.equal(vote(d, "h:H1", "A1", 0).status, 409, "a heat that has not started");
  assert.equal(vote(d, "h:H9", "A1", 0).status, 400, "a heat that does not exist");
  d = go(d, [{ op: "heat.start", id: "H1" }], ref, 1000);
  const open = openTargets(d, 1000);
  assert.equal(open.length, 1);
  assert.deepEqual([open[0].kind, open[0].target, open[0].state, open[0].locksIn], ["heat", "h:H1", "live", null]);
  assert.deepEqual(open[0].choices.map((c) => [c.choice, c.label]), [["A1", "#101"], ["A2", "#102"], ["A3", "#103"]]);
  assert.deepEqual(vote(d, "h:H1", "A1", 1000), { ok: true, vote: { voter: V, target: "h:H1", choice: "A1", reason: null } });
  assert.equal(vote(d, "h:H1", "A4", 1000).status, 400, "an athlete from another heat");
  assert.equal(vote(d, "h:H1", "nobody", 1000).status, 400);
  assert.equal(checkVote({ voter: V, target: "h:H1", choice: "A1", over13: false }, d, 1000).status, 400);
  d = go(d, [{ op: "entry.state", entry: "A3", state: "dns" }], ref, 2000);
  assert.deepEqual(openTargets(d, 2000)[0].choices.map((c) => c.choice), ["A1", "A2"], "someone who did not start cannot be picked");
  d = go(d, [{ op: "heat.end", id: "H1" }], ref, 10000);
  assert.ok(vote(d, "h:H1", "A2", 69000).ok);
  assert.equal(openTargets(d, 69000)[0].locksIn, 1);
  assert.equal(vote(d, "h:H1", "A2", 71000).status, 409, "locked a minute after the heat ends");
  assert.deepEqual(openTargets(d, 71000), []);
  d.settings.lockSecs = 0;
  assert.equal(vote(d, "h:H1", "A2", 10000).status, 409);
  d.settings.lockSecs = 60;
  d.settings.vote.open = false;
  assert.equal(vote(d, "h:H1", "A2", 11000).status, 409, "the vote switch is off");
  assert.deepEqual(openTargets(d, 11000), []);
});

test("fitness vote: the tally gives each heat's leaders and the event's, ignoring athletes who moved heat", () => {
  const d = fitnessEvent("time");
  d.settings.vote.open = true;
  d.settings.voteBy = "both";
  const counts = [
    { target: "h:H1", choice: "A1", reason: null, n: 4 }, { target: "h:H1", choice: "A2", reason: null, n: 6 },
    { target: "h:H2", choice: "A5", reason: null, n: 2 }, { target: "h:H1", choice: "A4", reason: null, n: 9 },
    { target: "h:H9", choice: "A1", reason: null, n: 9 }, { target: "h:H2", choice: "A4", reason: null, n: 0 },
  ];
  const t = tally(counts, d, 0);
  assert.equal(t.total, 30);
  assert.deepEqual(t.heats.map((h) => [h.heat, h.votes, h.leaders[0].choice, h.leaders[0].votes]), [["H1", 10, "A2", 6], ["H2", 2, "A5", 2]]);
  assert.deepEqual(t.heats[0].leaders.map((l) => l.label), ["#102 Alex", "#101 Sam"]);
  assert.equal(t.heats[1].leaders[0].label, "#201 Dee & Eli");
  assert.deepEqual(t.leaders.map((l) => l.choice), ["A2", "A1", "A5"]);
  assert.ok(!JSON.stringify(t).includes("Smith"));
  assert.deepEqual(tally([], d, 0).leaders, []);
});

test("football and boxing behave as before with the fitness additions", () => {
  assert.deepEqual(validate(footballEvent()), []);
  assert.equal(terms(footballEvent()).place, "pitch");
  const boxing = blankEvent({ slug: "fight-night", name: "Fight Night", sport: "boxing" });
  assert.equal(terms(boxing).place, "ring");
  assert.deepEqual(validate(boxing), []);
  assert.equal(publicView(boxing).comp, undefined);
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

test("the clubhouse: checked when saved, Spotify links only, set by the organiser", () => {
  const d = blankEvent({ slug: "x-cup", name: "X Cup" });
  const club = { on: true, intro: "All year.", members: 0, tiers: [{ id: "M1", name: "Member", benefits: ["Early tickets"], price: null }], culture: { playlist: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M", lineup: [{ time: null, name: "DJ One", role: "DJ" }], drops: [] }, community: { posts: [{ id: "W1", who: "Organiser", text: "Photos are up.", kind: "photo", ago: "2h" }], next: [{ date: "2026-11-01", title: "Next one", where: "Here" }] }, rewards: [{ id: "B1", name: "Founding fan", how: "register", text: "Registered early" }] };
  d.clubhouse = club;
  assert.deepEqual(validate(d), []);
  assert.equal(spotifyEmbed(club.culture.playlist), "https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M");
  assert.equal(spotifyEmbed("https://evil.example/playlist/37i9dQZF1DXcBWIGoYBM5M"), null);
  for (const bad of [{ culture: { playlist: "https://example.com/x" } }, { tiers: [{ id: "M1", name: "", benefits: [] }] }, { rewards: [{ id: "B1", name: "X", how: "pay" }] }, { culture: { lineup: [{ name: "X", role: "Headliner" }] } }]) {
    assert.ok(validate({ ...d, clubhouse: { ...club, ...bad } }).length > 0, JSON.stringify(bad));
  }
  assert.equal(applyOps(d, [{ op: "clubhouse.set", clubhouse: { ...club, intro: "Changed" } }], { role: "admin", id: null }).doc.clubhouse.intro, "Changed");
  assert.equal(applyOps(d, [{ op: "clubhouse.set", clubhouse: club }], { role: "referee", id: "R1" }).status, 403);
  assert.equal(publicView(d).clubhouse.tiers[0].price, null);
});
