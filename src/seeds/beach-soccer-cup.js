// Demo: a beach soccer cup that is always live (src/sim.js plays it forward).

import { londonParts } from "../util.js";
import { footballDoc, startNow, check, withPrivate, recipeOf } from "./lib.js";

const slug = "beach-soccer-cup";

export default {
  slug,
  recipes: true,
  kind: "football",
  sim: "football",
  blurb: "Eight teams on two pitches, live all day. Referees score from their phones, the table and the knockouts fill themselves in, and fans vote for the player of every game.",
  codes: [
    { role: "admin", subject: null, label: "Organiser", code: "BCHADMNWX2K7" },
    { role: "referee", subject: "R1", label: "Referee, Pitch 1", code: "BCHREFA2P3QT" },
    { role: "referee", subject: "R2", label: "Referee, Pitch 2", code: "BCHREFB4M5WS" },
    { role: "coach", subject: "T1", label: "Coach, Sandstorm", code: "BCHCHAA2K9ZV" },
    { role: "coach", subject: "T2", label: "Coach, Tide Riders", code: "BCHCHAB3T8RN" },
  ],
  build(now, recipe = {}) {
    const { doc } = footballDoc({
      seed: 4101, slug, name: "Beach Soccer Cup", venue: "Seafront Arena",
      about: "Eight teams, two pitches and one trophy. Ten-minute games on the sand, with the knockouts straight after the groups. Follow every game live and vote for your player of the game.",
      accent: "#f7b613", phase: "live", voteBy: "number", voteOpen: true,
      pitches: ["Pitch 1", "Pitch 2"], refs: ["Jordan Hale", "Mina Okafor"],
      teams: ["Sandstorm", "Tide Riders", "Coral Kings", "Dune Hawks", "Salt Sharks", "Sunset Roamers", "Breakers", "Palm Pirates"],
      division: "Cup", format: "groups-knockout", groups: 2, advance: 2, thirdPlace: true,
      gameMins: 10, gapMins: 2, terms: { place: "pitch", score: "goal", discipline: "Beach soccer" },
      ...recipeOf("football", recipe),
      date: londonParts(now).date, start: startNow(now),
    });
    doc.updates = [{ id: "U1", at: now, title: "Kick-off", body: "Gates are open and the first games are under way on both pitches.", link: null }];
    return withPrivate(check(doc), slug);
  },
  votes: () => [],
};
