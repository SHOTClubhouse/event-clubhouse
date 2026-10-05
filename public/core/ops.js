// Every change to an event is an op: a small named action with its arguments. The Worker
// applies ops to the stored document (authoritative); dashboards apply the same ops locally
// so a tap shows instantly. Who may do what is decided here, in one table.
//
// actor = { role: "admin" | "referee" | "judge" | "coach", id: officialId | teamId | null }
//
// applyOps(doc, ops, actor, now) never mutates its input. It returns { ok: true, doc } or
// { ok: false, status, error, index } for the first op that fails; the whole batch is
// rejected so a half-applied save never reaches fans. The resulting document must pass
// validate().

import { validate, newId, ID, STATES, PHASES, VOTE_BY, METHODS, mustScore } from "./model.js";
import { nextState, decision, cardsComplete } from "./boxing.js";

const ADMIN = ["admin"];
const OFFICIAL = ["admin", "referee"];

const fixture = (d, id) => d.fixtures.find((f) => f.id === id);
const bout = (d, id) => (d.card.bouts || []).find((b) => b.id === id);
const division = (d, id) => d.divisions.find((v) => v.id === id);
const pick = (src, keys) => Object.fromEntries(keys.filter((k) => src[k] !== undefined).map((k) => [k, src[k]]));
const allIds = (d) => [...d.fixtures.map((f) => f.id), ...d.divisions.flatMap((v) => v.teams.map((t) => t.id)), ...d.pitches.map((p) => p.id), ...d.officials.map((o) => o.id), ...(d.card.bouts || []).map((b) => b.id)];

