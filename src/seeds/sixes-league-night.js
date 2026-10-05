// Demo: a small-sided league night that has finished (the after and community view).

import { londonParts, addDays } from "../util.js";
import { champion, tables } from "../../public/core/standings.js";
import { footballDoc, check, withPrivate, between } from "./lib.js";

const slug = "sixes-league-night";

const longDate = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

export default {
  slug,
  kind: "football",
  sim: null,
  blurb: "A six-team league night that has finished. See the final table, the champions, the organiser's updates and the fans' player of the night.",
  codes: [
    { role: "admin", subject: null, label: "Organiser", code: "SXSAADMNV5W7" },
    { role: "referee", subject: "R1", label: "Referee", code: "SXSREFA2X6Y8" },
    { role: "coach", subject: "T1", label: "Coach, Corner Shop", code: "SXSCHAA3Z7B9" },
    { role: "coach", subject: "T2", label: "Coach, Sunday Legends", code: "SXSCHAB4C8D2" },
  ],
  build(now) {
    const date = addDays(londonParts(now).date, -3);
    const { doc, rand } = footballDoc({
      seed: 4303, slug, name: "Sixes League Night", date, venue: "Mill Lane Rec",
      about: "Six teams, one pitch, everyone plays everyone. Eight-minute games under the lights. Thanks to every team, referee and volunteer who made the night.",
      accent: "#f97316", phase: "post", voteBy: "name", voteOpen: false,
      pitches: ["Main pitch"], refs: ["Chris Ellison"],
      teams: ["Corner Shop", "Sunday Legends", "Mill Lane", "Late Tackles", "Five Alive", "Back Garden"],
      division: "League", format: "league",
      start: "18:30", gameMins: 8, gapMins: 2,
    });
    const base = Date.parse(`${date}T18:30:00Z`);
    const div0 = doc.divisions[0];
    doc.fixtures.forEach((f, i) => {
      f.homeScore = between(rand, 0, 3) + (rand() < 0.4 ? between(rand, 0, 2) : 0);
      f.awayScore = between(rand, 0, 3) + (rand() < 0.4 ? between(rand, 0, 2) : 0);
      f.state = "ft";
      f.goals = [["home", f.home, f.homeScore], ["away", f.away, f.awayScore]].flatMap(([side, id, n]) => Array.from({ length: n }, () => {
        const players = div0.teams.find((t) => t.id === id).players;
        return { side, team: id, player: rand() < 0.1 ? null : players[Math.floor(rand() * players.length)].id, min: between(rand, 1, 8) };
      })).sort((x, y) => x.min - y.min);
      f.ftAt = base + (i + 1) * 10 * 60000 - 120000;
    });
    const div = doc.divisions[0];
    const champ = champion(div, doc.fixtures, doc.settings.points);
    const winner = div.teams.find((t) => t.id === champ.id);
    const goals = doc.fixtures.reduce((s, f) => s + f.homeScore + f.awayScore, 0);
    const table = tables(div, doc.fixtures, doc.settings.points)[0].rows;
    const at = base + 4 * 60 * 60000;
    doc.updates = [
      { id: "U4", at: at + 3 * 24 * 60 * 60000, title: "Highlights", body: "Highlights from the night are on their way. They will be added to this page.", link: `https://events.shotclubhouse.com/e/${slug}/` },
      { id: "U3", at: at + 2 * 24 * 60 * 60000, title: "Next date announced", body: `The next league night is on ${longDate(addDays(date, 28))}. Same pitch, same kick-off. Register your interest to hear first.`, link: null },
      { id: "U2", at: at + 24 * 60 * 60000, title: `${winner.name} are champions`, body: `${winner.name} finished top of the table on ${table[0].pts} points. ${table[1].name} came second.`, link: null },
      { id: "U1", at, title: "Results recap", body: `${doc.fixtures.length} games and ${goals} goals. The final table is on this page, and the fans' player of the night is below.`, link: null },
    ];
    return withPrivate(check(doc), slug);
  },
  // Fan votes for a player-of-the-night leaderboard: a handful per game, leaning towards a few
  // standout players.
  votes(doc) {
    const div = doc.divisions[0];
    const rows = [];
    doc.fixtures.forEach((f, gi) => {
      const sides = [f.home, f.away].map((id) => div.teams.find((t) => t.id === id));
      const count = 5 + ((gi * 7) % 8);
      for (let k = 0; k < count; k++) {
        const team = sides[(gi + k) % 2];
        const players = team.players;
        const idx = Math.floor((((k * 37 + gi * 11) % 100) / 100) ** 2 * players.length);
        rows.push({ voter: `seed-voter-${String(k + 1).padStart(6, "0")}`, target: `g:${f.id}`, choice: `${team.id}.${players[idx].id}`, reason: null, ip_hash: "seed", at: f.ftAt - 60000 });
      }
    });
    return rows;
  },
};
