// Applies schema.sql, then inserts or replaces the demo events and their public demo codes.
//
//   node scripts/seed.js --local      this machine's D1 (hashes codes with SECRET from .dev.vars)
//   node scripts/seed.js --remote     the live D1 (set SECRET in the environment first; it must
//                                     equal the Worker's SECRET secret)
//
// Safe to re-run: events are replaced (and go back to their seed), codes keep their ids.

import { SEEDS, SEED_ORDER, buildDemo, demoStatements, eventId } from "../src/seeds/index.js";
import { hashCode } from "../src/auth.js";
import { normaliseCode } from "../src/util.js";
import { modeFrom, secretFor, applySchema, runSql, toSql } from "./lib.js";

const mode = modeFrom(process.argv.slice(2));
const secret = secretFor(mode);
const now = Date.now();

applySchema(mode);

const statements = [];
for (const slug of SEED_ORDER) {
  const { doc, votes } = buildDemo(slug, now);
  const codes = [];
  for (const [i, c] of SEEDS[slug].codes.entries()) {
    codes.push({ id: `${eventId(slug)}-${i + 1}`, hash: await hashCode(secret, normaliseCode(c.code)), role: c.role, subject: c.subject, label: c.label });
  }
  statements.push(...demoStatements({ id: eventId(slug), slug, doc, votes, codes, listed: true, now }));
  const units = doc.sport === "fitness" ? `${doc.comp.heats.length} heats, ${doc.comp.entries.length} athletes` : `${doc.fixtures.length || doc.card.bouts.length} ${doc.sport === "football" ? "games" : "bouts"}`;
  console.log(`${slug}: ${units}, ${votes.length} seeded votes, ${codes.length} codes`);
}

runSql(mode, toSql(statements));
console.log(`Seeded ${SEED_ORDER.length} demo events (${mode}).`);
