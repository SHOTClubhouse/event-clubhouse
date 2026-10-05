// The clubhouse preview every demo carries (docs/CLUBHOUSE.md): membership without prices, the
// culture and music around the event, the community after it, and rewards for turning up.
// Everything is invented. A recipe's `clubhouse` replaces any part of it.

import { addDays } from "../util.js";

// A public Spotify editorial playlist, so the player has something to play in every demo.
export const DEMO_PLAYLIST = "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M";

const TIERS = [
  { id: "M1", name: "Member", benefits: ["Early access to tickets", "Your member card for every event", "Results, highlights and photos after the day", "A vote in what happens next"], price: null },
  { id: "M2", name: "Founding member", benefits: ["Everything in Member", "Founding patch for your kit", "First pick of new merch drops", "Your name on the founders' wall"], price: null },
];

const BY_KIND = {
  football: {
    intro: "The game is one day. The clubhouse is all year: your team, your crew, the music, and the next one.",
    lineup: [{ time: null, name: "DJ Northside", role: "DJ" }, { time: null, name: "MC Kofi", role: "MC" }, { time: null, name: "The Halftime Set", role: "Live" }],
    drops: [{ id: "K1", title: "Matchday shirt", body: "The shirt from the day, for members first.", when: "Out now" }, { id: "K2", title: "Highlights reel", body: "Every goal from the final, cut to the playlist.", when: "This week" }],
    posts: [{ id: "W1", who: "Sandstorm", text: "Same time next month. We want the trophy back.", kind: "shoutout", ago: "2h" }, { id: "W2", who: "Organiser", text: "Photos from the day are up. Tag your team.", kind: "photo", ago: "5h" }, { id: "W3", who: "Maya", text: "That final was something else.", kind: "post", ago: "1d", person: true }],
  },
  boxing: {
    intro: "Fight night is one night. The clubhouse is where the gym, the fighters and the fans stay together until the next card.",
    lineup: [{ time: null, name: "DJ Ringside", role: "DJ" }, { time: null, name: "Ama Boateng", role: "Host" }, { time: null, name: "Walkout live band", role: "Live" }],
    drops: [{ id: "K1", title: "Fight night tee", body: "The card on the back, members first.", when: "Out now" }, { id: "K2", title: "Main event replay", body: "Every round, with the judges' cards.", when: "Tomorrow" }],
    posts: [{ id: "W1", who: "Foundry BC", text: "Proud of every one of ours tonight. Back in the gym Monday.", kind: "shoutout", ago: "3h" }, { id: "W2", who: "Organiser", text: "Next card announced. Members get tickets first.", kind: "post", ago: "6h" }, { id: "W3", who: "Theo", text: "Round three of the main event. Unreal.", kind: "post", ago: "1d", person: true }],
  },
  fitness: {
    intro: "Race day is one day. The clubhouse is your training crew, your times, the music that got you round, and the next start line.",
    lineup: [{ time: null, name: "DJ Pacemaker", role: "DJ" }, { time: null, name: "The Pace Crew", role: "Host" }],
    drops: [{ id: "K1", title: "Finisher patch", body: "For everyone who crossed the line.", when: "Out now" }, { id: "K2", title: "Your splits, explained", body: "Where you gained and where you lost time.", when: "This week" }],
    posts: [{ id: "W1", who: "Harbour Run Club", text: "Twelve of us raced. Twelve of us finished.", kind: "shoutout", ago: "4h" }, { id: "W2", who: "Organiser", text: "Results are final. Find yours by bib.", kind: "post", ago: "8h" }, { id: "W3", who: "Priya", text: "Wall balls nearly finished me. Booked the next one.", kind: "post", ago: "1d", person: true }],
  },
};

const REWARDS = [
  { id: "B1", name: "Founding fan", how: "register", text: "Registered before the day" },
  { id: "B2", name: "There on the day", how: "attend", text: "Opened the event while it was live" },
  { id: "B3", name: "Voice of the crowd", how: "vote", text: "Cast your first vote" },
  { id: "B4", name: "Three in a row", how: "streak", text: "Came to three events" },
  { id: "B5", name: "Brought a friend", how: "share", text: "A friend joined from your link" },
];

export function demoClubhouse(kind, doc, recipe = null) {
  const k = BY_KIND[kind] || BY_KIND.football;
  const base = {
    on: true,
    intro: k.intro,
    members: 0,
    tiers: TIERS.map((t) => ({ ...t, benefits: [...t.benefits] })),
    culture: { playlist: DEMO_PLAYLIST, lineup: k.lineup.map((x) => ({ ...x })), drops: k.drops.map((x) => ({ ...x })) },
    community: {
      // a juniors event shows only teams and the organiser, never a young person's name
      posts: k.posts.filter((p) => !(doc.settings && doc.settings.juniors && p.person)).map(({ person, ...x }) => x),
      next: doc.date ? [{ date: addDays(doc.date, 28), title: `${doc.name}: the next one`, where: doc.venue || "To be announced" }] : [],
    },
    rewards: REWARDS.map((r) => ({ ...r })),
  };
  if (!recipe || typeof recipe !== "object") return base;
  const out = { ...base, ...recipe };
  if (recipe.culture) out.culture = { ...base.culture, ...recipe.culture };
  if (recipe.community) out.community = { ...base.community, ...recipe.community };
  return out;
}
