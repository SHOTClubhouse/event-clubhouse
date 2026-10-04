// Fan voting. Ported from the London 26 MVP vote (188 votes from 71 phones) and extended to
// boxing rounds.
//
// Football: while a game is live, fans pick one player from either team (shown by shirt
// number, first name or both, per the event's voteBy). One vote per phone per game, changeable
// until the game's vote locks, lockSecs after full time. Votes add up across the day.
//   target "g:<fixtureId>", choice "<teamId>.<playerId>"
//
// Boxing: during a round and for lockSecs after it ends, fans pick the boxer who won the round
// for them, with an optional reason (style, pressure, defence, power). Round votes add up to a
// fans' fighter of the night.
//   target "r:<boutId>:<round>", choice "red" | "blue", reason one of REASONS or null
//
// Nobody nominates anyone and the scorer does nothing: what's votable follows the game and
// bout states the officials already set.

import { REASONS, playerLabel } from "./model.js";
import { resolve } from "./standings.js";

export const VOTER = /^[A-Za-z0-9_-]{16,64}$/;
const SHOWN = 12;

const lockMs = (doc) => (doc.settings.lockSecs ?? 60) * 1000;
export const isOpen = (doc) => !!(doc && doc.settings && doc.settings.vote && doc.settings.vote.open === true);

// ---- Football ----
function divisionOf(doc, f) { return doc.divisions.find((d) => d.id === f.division) || null; }
const gameVotes = (div) => div && div.vote !== false && div.format !== "exhibition";

function gameLeft(doc, f, now) {
  if (f.state === "live") return Infinity;
  if (f.state === "ft" && f.ftAt != null) return f.ftAt + lockMs(doc) - now;
  return 0;
}

export function teamsOf(doc, f) {
  const div = divisionOf(doc, f);
  if (!div) return [];
  return [f.home, f.away].map((ref) => resolve(div, doc.fixtures, ref, doc.settings.points)).filter(Boolean);
}

function choicesFor(doc, f) {
  const div = divisionOf(doc, f);
  return teamsOf(doc, f).map((teamId) => {
    const t = div.teams.find((x) => x.id === teamId);
    return { teamId, team: t.name, players: (t.players || []).map((p) => ({ choice: `${teamId}.${p.id}`, label: playerLabel(p, doc.settings.voteBy) })).filter((p) => p.label) };
  });
}

// ---- Boxing ----
function roundLeft(doc, b, n, now) {
  if ((b.state === "live") && b.round === n) return Infinity;
  const end = (b.roundEnds || {})[n];
  return end != null ? end + lockMs(doc) - now : 0;
}

// Everything fans can vote on right now.
export function openTargets(doc, now = Date.now()) {
  if (!isOpen(doc)) return [];
  const out = [];
  if (doc.sport === "football") {
    doc.fixtures.forEach((f) => {
      if (!gameVotes(divisionOf(doc, f))) return;
      const left = gameLeft(doc, f, now);
      if (left > 0) out.push({ kind: "game", target: `g:${f.id}`, id: f.id, time: f.time, pitch: f.pitch ?? null, stage: f.stage ?? null, division: divisionOf(doc, f).name, state: f.state, locksIn: left === Infinity ? null : Math.ceil(left / 1000), sides: choicesFor(doc, f) });
    });
  } else {
    (doc.card.bouts || []).forEach((b) => {
      for (let n = 1; n <= b.rounds; n++) {
        const left = roundLeft(doc, b, n, now);
        if (left > 0) out.push({ kind: "round", target: `r:${b.id}:${n}`, bout: b.id, round: n, state: b.state === "live" && b.round === n ? "live" : "ended", locksIn: left === Infinity ? null : Math.ceil(left / 1000), red: { name: b.red.name, club: b.red.club || "" }, blue: { name: b.blue.name, club: b.blue.club || "" }, reasons: REASONS });
      }
    });
  }
  return out;
}

