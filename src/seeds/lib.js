// Shared pieces for the demo seeds. Everything here is invented: names come from generic pools,
// never real people, clubs or leagues. A seed is built with the real generator, so the document
// always passes validate().

import { blankEvent, validate } from "../../public/core/model.js";
import { generate } from "../../public/core/generator.js";
import { londonParts } from "../util.js";

// A small seeded random generator (mulberry32), so a seed builds the same way every time.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = (rand, list) => list[Math.floor(rand() * list.length)];
export const between = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

const FIRST = ["Aiden", "Amara", "Ben", "Callum", "Dara", "Elias", "Farah", "Gabe", "Hana", "Ivo", "Jasper", "Kofi", "Leon", "Maya", "Nico", "Omar", "Priya", "Quinn", "Rafa", "Sasha", "Theo", "Uma", "Vince", "Wren", "Xavi", "Yusuf", "Zane", "Alba", "Bruno", "Cleo", "Dion", "Esme", "Finn", "Greta", "Hugo", "Isla", "Jonah", "Kira", "Luca", "Mateo", "Noor", "Otis", "Pia", "Reuben", "Sienna", "Tomas", "Una", "Viktor", "Willa", "Yara", "Zola", "Ade", "Bex", "Cass", "Dev", "Eli", "Fox", "Gus", "Hari", "Ines"];
const LAST = ["Ashby", "Bellamy", "Castillo", "Dunmore", "Eze", "Fairbank", "Gallagher", "Hartley", "Ibrahim", "Jarvis", "Kaplan", "Lindqvist", "Marlow", "Nwosu", "Okoye", "Prescott", "Quigley", "Rowntree", "Sandhu", "Thorne", "Underhill", "Vasquez", "Whitlock", "Yardley", "Zielinski", "Abara", "Brennan", "Calloway", "Delaney", "Ellery", "Fontaine", "Garrity", "Holloway", "Iyer", "Jessop", "Kerrigan", "Lavelle", "Mensah", "Novak", "Oyelaran", "Pemberton", "Rees", "Stanton", "Tamsin", "Varga", "Winslow", "Yilmaz", "Zahra", "Acheson", "Birch", "Crowe", "Dacosta", "Ferreira", "Goswami", "Hollis", "Imrie", "Kowalski", "Lockhart", "Mahmood", "Penhale"];

export function personNamer(rand) {
  const used = new Set();
  return () => {
    for (let i = 0; i < 200; i++) {
      const n = `${pick(rand, FIRST)} ${pick(rand, LAST)}`;
      if (!used.has(n)) { used.add(n); return n; }
    }
    return `${pick(rand, FIRST)} ${pick(rand, LAST)}`;
  };
}

export function squad(rand, namer, size) {
  const numbers = [];
  while (numbers.length < size) { const n = between(rand, 1, 30); if (!numbers.includes(n)) numbers.push(n); }
  numbers.sort((a, b) => a - b);
  return numbers.map((number, i) => ({ id: `p${i + 1}`, number, name: namer() }));
}

