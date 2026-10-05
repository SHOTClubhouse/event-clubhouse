// The always-live demo simulation. simStep() is a pure function: give it the event document, the
// clock and a random function, and it returns what a referee, judge or organiser would do next
// (as batches of real ops with the right actor) plus the fake fan votes to add. runStep() applies
// those batches with applyOps(), so every change is validated and saved like a real one.
//
// The simulation keeps its own bookkeeping in doc.private.sim (planned goals, round timers, when
// to reset). doc.private never leaves the server and never reaches a dashboard.
//
// Football: each pitch plays one game at a time, 3 to 4 minutes long, with goals at random
// moments, then a gap of about a minute before the next game on that pitch. Knockout games start
// once their teams are known. Boxing: a bout runs round by round (about a minute and a half a
// round), the judges score each round after it ends, and the referee records a stoppage or
// the decision. When everything is finished it waits about five minutes, then resets.

import { applyOps } from "../public/core/ops.js";
import { openTargets } from "../public/core/votes.js";
import { resolve, standings } from "../public/core/standings.js";
import { REASONS, toMins, fromMins } from "../public/core/model.js";
import { londonParts } from "./util.js";

const ADMIN = { role: "admin", id: null };
const RESET_WAIT = 5 * 60 * 1000;
const STALL = 10 * 60 * 1000; // nothing happened for this long: start the demo again
const PLACES = { "1st": 0, "2nd": 1, "3rd": 2, "4th": 3 };

const between = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = (rand, list) => list[Math.floor(rand() * list.length)];
const simVoter = (rand) => `sim-voter-${String(between(rand, 1, 60)).padStart(6, "0")}`;

export function simStep(doc, now, rand) {
  const prev = doc.private && doc.private.sim;
  const sim = prev ? structuredClone(prev) : { v: 1, progressAt: now, resetAt: null };
  const out = { batches: [], votes: [], sim, reset: false };
  if (sim.resetAt && now >= sim.resetAt) { out.reset = true; return out; }
  if (!sim.resetAt && now - sim.progressAt > STALL) { out.reset = true; return out; }
  (doc.sport === "boxing" ? boxing : football)(doc, now, rand, out);
  return out;
}

// Applies a step to a document. Returns { doc, votes, reset, errors }.
export function runStep(doc, now, rand) {
  const step = simStep(doc, now, rand);
  if (step.reset) return { doc, votes: [], reset: true, errors: [] };
  let d = doc;
  const errors = [];
  for (const b of step.batches) {
    const r = applyOps(d, b.ops, b.actor, now);
    if (r.ok) d = r.doc; else errors.push({ ops: b.ops, error: r.error });
  }
  return { doc: { ...d, private: { ...(d.private || {}), sim: step.sim } }, votes: step.votes, reset: false, errors };
}

const progress = (out, now) => { out.sim.progressAt = now; };
const finished = (out, now, rand) => { if (!out.sim.resetAt) out.sim.resetAt = now + RESET_WAIT + between(rand, 0, 30000); };

// ---------------------------------------------------------------- football

function divisionOf(doc, f) { return doc.divisions.find((v) => v.id === f.division); }

// A knockout place that is level on every tie-break is never guessed by the rules; the
// organiser picks. The simulation plays the organiser and picks the table's order.
function tieFixes(doc) {
  const ops = [];
  const points = doc.settings.points;
  doc.fixtures.filter((f) => f.stage && f.state === "scheduled").forEach((f) => {
    const div = divisionOf(doc, f);
    ["home", "away"].forEach((side) => {
      const ref = f[side];
      if (div.teams.some((t) => t.id === ref) || resolve(div, doc.fixtures, ref, points)) return;
      const m = typeof ref === "string" && ref.match(/^(1st|2nd|3rd|4th) (?:in table|Group (\S+))$/i);
      if (!m) return;
      const pool = m[2] ? div.teams.filter((t) => String(t.group).toLowerCase() === m[2].toLowerCase()) : div.teams;
      const ids = new Set(pool.map((t) => t.id));
      const games = doc.fixtures.filter((g) => g.division === div.id && !g.stage && ids.has(g.home) && ids.has(g.away));
      if (!games.length || games.some((g) => g.state !== "ft")) return;
      const chosen = standings(pool, games, points)[PLACES[m[1].toLowerCase()]];
      if (chosen) ops.push({ op: "fixture.edit", id: f.id, [side]: chosen.id });
    });
  });
  return ops;
}

// Small-sided football: about 3.5 goals a game, never more than 8.
export const MEAN_GOALS = 3.5;
export const MAX_GOALS = 8;
function goalTotal(rand) {
  for (;;) {
    const limit = Math.exp(-MEAN_GOALS);
    let k = 0, p = 1;
    do { k++; p *= rand(); } while (p > limit);
    if (k - 1 <= MAX_GOALS) return k - 1;
  }
}

