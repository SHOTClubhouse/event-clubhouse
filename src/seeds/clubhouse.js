// The clubhouse preview every demo carries (docs/CLUBHOUSE.md): membership without prices, the
// culture and music around the event, the community after it, and rewards for turning up.
// Everything is invented. A recipe's `clubhouse` replaces any part of it.

import { addDays } from "../util.js";

// Public Spotify playlists, each checked with Spotify's oEmbed endpoint on 5 Oct 2026.
// Football: "Shoot Football Stadium Anthems" (a long matchday and stadium anthems list).
export const DEMO_PLAYLIST = "https://open.spotify.com/playlist/7f1vgmJBpr1s7IdkmFDbB6";
// Boxing and fitness: "Best of Drum And Bass" (Sub Focus, Chase & Status, Wilkinson and more).
export const DNB_PLAYLIST = "https://open.spotify.com/playlist/1MVy9yTWOtiKg5OZBqNWuD";

const TIERS = [
  { id: "M1", name: "Member", benefits: ["Early access to tickets", "Your member card for every event", "Results, highlights and photos after the day", "A vote in what happens next"], price: null },
  { id: "M2", name: "Founding member", benefits: ["Everything in Member", "Founding patch for your kit", "First pick of new merch drops", "Your name on the founders' wall"], price: null },
];

const BY_KIND = {
  football: {
    intro: "The game is one day. The clubhouse is all year: your team, your crew, the music, and the next one.",
    playlist: DEMO_PLAYLIST,
    lineup: [
      { time: "12:30", name: "DJ Northside, drum and bass set", role: "DJ" },
      { time: "14:15", name: "Special guest: a former international, name to be announced", role: "Guest" },
      { time: "15:00", name: "The Halftime Show", role: "Live" },
      { time: "16:45", name: "MC Kofi, trophy presentation", role: "MC" },
    ],
    drops: [
      { id: "K1", title: "Members only: dressing-room cam", body: "Behind the scenes with the winners after the final.", when: "Members first", exclusive: true },
      { id: "K2", title: "Exclusive: the walkout mix", body: "The tracks the teams walked out to, mixed in one set.", when: "This week", exclusive: true },
      { id: "K3", title: "Matchday shirt, members first", body: "The shirt from the day, before it goes on general sale.", when: "Out now", exclusive: true },
      { id: "K4", title: "Highlights reel", body: "Every goal from the final, cut to the playlist.", when: "This week" },
    ],
    posts: [{ id: "W1", who: "Sandstorm", text: "Same time next month. We want the trophy back.", kind: "shoutout", ago: "2h" }, { id: "W2", who: "Organiser", text: "Photos from the day are up. Tag your team.", kind: "photo", ago: "5h" }, { id: "W3", who: "Maya", text: "That final was something else.", kind: "post", ago: "1d", person: true }],
  },
  boxing: {
    intro: "Fight night is one night. The clubhouse is where the gym, the fighters and the fans stay together until the next card.",
    playlist: DNB_PLAYLIST,
    lineup: [
      { time: "18:00", name: "DJ Ringside, drum and bass set", role: "DJ" },
      { time: "20:30", name: "Special guest: a former champion, name to be announced", role: "Guest" },
      { time: "21:00", name: "Ama Boateng, ring host", role: "Host" },
      { time: "22:00", name: "Walkout live band", role: "Live" },
    ],
    drops: [
      { id: "K1", title: "Members only: corner cam", body: "The between-rounds talk from the main event corner.", when: "Members first", exclusive: true },
      { id: "K2", title: "Exclusive: the walkout mix", body: "Every fighter's walkout track in one mix.", when: "Tomorrow", exclusive: true },
      { id: "K3", title: "Fight night tee, members first", body: "The card on the back, before general sale.", when: "Out now", exclusive: true },
      { id: "K4", title: "Main event replay", body: "Every round, with the judges' cards.", when: "Tomorrow" },
    ],
    posts: [{ id: "W1", who: "Foundry BC", text: "Proud of every one of ours tonight. Back in the gym Monday.", kind: "shoutout", ago: "3h" }, { id: "W2", who: "Organiser", text: "Next card announced. Members get tickets first.", kind: "post", ago: "6h" }, { id: "W3", who: "Theo", text: "Round three of the main event. Unreal.", kind: "post", ago: "1d", person: true }],
  },
  fitness: {
    intro: "Race day is one day. The clubhouse is your training crew, your times, the music that got you round, and the next start line.",
    playlist: DNB_PLAYLIST,
    lineup: [
      { time: "08:00", name: "DJ Pacemaker, warm-up set", role: "DJ" },
      { time: "09:00", name: "Special guest: a former Olympian, name to be announced", role: "Guest" },
      { time: "09:30", name: "The Pace Crew, race briefing", role: "Host" },
      { time: "12:00", name: "Finish line live set", role: "Live" },
    ],
    drops: [
      { id: "K1", title: "Members only: course fly-through", body: "The whole course from above, with the split points marked.", when: "Members first", exclusive: true },
      { id: "K2", title: "Exclusive: the finish-line mix", body: "The set that played as you crossed the line.", when: "This week", exclusive: true },
      { id: "K3", title: "Finisher patch, members first", body: "For everyone who crossed the line, before it goes on sale.", when: "Out now", exclusive: true },
      { id: "K4", title: "Your splits, explained", body: "Where you gained and where you lost time.", when: "This week" },
    ],
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
    culture: { playlist: k.playlist || DEMO_PLAYLIST, lineup: k.lineup.map((x) => ({ ...x })), drops: k.drops.map((x) => ({ ...x })) },
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
