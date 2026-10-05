// Shared pieces for the demo seeds. Everything here is invented: names come from generic pools,
// never real people, clubs or leagues. A seed is built with the real generator, so the document
// always passes validate().

import { blankEvent, validate, toMins, fromMins, RANKINGS, MEASURES, ENTRY_SIZES } from "../../public/core/model.js";
import { generate } from "../../public/core/generator.js";
import { londonParts } from "../util.js";
import { addMins } from "../../public/core/model.js";
import { applyOps } from "../../public/core/ops.js";
import { resolve, standings } from "../../public/core/standings.js";

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
  const [lo, hi] = Array.isArray(o.squad) ? o.squad : [6, 8];
  // One division, or several (age groups, a men's and women's draw) sharing the pitches: each
  // division gets its own pitches when there are enough, otherwise they play one after another.
  const plan = Array.isArray(o.divisions) && o.divisions.length
    ? o.divisions.map((v, i) => ({ id: `D${i + 1}`, prefix: `D${i + 1}-`, name: v.name, teams: v.teams, format: v.format || o.format, groups: v.groups ?? o.groups, advance: v.advance ?? o.advance, thirdPlace: v.thirdPlace ?? o.thirdPlace }))
    : [{ id: "main", prefix: "", name: o.division, teams: o.teams, format: o.format, groups: o.groups, advance: o.advance, thirdPlace: o.thirdPlace }];
  const own = doc.pitches.length >= plan.length;
  let start = o.start, n = 0, last = null;
  doc.divisions = [];
  doc.fixtures = [];
  plan.forEach((v, i) => {
    const pitches = own ? doc.pitches.filter((_, k) => k % plan.length === i) : doc.pitches;
    const teams = v.teams.map((name) => ({ id: `T${++n}`, name }));
    const g = generate({
      teams, format: v.format, groups: v.groups, advance: v.advance, legs: 1, thirdPlace: !!v.thirdPlace,
      start, gameMins: o.gameMins, gapMins: o.gapMins, minRest: 1,
      pitches: pitches.map((p) => p.id), refs: doc.officials.filter((r) => pitches.some((p) => p.id === r.pitch)).map((r) => r.id), refMode: "pitch", division: v.id, idPrefix: "M",
    });
    if (!g.ok) throw new Error(`seed ${o.slug} ${v.name}: ${g.errors.join(" ")}`);
    doc.divisions.push({ id: v.id, name: v.name, format: v.format, teams: g.teams.map((t) => ({ ...t, players: squad(rand, namer, between(rand, lo, hi)) })) });
    doc.fixtures.push(...g.fixtures.map((f) => ({ ...f, id: `${v.prefix}${f.id}` })));
    if (!own) start = addMins(g.summary.ends, o.gapMins || 0);
    last = g;
  });
  return { doc, rand, generated: last };
}