export const OPS = {
  // ---- On the day: football ----
  "fixture.score": { roles: OFFICIAL, run(d, o) {
    const f = fixture(d, o.id); if (!f) return "Game not found.";
    f.homeScore = o.home; f.awayScore = o.away;
    if (f.state === "scheduled") f.state = "live";
    if (f.pens && f.homeScore !== f.awayScore) f.pens = null;
  } },
  "fixture.state": { roles: OFFICIAL, run(d, o, a, now) {
    const f = fixture(d, o.id); if (!f) return "Game not found.";
    if (!STATES.includes(o.state)) return "Unknown state.";
    if (o.state === "scheduled") { f.homeScore = null; f.awayScore = null; f.pens = null; f.ftAt = null; }
    if (o.state === "live") { if (f.homeScore == null) { f.homeScore = 0; f.awayScore = 0; } f.ftAt = null; f.pens = null; }
    if (o.state === "ft") { if (f.homeScore == null) { f.homeScore = 0; f.awayScore = 0; } if (f.state !== "ft") f.ftAt = now; }
    f.state = o.state;
  } },
  "fixture.pens": { roles: OFFICIAL, run(d, o) {
    const f = fixture(d, o.id); if (!f) return "Game not found.";
    f.pens = o.side === "home" || o.side === "away" ? o.side : null;
  } },
  "stream.set": { roles: OFFICIAL, run(d, o) {
    const s = { url: o.url || null, on: !!o.on, label: o.label || "" };
    if (o.pitch == null) { d.stream = s; return; }
    const p = d.pitches.find((x) => x.id === o.pitch); if (!p) return "Pitch not found.";
    p.stream = s;
  } },

  // ---- On the day: boxing ----
  "bout.action": { roles: OFFICIAL, run(d, o, a, now) {
    const b = bout(d, o.id); if (!b) return "Bout not found.";
    const n = nextState(b, o.action, now);
    if (n.error) return n.error;
    Object.assign(b, n);
  } },
  "bout.result": { roles: OFFICIAL, run(d, o, a, now) {
    const b = bout(d, o.id); if (!b) return "Bout not found.";
    if (b.state === "scheduled") return "Start the bout first.";
    if (!METHODS.includes(o.method)) return "Pick how the bout ended.";
    const round = Number.isInteger(o.round) ? o.round : b.round;
    if (o.method === "PTS") {
      if (b.scoring !== "judges") {
        if (o.winner !== "red" && o.winner !== "blue") return "Pick the winner.";
        b.result = { method: "PTS", winner: o.winner, round: b.rounds };
      } else {
        const probe = { ...b, result: { round: b.rounds } };
        if (!cardsComplete(probe, d.scorecards)) return "Every judge must score every round first.";
        const dec = decision(b, d.scorecards);
        b.result = dec.winner ? { method: "PTS", winner: dec.winner, kind: dec.kind, round: b.rounds } : { method: "DRAW", winner: null, kind: dec.kind, round: b.rounds };
      }
    } else if (o.method === "DRAW" || o.method === "NC") b.result = { method: o.method, winner: null, round };
    else {
      if (o.winner !== "red" && o.winner !== "blue") return "Pick the winner.";
      b.result = { method: o.method, winner: o.winner, round };
    }
    b.roundEnds = { ...(b.roundEnds || {}) };
    if (b.roundEnds[round] == null) b.roundEnds[round] = now;
    b.round = Math.min(round, b.rounds);
    b.state = "done"; b.doneAt = now;
  } },
  "score.round": { roles: ["admin", "judge"], run(d, o, a) {
    const b = bout(d, o.bout); if (!b) return "Bout not found.";
    const judge = a.role === "judge" ? a.id : o.judge;
    if (!b.judges.includes(judge)) return "You're not judging this bout.";
    if (!Number.isInteger(o.round) || o.round < 1 || o.round > b.rounds) return "Unknown round.";
    if (!mustScore(o.red, o.blue)) return "Score it 10-9, 10-8 or 10-10 (the winner of the round gets 10).";
    if (a.role === "judge") {
      const ended = o.round < b.round || (o.round === b.round && (b.state === "break" || b.state === "done"));
      if (!ended) return "Score the round once it has ended.";
      if (b.state === "done" && b.result) return "This bout is decided. Ask the organiser to change a card.";
    }
    if (!ID.test(b.id) || !ID.test(judge)) return "Unknown bout.";
    if (!Object.hasOwn(d.scorecards, b.id)) d.scorecards[b.id] = {};
    if (!Object.hasOwn(d.scorecards[b.id], judge)) d.scorecards[b.id][judge] = {};
    d.scorecards[b.id][judge][o.round] = [o.red, o.blue];
  } },

  // ---- Coaches ----
  "team.players": { roles: ["admin", "coach"], run(d, o, a) {
    const v = division(d, o.division); const t = v && v.teams.find((x) => x.id === o.id);
    if (!t) return "Team not found.";
    if (a.role === "coach" && a.id !== t.id) return "You can only edit your own squad.";
    if (!Array.isArray(o.players)) return "Players must be a list.";
    const taken = [];
    t.players = o.players.map((p) => {
      const id = typeof p.id === "string" && p.id ? p.id : newId("p", [...taken, ...o.players.map((x) => x.id).filter(Boolean)]);
      taken.push(id);
      return { id, number: p.number === "" || p.number == null ? null : Number(p.number), name: (p.name || "").trim() };
    });
  } },

  // ---- Set-up (admin) ----
  "event.set": { roles: ADMIN, run(d, o) {
    Object.assign(d, pick(o, ["name", "date", "venue", "about", "timezone"]));
    if (o.theme) d.theme = { ...d.theme, ...pick(o.theme, ["accent", "logo", "partner"]) };
    if (o.links) d.links = { ...d.links, ...pick(o.links, ["tickets", "clubhouse"]) };
  } },
  "phase.set": { roles: ADMIN, run(d, o) { if (!PHASES.includes(o.phase)) return "Unknown phase."; d.phase = o.phase; } },
  "settings.set": { roles: ADMIN, run(d, o) {
    if (o.voteBy !== undefined && !VOTE_BY.includes(o.voteBy)) return "Show players by number, name or both.";
    Object.assign(d.settings, pick(o, ["voteBy", "lockSecs", "points", "showCards", "terms", "juniors"]));
  } },
  "clubhouse.set": { roles: ADMIN, run(d, o) { if (!o.clubhouse || typeof o.clubhouse !== "object") return "Send the clubhouse."; d.clubhouse = o.clubhouse; } },
  "vote.open": { roles: ADMIN, run(d, o) { d.settings.vote = { ...d.settings.vote, open: !!o.open }; } },
  "pitch.add": { roles: ADMIN, run(d, o) { d.pitches.push({ id: o.id || newId("P", allIds(d)), name: o.name, stream: { url: null, on: false, label: "" } }); } },
  "pitch.edit": { roles: ADMIN, run(d, o) { const p = d.pitches.find((x) => x.id === o.id); if (!p) return "Pitch not found."; Object.assign(p, pick(o, ["name"])); } },
  "pitch.remove": { roles: ADMIN, run(d, o) {
    if (d.fixtures.some((f) => f.pitch === o.id)) return "Games are on this pitch. Move them first.";
    d.pitches = d.pitches.filter((p) => p.id !== o.id);
    d.officials.forEach((x) => { if (x.pitch === o.id) x.pitch = null; });
  } },
  "official.add": { roles: ADMIN, run(d, o) { d.officials.push({ id: o.id || newId(o.role === "judge" ? "J" : "R", allIds(d)), name: o.name, role: o.role, pitch: o.pitch ?? null }); } },
  "official.edit": { roles: ADMIN, run(d, o) { const x = d.officials.find((y) => y.id === o.id); if (!x) return "Official not found."; Object.assign(x, pick(o, ["name", "role", "pitch"])); } },
  "official.remove": { roles: ADMIN, run(d, o) {
    if (d.fixtures.some((f) => f.ref === o.id) || (d.card.bouts || []).some((b) => b.judges.includes(o.id))) return "This official has games or bouts. Reassign them first.";
    d.officials = d.officials.filter((x) => x.id !== o.id);
  } },
  "division.add": { roles: ADMIN, run(d, o) { d.divisions.push({ id: o.id || newId("D", allIds(d)), name: o.name, format: o.format || "groups-knockout", teams: [], ...(o.vote === false ? { vote: false } : {}) }); } },
  "division.edit": { roles: ADMIN, run(d, o) { const v = division(d, o.id); if (!v) return "Division not found."; Object.assign(v, pick(o, ["name", "format", "vote"])); } },
  "division.remove": { roles: ADMIN, run(d, o) { d.divisions = d.divisions.filter((v) => v.id !== o.id); d.fixtures = d.fixtures.filter((f) => f.division !== o.id); } },
  "team.add": { roles: ADMIN, run(d, o) {
    const v = division(d, o.division); if (!v) return "Division not found.";
    v.teams.push({ id: o.id || newId("T", allIds(d)), name: o.name, ...(o.group ? { group: o.group } : {}), players: [] });
  } },
  "team.edit": { roles: ADMIN, run(d, o) {
    const v = division(d, o.division); const t = v && v.teams.find((x) => x.id === o.id); if (!t) return "Team not found.";
    Object.assign(t, pick(o, ["name", "group"]));
    if (t.group === null || t.group === "") delete t.group;
  } },
  "team.remove": { roles: ADMIN, run(d, o) {
    if (d.fixtures.some((f) => f.home === o.id || f.away === o.id)) return "This team has games. Remove or regenerate them first.";
    const v = division(d, o.division); if (!v) return "Division not found.";
    v.teams = v.teams.filter((t) => t.id !== o.id);
  } },
  // The generator's output: replaces a division's fixtures (and team groups). Refused once any
  // game in the division has started, so a regenerate can never wipe a result.
  "fixtures.replace": { roles: ADMIN, run(d, o) {
    const v = division(d, o.division); if (!v) return "Division not found.";
    if (!o.force && d.fixtures.some((f) => f.division === o.division && f.state !== "scheduled")) return "Games in this division have started. Edit them one by one instead.";
    if (Array.isArray(o.groups)) o.groups.forEach(({ id, group }) => { const t = v.teams.find((x) => x.id === id); if (t) { if (group) t.group = group; else delete t.group; } });
    if (o.format) v.format = o.format;
    d.fixtures = d.fixtures.filter((f) => f.division !== o.division).concat(o.fixtures.map((f) => ({ ...f, division: o.division })));
  } },
  "fixture.add": { roles: ADMIN, run(d, o) { d.fixtures.push({ homeScore: null, awayScore: null, state: "scheduled", ...o.fixture, id: o.fixture.id || newId("X", allIds(d)) }); } },
  "fixture.edit": { roles: ADMIN, run(d, o) { const f = fixture(d, o.id); if (!f) return "Game not found."; Object.assign(f, pick(o, ["time", "pitch", "ref", "home", "away", "stage"])); } },
  "fixture.remove": { roles: ADMIN, run(d, o) { d.fixtures = d.fixtures.filter((f) => f.id !== o.id); } },
  "bout.add": { roles: ADMIN, run(d, o) {
    const order = Math.max(0, ...(d.card.bouts || []).map((b) => b.order)) + 1;
    d.card.bouts.push({ id: o.id || newId("B", allIds(d)), order, title: o.title || "", weight: o.weight || "", rounds: o.rounds || 3, roundMins: o.roundMins || 2, scoring: o.scoring || "judges", judges: o.judges || [], red: { name: o.red?.name, club: o.red?.club || "" }, blue: { name: o.blue?.name, club: o.blue?.club || "" }, state: "scheduled", round: 0, result: null, ...(o.pitch ? { pitch: o.pitch } : {}) });
  } },
  "bout.edit": { roles: ADMIN, run(d, o) {
    const b = bout(d, o.id); if (!b) return "Bout not found.";
    Object.assign(b, pick(o, ["order", "title", "weight", "rounds", "roundMins", "scoring", "judges", "pitch"]));
    if (o.red) b.red = { ...b.red, ...pick(o.red, ["name", "club"]) };
    if (o.blue) b.blue = { ...b.blue, ...pick(o.blue, ["name", "club"]) };
  } },
  "bout.remove": { roles: ADMIN, run(d, o) { d.card.bouts = d.card.bouts.filter((b) => b.id !== o.id); delete d.scorecards[o.id]; } },
  "update.add": { roles: ADMIN, run(d, o, a, now) { d.updates.unshift({ id: newId("U", d.updates.map((u) => u.id)), at: now, title: o.title, body: o.body || "", link: o.link || null }); } },
  "update.remove": { roles: ADMIN, run(d, o) { d.updates = d.updates.filter((u) => u.id !== o.id); } },
};

