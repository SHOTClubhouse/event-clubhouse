// Demo: workout games that are always live (src/sim.js runs the heats). Three workouts, scored as
// a weight, a time and a rep count, ranked by placings in each category.

import { londonParts } from "../util.js";
import { fitnessDoc, startNow, check, withPrivate, recipeOf } from "./lib.js";

const slug = "fitness-games";

const SEGMENTS = [{ name: "Strength", measure: "kg" }, { name: "Engine", measure: "time" }, { name: "Metcon", measure: "reps" }];
const CATEGORIES = [{ name: "Individual Women", size: 1 }, { name: "Individual Men", size: 1 }, { name: "Pairs Mixed", size: 2 }];

export default {
  slug,
  recipes: true,
  kind: "fitness",
  sim: "fitness",
  blurb: "Eight heats of eight on the floor, live all day. Three workouts are scored one after another, the lowest total of placings wins each category, and fans vote for the favourite of every heat.",
  codes: [
    { role: "admin", subject: null, label: "Organiser", code: "FTGADMNR3H2K" },
    { role: "referee", subject: "R1", label: "Timekeeper, Floor 1", code: "FTGREFA5W7Q3" },
    { role: "referee", subject: "R2", label: "Timekeeper, Floor 2", code: "FTGREFB6X8Y4" },
  ],
  build(now, recipe = {}) {
    const r = recipeOf("fitness", recipe);
    const { doc } = fitnessDoc({
      seed: 4502, slug, name: "Workout Games", venue: "Millbank Training Hall",
      about: "Three workouts, eight heats and a podium in every category. Each workout is scored as it finishes, and the lowest total of placings wins.",
      accent: "#f7b613", voteBy: "both", ranking: "placings",
      segments: SEGMENTS, categories: CATEGORIES, heats: 8, perHeat: 8, gapMins: 6, heatWord: "Heat", bibStart: 201,
      terms: { place: "floor", discipline: "Workout games" },
      ...r,
      date: londonParts(now).date, start: startNow(now),
    });
    doc.updates = [{ id: "U1", at: now, title: "Heat 1 on the floor", body: "The first heat is warming up. Strength is the first workout.", link: null }];
    return withPrivate(check(doc), slug);
  },
  votes: () => [],
};
