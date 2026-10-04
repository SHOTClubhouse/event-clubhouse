// Demo: a white-collar fight night that is always live (src/sim.js runs the bouts).

import { blankEvent } from "../../public/core/model.js";
import { londonParts } from "../util.js";
import { rng, personNamer, pick, check, withPrivate } from "./lib.js";

const slug = "fight-night";

const CLUBS = ["Foundry BC", "Eastgate ABC", "Riverside BC", "Harbour Gym", "Northgate ABC", "Hilltop Boxing", "Ironside BC", "Kingsway ABC", "Millbank Gym", "Redbridge BC"];
const WEIGHTS = ["Light welterweight", "Welterweight", "Light middleweight", "Super lightweight", "Cruiserweight", "Lightweight"];

export default {
  slug,
  sim: "boxing",
  blurb: "A seven-bout card live all night. The timekeeper runs the rounds, three judges score on their own cards, and fans vote on every round with a reason.",
  codes: [
    { role: "admin", subject: null, label: "Organiser", code: "FGHTADMNE3F4" },
    { role: "judge", subject: "J1", label: "Judge 1", code: "FGHJUDA2H5J6" },
    { role: "judge", subject: "J2", label: "Judge 2", code: "FGHJUDB3K7M8" },
    { role: "judge", subject: "J3", label: "Judge 3", code: "FGHJUDC4N9P2" },
    { role: "referee", subject: "R1", label: "Referee and timekeeper", code: "FGHREFA5Q3R4" },
  ],
  build(now) {
    const rand = rng(4404);
    const namer = personNamer(rand);
    const doc = blankEvent({ slug, name: "Fight Night", sport: "boxing", date: londonParts(now).date });
    doc.venue = "The Foundry Hall";
    doc.about = "Seven bouts of white-collar boxing, three two-minute rounds each and a five-round main event. Judges score every round on the ten-point must system, and fans vote for the round winner.";
    doc.phase = "live";
    doc.theme.accent = "#f7b613";
    doc.settings.vote = { open: true };
    doc.settings.lockSecs = 60;
    doc.officials = [
      { id: "J1", name: "Dana Whitcombe", role: "judge", pitch: null },
      { id: "J2", name: "Ravi Menon", role: "judge", pitch: null },
      { id: "J3", name: "Helen Brightwell", role: "judge", pitch: null },
      { id: "R1", name: "Sam Whitfield", role: "referee", pitch: null },
    ];
    const titles = ["Opening bout", "Bout 2", "Exhibition", "Bout 4", "Bout 5", "Co-main event", "Main event"];
    doc.card.bouts = titles.map((title, i) => {
      const main = i === titles.length - 1;
      const exhibition = title === "Exhibition";
      const clubs = [pick(rand, CLUBS), pick(rand, CLUBS)];
      if (clubs[0] === clubs[1]) clubs[1] = CLUBS[(CLUBS.indexOf(clubs[0]) + 1) % CLUBS.length];
      return {
        id: `B${i + 1}`, order: i + 1, title, weight: pick(rand, WEIGHTS),
        rounds: main ? 5 : 3, roundMins: 2, scoring: exhibition ? "none" : "judges", judges: exhibition ? [] : ["J1", "J2", "J3"],
        red: { name: namer(), club: clubs[0] }, blue: { name: namer(), club: clubs[1] },
        state: "scheduled", round: 0, result: null,
      };
    });
    return withPrivate(check(doc), slug);
  },
  votes: () => [],
};
