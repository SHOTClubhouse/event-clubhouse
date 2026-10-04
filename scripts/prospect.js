// Creates private, unlisted demo events for prospects from a file that is never committed.
//
//   node scripts/prospect.js --local  [--file private/prospects.json] [--site http://127.0.0.1:8787]
//   node scripts/prospect.js --remote [--file private/prospects.json] [--site https://events.shotclubhouse.com]
//
// private/prospects.json is gitignored. Its shape is in docs/prospects.example.json. Each entry
// becomes a copy of a demo seed with the prospect's event name, partner name and accent colour,
// at a random link nobody can guess (/e/p-xxxxxxxxxx/), with its own fresh codes. The links and
// codes print once, here, and are not stored anywhere except as hashes in the database.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SEEDS, buildDemo, demoStatements } from "../src/seeds/index.js";
import { hashCode } from "../src/auth.js";
import { randomCode, randomSlugPart, formatCode, normaliseCode } from "../src/util.js";
import { COLOUR, HTTPS } from "../public/core/model.js";
import { modeFrom, secretFor, runSql, toSql, root } from "./lib.js";

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const mode = modeFrom(argv);
const secret = secretFor(mode);
const file = flag("--file") || join(root, "private", "prospects.json");
const site = (flag("--site") || process.env.SITE || (mode === "local" ? "http://127.0.0.1:8787" : "https://events.shotclubhouse.com")).replace(/\/$/, "");

if (!existsSync(file)) { console.error(`No prospects file at ${file}. Copy docs/prospects.example.json to private/prospects.json and edit it.`); process.exit(1); }
let list;
try { list = JSON.parse(readFileSync(file, "utf8")); } catch (e) { console.error(`${file} is not valid JSON: ${e.message}`); process.exit(1); }
if (!Array.isArray(list) || !list.length) { console.error("The prospects file must be a list with at least one entry."); process.exit(1); }

const problems = [];
list.forEach((p, i) => {
  const at = `entry ${i + 1}`;
  if (typeof p.name !== "string" || !p.name.trim() || p.name.length > 80) problems.push(`${at}: name is 1 to 80 characters`);
  if (p.partner != null && (typeof p.partner !== "string" || p.partner.length > 60)) problems.push(`${at}: partner is 60 characters or fewer`);
  if (!COLOUR.test(p.accent || "")) problems.push(`${at}: accent is a #rrggbb colour`);
  if (p.seed != null && !SEEDS[p.seed]) problems.push(`${at}: seed is one of ${Object.keys(SEEDS).join(", ")}`);
  if (p.logo != null && !(typeof p.logo === "string" && HTTPS.test(p.logo))) problems.push(`${at}: logo is an https link`);
});
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }

const now = Date.now();
const statements = [];
const report = [];
for (const p of list) {
  const seedKey = p.seed || "beach-soccer-cup";
  const slug = `p-${randomSlugPart(10)}`;
  const { seed, doc, votes } = buildDemo(seedKey, now, { slug, name: p.name.trim(), partner: p.partner || null, accent: p.accent, logo: p.logo || null });
  const id = `prospect-${slug}`;
  const codes = [];
  const shown = [];
  for (const [i, c] of seed.codes.entries()) {
    const plain = randomCode(12);
    codes.push({ id: `${id}-${i + 1}`, hash: await hashCode(secret, normaliseCode(plain)), role: c.role, subject: c.subject, label: c.label });
    shown.push({ role: c.role, label: c.label, code: formatCode(plain) });
  }
  statements.push(...demoStatements({ id, slug, doc, votes, codes, listed: false, now }));
  report.push({ name: p.name.trim(), slug, shown });
}

runSql(mode, toSql(statements));

report.forEach((r) => {
  console.log(`\n${r.name}`);
  console.log(`  Fan app      ${site}/e/${r.slug}/`);
  console.log(`  Big screen   ${site}/e/${r.slug}/screen/`);
  console.log(`  Staff sign-in  ${site}/admin/  (organiser)   ${site}/ref/  (referee, judge)   ${site}/coach/  (coach)`);
  r.shown.forEach((c) => console.log(`  ${c.role.padEnd(8)} ${c.label.padEnd(26)} ${c.code}`));
});
console.log("\nThese links and codes are shown once. The links are unlisted and carry noindex, but anyone with a link can open it.");
