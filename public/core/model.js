// The event document: one JSON object per event holding everything the day needs (teams,
// fixtures, pitches, officials, the fight card, scorecards, updates). Shared by the Worker
// (authoritative), the dashboards (optimistic display) and the tests.
//
// Private data lives in the same document but never leaves the server for a fan: publicView()
// strips player names down to what the event allows, hides judges' scorecards until a bout is
// decided, and drops anything marked private.

export const SPORTS = ["football", "boxing"];
export const PHASES = ["pre", "live", "post"];
export const FORMATS = ["league", "groups-knockout", "knockout", "exhibition"];
export const STATES = ["scheduled", "live", "ft"];
export const BOUT_STATES = ["scheduled", "live", "break", "done"];
export const VOTE_BY = ["number", "name", "both"];
// The words an event uses: where games are played and what is scored. Futsal and dodgeball play
// on courts and score points or goals; a street series plays on a cage; boxing has a ring.
export const PLACES = ["pitch", "court", "cage", "ring", "arena"];
export const SCORES = ["goal", "point"];
export const OFFICIAL_ROLES = ["referee", "judge"];
export const METHODS = ["PTS", "KO", "TKO", "RSC", "RTD", "DQ", "DRAW", "NC"];
export const REASONS = ["style", "pressure", "defence", "power"];