// A fitness event: segments, categories, heats (waves) and entries, all invented. Returns { doc, rand }.
// o.segments are names or { name, measure }; o.categories are names or { name, size }. A timed race
// only has time segments, so for ranking "time" every measure is time.
const FITNESS_CLUBS = ["Northgate Fitness", "Riverside Run Club", "Hilltop Athletics", "Eastgate Training", "Millbank Fitness", "Harbour Strength", "Kingsway Conditioning", "Redbridge Runners"];
export function fitnessDoc(o) {
  const rand = rng(o.seed);
  const namer = personNamer(rand);
  const doc = blankEvent({ slug: o.slug, name: o.name, sport: "fitness", date: o.date });
  doc.venue = o.venue;
  doc.about = o.about;
  doc.phase = o.phase || "live";
  doc.theme.accent = o.accent;
  doc.settings.voteBy = o.voteBy;
  doc.settings.vote = { open: o.voteOpen !== false };
  doc.settings.lockSecs = 60;
  doc.settings.terms = { ...o.terms };
  doc.officials = [1, 2].map((n) => ({ id: `R${n}`, name: namer(), role: "referee", pitch: null }));
  const ranking = o.ranking;
  doc.comp.ranking = ranking;
  doc.comp.segments = o.segments.map((g, i) => {
    const s = typeof g === "string" ? { name: g } : g;
    return { id: `S${i + 1}`, name: String(s.name).trim(), measure: ranking === "time" ? "time" : s.measure || "time" };
  });
  doc.comp.categories = o.categories.map((k, i) => {
    const c = typeof k === "string" ? { name: k } : k;
    return { id: `C${i + 1}`, name: String(c.name).trim(), size: c.size || 1 };
  });
  const cats = doc.comp.categories;
  const gap = o.gapMins;
  const heatWord = o.heatWord || "Heat";
  doc.comp.heats = Array.from({ length: o.heats }, (_, i) => ({
    id: `H${i + 1}`, time: fromMins(toMins(o.start) + i * gap), name: `${heatWord} ${i + 1}`,
    category: cats[i % cats.length].id, state: "scheduled", startedAt: null, endedAt: null,
  }));
  const clubs = o.clubs || FITNESS_CLUBS;
  let k = 0;
  doc.comp.entries = doc.comp.heats.flatMap((h) => {
    const size = cats.find((c) => c.id === h.category).size;
    return Array.from({ length: o.perHeat }, () => {
      k++;
      return {
        id: `A${k}`, bib: o.bibStart + k - 1, name: Array.from({ length: size }, namer).join(" & "), club: pick(rand, clubs),
        category: h.category, heat: h.id, results: doc.comp.segments.map(() => null), state: "ready",
      };
    });
  });
  return { doc, rand };
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
  football: ["clubhouse", "name", "venue", "about", "teams", "divisions", "division", "format", "groups", "advance", "thirdPlace", "gameMins", "gapMins", "pitches", "voteBy", "terms", "squad", "juniors"],
  boxing: ["clubhouse", "name", "venue", "about", "bouts", "judges", "terms", "clubs", "rings", "juniors"],
  fitness: ["clubhouse", "name", "venue", "about", "ranking", "segments", "categories", "heats", "perHeat", "gapMins", "terms"],
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
    if (r.divisions !== undefined && !(Array.isArray(r.divisions) && r.divisions.length >= 1 && r.divisions.length <= 6 && r.divisions.every((v) => v && typeof v.name === "string" && v.name.trim() && v.name.length <= 40 && names(v.teams, 2, 32, 40)))) e.push("recipe.divisions: 1 to 6 divisions, each with a name and 2 to 32 team names");
    if (r.pitches !== undefined && !names(r.pitches, 1, 8, 40)) e.push("recipe.pitches: 1 to 8 names, 40 characters or fewer");
    if (r.juniors !== undefined && typeof r.juniors !== "boolean") e.push("recipe.juniors: true or false");
    if (r.squad !== undefined && !(Array.isArray(r.squad) && r.squad.length === 2 && r.squad.every(Number.isInteger) && r.squad[0] >= 1 && r.squad[0] <= r.squad[1] && r.squad[1] <= 20)) e.push("recipe.squad: [smallest, largest] squad, up to 20");
  } else if (kind === "fitness") {
    const named = (v, extra) => (typeof v === "string" ? v.trim() && v.length <= 40 : !!v && typeof v === "object" && typeof v.name === "string" && v.name.trim() && v.name.length <= 40 && extra(v));
    const list = (v, max, extra) => Array.isArray(v) && v.length >= 1 && v.length <= max && v.every((x) => named(x, extra));
    const whole = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
    if (r.ranking !== undefined && !RANKINGS.includes(r.ranking)) e.push(`recipe.ranking: ${RANKINGS.join(" or ")}`);
    if (r.segments !== undefined && !list(r.segments, 20, (x) => x.measure === undefined || MEASURES.includes(x.measure))) e.push(`recipe.segments: 1 to 20 segments with a name (40 characters or fewer) and a measure of ${MEASURES.join(", ")}`);
    if (r.categories !== undefined && !list(r.categories, 16, (x) => x.size === undefined || ENTRY_SIZES.includes(x.size))) e.push(`recipe.categories: 1 to 16 categories with a name and a size of ${ENTRY_SIZES.join(", ")} athletes`);
    if (r.heats !== undefined && !whole(r.heats, 1, 120)) e.push("recipe.heats: how many heats, 1 to 120");
    if (r.perHeat !== undefined && !whole(r.perHeat, 1, 50)) e.push("recipe.perHeat: athletes in each heat, 1 to 50");
    if (r.gapMins !== undefined && !whole(r.gapMins, 1, 30)) e.push("recipe.gapMins: minutes between heats, 1 to 30");
    if (Number.isInteger(r.heats) && Number.isInteger(r.perHeat) && r.heats * r.perHeat > 800) e.push("recipe: an event holds up to 800 athletes (heats times athletes in each heat)");
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
    const refs = doc.officials.filter((x) => x.role === "referee").length;
    const label = o.role === "judge" ? `Judge ${o.id.replace(/^\D+/, "")}` : doc.sport === "fitness" ? (refs > 1 ? `Timekeeper, Floor ${o.id.replace(/^\D+/, "")}` : "Timekeeper") : place(o.pitch) ? `Referee, ${place(o.pitch)}` : doc.sport === "boxing" ? "Referee and timekeeper" : "Referee";
    out.push({ role: o.role, subject: o.id, label });
  });
  doc.divisions.flatMap((v) => v.teams).slice(0, 2).forEach((t) => out.push({ role: "coach", subject: t.id, label: `Coach, ${t.name}` }));
  return out;
}