// Checks one vote. Returns { ok, vote } or { ok: false, status, error }. The hidden "website"
// field catches bots: accepted, never stored.
export function checkVote(body, doc, now = Date.now()) {
  const b = body && typeof body === "object" ? body : {};
  if (!isOpen(doc)) return { ok: false, status: 409, error: "Voting isn't open right now." };
  if (typeof b.website === "string" && b.website.trim()) return { ok: true, drop: true };
  if (!VOTER.test(typeof b.voter === "string" ? b.voter : "")) return { ok: false, status: 400, error: "Refresh the page and try again." };
  if (b.over13 !== true) return { ok: false, status: 400, error: "Voting is for people aged 13 and over." };
  const target = typeof b.target === "string" ? b.target : "";
  const open = openTargets(doc, now).find((t) => t.target === target);
  if (!open) {
    const known = doc.sport === "football" ? doc.fixtures.some((f) => `g:${f.id}` === target) : /^r:/.test(target);
    return { ok: false, status: known ? 409 : 400, error: known ? "Voting for this one has closed or hasn't opened yet." : "Pick from a game or round that's on now." };
  }
  if (open.kind === "game") {
    const ok = open.sides.some((s) => s.players.some((p) => p.choice === b.choice));
    if (!ok) return { ok: false, status: 400, error: "Pick a player from this game." };
    return { ok: true, vote: { voter: b.voter, target, choice: b.choice, reason: null } };
  }
  if (b.choice !== "red" && b.choice !== "blue") return { ok: false, status: 400, error: "Pick red or blue." };
  if (b.reason != null && !REASONS.includes(b.reason)) return { ok: false, status: 400, error: "Pick a reason from the list, or none." };
  return { ok: true, vote: { voter: b.voter, target, choice: b.choice, reason: b.reason ?? null } };
}

// The live view. counts: [{ target, choice, reason, n }] summed from the stored votes.
export function tally(counts, doc, now = Date.now()) {
  const rows = (counts || []).filter((r) => r.n > 0);
  const total = rows.reduce((s, r) => s + r.n, 0);
  const result = { open: isOpen(doc), total, now: openTargets(doc, now) };
  if (doc.sport === "football") {
    const labels = {};
    doc.divisions.forEach((d) => d.teams.forEach((t) => (t.players || []).forEach((p) => (labels[`${t.id}.${p.id}`] = { label: playerLabel(p, doc.settings.voteBy), team: t.name }))));
    const by = {};
    rows.forEach((r) => { if (labels[r.choice]) by[r.choice] = (by[r.choice] || 0) + r.n; });
    result.leaders = Object.entries(by).map(([choice, votes]) => ({ choice, ...labels[choice], votes }))
      .sort((a, b) => b.votes - a.votes || a.label.localeCompare(b.label)).slice(0, SHOWN);
    return result;
  }
  const bouts = Object.fromEntries((doc.card.bouts || []).map((b) => [b.id, b]));
  const rounds = {}, fighters = {};
  rows.forEach((r) => {
    const m = /^r:([^:]+):(\d+)$/.exec(r.target);
    if (!m || !bouts[m[1]] || (r.choice !== "red" && r.choice !== "blue")) return;
    const key = r.target;
    rounds[key] = rounds[key] || { target: key, bout: m[1], round: Number(m[2]), red: 0, blue: 0, reasons: { red: {}, blue: {} } };
    rounds[key][r.choice] += r.n;
    if (r.reason) rounds[key].reasons[r.choice][r.reason] = (rounds[key].reasons[r.choice][r.reason] || 0) + r.n;
    const f = `${m[1]}.${r.choice}`;
    fighters[f] = fighters[f] || { bout: m[1], corner: r.choice, name: bouts[m[1]][r.choice].name, votes: 0 };
    fighters[f].votes += r.n;
  });
  result.rounds = Object.values(rounds).sort((a, b) => (bouts[a.bout].order - bouts[b.bout].order) || a.round - b.round);
  result.fighters = Object.values(fighters).sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name)).slice(0, SHOWN);
  return result;
}
