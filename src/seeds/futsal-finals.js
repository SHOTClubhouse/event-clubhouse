// Demo: a futsal finals day two weeks away (the pre-registration and schedule view).

import { londonParts, addDays } from "../util.js";
import { footballDoc, check, withPrivate } from "./lib.js";

const slug = "futsal-finals";

export default {
  slug,
  sim: null,
  blurb: "Twelve teams, three pitches and a day of futsal two weeks away. See the schedule and the groups, and try pre-registration as a fan.",
  codes: [
    { role: "admin", subject: null, label: "Organiser", code: "FUTSADMNY4P6" },
    { role: "referee", subject: "R1", label: "Referee, Court 1", code: "FUTREFA2G7HC" },
    { role: "referee", subject: "R2", label: "Referee, Court 2", code: "FUTREFB3J8KD" },
    { role: "referee", subject: "R3", label: "Referee, Court 3", code: "FUTREFC4M9NE" },
    { role: "coach", subject: "T1", label: "Coach, Hardwood", code: "FUTCHAA5Q2RF" },
    { role: "coach", subject: "T2", label: "Coach, Parquet", code: "FUTCHAB6S3TG" },
  ],
  build(now) {
    const { doc } = footballDoc({
      seed: 4202, slug, name: "Futsal Finals", date: addDays(londonParts(now).date, 14), venue: "Northgate Sports Hall",
      about: "Twelve teams in four groups of three, then quarter-finals, semi-finals and the final, all in one day on three courts. Register your interest to get the line-ups and any changes first.",
      accent: "#8b5cf6", phase: "pre", voteBy: "both", voteOpen: false,
      pitches: ["Court 1", "Court 2", "Court 3"], refs: ["Alex Moran", "Priti Desai", "Tom Larkin"],
      teams: ["Hardwood", "Parquet", "Redline", "Nightshift", "Northside", "Quickstep", "Backline", "Skyline", "Tempo", "Ironworks", "Harbour", "Rapids"],
      division: "Finals", format: "groups-knockout", groups: 4, advance: 2, thirdPlace: false,
      start: "10:00", gameMins: 12, gapMins: 2,
    });
    doc.links.tickets = null;
    return withPrivate(check(doc), slug);
  },
  votes: () => [],
};