// ---- Games already played ----
// Plays the games `want(fixture)` accepts to full time, in order, through the real ops (so every
// score, scorer and knockout name passes validation). Knockout places are filled from the tables;
// a place level on every tie-break is picked by table order, as the organiser would. About one
// goal in ten has no scorer. Returns the document (unchanged if an op is refused).
export function playPast(doc, now, rand, want) {
  const admin = { role: "admin", id: null };
  const points = doc.settings.points;
  const places = { "1st": 0, "2nd": 1, "3rd": 2, "4th": 3 };
  const apply = (ops, at) => { const r = applyOps(doc, ops, admin, at); if (r.ok) doc = r.doc; return r.ok; };
  const real = (div, f, side) => {
    const ref = f[side];
    if (div.teams.some((t) => t.id === ref)) return ref;
    const r = resolve(div, doc.fixtures, ref, points);
    if (r) return r;
    const m = typeof ref === "string" && ref.match(/^(1st|2nd|3rd|4th) (?:in table|Group (\S+))$/i);
    if (!m) return null;
    const pool = m[2] ? div.teams.filter((t) => String(t.group).toLowerCase() === m[2].toLowerCase()) : div.teams;
    const ids = new Set(pool.map((t) => t.id));
    const games = doc.fixtures.filter((g) => g.division === div.id && !g.stage && ids.has(g.home) && ids.has(g.away));
    if (!games.length || games.some((g) => g.state !== "ft")) return null;
    const row = standings(pool, games, points)[places[m[1].toLowerCase()]];
    return row ? row.id : null;
  };
  let moved = true;
  let k = 0;
  while (moved) {
    moved = false;
    for (const f0 of doc.fixtures) {
      const f = doc.fixtures.find((x) => x.id === f0.id);
      if (f.state === "ft" || !want(f)) continue;
      const div = doc.divisions.find((v) => v.id === f.division);
      const h = real(div, f, "home"), a = real(div, f, "away");
      if (!h || !a || h === a) continue;
      // a game whose time is already past is played at that time; any other well before now
      const ago = minsFrom(now, f.time);
      const start = ago < 0 ? now + ago * 60000 : now - (200 - k++) * 60000;
      const fix = [];
      if (h !== f.home) fix.push({ op: "fixture.edit", id: f.id, home: h });
      if (a !== f.away) fix.push({ op: "fixture.edit", id: f.id, away: a });
      if (fix.length && !apply(fix, start)) continue;
      const total = between(rand, 0, 7);
      const ops = [{ op: "fixture.state", id: f.id, state: "live" }];
      const team = (id) => div.teams.find((t) => t.id === id);
      let home = 0;
      for (let i = 0; i < total; i++) {
        const side = rand() < 0.5 ? "home" : "away";
        if (side === "home") home++;
        const t = team(side === "home" ? h : a);
        const g = { op: "goal.add", id: f.id, side, min: 1 + Math.floor(((i + 0.5) / Math.max(1, total)) * 9) };
        if (t && t.players.length && rand() >= 0.1) g.player = pick(rand, t.players).id;
        ops.push(g);
      }
      ops.push({ op: "fixture.state", id: f.id, state: "ft" });
      if (f.stage && home * 2 === total) ops.push({ op: "fixture.pens", id: f.id, side: rand() < 0.5 ? "home" : "away" });
      if (apply(ops, start)) moved = true;
    }
  }
  return doc;
}

