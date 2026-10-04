// The demo seeds, and how a demo event is (re)built and written. Used by the Worker (reset,
// nightly reset, simulation reset) and by scripts/seed.js and scripts/prospect.js.

import { check } from "./lib.js";
import { insertVoteStatements } from "../votes.js";
import beach from "./beach-soccer-cup.js";
import futsal from "./futsal-finals.js";
import sixes from "./sixes-league-night.js";
import fight from "./fight-night.js";

export const SEEDS = Object.fromEntries([beach, futsal, sixes, fight].map((s) => [s.slug, s]));
export const SEED_ORDER = [beach.slug, futsal.slug, sixes.slug, fight.slug];

// A prospect or demo event from a seed. overrides: { slug, name, partner, accent, logo, teams }.
export function buildDemo(key, now, overrides = null) {
  const seed = SEEDS[key];
  if (!seed) throw new Error(`No demo seed called ${key}`);
  const doc = seed.build(now);
  if (overrides) {
    if (overrides.slug) doc.slug = overrides.slug;
    if (overrides.name) doc.name = overrides.name;
    if (overrides.accent) doc.theme.accent = overrides.accent;
    if (overrides.partner) doc.theme.partner = overrides.partner;
    if (overrides.logo) doc.theme.logo = overrides.logo;
    if (Array.isArray(overrides.teams)) doc.divisions.flatMap((v) => v.teams).forEach((t, i) => { if (overrides.teams[i]) t.name = String(overrides.teams[i]).trim(); });
    doc.private = { demo: { seed: key, overrides } };
  }
  return { seed, doc: check(doc), votes: seed.votes(doc, now) };
}

export const eventId = (slug) => `demo-${slug}`;

// The statements that put a demo event into D1 (insert, or replace what is there). Plain
// { sql, params } so the Worker can bind them and the scripts can print them as SQL.
export function demoStatements({ id, slug, doc, votes, codes, listed, now }) {
  const out = [{
    sql: "INSERT INTO events (id, slug, organiser, demo, listed, doc, rev, created_at, updated_at) VALUES (?, ?, NULL, 1, ?, ?, 1, ?, ?) ON CONFLICT (slug) DO UPDATE SET doc = excluded.doc, listed = excluded.listed, demo = 1, rev = events.rev + 1, updated_at = excluded.updated_at",
    params: [id, slug, listed ? 1 : 0, JSON.stringify(doc), now, now],
  }];
  out.push({ sql: "DELETE FROM votes WHERE event_id = ?", params: [id] });
  out.push(...insertVoteStatements(id, votes));
  if (codes) {
    out.push({ sql: "DELETE FROM codes WHERE event_id = ?", params: [id] });
    codes.forEach((c, i) => out.push({
      sql: "INSERT INTO codes (id, event_id, code_hash, role, subject, label, created_at, revoked) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
      params: [c.id || `${id}-${i + 1}`, id, c.hash, c.role, c.subject, c.label, now],
    }));
  }
  return out;
}