export const HTTPS = /^https:\/\/[^\s"'<>]+$/;
export const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;
// Ids are used as object keys (scorecards, tallies), so the names JavaScript gives special
// meaning to are refused outright.
export const ID = /^(?!(?:__proto__|constructor|prototype)$)[A-Za-z0-9_-]{1,24}$/;
export const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const COLOUR = /^#[0-9a-fA-F]{6}$/;

const isScore = (n) => Number.isInteger(n) && n >= 0 && n <= 99;
const text = (v, max) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const optText = (v, max) => v == null || (typeof v === "string" && v.length <= max);
const optUrl = (v) => v == null || v === "" || (typeof v === "string" && HTTPS.test(v));

// ---- Time ----
export const toMins = (hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + m; };
export const fromMins = (mins) => { const m = ((Math.round(mins) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
export const addMins = (hhmm, n) => fromMins(toMins(hhmm) + n);

// ---- A blank event, filled in by the admin set-up ----
export function blankEvent({ slug, name, sport = "football", date = null } = {}) {
  return {
    v: 1,
    slug, name, sport, date, venue: "", timezone: "Europe/London",
    phase: "pre",
    about: "",
    theme: { accent: sport === "boxing" ? "#f7b613" : "#1abc9c", logo: null, partner: null },
    links: { tickets: null, clubhouse: "https://shotclubhouse.com/join/" },
    settings: { voteBy: "number", vote: { open: false }, lockSecs: 60, points: { win: 3, draw: 1, loss: 0 }, showCards: "after" },
    stream: { url: null, on: false, label: "" },
    pitches: sport === "football" ? [{ id: "P1", name: "Pitch 1", stream: { url: null, on: false, label: "" } }] : [],
    officials: [],
    divisions: sport === "football" ? [{ id: "main", name: "Main", format: "groups-knockout", teams: [] }] : [],
    fixtures: [],
    card: { bouts: [] },
    scorecards: {},
    updates: [],
  };
}

// ---- Validation: the shape every saved document must have ----
// Never throws: malformed data (a null in a list, a string where an object belongs) is an error
// message, not a crash.
export function validate(doc) {
  try { return check(doc); } catch (e) { return ["event: the data is malformed"]; }
}

function check(doc) {
  const errs = [];
  const d = doc;
  if (!d || typeof d !== "object") return ["event missing"];
  if (!text(d.name, 80)) errs.push("name: 1 to 80 characters");
  if (!SLUG.test(d.slug || "")) errs.push("slug: 3 to 48 lower-case letters, numbers and dashes");
  if (!SPORTS.includes(d.sport)) errs.push(`sport: one of ${SPORTS.join(", ")}`);
  if (!PHASES.includes(d.phase)) errs.push(`phase: one of ${PHASES.join(", ")}`);
  if (d.date != null && !DATE.test(d.date)) errs.push("date: YYYY-MM-DD");
  if (!optText(d.venue, 120)) errs.push("venue: 120 characters or fewer");
  if (!optText(d.about, 2000)) errs.push("about: 2000 characters or fewer");
  const th = d.theme || {};
  if (!COLOUR.test(th.accent || "")) errs.push("theme.accent: a #rrggbb colour");
  if (!optUrl(th.logo)) errs.push("theme.logo: an https link");
  if (!optText(th.partner, 60)) errs.push("theme.partner: 60 characters or fewer");
  const ln = d.links || {};
  if (!optUrl(ln.tickets)) errs.push("links.tickets: an https link");
  if (!optUrl(ln.clubhouse)) errs.push("links.clubhouse: an https link");
  const s = d.settings || {};
  if (!VOTE_BY.includes(s.voteBy)) errs.push(`settings.voteBy: one of ${VOTE_BY.join(", ")}`);
  if (!s.vote || typeof s.vote.open !== "boolean") errs.push("settings.vote.open: true or false");
  if (!Number.isInteger(s.lockSecs) || s.lockSecs < 0 || s.lockSecs > 600) errs.push("settings.lockSecs: 0 to 600");
  const pts = s.points || {};
  if (![pts.win, pts.draw, pts.loss].every((n) => Number.isInteger(n) && n >= 0 && n <= 10)) errs.push("settings.points: whole numbers 0 to 10");
  errs.push(...streamErrors(d.stream, "stream"));
  if (s.juniors != null && typeof s.juniors !== "boolean") errs.push("settings.juniors: true or false");
  if (s.terms != null) {
    const t = s.terms;
    if (typeof t !== "object" || Array.isArray(t)) errs.push("settings.terms: an object");
    else {
      if (t.place != null && !PLACES.includes(t.place)) errs.push(`settings.terms.place: one of ${PLACES.join(", ")}`);
      if (t.score != null && !SCORES.includes(t.score)) errs.push(`settings.terms.score: one of ${SCORES.join(", ")}`);
      if (!optText(t.discipline, 30)) errs.push("settings.terms.discipline: up to 30 characters");
    }
  }

  const pitchIds = new Set();
  (Array.isArray(d.pitches) ? d.pitches : errs.push("pitches missing") && []).forEach((p) => {
    if (!ID.test(p.id || "") || pitchIds.has(p.id)) errs.push(`pitch ${p.id}: missing or duplicate id`);
    if (!text(p.name, 40)) errs.push(`pitch ${p.id}: name 1 to 40 characters`);
    errs.push(...streamErrors(p.stream, `pitch ${p.id} stream`));
    pitchIds.add(p.id);
  });
  const offIds = new Set();
  (Array.isArray(d.officials) ? d.officials : errs.push("officials missing") && []).forEach((o) => {
    if (!ID.test(o.id || "") || offIds.has(o.id)) errs.push(`official ${o.id}: missing or duplicate id`);
    if (!text(o.name, 40)) errs.push(`official ${o.id}: name 1 to 40 characters`);
    if (!OFFICIAL_ROLES.includes(o.role)) errs.push(`official ${o.id}: role ${OFFICIAL_ROLES.join(" or ")}`);
    if (o.pitch != null && !pitchIds.has(o.pitch)) errs.push(`official ${o.id}: unknown pitch ${o.pitch}`);
    offIds.add(o.id);
  });

  const divs = Object.create(null);
  const teamIds = new Set();
  (Array.isArray(d.divisions) ? d.divisions : errs.push("divisions missing") && []).forEach((v) => {
    if (!ID.test(v.id || "") || divs[v.id]) errs.push(`division ${v.id}: missing or duplicate id`);
    if (!text(v.name, 40)) errs.push(`division ${v.id}: name 1 to 40 characters`);
    if (!FORMATS.includes(v.format)) errs.push(`division ${v.id}: format one of ${FORMATS.join(", ")}`);
    const ids = new Set();
    (Array.isArray(v.teams) ? v.teams : errs.push(`division ${v.id}: teams missing`) && []).forEach((t) => {
      if (!ID.test(t.id || "") || teamIds.has(t.id)) errs.push(`team ${t.id}: missing or duplicate id (team ids are unique across divisions)`);
      teamIds.add(t.id);
      if (!text(t.name, 40)) errs.push(`team ${t.id}: name 1 to 40 characters`);
      if (t.group != null && !(typeof t.group === "string" && /^[A-Za-z0-9]{1,4}$/.test(t.group))) errs.push(`team ${t.id}: group is 1 to 4 letters or numbers`);
      errs.push(...playerErrors(t.players, `team ${t.id}`));
      ids.add(t.id);
    });
    divs[v.id] = { ...v, ids };
  });

  const seen = new Set();
  (Array.isArray(d.fixtures) ? d.fixtures : errs.push("fixtures missing") && []).forEach((f) => {
    const at = `game ${f.id}`;
    if (!ID.test(f.id || "") || seen.has(f.id)) errs.push(`${at}: missing or duplicate id`);
    seen.add(f.id);
    const div = divs[f.division];
    if (!div) { errs.push(`${at}: unknown division ${f.division}`); return; }
    if (!TIME.test(f.time || "")) errs.push(`${at}: time must be HH:MM`);
    if (!STATES.includes(f.state)) errs.push(`${at}: state must be ${STATES.join(", ")}`);
    if (!text(f.home, 40) || !text(f.away, 40)) errs.push(`${at}: both sides needed`);
    else if (f.home === f.away) errs.push(`${at}: a team cannot play itself`);
    if (div.format !== "exhibition" && !f.stage && (!div.ids.has(f.home) || !div.ids.has(f.away))) errs.push(`${at}: group games use teams from ${div.name}`);
    if (f.stage != null && !text(f.stage, 30)) errs.push(`${at}: stage is a short name like Final`);
    if (f.pitch != null && !pitchIds.has(f.pitch)) errs.push(`${at}: unknown pitch ${f.pitch}`);
    if (f.ref != null && !offIds.has(f.ref)) errs.push(`${at}: unknown referee ${f.ref}`);
    const hasH = f.homeScore != null, hasA = f.awayScore != null;
    if (hasH !== hasA) errs.push(`${at}: both scores or neither`);
    if ((hasH && !isScore(f.homeScore)) || (hasA && !isScore(f.awayScore))) errs.push(`${at}: scores are whole numbers 0 to 99`);
    if (f.state === "ft" && !hasH) errs.push(`${at}: full time needs a score`);
    if (f.pens != null) {
      if (f.pens !== "home" && f.pens !== "away") errs.push(`${at}: penalty winner is home or away`);
      else if (!f.stage || f.state !== "ft" || f.homeScore !== f.awayScore) errs.push(`${at}: only a level knockout game at full time has a penalty winner`);
    }
  });

  const boutIds = new Set();
  const bouts = d.card && Array.isArray(d.card.bouts) ? d.card.bouts : (errs.push("card.bouts missing"), []);
  bouts.forEach((b) => {
    const at = `bout ${b.id}`;
    if (!ID.test(b.id || "") || boutIds.has(b.id)) errs.push(`${at}: missing or duplicate id`);
    boutIds.add(b.id);
    if (!Number.isInteger(b.order) || b.order < 1) errs.push(`${at}: order is a whole number from 1`);
    if (!Number.isInteger(b.rounds) || b.rounds < 1 || b.rounds > 12) errs.push(`${at}: 1 to 12 rounds`);
    if (!(typeof b.roundMins === "number" && b.roundMins > 0 && b.roundMins <= 5)) errs.push(`${at}: rounds of up to 5 minutes`);
    if (!["judges", "none"].includes(b.scoring)) errs.push(`${at}: scoring is judges or none`);
    if (!Array.isArray(b.judges) || b.judges.some((j) => !offIds.has(j))) errs.push(`${at}: judges must be officials`);
    ["red", "blue"].forEach((c) => { if (!b[c] || !text(b[c].name, 40) || !optText(b[c].club, 40)) errs.push(`${at}: ${c} corner needs a name`); });
    if (!BOUT_STATES.includes(b.state)) errs.push(`${at}: state one of ${BOUT_STATES.join(", ")}`);
    if (!Number.isInteger(b.round) || b.round < 0 || b.round > b.rounds) errs.push(`${at}: round 0 to ${b.rounds}`);
    if (b.result != null) {
      const r = b.result;
      if (!METHODS.includes(r.method)) errs.push(`${at}: result method one of ${METHODS.join(", ")}`);
      if (!["red", "blue", null].includes(r.winner ?? null)) errs.push(`${at}: winner is red, blue or none`);
      if ((r.method === "DRAW" || r.method === "NC") !== (r.winner == null)) errs.push(`${at}: only a draw or no contest has no winner`);
    }
  });
  const sc = d.scorecards || {};
  Object.entries(sc).forEach(([bout, byJudge]) => {
    if (!boutIds.has(bout)) errs.push(`scorecards: unknown bout ${bout}`);
    Object.entries(byJudge || {}).forEach(([judge, rounds]) => {
      if (!offIds.has(judge)) errs.push(`scorecards ${bout}: unknown judge ${judge}`);
      Object.entries(rounds || {}).forEach(([n, pair]) => {
        if (!Array.isArray(pair) || pair.length !== 2 || !mustScore(pair[0], pair[1])) errs.push(`scorecards ${bout} ${judge} round ${n}: 10-point must scores like 10-9`);
      });
    });
  });
  (Array.isArray(d.updates) ? d.updates : errs.push("updates missing") && []).forEach((u) => {
    if (!ID.test(u.id || "")) errs.push(`update ${u.id}: missing id`);
    if (!text(u.title, 120) || !optText(u.body, 2000) || !optUrl(u.link)) errs.push(`update ${u.id}: title up to 120, body up to 2000, link https`);
  });
  return errs;
}

// A round under the 10-point must system: the winner of the round gets 10, the loser 6 to 9;
// an even round is 10-10.
export const mustScore = (r, b) => Number.isInteger(r) && Number.isInteger(b) && Math.max(r, b) === 10 && Math.min(r, b) >= 6;

function streamErrors(st, at) {
  if (st == null) return [];
  if (typeof st !== "object") return [`${at}: must be an object`];
  const e = [];
  if (typeof st.on !== "boolean") e.push(`${at}: on must be true or false`);
  if (st.url != null && !(typeof st.url === "string" && HTTPS.test(st.url))) e.push(`${at}: link must start https://`);
  if (st.on === true && !st.url) e.push(`${at}: add a link before switching it on`);
  if (!optText(st.label, 80)) e.push(`${at}: label 80 characters or fewer`);
  return e;
}

function playerErrors(players, at) {
  if (players == null) return [];
  if (!Array.isArray(players) || players.length > 40) return [`${at}: up to 40 players`];
  const e = [], ids = new Set(), nums = new Set();
  players.forEach((p) => {
    if (!ID.test(p.id || "") || ids.has(p.id)) e.push(`${at}: player id missing or duplicate`);
    ids.add(p.id);
    if (p.number != null) {
      if (!Number.isInteger(p.number) || p.number < 0 || p.number > 999) e.push(`${at}: shirt numbers 0 to 999`);
      else if (nums.has(p.number)) e.push(`${at}: shirt number ${p.number} used twice`);
      nums.add(p.number);
    }
    if (!optText(p.name, 60)) e.push(`${at}: player name 60 characters or fewer`);
    if (p.number == null && !(typeof p.name === "string" && p.name.trim())) e.push(`${at}: each player needs a number or a name`);
  });
  return e;
}

// ---- What fans may see ----
// Names: "number" shows shirt numbers only, "name" first names only, "both" number and first
// name. Full names never leave the server. Scorecards stay hidden until the bout is done
// (settings.showCards "after") or always ("live"), or never ("never").
export const firstName = (full) => (typeof full === "string" ? full.trim().split(/\s+/)[0] || "" : "");

export function playerLabel(p, voteBy) {
  const num = p.number != null ? `#${p.number}` : "";
  const nm = firstName(p.name);
  if (voteBy === "number") return num || nm;
  if (voteBy === "name") return nm || num;
  return [num, nm].filter(Boolean).join(" ");
}

export function publicView(doc) {
  const d = JSON.parse(JSON.stringify(doc));
  const by = d.settings.voteBy;
  d.divisions.forEach((v) => v.teams.forEach((t) => {
    t.players = (t.players || []).map((p) => ({ id: p.id, label: playerLabel(p, by), number: by === "name" ? undefined : p.number ?? undefined }));
  }));
  d.officials = d.officials.map((o) => ({ id: o.id, name: firstName(o.name), role: o.role, pitch: o.pitch ?? null }));
  // Juniors: the public sees team names, and boxers by first name and club. No squads at all.
  if (d.settings.juniors) {
    d.divisions.forEach((v) => v.teams.forEach((t) => { t.players = []; }));
    d.card.bouts.forEach((b) => ["red", "blue"].forEach((c) => { if (b[c]) b[c] = { ...b[c], name: firstName(b[c].name) }; }));
  }
  const show = d.settings.showCards || "after";
  const done = new Set(d.card.bouts.filter((b) => b.state === "done").map((b) => b.id));
  Object.keys(d.scorecards || {}).forEach((bout) => { if (show === "never" || (show === "after" && !done.has(bout))) delete d.scorecards[bout]; });
  delete d.private;
  return d;
}

// ---- Live stream links (ported from London 26) ----
// YouTube and Twitch links become an embedded player; a direct video file or live feed (.mp4,
// .m3u8) plays in our own player; any other https link (a Veo match page) becomes a button,
// because Veo won't let other sites frame its pages.
export function streamInfo(s) {
  if (!s || s.on !== true || typeof s.url !== "string" || !HTTPS.test(s.url)) return null;
  let u;
  try { u = new URL(s.url); } catch (e) { return null; }
  const host = u.hostname.replace(/^(www|m)\./, "");
  const label = typeof s.label === "string" ? s.label : "";
  if (host === "youtube.com" || host === "youtu.be" || host === "youtube-nocookie.com") {
    const id = host === "youtu.be" ? u.pathname.slice(1) : u.searchParams.get("v") || (u.pathname.match(/^\/(?:live|embed|shorts)\/([^/?#]+)/) || [])[1];
    if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) return { kind: "youtube", id, url: s.url, host: "YouTube", label };
  }
  if (host === "twitch.tv") {
    const ch = (u.pathname.match(/^\/([A-Za-z0-9_]{3,25})\/?$/) || [])[1];
    if (ch && !["videos", "directory", "settings", "downloads", "p"].includes(ch.toLowerCase())) return { kind: "twitch", channel: ch.toLowerCase(), url: s.url, host: "Twitch", label };
  }
  const ext = (u.pathname.match(/\.(mp4|m4v|webm|mov|m3u8)$/i) || [])[1];
  if (ext) return { kind: "video", format: ext.toLowerCase() === "m3u8" ? "hls" : "file", url: s.url, host: /(^|\.)veo(cdn)?\.(co|com)$/.test(host) ? "Veo" : host, label };
  const names = { "veo.co": "Veo", "app.veo.co": "Veo", "veo.com": "Veo", "facebook.com": "Facebook", "fb.watch": "Facebook", "instagram.com": "Instagram" };
  return { kind: "link", url: s.url, host: names[host] || host, label };
}

// ---- Pre-registration consent ----
// The one sentence a fan agrees to. The fan page shows it and the Worker stores it with the
// registration, both from here, so what was shown and what was recorded can never differ.
// The organiser names themselves through theme.partner; otherwise the event name stands in.
export const consentText = (doc) => `${(doc.theme && doc.theme.partner) || doc.name} and SHOT Clubhouse can email me about ${doc.name}, future events and the clubhouse. I can unsubscribe at any time.`;

// ---- Words ----
// terms(doc).place is "pitch", .places "pitches", .Place "Pitch"; .score "goal", .Score "Goal",
// .diff the table's difference column. Older events have no terms and read as football.
export function terms(doc) {
  const t = (doc && doc.settings && doc.settings.terms) || {};
  const place = PLACES.includes(t.place) ? t.place : doc && doc.sport === "boxing" ? "ring" : "pitch";
  const score = SCORES.includes(t.score) ? t.score : "goal";
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  const places = place === "pitch" ? "pitches" : `${place}s`;
  return {
    place, places, Place: cap(place), Places: cap(places),
    score, scores: `${score}s`, Score: cap(score),
    diff: score === "goal" ? { abbr: "GD", title: "Goal difference" } : { abbr: "PD", title: "Points difference" },
    discipline: (typeof t.discipline === "string" && t.discipline.trim()) || "",
  };
}

// ---- Small helpers ----
export const teamOf = (doc, divisionId, teamId) => ((doc.divisions.find((v) => v.id === divisionId) || {}).teams || []).find((t) => t.id === teamId) || null;
export const newId = (prefix, taken) => { let i = 1; const set = new Set(taken); while (set.has(`${prefix}${i}`)) i++; return `${prefix}${i}`; };