function planGame(f, now, rand) {
  const dur = between(rand, 170, 240) * 1000;
  const total = goalTotal(rand);
  const lean = 0.35 + rand() * 0.3;
  const goals = Array.from({ length: total }, () => ({ at: now + Math.round((0.06 + rand() * 0.88) * dur), side: rand() < lean ? "home" : "away" })).sort((a, b) => a.at - b.at);
  return { cur: f.id, startAt: now, endAt: now + dur, goals, applied: 0 };
}

// ---- times follow the real London clock ----
const SLOT = 5; // minutes: a game of 3 to 4 minutes plus the break before the next one
const rank = (f) => (!f.stage ? 0 : /^(Round|Quarter)/.test(f.stage) ? 1 : /^Semi/.test(f.stage) ? 2 : 3);

// Times for the games still to come, as minutes from now. Only the pitches in `need` are
// re-timed, and only games whose time actually changes get an edit, so a quiet tick writes nothing.
function retimeOps(doc, now, need, started, running) {
  const p = londonParts(now);
  const nowMin = p.hour * 60 + p.minute;
  const delta = (hhmm) => { let d = (toMins(hhmm) - nowMin) % 1440; if (d < -720) d += 1440; if (d >= 720) d -= 1440; return d; };
  const want = {};
  const startedIds = new Set(started.map((f) => f.id));
  started.forEach((f) => { want[f.id] = 0; });
  const todo = [];
  doc.pitches.filter((x) => need.has(x.id)).forEach((pitch) => {
    const base = started.some((f) => f.pitch === pitch.id) ? SLOT : running.has(pitch.id) ? 3 : 1;
    doc.fixtures.filter((f) => f.state === "scheduled" && f.pitch === pitch.id && !startedIds.has(f.id)).forEach((f, k) => { want[f.id] = base + k * SLOT; todo.push(f); });
  });
  const at = (f) => (f.id in want ? want[f.id] : delta(f.time));
  const floor = {};
  todo.sort((a, b) => rank(a) - rank(b)).forEach((f) => {
    // a knockout round waits for every earlier round to be played, on any pitch
    const before = doc.fixtures.filter((g) => rank(g) < rank(f) && g.state !== "ft").map(at);
    let t = Math.max(want[f.id], floor[f.pitch] ?? -Infinity, before.length ? Math.max(...before) + SLOT : -Infinity);
    want[f.id] = t;
    floor[f.pitch] = t + SLOT;
  });
  const ops = [];
  doc.fixtures.forEach((f) => {
    if (!(f.id in want)) return;
    const time = fromMins(nowMin + want[f.id]);
    if (time !== f.time) ops.push({ op: "fixture.edit", id: f.id, time });
  });
  return ops;
}

