// Fan votes in D1, and the 2 second tally cache.

import { tally } from "../public/core/votes.js";

export const TALLY_TTL = 2000;
const cache = new Map(); // event id -> { at, rows }

export async function countRows(db, eventId, now = Date.now(), { fresh = false } = {}) {
  const hit = cache.get(eventId);
  if (!fresh && hit && now - hit.at < TALLY_TTL) return hit.rows;
  const { results } = await db.prepare("SELECT target, choice, reason, COUNT(*) AS n FROM votes WHERE event_id = ? GROUP BY target, choice, reason").bind(eventId).all();
  cache.set(eventId, { at: now, rows: results });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return results;
}

export const forget = (eventId) => cache.delete(eventId);

export async function tallyFor(db, row, now = Date.now(), opts) {
  return tally(await countRows(db, row.id, now, opts), row.doc, now);
}

export const UPSERT = "INSERT INTO votes (event_id, voter, target, choice, reason, ip_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (event_id, voter, target) DO UPDATE SET choice = excluded.choice, reason = excluded.reason, updated_at = excluded.updated_at";

export const upsertVote = (db, eventId, v, ip, now) => db.prepare(UPSERT).bind(eventId, v.voter, v.target, v.choice, v.reason ?? null, ip, now, now);

export async function existingVote(db, eventId, voter, target) {
  return db.prepare("SELECT choice FROM votes WHERE event_id = ? AND voter = ? AND target = ?").bind(eventId, voter, target).first();
}

export async function recentNewVotes(db, ip, since) {
  const r = await db.prepare("SELECT COUNT(*) AS n FROM votes WHERE ip_hash = ? AND created_at > ?").bind(ip, since).first();
  return r ? r.n : 0;
}

// Multi-row inserts for seeds and the simulation. D1 allows 100 bound values a query, so 10 rows
// of 8 columns at a time.
export function insertVoteStatements(eventId, rows) {
  const out = [];
  for (let i = 0; i < rows.length; i += 10) {
    const chunk = rows.slice(i, i + 10);
    const sql = `INSERT INTO votes (event_id, voter, target, choice, reason, ip_hash, created_at, updated_at) VALUES ${chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ")} ON CONFLICT (event_id, voter, target) DO UPDATE SET choice = excluded.choice, reason = excluded.reason, updated_at = excluded.updated_at`;
    out.push({ sql, params: chunk.flatMap((v) => [eventId, v.voter, v.target, v.choice, v.reason ?? null, v.ip_hash, v.at, v.at]) });
  }
  return out;
}