// Ops a role may send at all (for the dashboards to show or hide controls).
export const allowed = (role) => Object.keys(OPS).filter((k) => OPS[k].roles.includes(role));

// Every id an op names must be a valid id, checked before the op runs, because ids become object
// keys (scorecards) and "__proto__" there would reach every object in the process.
const ID_KEYS = ["id", "division", "judge", "team", "pitch", "ref", "home", "away"];
const RESERVED = /^(__proto__|constructor|prototype)$/;
const bad = (v) => typeof v === "string" && RESERVED.test(v);
const plain = (x) => !!x && typeof x === "object" && ID_KEYS.every((k) => !bad(x[k]));
function keysSafe(o) {
  if (!plain(o)) return false;
  if (o.fixture != null && !plain(o.fixture)) return false;
  if (Array.isArray(o.fixtures) && !o.fixtures.every(plain)) return false;
  if (Array.isArray(o.judges) && o.judges.some(bad)) return false;
  return true;
}

export function applyOps(doc, ops, actor, now = Date.now()) {
  if (!Array.isArray(ops) || !ops.length) return { ok: false, status: 400, error: "Nothing to save." };
  if (ops.length > 200) return { ok: false, status: 400, error: "Too many changes in one save." };
  const d = JSON.parse(JSON.stringify(doc));
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i] || {};
    if (!keysSafe(o)) return { ok: false, status: 400, error: "That id isn't allowed.", index: i };
    const def = OPS[o.op];
    if (!def) return { ok: false, status: 400, error: `Unknown change "${o.op}".`, index: i };
    if (!actor || !def.roles.includes(actor.role)) return { ok: false, status: 403, error: "You don't have permission to do that.", index: i };
    const err = def.run(d, o, actor, now);
    if (err) return { ok: false, status: 409, error: err, index: i };
  }
  const errs = validate(d);
  if (errs.length) return { ok: false, status: 422, error: errs[0], errors: errs };
  return { ok: true, doc: d };
}