// Start time for a demo that should look like it is happening now: the current London time.
// (Past midnight the times simply wrap; the nightly reset at 04:00 starts a fresh day.)
export function startNow(now) {
  const { hour, minute } = londonParts(now);
  const m = hour * 60 + minute;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// A football event built with the real generator. Returns { doc, generated }.
export function footballDoc(o) {
  const rand = rng(o.seed);
  const namer = personNamer(rand);
  const doc = blankEvent({ slug: o.slug, name: o.name, sport: "football", date: o.date });
  doc.venue = o.venue;
  doc.about = o.about;
  doc.phase = o.phase;
  doc.theme.accent = o.accent;
  doc.settings.voteBy = o.voteBy;
  doc.settings.vote = { open: !!o.voteOpen && !o.juniors };
  doc.settings.lockSecs = 60;
  if (o.terms) doc.settings.terms = { ...o.terms };
  if (o.juniors) { doc.settings.juniors = true; doc.settings.vote = { open: false }; }
  doc.pitches = o.pitches.map((name, i) => ({ id: `P${i + 1}`, name, stream: { url: null, on: false, label: "" } }));
  // one referee per pitch: the seed's own names first, invented ones for any extra pitches
  const refs = o.pitches.map((_, i) => (o.refs && o.refs[i]) || namer());
  doc.officials = refs.map((name, i) => ({ id: `R${i + 1}`, name, role: "referee", pitch: `P${i + 1}` }));
  const teams = o.teams.map((name, i) => ({ id: `T${i + 1}`, name }));
  const g = generate({
    teams, format: o.format, groups: o.groups, advance: o.advance, legs: 1, thirdPlace: !!o.thirdPlace,
    start: o.start, gameMins: o.gameMins, gapMins: o.gapMins, minRest: 1,
    pitches: doc.pitches.map((p) => p.id), refs: doc.officials.map((r) => r.id), refMode: "pitch", division: "main", idPrefix: "M",
  });
  if (!g.ok) throw new Error(`seed ${o.slug}: ${g.errors.join(" ")}`);
  const [lo, hi] = Array.isArray(o.squad) ? o.squad : [6, 8];
  doc.divisions = [{ id: "main", name: o.division, format: o.format, teams: g.teams.map((t) => ({ ...t, players: squad(rand, namer, between(rand, lo, hi)) })) }];
  doc.fixtures = g.fixtures;
  return { doc, rand, generated: g };
}

export function check(doc) {
  const errs = validate(doc);
  if (errs.length) throw new Error(`seed ${doc.slug} is invalid: ${errs.join("; ")}`);
  return doc;
}

export const withPrivate = (doc, seed) => { doc.private = { demo: { seed } }; return doc; };

// ---- Recipes: a prospect's own version of a demo ----
// A recipe changes only the parts of a seed listed here (names, format, timings, wording), so
// it can never change what a demo is. Each seed merges a recipe over its own defaults.
export const RECIPE_KEYS = {
  football: ["name", "venue", "about", "teams", "division", "format", "groups", "advance", "thirdPlace", "gameMins", "gapMins", "pitches", "voteBy", "terms", "squad", "juniors"],
  boxing: ["name", "venue", "about", "bouts", "judges", "terms", "clubs", "rings", "juniors"],
};

export function recipeOf(kind, r) {
  const out = {};
  if (!r || typeof r !== "object") return out;
  RECIPE_KEYS[kind].forEach((k) => { if (r[k] !== undefined && r[k] !== null) out[k] = r[k]; });
  return out;
}

// Problems with a recipe, in words an organiser could fix. Empty when it is fine.
export function recipeErrors(kind, r) {
  const e = [];
  if (r == null) return e;
  if (typeof r !== "object" || Array.isArray(r)) return ["recipe: an object"];
  const known = new Set(RECIPE_KEYS[kind]);
  Object.keys(r).forEach((k) => { if (!known.has(k)) e.push(`recipe.${k}: not something a ${kind} demo can change`); });
  const names = (v, lo, hi, max) => Array.isArray(v) && v.length >= lo && v.length <= hi && v.every((x) => typeof x === "string" && x.trim() && x.length <= max);
  if (kind === "football") {
    if (r.teams !== undefined && !names(r.teams, 2, 32, 40)) e.push("recipe.teams: 2 to 32 team names, 40 characters or fewer");
    if (r.pitches !== undefined && !names(r.pitches, 1, 8, 40)) e.push("recipe.pitches: 1 to 8 names, 40 characters or fewer");
    if (r.juniors !== undefined && typeof r.juniors !== "boolean") e.push("recipe.juniors: true or false");
    if (r.squad !== undefined && !(Array.isArray(r.squad) && r.squad.length === 2 && r.squad.every(Number.isInteger) && r.squad[0] >= 1 && r.squad[0] <= r.squad[1] && r.squad[1] <= 20)) e.push("recipe.squad: [smallest, largest] squad, up to 20");
  } else {
    if (r.bouts !== undefined && !(Array.isArray(r.bouts) && r.bouts.length >= 1 && r.bouts.length <= 20 && r.bouts.every((b) => b && typeof b === "object"))) e.push("recipe.bouts: 1 to 20 bouts");
    if (r.judges !== undefined && ![0, 1, 3, 5].includes(r.judges)) e.push("recipe.judges: 0, 1, 3 or 5");
    if (r.clubs !== undefined && !names(r.clubs, 2, 40, 40)) e.push("recipe.clubs: 2 to 40 club names");
    if (r.rings !== undefined && !names(r.rings, 2, 6, 30)) e.push("recipe.rings: 2 to 6 ring names, 30 characters or fewer");
  }
  return e;
}

// Access codes for a demo built from its document: the organiser, every official, and the first
// two teams' coaches. Labels use the event's own names (a prospect's teams and courts).
export function codesFor(doc) {
  const place = (id) => (doc.pitches.find((p) => p.id === id) || {}).name;
  const out = [{ role: "admin", subject: null, label: "Organiser" }];
  doc.officials.forEach((o) => {
    const label = o.role === "judge" ? `Judge ${o.id.replace(/^\D+/, "")}` : place(o.pitch) ? `Referee, ${place(o.pitch)}` : doc.sport === "boxing" ? "Referee and timekeeper" : "Referee";
    out.push({ role: o.role, subject: o.id, label });
  });
  doc.divisions.flatMap((v) => v.teams).slice(0, 2).forEach((t) => out.push({ role: "coach", subject: t.id, label: `Coach, ${t.name}` }));
  return out;
}
