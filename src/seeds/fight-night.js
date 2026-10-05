// Demo: a white-collar fight night that is always live (src/sim.js runs the bouts).

import { blankEvent } from "../../public/core/model.js";
import { londonParts } from "../util.js";
import { rng, personNamer, pick, check, withPrivate, recipeOf } from "./lib.js";

const slug = "fight-night";

const CLUBS = ["Foundry BC", "Eastgate ABC", "Riverside BC", "Harbour Gym", "Northgate ABC", "Hilltop Boxing", "Ironside BC", "Kingsway ABC", "Millbank Gym", "Redbridge BC"];
const WEIGHTS = ["Light welterweight", "Welterweight", "Light middleweight", "Super lightweight", "Cruiserweight", "Lightweight"];

export default {
  slug,
  recipes: true,
  kind: "boxing",
  sim: "boxing",
  blurb: "A seven-bout card live all night. The timekeeper runs the rounds, three judges score on their own cards, and fans vote on every round with a reason.",
  codes: [
    { role: "admin", subject: null, label: "Organiser", code: "FGHTADMNE3F4" },
    { role: "judge", subject: "J1", label: "Judge 1", code: "FGHJUDA2H5J6" },
    { role: "judge", subject: "J2", label: "Judge 2", code: "FGHJUDB3K7M8" },
    { role: "judge", subject: "J3", label: "Judge 3", code: "FGHJUDC4N9P2" },
    { role: "referee", subject: "R1", label: "Referee and timekeeper", code: "FGHREFA5Q3R4" },
  ],
  build(now, recipe = {}) {
    const r = recipeOf("boxing", recipe);
    const rand = rng(4404);
    const namer = personNamer(rand);
    const doc = blankEvent({ slug, name: r.name || "Fight Night", sport: "boxing", date: londonParts(now).date });
    doc.venue = r.venue || "The Foundry Hall";
    doc.about = r.about || "Seven bouts of white-collar boxing, three two-minute rounds each and a five-round main event. Judges score every round on the ten-point must system, and fans vote for the round winner.";
    doc.settings.terms = r.terms || { discipline: "White-collar boxing" };
    doc.phase = "live";
    doc.theme.accent = "#f7b613";
    doc.settings.vote = { open: !r.juniors };
    doc.settings.lockSecs = 60;
    const JUDGES = ["Dana Whitcombe", "Ravi Menon", "Helen Brightwell", "Marcus Oduya", "Lena Fairweather"];
    const judgeIds = Array.from({ length: r.judges ?? 3 }, (_, i) => `J${i + 1}`);
    // Rings: one referee each, and the bouts shared out in turn. Without rings, one referee.
    const REFS = ["Sam Whitfield", "Joe Kirwan", "Ama Boateng", "Lewis Hart", "Nadia Price", "Owen Tate"];
    doc.pitches = (r.rings || []).map((name, i) => ({ id: `P${i + 1}`, name, stream: { url: null, on: false, label: "" } }));
    const refs = doc.pitches.length ? doc.pitches.map((p, i) => ({ id: `R${i + 1}`, name: REFS[i], role: "referee", pitch: p.id })) : [{ id: "R1", name: REFS[0], role: "referee", pitch: null }];
    doc.officials = [...judgeIds.map((id, i) => ({ id, name: JUDGES[i], role: "judge", pitch: null })), ...refs];
    if (doc.pitches.length) doc.settings.terms = { ...doc.settings.terms, place: "ring" };
    if (r.juniors) { doc.settings.juniors = true; doc.settings.vote = { open: false }; }
    const clubPool = r.clubs || CLUBS;
    // The card: the recipe's bouts, or seven white-collar bouts with an exhibition and a main event.
    const plan = r.bouts || ["Opening bout", "Bout 2", "Exhibition", "Bout 4", "Bout 5", "Co-main event", "Main event"].map((title, i, all) => ({ title, rounds: i === all.length - 1 ? 5 : 3, roundMins: 2, scoring: title === "Exhibition" ? "none" : "judges" }));
    doc.card.bouts = plan.map((b, i) => {
      const scored = (b.scoring || "judges") === "judges" && judgeIds.length > 0;
      const clubs = [pick(rand, clubPool), pick(rand, clubPool)];
      if (clubs[0] === clubs[1]) clubs[1] = clubPool[(clubPool.indexOf(clubs[0]) + 1) % clubPool.length];
      return {
        id: `B${i + 1}`, order: i + 1, title: String(b.title || `Bout ${i + 1}`).slice(0, 60), weight: String(b.weight || pick(rand, WEIGHTS)).slice(0, 40),
        rounds: b.rounds || 3, roundMins: b.roundMins || 2, scoring: scored ? "judges" : "none", judges: scored ? judgeIds : [],
        red: { name: namer(), club: clubs[0] }, blue: { name: namer(), club: clubs[1] },
        state: "scheduled", round: 0, result: null,
        ...(doc.pitches.length ? { pitch: doc.pitches[i % doc.pitches.length].id } : {}),
      };
    });
    return withPrivate(check(doc), slug);
  },
  votes: () => [],
};
