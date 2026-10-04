// Demo events in the running Worker: reset to the seed, the always-live simulation, the nightly
// reset. The pure parts are in src/sim.js and src/seeds/.

import { SEEDS, buildDemo, demoStatements } from "./seeds/index.js";
import { runStep } from "./sim.js";
import { casWrite, loadEvent } from "./events.js";
import { insertVoteStatements, forget } from "./votes.js";
import { londonParts } from "./util.js";

const bind = (db, s) => db.prepare(s.sql).bind(...s.params);

// Which seed a demo event was built from (prospect clones keep theirs in doc.private).
export const seedKeyOf = (row) => {
  const d = row.doc.private && row.doc.private.demo;
  return d && SEEDS[d.seed] ? d.seed : SEEDS[row.slug] ? row.slug : null;
};

// Puts a demo event back to its seed: fresh document, fresh seeded votes, same codes.
export async function resetDemo(db, row, now = Date.now()) {
  const key = seedKeyOf(row);
  if (!key) return false;
  const marker = row.doc.private && row.doc.private.demo;
  const overrides = marker && marker.overrides ? { ...marker.overrides, slug: row.slug } : null;
  const { doc, votes } = buildDemo(key, now, overrides);
  const statements = demoStatements({ id: row.id, slug: row.slug, doc, votes, codes: null, listed: row.listed, now });
  await db.batch(statements.map((s) => bind(db, s)));
  forget(row.id);
  return true;
}

// One simulation tick for one event: apply the next step with a compare-and-swap, then add the
// fake votes. Returns what happened, for the logs.
export async function simulate(db, slug, now = Date.now(), rand = Math.random) {
  for (let i = 0; i < 5; i++) {
    const row = await loadEvent(db, slug);
    if (!row || !row.demo) return { slug, skipped: true };
    const key = seedKeyOf(row);
    if (!key || !SEEDS[key].sim) return { slug, skipped: true };
    const step = runStep(row.doc, now, rand);
    if (step.reset) { await resetDemo(db, row, now); return { slug, reset: true }; }
    if (step.errors.length) console.error("sim refused a change", slug, JSON.stringify(step.errors));
    const changed = JSON.stringify(step.doc) !== JSON.stringify(row.doc);
    if (changed && !(await casWrite(db, row.id, row.rev, step.doc, now))) continue;
    if (step.votes.length) await db.batch(insertVoteStatements(row.id, step.votes).map((s) => bind(db, s)));
    return { slug, changed, votes: step.votes.length, errors: step.errors.length };
  }
  return { slug, conflict: true };
}

// Only demos built from a simulated seed (the two always-live ones, and prospect copies of them).
export async function simulateAll(db, now = Date.now()) {
  const keys = Object.keys(SEEDS).filter((k) => SEEDS[k].sim);
  const marks = keys.map(() => "?").join(", ");
  const { results } = await db.prepare(`SELECT slug FROM events WHERE demo = 1 AND (slug IN (${marks}) OR json_extract(doc, '$.private.demo.seed') IN (${marks}))`).bind(...keys, ...keys).all();
  const out = [];
  for (const r of results) out.push(await simulate(db, r.slug, now));
  return out;
}

// 04:00 London: every demo goes back to its seed.
export const isNightlyReset = (now) => { const p = londonParts(now); return p.hour === 4 && p.minute === 0; };

export async function resetAllDemos(db, now = Date.now()) {
  const { results } = await db.prepare("SELECT slug FROM events WHERE demo = 1").all();
  let n = 0;
  for (const r of results) {
    const row = await loadEvent(db, r.slug);
    if (row && (await resetDemo(db, row, now))) n++;
  }
  return n;
}
