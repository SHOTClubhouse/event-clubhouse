// Fitness competitions: leaderboards and the small helpers the pages share. The document shape and
// every rule here are in docs/FITNESS.md.
//
// Works on the full document and on the public view alike: a row's label is the entry's own
// `label` when it has one (the public view), otherwise it is made from the name and voteBy.

import { entryLabel, toMins } from "./model.js";

export { entryLabel };

export const comp = (doc) => (doc && doc.comp) || { ranking: "time", segments: [], categories: [], heats: [], entries: [] };

// "1:05:32", or "4:07" under an hour. Anything that is not a time reads as a dash.
export function fmtTime(secs) {
  if (typeof secs !== "number" || !Number.isFinite(secs) || secs < 0) return "-";
  const s = Math.round(secs);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const two = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
}

// How many segments an entry has a result for, and which one it is on (the first without a
// result, or null once every segment is done).
export const segmentsDone = (entry) => (entry.results || []).filter((v) => v != null).length;
export function currentSegment(entry) {
  const i = (entry.results || []).findIndex((v) => v == null);
  return i < 0 ? null : i;
}

// The latest split an entry has: the last result it has, or null.
function lastResult(entry) {
  const r = entry.results || [];
  for (let i = r.length - 1; i >= 0; i--) if (r[i] != null) return r[i];
  return null;
}

const labelOf = (doc, e) => (typeof e.label === "string" && e.label ? e.label : entryLabel(e, (doc.settings || {}).voteBy));

// Competition ranking: the same key shares a place and the next place is skipped (1, 2, 2, 4).
function place(rows, keyOf) {
  let prev, at = 0;
  rows.forEach((r, i) => {
    const k = keyOf(r);
    if (i === 0 || k !== prev) at = i + 1;
    prev = k;
    r.rank = at;
  });
}

const STATE_ORDER = { finished: 0, racing: 1, ready: 2, dnf: 3, dns: 4 };

function timeBoard(doc, entries) {
  const total = (e) => (e.state === "finished" ? lastResult(e) : null);
  const rows = entries.map((e) => ({ id: e.id, bib: e.bib, label: labelOf(doc, e), rank: null, state: e.state, done: segmentsDone(e), total: total(e), points: null, last: lastResult(e) }));
  const finishedTotal = (r) => (r.total == null ? Infinity : r.total);
  rows.sort((a, b) => (STATE_ORDER[a.state] - STATE_ORDER[b.state])
    || (a.state === "finished" ? finishedTotal(a) - finishedTotal(b) : 0)
    || (a.state === "racing" || a.state === "ready" ? (b.done - a.done) || ((a.last ?? Infinity) - (b.last ?? Infinity)) : 0)
    || a.bib - b.bib);
  const fin = rows.filter((r) => r.state === "finished" && r.total != null);
  place(fin, (r) => r.total);
  const racing = rows.filter((r) => r.state === "racing" && r.done > 0);
  place(racing, (r) => `${r.done}:${r.last}`);
  racing.forEach((r) => { r.rank += fin.length; });
  return rows;
}

// Lower is better for a time, higher for reps and kg.
function placingsBoard(doc, entries, segments) {
  const n = entries.length;
  const ranks = entries.map(() => segments.map(() => n));
  segments.forEach((g, s) => {
    const scored = entries.map((e, i) => ({ i, v: e.results[s] })).filter((x) => x.v != null);
    scored.sort((a, b) => (g.measure === "time" ? a.v - b.v : b.v - a.v));
    let at = 0, prev;
    scored.forEach((x, k) => {
      if (k === 0 || x.v !== prev) at = k + 1;
      prev = x.v;
      ranks[x.i][s] = at;
    });
  });
  const rows = entries.map((e, i) => ({
    id: e.id, bib: e.bib, label: labelOf(doc, e), rank: null, state: e.state, done: segmentsDone(e), total: null,
    points: ranks[i].reduce((a, b) => a + b, 0),
    last: segments.length ? ranks[i][segments.length - 1] : null,
    ranks: segments.map((_, s) => (e.results[s] == null ? null : ranks[i][s])),
  }));
  const live = (r) => r.state !== "dns" && r.done > 0;
  rows.sort((a, b) => (live(b) - live(a)) || (live(a) ? (a.points - b.points) || (a.last - b.last) : 0) || a.bib - b.bib);
  rows.filter(live).forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

// Best first. `rank` is null for entries that are not ranked yet: not started, dnf and dns in a
// timed race; dns or nothing scored in placings.
export function leaderboard(doc, categoryId) {
  const c = comp(doc);
  const entries = c.entries.filter((e) => e.category === categoryId);
  return c.ranking === "placings" ? placingsBoard(doc, entries, c.segments) : timeBoard(doc, entries);
}

const heatEntries = (doc, heatId) => comp(doc).entries.filter((e) => e.heat === heatId).sort((a, b) => a.bib - b.bib);

// Heats on the course now, each with its entries and what each is doing.
export function onCourse(doc) {
  const c = comp(doc);
  return c.heats.filter((h) => h.state === "live").map((heat) => ({
    heat,
    entries: heatEntries(doc, heat.id).map((e) => {
      const cur = currentSegment(e);
      return { id: e.id, bib: e.bib, label: labelOf(doc, e), state: e.state, done: segmentsDone(e), current: cur, segment: cur == null ? null : c.segments[cur] || null, last: lastResult(e) };
    }),
  }));
}

// The next n heats still to start, earliest time first, each with who is in it.
export function nextHeats(doc, n = 3) {
  const c = comp(doc);
  return c.heats
    .map((heat, i) => ({ heat, i }))
    .filter((x) => x.heat.state === "scheduled")
    .sort((a, b) => toMins(a.heat.time) - toMins(b.heat.time) || a.i - b.i)
    .slice(0, Math.max(0, n))
    .map(({ heat }) => ({ heat, entries: heatEntries(doc, heat.id).map((e) => ({ id: e.id, bib: e.bib, label: labelOf(doc, e) })) }));
}
