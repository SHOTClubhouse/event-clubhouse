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

// Start time for a demo that should look like it is happening now: the current London time,
// to the nearest 5 minutes below, kept early enough that the day does not run past midnight.
export function startNow(now) {
  const { hour, minute } = londonParts(now);
  const m = Math.min(hour * 60 + minute - (minute % 5), 21 * 60 + 30);
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
  doc.settings.vote = { open: !!o.voteOpen };
  doc.settings.lockSecs = 60;
  doc.pitches = o.pitches.map((name, i) => ({ id: `P${i + 1}`, name, stream: { url: null, on: false, label: "" } }));
  doc.officials = o.refs.map((name, i) => ({ id: `R${i + 1}`, name, role: "referee", pitch: o.pitches.length === o.refs.length ? `P${i + 1}` : null }));
  const teams = o.teams.map((name, i) => ({ id: `T${i + 1}`, name }));
  const g = generate({
    teams, format: o.format, groups: o.groups, advance: o.advance, legs: 1, thirdPlace: !!o.thirdPlace,
    start: o.start, gameMins: o.gameMins, gapMins: o.gapMins, minRest: 1,
    pitches: doc.pitches.map((p) => p.id), refs: doc.officials.map((r) => r.id), refMode: "pitch", division: "main", idPrefix: "M",
  });
  if (!g.ok) throw new Error(`seed ${o.slug}: ${g.errors.join(" ")}`);
  doc.divisions = [{ id: "main", name: o.division, format: o.format, teams: g.teams.map((t) => ({ ...t, players: squad(rand, namer, between(rand, 6, 8)) })) }];
  doc.fixtures = g.fixtures;
  return { doc, rand, generated: g };
}

export function check(doc) {
  const errs = validate(doc);
  if (errs.length) throw new Error(`seed ${doc.slug} is invalid: ${errs.join("; ")}`);
  return doc;
}

export const withPrivate = (doc, seed) => { doc.private = { demo: { seed } }; return doc; };
