// Shared by the seed, prospect and organiser scripts: reading local secrets, running wrangler's
// D1 commands, and turning { sql, params } statements into plain SQL.

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = join(root, "node_modules", "wrangler", "bin", "wrangler.js");

export function modeFrom(argv) {
  const local = argv.includes("--local"), remote = argv.includes("--remote");
  if (local === remote) { console.error("Say where: --local (this machine's D1) or --remote (the live D1)."); process.exit(1); }
  return local ? "local" : "remote";
}

export function devVars() {
  const file = join(root, ".dev.vars");
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^(["'])(.*)\1$/, "$2")]));
}

// Local hashing uses .dev.vars; remote uses the SECRET environment variable, which must be the
// same value as the deployed Worker's SECRET secret or none of the codes will work.
export function secretFor(mode) {
  const s = mode === "local" ? devVars().SECRET : process.env.SECRET;
  if (!s) { console.error(mode === "local" ? "No SECRET in .dev.vars." : "Set the SECRET environment variable to the Worker's SECRET before using --remote."); process.exit(1); }
  return s;
}

const literal = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

export function toSql(statements) {
  return statements.map(({ sql, params }) => {
    const parts = sql.split("?");
    return `${parts.map((p, i) => p + (i < params.length ? literal(params[i]) : "")).join("")};`;
  }).join("\n");
}

export function d1(mode, args) {
  const base = ["d1", "execute", "event-clubhouse", mode === "local" ? "--local" : "--remote"];
  if (mode === "local") base.push("--persist-to", process.env.PERSIST || ".wrangler/state"); // PERSIST lets several local copies run side by side
  const r = spawnSync(process.execPath, [wrangler, ...base, ...args], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) { console.error("wrangler d1 execute failed."); process.exit(r.status || 1); }
}

export function runSql(mode, sql) {
  const file = join(tmpdir(), `event-clubhouse-${randomBytes(6).toString("hex")}.sql`);
  writeFileSync(file, sql);
  try { d1(mode, ["--file", file]); } finally { rmSync(file, { force: true }); }
}

export const applySchema = (mode) => d1(mode, ["--file", join(root, "schema.sql")]);
