// The referee's offline queue. Every tap becomes an op saved on the phone first and sent when
// there is signal. The screen always shows "what the website last told us" plus "what is still
// waiting on this phone", so a tap is never lost and never counted twice: scores are sent as
// absolute numbers, and a queued op is only removed once the server has confirmed it.

import { OPS } from "../core/ops.js";

const KEY = (slug) => `ec.refq.v1.${slug}`;

export function load(slug) {
  try { const q = JSON.parse(localStorage.getItem(KEY(slug)) || "[]"); return Array.isArray(q) ? q : []; } catch (e) { return memory[slug] || []; }
}
function save(slug, q) {
  try { localStorage.setItem(KEY(slug), JSON.stringify(q)); } catch (e) { /* private mode: the queue lasts this page */ memory[slug] = q; }
}
const memory = {};

let seq = Date.now() * 1000;

// Adds an op. A key joins a run of taps on the same thing at the end of the queue (ten taps on
// "+" offline send one score), but never reorders anything else.
export function push(slug, op, key = null) {
  const q = load(slug);
  const last = q[q.length - 1];
  const entry = { id: ++seq, op, key, at: Date.now(), taps: 1 };
  if (key && last && last.key === key) { entry.taps = (last.taps || 1) + 1; q[q.length - 1] = entry; } else q.push(entry);
  save(slug, q);
  return entry;
}

export function remove(slug, ids) {
  const gone = new Set(ids);
  save(slug, load(slug).filter((e) => !gone.has(e.id)));
}

export const size = (slug) => load(slug).length;
// What to tell the referee: taps waiting, even when several were merged into one op.
export const taps = (slug) => load(slug).reduce((n, e) => n + (e.taps || 1), 0);

// The event as this phone should show it: the server's copy with the waiting ops applied.
export function derive(server, queue, actor) {
  const d = structuredClone(server);
  queue.forEach((e) => {
    const def = OPS[e.op.op];
    if (def) { try { def.run(d, e.op, actor, e.at); } catch (err) { /* a bad op is caught when it is sent */ } }
  });
  return d;
}

// Would this op be refused? Returns the plain message, or null. Run on the derived event.
export function precheck(derived, op, actor) {
  const def = OPS[op.op];
  if (!def) return "Unknown change.";
  try { return def.run(structuredClone(derived), op, actor, Date.now()) || null; } catch (e) { return "That didn't work."; }
}

// The ops that put a game back exactly as it was (for Undo). Order matters: state first (it can
// clear scores and penalties), then the score, then the penalty winner.
export function restoreOps(f) {
  if (f.state === "scheduled") return [{ op: "fixture.state", id: f.id, state: "scheduled" }];
  const ops = [{ op: "fixture.state", id: f.id, state: "live" }, { op: "fixture.score", id: f.id, home: f.homeScore ?? 0, away: f.awayScore ?? 0 }];
  if (f.state === "ft") ops.push({ op: "fixture.state", id: f.id, state: "ft" });
  if (f.pens) ops.push({ op: "fixture.pens", id: f.id, side: f.pens });
  return ops;
}
