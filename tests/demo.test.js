import { test } from "node:test";
import assert from "node:assert/strict";
import { SEEDS } from "../src/seeds/index.js";
import { simStep, runStep } from "../src/sim.js";
import { rng } from "../src/seeds/lib.js";
import { validate, toMins } from "../public/core/model.js";
import { resolve, leaderSoFar } from "../public/core/standings.js";
import { londonParts } from "../src/util.js";

const NOW = Date.parse("2026-10-04T12:00:00Z");
const beach = (now = NOW) => SEEDS["beach-soccer-cup"].build(now);
const minsFrom = (now, hhmm) => { const p = londonParts(now); let d = (toMins(hhmm) - (p.hour * 60 + p.minute)) % 1440; if (d < -720) d += 1440; if (d >= 720) d -= 1440; return d; };

for (const [when, now] of [["midday", NOW], ["just before midnight", Date.parse("2026-10-04T22:55:00Z")]]) {
  test(`beach demo built at ${when}: the earlier group games are played, in the past, with scorers`, () => {
    const doc = beach(now);
    assert.deepEqual(validate(doc), []);
    const done = doc.fixtures.filter((f) => f.state === "ft");
    assert.ok(done.length >= 8, `at least 8 games played, got ${done.length}`);
    done.forEach((f) => {
      assert.equal(f.stage ?? null, null, "only group games are played before the demo opens");
      assert.ok(minsFrom(now, f.time) < 0, `${f.id} at ${f.time} is in the past`);
      assert.equal((f.goals || []).length, f.homeScore + f.awayScore);
    });
    assert.ok(done.some((f) => (f.goals || []).some((g) => g.player)), "some goals have scorers");
    const next = doc.fixtures.filter((f) => f.state === "scheduled").map((f) => minsFrom(now, f.time));
    assert.equal(Math.min(...next), 0, "the first game still to play starts now");
    assert.ok(doc.fixtures.filter((f) => !f.stage && f.state === "scheduled").length >= doc.pitches.length * 2, "games are left to play live");
  });
}

test("beach demo: every played game has fan votes for a player of the game", () => {
  const doc = beach();
  const votes = SEEDS["beach-soccer-cup"].votes(doc, NOW);
  doc.fixtures.filter((f) => f.state === "ft").forEach((f) => {
    const mine = votes.filter((v) => v.target === `g:${f.id}`);
    assert.ok(mine.length >= 6, `${f.id} has votes`);
    const [team] = mine[0].choice.split(".");
    assert.ok([f.home, f.away].includes(team), "votes go to players in the game");
  });
  assert.equal(new Set(votes.map((v) => `${v.voter}|${v.target}`)).size, votes.length, "one vote per voter per game");
});

test("beach demo: the knockout shows the group leaders so far before the groups finish", () => {
  const doc = beach();
  const div = doc.divisions[0];
  const semis = doc.fixtures.filter((f) => /^Semi/.test(f.stage || ""));
  assert.ok(semis.length >= 2);
  semis.forEach((f) => ["home", "away"].forEach((s) => {
    const id = resolve(div, doc.fixtures, f[s], doc.settings.points) || leaderSoFar(div, doc.fixtures, f[s], doc.settings.points);
    assert.ok(div.teams.some((t) => t.id === id), `${f.stage} ${s} has a name`);
  }));
});

test("beach demo: live stream preview on and the fan vote open", () => {
  const doc = beach();
  assert.equal(doc.settings.streamPreview, true);
  assert.equal(doc.settings.vote.open, true);
});

test("sim scores with goal.add and a scorer from the squad", () => {
  let doc = beach();
  const rand = rng(7);
  let now = NOW;
  let sawScorer = false;
  for (let i = 0; i < 200; i++) {
    const step = simStep(doc, now, rand);
    if (step.reset) break;
    assert.ok(!step.batches.some((b) => b.ops.some((o) => o.op === "fixture.score")), "no fixture.score");
    const r = runStep(doc, now, rng(i + 1));
    assert.deepEqual(r.errors, []);
    doc = r.doc;
    if (doc.fixtures.some((f) => f.goals && (f.goals || []).some((g) => g.player))) sawScorer = true;
    now += 5000;
  }
  assert.ok(sawScorer);
});

test("sixes league night: finished games carry scorers", () => {
  const doc = SEEDS["sixes-league-night"].build(NOW);
  doc.fixtures.forEach((f) => assert.equal((f.goals || []).length, f.homeScore + f.awayScore));
  assert.ok(doc.fixtures.some((f) => (f.goals || []).some((g) => g.player)));
});
