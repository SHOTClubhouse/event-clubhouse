// Demo: a timed fitness race that is always live (src/sim.js sends out a wave about every four
// minutes and posts each athlete's splits). Eight runs with a station after each, generic names.

import { londonParts } from "../util.js";
import { fitnessDoc, startNow, check, withPrivate, recipeOf } from "./lib.js";

const slug = "fitness-race";

const STATIONS = ["Ski machine", "Sled push", "Sled pull", "Burpee jumps", "Rowing machine", "Farmer's carry", "Walking lunges", "Ball throws"];
const SEGMENTS = STATIONS.flatMap((station, i) => [`Run ${i + 1}`, station]);
const CATEGORIES = [{ name: "Open Women", size: 1 }, { name: "Open Men", size: 1 }, { name: "Pro Women", size: 1 }, { name: "Pro Men", size: 1 }, { name: "Doubles Mixed", size: 2 }];

export default {
  slug,
  recipes: true,
  kind: "fitness",
  sim: "fitness",
  blurb: "Sixteen waves of ten athletes, live all day. Eight runs and eight stations each, timekeepers post splits from their phones, and fans follow the leaderboard and vote for the favourite of every wave.",
  codes: [
    { role: "admin", subject: null, label: "Organiser", code: "FTRADMNWQ2K7" },
    { role: "referee", subject: "R1", label: "Timekeeper, Floor 1", code: "FTRREFA3P5M8" },
    { role: "referee", subject: "R2", label: "Timekeeper, Floor 2", code: "FTRREFB4T6N9" },
  ],
  build(now, recipe = {}) {
    const r = recipeOf("fitness", recipe);
    const { doc } = fitnessDoc({
      seed: 4501, slug, name: "Fitness Race", venue: "Harbour Hall",
      about: "Eight runs, eight stations and one finish line. Athletes start in waves and every split is posted as they go, so you can follow your favourites around the course and vote for the best of each wave.",
      accent: "#1abc9c", voteBy: "both", ranking: "time",
      segments: SEGMENTS, categories: CATEGORIES, heats: 16, perHeat: 10, gapMins: 4, heatWord: "Wave", bibStart: 101,
      terms: { place: "arena", discipline: "Fitness race" },
      ...r,
      date: londonParts(now).date, start: startNow(now),
    });
    doc.updates = [{ id: "U1", at: now, title: "First wave away", body: "The course is open and the first wave has started.", link: null }];
    return withPrivate(check(doc), slug);
  },
  votes: () => [],
};