function football(doc, now, rand, out) {
  const { sim } = out;
  sim.pitches = sim.pitches || {};
  const fixtures = doc.fixtures;
  const points = doc.settings.points;
  if (!fixtures.length || fixtures.every((f) => f.state === "ft")) { finished(out, now, rand); return; }

  const fixes = tieFixes(doc);
  if (fixes.length) out.batches.push({ actor: ADMIN, ops: fixes });

  // fan votes on games that are live right now
  openTargets(doc, now).filter((t) => t.kind === "game" && t.state === "live").forEach((t) => {
    for (let i = between(rand, 1, 3); i > 0; i--) {
      const side = t.sides[rand() < 0.5 ? 0 : 1];
      if (!side || !side.players.length) continue;
      const player = side.players[Math.floor(rand() ** 2 * side.players.length)];
      out.votes.push({ voter: simVoter(rand), target: t.target, choice: player.choice, reason: null, ip_hash: "sim", at: now });
    }
  });

  const sidesOf = (f) => { const d = divisionOf(doc, f); return [resolve(d, fixtures, f.home, points), resolve(d, fixtures, f.away, points)]; };
  const actorFor = (f) => (f.ref ? { role: "referee", id: f.ref } : ADMIN);
  const nowParts = londonParts(now);
  const nowMin = nowParts.hour * 60 + nowParts.minute;
  const started = [], starts = [], running = new Set(), need = new Set();
  if (!sim.timed) { sim.timed = true; doc.pitches.forEach((x) => need.add(x.id)); }

  doc.pitches.forEach((pitch) => {
    const ps = (sim.pitches[pitch.id] = sim.pitches[pitch.id] || { cur: null, idleUntil: now });
    const cur = ps.cur && fixtures.find((f) => f.id === ps.cur);

    if (cur && cur.state === "live") {
      let n = ps.applied;
      const ending = now >= ps.endAt;
      while (n < ps.goals.length && (ending || ps.goals[n].at <= now)) n++;
      const home = ps.goals.slice(0, n).filter((g) => g.side === "home").length;
      const away = n - home;
      const ops = [];
      if (n > ps.applied) { ops.push({ op: "fixture.score", id: cur.id, home, away }); ps.applied = n; progress(out, now); }
      if (ending) {
        ops.push({ op: "fixture.state", id: cur.id, state: "ft" });
        if (cur.stage && home === away) ops.push({ op: "fixture.pens", id: cur.id, side: rand() < 0.5 ? "home" : "away" });
        ps.cur = null;
        ps.idleUntil = now + between(rand, 50, 75) * 1000;
        progress(out, now);
      }
      if (ops.length) out.batches.push({ actor: actorFor(cur), ops });
      if (!ending) running.add(pitch.id);
      return;
    }

    ps.cur = null;
    if (now < ps.idleUntil) return;

    // teams already on, or about to go on, another pitch
    const busy = new Set();
    Object.values(sim.pitches).forEach((p) => {
      const f = p.cur && fixtures.find((x) => x.id === p.cur);
      if (f) sidesOf(f).forEach((id) => id && busy.add(id));
    });
    const index = fixtures.findIndex((f) => f.state === "scheduled" && f.pitch === pitch.id);
    if (index < 0) return;
    const next = fixtures[index];
    const [h, a] = sidesOf(next);
    if (!h || !a || busy.has(h) || busy.has(a)) return;
    // never jump the queue: an earlier game that still involves either team goes first
    const blocked = fixtures.slice(0, index).some((f) => f.state !== "ft" && f.id !== next.id && sidesOf(f).some((id) => id === h || id === a));
    if (blocked) return;

    sim.pitches[pitch.id] = planGame(next, now, rand);
    started.push(next);
    need.add(pitch.id);
    starts.push({ actor: actorFor(next), ops: [{ op: "fixture.state", id: next.id, state: "live" }] });
    progress(out, now);
  });

  // a game that has waited past its time (for example a knockout waiting for teams) is re-timed
  doc.pitches.forEach((pitch) => {
    const first = fixtures.find((f) => f.state === "scheduled" && f.pitch === pitch.id && !started.includes(f));
    if (!first) return;
    let d = (toMins(first.time) - nowMin) % 1440;
    if (d < -720) d += 1440;
    if (d < -1) need.add(pitch.id);
  });
  const timing = retimeOps(doc, now, need, started, running);
  if (timing.length) out.batches.push({ actor: ADMIN, ops: timing });
  out.batches.push(...starts);
}

// ---------------------------------------------------------------- boxing

const STOPPAGES = ["TKO", "TKO", "TKO", "RSC", "KO", "RTD"];

function planBout(b, rand) {
  return {
    winner: rand() < 0.5 ? "red" : "blue",
    pWin: 0.6 + rand() * 0.2,
    stop: b.scoring === "judges" && rand() < 0.2 ? { round: between(rand, 1, b.rounds), method: pick(rand, STOPPAGES) } : null,
    rw: {}, pending: {}, roundEndAt: 0, breakEndAt: 0, stopAt: null,
  };
}

function beginRound(plan, b, round, now, rand) {
  const ms = between(rand, 65, 100) * 1000;
  plan.roundEndAt = now + ms;
  plan.stopAt = plan.stop && plan.stop.round === round ? now + Math.round((0.3 + rand() * 0.5) * ms) : null;
}

const other = (c) => (c === "red" ? "blue" : "red");

function judgeScore(rand, roundWinner) {
  if (rand() < 0.04) return [10, 10];
  const w = rand() < 0.9 ? roundWinner : other(roundWinner);
  const low = rand() < 0.86 ? 9 : rand() < 0.85 ? 8 : 7;
  return w === "red" ? [10, low] : [low, 10];
}

// A card with several rings (amateur championships) runs one bout at a time in each ring; a card
// without rings is one ring, kept in sim itself as before.
function boxing(doc, now, rand, out) {
  const { sim } = out;
  const bouts = [...doc.card.bouts].sort((a, b) => a.order - b.order);
  if (!bouts.length || bouts.every((b) => b.state === "done")) { finished(out, now, rand); return; }
  const rings = doc.pitches.length > 1 ? doc.pitches.map((p) => p.id) : [null];
  const runs = rings.map((rid) => {
    const st = rid === null ? sim : ((sim.rings ||= {})[rid] ||= {});
    const official = doc.officials.find((o) => o.role === "referee" && (rid === null || o.pitch === rid)) || doc.officials.find((o) => o.role === "referee");
    const mine = rid === null ? bouts : bouts.filter((b) => (b.pitch || rings[0]) === rid);
    return { st, mine, ref: official ? { role: "referee", id: official.id } : ADMIN };
  });

  // fan votes on rounds that are open right now
  openTargets(doc, now).filter((t) => t.kind === "round").forEach((t) => {
    const run = runs.find((x) => x.st.plan && x.st.cur === t.bout);
    const planned = run ? run.st.plan : null;
    const lean = planned ? (planned.rw[t.round] || planned.winner) : pick(rand, ["red", "blue"]);
    for (let i = between(rand, 1, 3); i > 0; i--) {
      out.votes.push({ voter: simVoter(rand), target: t.target, choice: rand() < 0.7 ? lean : other(lean), reason: rand() < 0.2 ? null : pick(rand, REASONS), ip_hash: "sim", at: now });
    }
  });
  runs.forEach((run) => { if (run.mine.some((b) => b.state !== "done")) ring(doc, run.mine, run.st, run.ref, now, rand, out); });
}