// Minutes from the London clock at `now` to an "HH:MM" time, between -720 and 719.
function minsFrom(now, hhmm) {
  const p = londonParts(now);
  let d = (toMins(hhmm) - (p.hour * 60 + p.minute)) % 1440;
  if (d < -720) d += 1440;
  if (d >= 720) d -= 1440;
  return d;
}

// ---- A day already under way ----
// A demo opened at any moment should already have results, a table and names in the knockout.
// This plays about two in three of the group or league games, always leaving at least two a
// pitch to play live, and moves the whole schedule so the first game still to play starts now
// and the played ones sit at their real times earlier in the day.
export function playEarlier(doc, now, rand) {
  const after = (f) => (minsFrom(now, f.time) + 1440) % 1440;
  const games = doc.fixtures.filter((f) => !f.stage).sort((a, b) => after(a) - after(b) || doc.pitches.findIndex((p) => p.id === a.pitch) - doc.pitches.findIndex((p) => p.id === b.pitch));
  const left = Math.max(doc.pitches.length * 2, Math.ceil(games.length * 0.3));
  const played = games.slice(0, Math.max(0, games.length - left));
  if (!played.length) return doc;
  const shift = after(games[played.length]);
  doc.fixtures.forEach((f) => { f.time = fromMins(toMins(f.time) - shift); });
  const ids = new Set(played.map((f) => f.id));
  return playPast(doc, now, rand, (f) => ids.has(f.id));
}

// Fan votes for the games already played, so each one has a player of the game. Votes lean
// towards a few players, the way a crowd does. None on a juniors event.
export function pastVotes(doc, rand) {
  if (doc.settings.juniors) return [];
  const out = [];
  doc.fixtures.filter((f) => f.state === "ft" && f.ftAt).forEach((f) => {
    const div = doc.divisions.find((v) => v.id === f.division);
    const squads = [f.home, f.away].map((id) => div && div.teams.find((t) => t.id === id)).filter((t) => t && t.players && t.players.length);
    if (!squads.length) return;
    for (let i = 0, n = between(rand, 6, 24); i < n; i++) {
      const t = squads[rand() < 0.55 ? 0 : squads.length - 1];
      const p = t.players[Math.floor(rand() ** 2 * t.players.length)];
      out.push({ voter: `sim-voter-${String(i + 1).padStart(6, "0")}`, target: `g:${f.id}`, choice: `${t.id}.${p.id}`, reason: null, ip_hash: "sim", at: f.ftAt - 30000 });
    }
  });
  return out;
}