// One ring: start the next bout, run its rounds, collect the cards, give the result.
function ring(doc, bouts, st, ref, now, rand, out) {
  const cur = bouts.find((b) => b.state === "live" || b.state === "break");

  if (!cur) {
    st.cur = null; st.plan = null;
    if (now < (st.idleUntil || 0)) return;
    const next = bouts.find((b) => b.state === "scheduled");
    if (!next) return;
    st.cur = next.id;
    st.plan = planBout(next, rand);
    beginRound(st.plan, next, 1, now, rand);
    out.batches.push({ actor: ref, ops: [{ op: "bout.action", id: next.id, action: "start" }] });
    progress(out, now);
    return;
  }

  if (st.cur !== cur.id || !st.plan) { // picked up part-way through (for example after an organiser edit)
    st.cur = cur.id;
    st.plan = planBout(cur, rand);
    if (cur.state === "live") beginRound(st.plan, cur, cur.round, now, rand); else st.plan.breakEndAt = now + 10000;
  }
  const plan = st.plan;
  const r = cur.round;
  const done = () => { st.cur = null; st.plan = null; st.idleUntil = now + between(rand, 30, 50) * 1000; progress(out, now); };

  if (cur.state === "live") {
    if (plan.stopAt && now >= plan.stopAt) {
      out.batches.push({ actor: ref, ops: [{ op: "bout.result", id: cur.id, method: plan.stop.method, winner: plan.winner, round: r }] });
      done();
      return;
    }
    if (now >= plan.roundEndAt) {
      const winner = rand() < plan.pWin ? plan.winner : other(plan.winner);
      plan.rw[r] = winner;
      if (cur.scoring === "judges") {
        plan.pending[r] = {};
        cur.judges.forEach((j) => { const [red, blue] = judgeScore(rand, winner); plan.pending[r][j] = { at: now + between(rand, 4, 16) * 1000, red, blue }; });
      }
      plan.breakEndAt = now + between(rand, 22, 30) * 1000;
      out.batches.push({ actor: ref, ops: [{ op: "bout.action", id: cur.id, action: "end-round" }] });
      progress(out, now);
    }
    return;
  }

  // between rounds: judges hand in their cards
  const cards = doc.scorecards[cur.id] || {};
  Object.entries(plan.pending).forEach(([round, byJudge]) => {
    Object.entries(byJudge).forEach(([judge, s]) => {
      if (s.at > now || (cards[judge] || {})[round]) return;
      out.batches.push({ actor: { role: "judge", id: judge }, ops: [{ op: "score.round", bout: cur.id, round: Number(round), red: s.red, blue: s.blue }] });
      progress(out, now);
    });
  });
  if (now < plan.breakEndAt) return;

  if (r < cur.rounds) {
    out.batches.push({ actor: ref, ops: [{ op: "bout.action", id: cur.id, action: "next-round" }] });
    beginRound(plan, cur, r + 1, now, rand);
    progress(out, now);
    return;
  }

  // the last round is over: decision
  if (cur.scoring === "judges") {
    // an organiser fills in any card a judge has not handed in yet, so a decision is always possible
    const fill = [];
    cur.judges.forEach((j) => {
      for (let n = 1; n <= cur.rounds; n++) {
        if ((cards[j] || {})[n]) continue;
        const s = (plan.pending[n] || {})[j] || { red: 10, blue: 9 };
        fill.push({ op: "score.round", bout: cur.id, round: n, judge: j, red: s.red, blue: s.blue });
      }
    });
    if (fill.length) out.batches.push({ actor: ADMIN, ops: fill });
    out.batches.push({ actor: ref, ops: [{ op: "bout.result", id: cur.id, method: "PTS" }] });
  } else {
    const reds = Object.values(plan.rw).filter((w) => w === "red").length;
    const blues = Object.values(plan.rw).length - reds;
    const winner = reds === blues ? plan.winner : reds > blues ? "red" : "blue";
    out.batches.push({ actor: ref, ops: [{ op: "bout.result", id: cur.id, method: "PTS", winner }] });
  }
  done();
}
