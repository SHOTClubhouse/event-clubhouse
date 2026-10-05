// Fan app views: pure functions from state to HTML. No DOM access, no network. Everything
// that came from the event goes through esc().

import { esc, side, pitchName, plural, stageText } from "/js/ui.js";
import { tables, champion, winnerOf } from "/core/standings.js";
import { currentBout, ringsNow, resultText, decision } from "/core/boxing.js";

// ---- Small helpers ----
export const fmtDate = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "");
export function daysTo(d) {
  if (!d) return null;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((new Date(`${d}T00:00:00`) - t) / 864e5);
}
export const byTime = (a, b) => String(a.time).localeCompare(String(b.time)) || String(a.pitch).localeCompare(String(b.pitch)) || String(a.id).localeCompare(String(b.id));
const divOf = (ev, id) => ev.divisions.find((d) => d.id === id) || null;
const teamOf = (ev, divId, teamId) => ((divOf(ev, divId) || { teams: [] }).teams.find((t) => t.id === teamId)) || null;
export const allTeams = (ev) => ev.divisions.flatMap((d) => d.teams.map((t) => ({ ...t, division: d.id, divisionName: d.name })));
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
export const isFootball = (ev) => ev.sport === "football";
export const isJuniors = (ev) => !!(ev.settings && ev.settings.juniors);
// The sentence that stands where a vote would be, on a youth event.
export const youthLine = (ev) => `Youth event: no fan voting, ${isFootball(ev) ? "team names only" : "first names and clubs only"}.`;
const youthNote = (ev) => (isJuniors(ev) ? `<p class="ece-youth" data-youth>${esc(youthLine(ev))}</p>` : "");
// Boxing with more than one ring: the ring a bout is in (a bout with no ring is in the first).
export const hasRings = (ev) => ev.sport === "boxing" && (ev.pitches || []).length > 1;
export const ringName = (ev, b) => (hasRings(ev) ? pitchName(ev, b.pitch || ev.pitches[0].id) : "");
const hasKnockouts = (ev) => ev.fixtures.some((f) => f.stage);
const hasTables = (ev) => ev.fixtures.some((f) => !f.stage) && ev.divisions.some((d) => d.format !== "exhibition" && d.format !== "knockout");
const hasGroups = (ev) => ev.divisions.some((d) => d.teams.some((t) => t.group));

const empty = (title, body = "") => `<div class="ece-empty"><b>${esc(title)}</b>${body ? `<span>${esc(body)}</span>` : ""}</div>`;

// ---- Which sections apply ----
export function tabsFor(ev, votes) {
  const f = isFootball(ev);
  const voteShown = ev.phase === "live" && !isJuniors(ev) && (ev.settings.vote.open || (votes && votes.total > 0));
  const club = !!(ev.clubhouse && ev.clubhouse.on === true);
  const t = [];
  if (ev.phase === "pre") {
    t.push(["home", "Home"]);
    if (club) t.push(["clubhouse", "Clubhouse"]);
    if (f) { if (allTeams(ev).length) t.push(["teams", "Teams"]); if (ev.fixtures.length) t.push(["schedule", "Schedule"]); if (hasGroups(ev)) t.push(["groups", "Groups"]); }
    else if (ev.card.bouts.length) t.push(["card", "Fight card"]);
  } else if (ev.phase === "live") {
    t.push(["now", "Now"]);
    if (voteShown) t.push(["vote", "Vote"]);
    if (f) {
      t.push(["schedule", "Schedule"]);
      if (hasTables(ev)) t.push(["tables", "Tables"]);
      if (hasKnockouts(ev)) t.push(["knockouts", "Knockouts"]);
      t.push(["results", "Results"]);
    } else t.push(["card", "Fight card"]);
    if (club) t.push(["clubhouse", "Clubhouse"]);
  } else {
    t.push(["wrap", "The day"]);
    if (club) t.push(["clubhouse", "Clubhouse"]);
    if (f) { t.push(["results", "Results"]); if (hasTables(ev)) t.push(["tables", "Tables"]); if (hasKnockouts(ev)) t.push(["knockouts", "Knockouts"]); }
    else t.push(["card", "Fight card"]);
  }
  return t;
}
export const defaultTab = (ev) => (ev.phase === "pre" ? "home" : ev.phase === "live" ? "now" : "wrap");

// ---- Header ----
export function headerHtml(ev) {
  const th = ev.theme || {};
  const lock = [
    th.logo ? `<img class="ece-logo" src="${esc(th.logo)}" alt="${esc(th.partner || ev.name)} logo" height="36">` : "",
    th.partner ? `${th.logo ? "" : `<span class="ece-lock__name">${esc(th.partner)}</span>`}<span class="ece-lock__x" aria-hidden="true">&times;</span><span class="ece-sr">and</span>` : "",
    `<img class="ece-lock__shot" src="/assets/brand/shot-logo.png" alt="SHOT" height="26">`,
  ].join("");
  const live = ev.phase === "live" ? `<span class="ec-badge ec-badge--live ece-live">Live</span>` : ev.phase === "post" ? `<span class="ec-badge ece-phase">Full time</span>` : `<span class="ec-badge ece-phase">Coming up</span>`;
  return `<div class="ece-wrap ece-head__in">
    <div class="ece-toprow"><div class="ece-lock">${lock}</div><button type="button" class="ece-share" data-share aria-label="Share this event"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v14"/></svg>Share</button></div>
    <h1 class="ece-title">${esc(ev.name)}</h1>
    <p class="ece-meta">${live}${ev.date ? `<span>${esc(fmtDate(ev.date))}</span>` : ""}${ev.venue ? `<span>${esc(ev.venue)}</span>` : ""}${terms(ev).discipline ? `<span class="ece-disc">${esc(terms(ev).discipline)}</span>` : ""}</p>
    <p class="ece-fresh" id="fresh"></p>
  </div>`;
}

// ---- A game ----
function groupOf(ev, f) {
  const t = teamOf(ev, f.division, f.home);
  return t && t.group ? `Group ${t.group}` : "";
}
function scoreHtml(f) {
  if (f.homeScore == null) return `<span class="ece-sc__t">${esc(f.time)}</span>`;
  return `${esc(f.homeScore)}<i>-</i>${esc(f.awayScore)}`;
}
const stateBadge = (f) => (f.state === "live" ? `<span class="ec-badge ec-badge--live">Live</span>` : f.state === "ft" ? `<span class="ec-badge ec-badge--ft">FT</span>` : "");

export function gameCard(ev, f, S, o = {}) {
  const h = side(ev, f, "home"), a = side(ev, f, "away");
  const mine = S.follow && (h.id === S.follow || a.id === S.follow);
  const w = f.state === "ft" ? winnerOf(f) : null;
  const meta = [
    stateBadge(f),
    f.homeScore != null || f.state !== "scheduled" ? `<span>${esc(f.time)}</span>` : "",
    f.stage ? `<b>${esc(stageText(f.stage))}</b>` : groupOf(ev, f) ? `<span>${esc(groupOf(ev, f))}</span>` : "",
    o.pitch !== false && f.pitch && ev.pitches.length > 1 ? `<span>${esc(pitchName(ev, f.pitch))}</span>` : "",
    o.division && ev.divisions.length > 1 ? `<span>${esc((divOf(ev, f.division) || {}).name || "")}</span>` : "",
    f.pens ? `<span>Won on pens</span>` : "",
    mine ? `<span class="ece-tag">Your team</span>` : "",
  ].filter(Boolean).join("");
  const cls = (s, k) => `ece-t ece-t--${k}${s.tbc ? " is-tbc" : ""}${w === (k === "h" ? "home" : "away") ? " is-won" : ""}`;
  const label = f.homeScore != null ? `${h.text} ${f.homeScore}, ${a.text} ${f.awayScore}${f.state === "live" ? ", live" : f.state === "ft" ? ", full time" : ""}` : `${h.text} v ${a.text} at ${f.time}`;
  return `<article class="ece-game ece-game--${esc(f.state)}${o.big ? " ece-game--big" : ""}${mine ? " is-mine" : ""}" data-fx="${esc(f.id)}" aria-label="${esc(label)}">
    <div class="ece-game__meta">${meta}</div>
    <div class="ece-game__row"><span class="${cls(h, "h")}">${esc(h.text)}</span><span class="ece-sc${f.homeScore == null ? " is-time" : ""}" data-score="${esc(f.id)}">${scoreHtml(f)}</span><span class="${cls(a, "a")}">${esc(a.text)}</span></div>
  </article>`;
}

// ---- NOW (football) ----
export function nowFootball(S) {
  const ev = S.event, fx = ev.fixtures, T = terms(ev);
  if (!fx.length) return youthNote(ev) + empty("Fixtures to follow", "The schedule will appear here as soon as the organiser publishes it.");
  const out = [youthNote(ev)];
  const mine = S.follow ? fx.filter((f) => f.state !== "ft" && [side(ev, f, "home").id, side(ev, f, "away").id].includes(S.follow)).sort((a, b) => (b.state === "live") - (a.state === "live") || byTime(a, b))[0] : null;
  if (mine) out.push(`<section class="ece-sec" aria-labelledby="h-mine"><h2 id="h-mine" class="ece-h">Your team</h2>${gameCard(ev, mine, S, { big: true })}</section>`);
  const groups = ev.pitches.map((p) => ({ id: p.id, name: p.name }));
  if (fx.some((f) => !f.pitch || !ev.pitches.some((p) => p.id === f.pitch))) groups.push({ id: null, name: ev.pitches.length ? "Other games" : "Games" });
  const inGroup = (g) => (f) => (g.id ? f.pitch === g.id : !f.pitch || !ev.pitches.some((p) => p.id === f.pitch));
  const anyLive = fx.some((f) => f.state === "live");
  groups.forEach((g) => {
    const mineG = inGroup(g);
    const live = fx.filter((f) => f.state === "live" && mineG(f)).sort(byTime);
    const next = fx.filter((f) => f.state === "scheduled" && mineG(f)).sort(byTime).slice(0, live.length ? 2 : 3);
    if (!live.length && !next.length) return;
    out.push(`<section class="ece-sec" aria-labelledby="h-${esc(g.id || "x")}"><h2 id="h-${esc(g.id || "x")}" class="ece-h">${esc(g.name)}${live.length ? ` <span class="ece-h__n">${live.length} live</span>` : ""}</h2>
      ${live.map((f) => gameCard(ev, f, S, { big: true, pitch: false })).join("")}
      ${live.length ? "" : `<p class="ece-note">Between games on this ${T.place}.</p>`}
      ${next.length ? `<h3 class="ece-h3">Up next</h3>${next.map((f) => gameCard(ev, f, S, { pitch: false })).join("")}` : ""}</section>`);
  });
  if (!anyLive && out.length === (mine ? 2 : 1)) out.push(empty("No games on right now", "Check the schedule for what is next."));
  const done = fx.filter((f) => f.state === "ft").sort((a, b) => (b.ftAt || 0) - (a.ftAt || 0) || byTime(b, a)).slice(0, 4);
  if (done.length) out.push(`<section class="ece-sec" aria-labelledby="h-done"><h2 id="h-done" class="ece-h">Just finished</h2>${done.map((f) => gameCard(ev, f, S)).join("")}<button type="button" class="ec-btn ec-btn--ghost ec-btn--block ece-more" data-go="results">All results</button></section>`);
  return out.join("");
}

// ---- NOW (boxing) ----
function corners(b, o = {}) {
  const win = b.result && b.result.winner;
  const c = (k) => `<div class="ece-fighter ece-fighter--${k}${win === k ? " is-won" : ""}"><small>${k === "red" ? "Red corner" : "Blue corner"}${win === k ? " &middot; Winner" : ""}</small><b>${esc(b[k].name)}</b>${b[k].club ? `<span>${esc(b[k].club)}</span>` : ""}</div>`;
  return `<div class="ece-vs${o.big ? " ece-vs--big" : ""}">${c("red")}<span class="ece-vs__v" aria-hidden="true">v</span>${c("blue")}</div>`;
}
const boutState = (b) => (b.state === "live" ? `<span class="ec-badge ec-badge--live">Live</span>` : b.state === "break" ? `<span class="ec-badge ece-badge--break">Break</span>` : b.state === "done" ? `<span class="ec-badge ec-badge--ft">Done</span>` : `<span class="ec-badge">Up next</span>`);

export function splitBar(r, labels = {}) {
  const t = (r.red || 0) + (r.blue || 0);
  const rp = t ? Math.round((r.red / t) * 100) : 50;
  return `<div class="ece-split" role="img" aria-label="${esc(`${labels.red || "Red"} ${t ? rp : 0} per cent, ${labels.blue || "Blue"} ${t ? 100 - rp : 0} per cent, ${t} votes`)}"><span class="ece-split__r" style="--w:${t ? rp : 50}%"></span><span class="ece-split__b"></span><em>${t ? `${rp}%` : "No votes yet"}</em><em>${t ? `${100 - rp}%` : ""}</em></div>`;
}

function mainBout(S, b, ring = "") {
  const ev = S.event, rounds = (S.votes && S.votes.rounds) || [];
  const live = b.state === "live" || b.state === "break";
  const cur = rounds.find((r) => r.bout === b.id && r.round === b.round);
  const open = S.votes && S.votes.now && S.votes.now.some((t) => t.bout === b.id);
  return `<article class="ece-main-bout${live ? " is-live" : ""}"${ring ? ` data-ring="${esc(ring)}"` : ""}>
    ${ring ? `<h2 class="ece-ringname">${esc(ring)}</h2>` : ""}
    <div class="ece-main-bout__top">${boutState(b)}<span>Bout ${esc(b.order)} of ${ev.card.bouts.length}</span>${b.title ? `<b>${esc(b.title)}</b>` : ""}</div>
    ${live ? `<p class="ece-round">Round <b>${esc(b.round)}</b> of ${esc(b.rounds)}${b.state === "break" ? " &middot; between rounds" : ""}</p>` : `<p class="ece-round">${esc(b.rounds)} rounds${b.weight ? ` &middot; ${esc(b.weight)}` : ""}</p>`}
    ${corners(b, { big: true })}
    ${live && cur ? `<div class="ece-fans"><h3 class="ece-h3">Fans, round ${esc(b.round)}</h3>${splitBar(cur, { red: b.red.name, blue: b.blue.name })}</div>` : ""}
    ${open ? `<button type="button" class="ec-btn ec-btn--gold ec-btn--block ec-btn--big" data-go="vote">Vote for the round${ring ? `<span class="ece-sr"> in ${esc(ring)}</span>` : ""}</button>` : ""}
  </article>`;
}

export function nowBoxing(S) {
  const ev = S.event;
  const rings = hasRings(ev) ? ringsNow(ev) : [{ ring: null, bout: currentBout(ev.card) }];
  const first = rings[0] && rings[0].bout;
  if (!first) return empty("Fight card to follow", "Bouts will appear here once the card is published.");
  const showing = new Set(rings.map((r) => r.bout.id));
  const upcoming = [...ev.card.bouts].sort((x, y) => x.order - y.order).filter((x) => x.state === "scheduled" && !showing.has(x.id)).slice(0, 3);
  const done = ev.card.bouts.filter((x) => x.state === "done").length;
  const many = rings.length > 1;
  const main = many
    ? `<div class="ece-rings">${rings.map((r) => `<section class="ece-ring" aria-label="${esc(pitchName(ev, r.ring))}">${mainBout(S, r.bout, pitchName(ev, r.ring))}</section>`).join("")}</div>`
    : mainBout(S, first, hasRings(ev) ? pitchName(ev, rings[0].ring) : "");
  return `<section class="ece-sec">${youthNote(ev)}${main}</section>
  ${upcoming.length ? `<section class="ece-sec" aria-labelledby="h-up"><h2 id="h-up" class="ece-h">Up next</h2>${upcoming.map((x) => boutCard(x, S, { compact: true })).join("")}</section>` : ""}
  <button type="button" class="ec-btn ec-btn--ghost ec-btn--block ece-more" data-go="card">Full fight card${done ? ` (${plural(done, "result")})` : ""}</button>`;
}

// ---- Fight card ----
export function boutCard(b, S, o = {}) {
  const ev = S.event;
  const rounds = ((S.votes && S.votes.rounds) || []).filter((r) => r.bout === b.id);
  const judges = b.state === "done" && b.scoring === "judges" && (ev.scorecards || {})[b.id] ? decision(b, ev.scorecards) : null;
  const res = b.result ? `<p class="ece-result"><b>${esc(resultText(b))}</b>${judges && b.result.method === "PTS" ? ` <span>Judges: ${judges.totals.map(esc).join(", ")}</span>` : ""}</p>` : "";
  const split = !o.compact && rounds.length ? `<details class="ece-fanround"><summary>Fans, round by round</summary>${rounds.map((r) => `<div class="ece-fanround__r"><span>Round ${esc(r.round)}</span>${splitBar(r, { red: b.red.name, blue: b.blue.name })}</div>`).join("")}</details>` : "";
  return `<article class="ece-bout ece-bout--${esc(b.state)}${b.state === "live" || b.state === "break" ? " is-live" : ""}">
    <header class="ece-bout__top"><span class="ece-bout__n">${esc(b.order)}</span><span class="ece-bout__t"><b>${esc(b.title || `Bout ${b.order}`)}</b><small>${[ringName(ev, b), b.weight, plural(b.rounds, "round")].filter(Boolean).map(esc).join(" &middot; ")}</small></span>${boutState(b)}</header>
    ${corners(b)}${res}${split}
  </article>`;
}

export function cardView(S) {
  const bouts = [...S.event.card.bouts].sort((a, b) => a.order - b.order);
  if (!bouts.length) return empty("Fight card to follow", "Bouts will appear here once the card is published.");
  return `<section class="ece-sec"><h2 class="ece-h">Fight card</h2>${bouts.map((b) => boutCard(b, S)).join("")}</section>`;
}

// ---- Schedule ----
export function scheduleView(S) {
  const ev = S.event, f = S.filters, T = terms(ev);
  if (!ev.fixtures.length) return empty("Fixtures to follow", "The schedule will appear here as soon as the organiser publishes it.");
  const teams = allTeams(ev);
  const pitches = ev.pitches.length > 1 ? `<div class="ece-seg" role="group" aria-label="Filter by ${T.place}">${[["all", `All ${T.places}`], ...ev.pitches.map((p) => [p.id, p.name])].map(([id, n]) => `<button type="button" data-k="fp-${esc(id)}" data-fpitch="${esc(id)}" aria-pressed="${f.pitch === id}">${esc(n)}</button>`).join("")}</div>` : "";
  const divs = ev.divisions.length > 1 ? `<div class="ec-field"><label for="f-div">Division</label><select id="f-div" data-k="f-div" class="ec-select" data-fdiv><option value="all">All divisions</option>${ev.divisions.map((d) => `<option value="${esc(d.id)}"${f.div === d.id ? " selected" : ""}>${esc(d.name)}</option>`).join("")}</select></div>` : "";
  const team = `<div class="ec-field"><label for="f-team">My team</label><select id="f-team" data-k="f-team" class="ec-select" data-follow><option value="">Not following a team</option>${teams.map((t) => `<option value="${esc(t.id)}"${S.follow === t.id ? " selected" : ""}>${esc(t.name)}${ev.divisions.length > 1 ? ` (${esc(t.divisionName)})` : ""}</option>`).join("")}</select></div>`;
  let list = [...ev.fixtures].sort(byTime);
  if (f.pitch !== "all") list = list.filter((x) => x.pitch === f.pitch);
  if (f.div !== "all") list = list.filter((x) => x.division === f.div);
  if (S.follow && f.mineOnly) list = list.filter((x) => [side(ev, x, "home").id, side(ev, x, "away").id].includes(S.follow));
  const slots = [...new Set(list.map((x) => x.time))];
  const body = list.length ? slots.map((t) => `<section class="ece-slot" aria-label="${esc(t)}"><h3 class="ece-slot__t">${esc(t)}</h3>${list.filter((x) => x.time === t).map((x) => gameCard(ev, x, S, { division: f.div === "all" })).join("")}</section>`).join("") : empty("No games match", "Try another ${T.place} or division.");
  return `<section class="ece-sec"><h2 class="ece-h">Schedule</h2><div class="ece-filters">${pitches}<div class="ece-filters__sel">${team}${divs}</div>
    ${S.follow ? `<label class="ece-switch"><input type="checkbox" data-k="f-mine" data-mine${f.mineOnly ? " checked" : ""}><span>Show only my team</span></label>` : ""}</div>${body}</section>`;
}

// ---- Results ----
export function resultsView(S) {
  const ev = S.event;
  const done = ev.fixtures.filter((f) => f.state === "ft").sort((a, b) => (b.ftAt || 0) - (a.ftAt || 0) || byTime(b, a));
  if (!done.length) return empty("No results yet", "Full-time scores will land here as games finish.");
  return `<section class="ece-sec"><h2 class="ece-h">Results <span class="ece-h__n">${plural(done.length, "game")}</span></h2>${done.map((f) => gameCard(ev, f, S, { division: true })).join("")}</section>`;
}

// ---- Tables ----
export function tablesView(S) {
  const ev = S.event, T = terms(ev);
  const blocks = ev.divisions.filter((d) => d.format !== "exhibition" && d.format !== "knockout" && d.teams.length).flatMap((d) =>
    tables(d, ev.fixtures, ev.settings.points).map((t) => `<section class="ece-sec"><h2 class="ece-h">${esc(ev.divisions.length > 1 ? `${d.name}${t.group ? ", " : ""}` : "")}${t.group ? `Group ${esc(t.group)}` : ev.divisions.length > 1 ? "" : "Table"}</h2>
      <div class="ece-tablewrap"><table class="ec-table ece-table"><caption class="ece-sr">${esc(d.name)} ${t.group ? `group ${esc(t.group)} ` : ""}table</caption><thead><tr><th scope="col">Team</th><th scope="col" class="num"><abbr title="Played">P</abbr></th><th scope="col" class="num"><abbr title="Won">W</abbr></th><th scope="col" class="num"><abbr title="Drawn">D</abbr></th><th scope="col" class="num"><abbr title="Lost">L</abbr></th><th scope="col" class="num"><abbr title="${esc(T.diff.title)}">${esc(T.diff.abbr)}</abbr></th><th scope="col" class="num"><abbr title="Points">Pts</abbr></th></tr></thead><tbody>
      ${t.rows.map((r, i) => `<tr class="${S.follow === r.id ? "is-mine" : ""}"><th scope="row"><span class="ece-pos">${i + 1}</span>${esc(r.name)}</th><td class="num">${r.p}</td><td class="num">${r.w}</td><td class="num">${r.d}</td><td class="num">${r.l}</td><td class="num">${r.gd > 0 ? "+" : ""}${r.gd}</td><td class="num"><b>${r.pts}</b></td></tr>`).join("")}</tbody></table></div></section>`));
  return blocks.length ? blocks.join("") : empty("Tables to follow", "They fill in as games finish.");
}

// ---- Knockouts ----
function koRounds(ev, div) {
  const ko = ev.fixtures.filter((f) => f.division === div.id && f.stage).sort(byTime);
  const map = new Map();
  ko.forEach((f) => { const k = f.stage.replace(/\s*\d+$/, "").trim(); if (!map.has(k)) map.set(k, []); map.get(k).push(f); });
  return [...map];
}
function koCard(ev, f, S) {
  const h = side(ev, f, "home"), a = side(ev, f, "away"), w = winnerOf(f);
  const row = (s, score, win, k) => `<div class="ece-ko__r${s.tbc ? " is-tbc" : ""}${win ? " is-won" : ""}"><span>${esc(s.text)}</span><b data-score="${esc(f.id)}-${k}">${score == null ? "" : esc(score)}</b></div>`;
  return `<article class="ece-ko ece-ko--${esc(f.state)}${S.follow && [h.id, a.id].includes(S.follow) ? " is-mine" : ""}" data-fx="${esc(f.id)}"><div class="ece-ko__m">${stateBadge(f)}<span>${esc(stageText(f.stage))} &middot; ${esc(f.time)}${f.pitch && ev.pitches.length > 1 ? ` &middot; ${esc(pitchName(ev, f.pitch))}` : ""}</span></div>
    ${row(h, f.homeScore, w === "home", "h")}${row(a, f.awayScore, w === "away", "a")}${f.pens ? `<small class="ece-ko__p">Won on penalties</small>` : ""}</article>`;
}
export function knockoutsView(S) {
  const ev = S.event;
  const out = ev.divisions.map((d) => {
    const rounds = koRounds(ev, d);
    if (!rounds.length) return "";
    return `<section class="ece-sec"><h2 class="ece-h">${esc(ev.divisions.length > 1 ? `${d.name} knockouts` : "Knockouts")}</h2><div class="ece-bracket">${rounds.map(([name, games]) => `<div class="ece-round-col"><h3 class="ece-h3">${esc(name)}</h3>${games.map((g) => koCard(ev, g, S)).join("")}</div>`).join("")}</div></section>`;
  }).join("");
  return out || empty("Knockouts to follow", "The bracket fills in by itself as group games finish.");
}

// ---- Pre: teams and groups ----
export function teamsView(S) {
  const ev = S.event;
  const out = ev.divisions.filter((d) => d.teams.length).map((d) => `<section class="ece-sec"><h2 class="ece-h">${esc(ev.divisions.length > 1 ? d.name : "Who's playing")} <span class="ece-h__n">${plural(d.teams.length, "team")}</span></h2><ul class="ece-teams">${d.teams.map((t) => `<li class="ece-teamcard${S.follow === t.id ? " is-mine" : ""}"><span class="ece-teamcard__n">${esc(t.name)}${t.group ? `<small>Group ${esc(t.group)}</small>` : ""}</span><button type="button" class="ece-follow" data-k="fw-${esc(t.id)}" data-follow-team="${esc(t.id)}" aria-pressed="${S.follow === t.id}" aria-label="Follow ${esc(t.name)}">${S.follow === t.id ? "Following" : "Follow"}</button></li>`).join("")}</ul></section>`).join("");
  return out || empty("Teams to follow", "Who is playing will appear here once the organiser confirms the line-up.");
}
export function groupsView(S) {
  const ev = S.event;
  const out = ev.divisions.flatMap((d) => {
    const gs = [...new Set(d.teams.map((t) => t.group).filter(Boolean))].sort();
    return gs.map((g) => `<section class="ece-group"><h3 class="ece-h3">${esc(ev.divisions.length > 1 ? `${d.name}, ` : "")}Group ${esc(g)}</h3><ul>${d.teams.filter((t) => t.group === g).map((t) => `<li>${esc(t.name)}</li>`).join("")}</ul></section>`);
  });
  return out.length ? `<section class="ece-sec"><h2 class="ece-h">Groups</h2><div class="ece-groups">${out.join("")}</div></section>` : empty("Groups to follow");
}

// ---- Register ----
import { consentText, terms } from "../core/model.js";
export { consentText };
export function registerCard(S, o = {}) {
  const ev = S.event, r = S.reg || {};
  const title = o.title || "Join the clubhouse";
  const lede = o.lede || "Get the line-ups, any changes and what comes next, first.";
  if (r.state === "demo") {
    return `<section class="ece-card ece-reg ece-reg--done" aria-live="polite"><h2 class="ece-h">That's how fans sign up</h2><p>This is a demo, so we haven't kept your details. On a real event, the organiser gets a list of everyone who registered.</p></section>`;
  }
  if (r.state === "ok" || r.state === "already") {
    return `<section class="ece-card ece-reg ece-reg--done" aria-live="polite"><h2 class="ece-h">${r.state === "already" ? "You're already on the list" : "You're in"}</h2><p>${r.state === "already" ? "We've got that email already, so there's nothing more to do. We'll keep you posted." : "Thanks. We'll email you about " + esc(ev.name) + " and what comes next."}</p></section>`;
  }
  return `<section class="ece-card ece-reg" aria-labelledby="reg-h"><h2 id="reg-h" class="ece-h">${esc(title)}</h2><p class="ece-lede">${esc(lede)}</p>
    <form data-reg novalidate>
      <div class="ec-field"><label for="reg-name">First name</label><input id="reg-name" name="firstName" class="ec-input" type="text" autocomplete="given-name" maxlength="40" required></div>
      <div class="ec-field"><label for="reg-email">Email</label><input id="reg-email" name="email" class="ec-input" type="email" inputmode="email" autocomplete="email" autocapitalize="none" maxlength="254" required></div>
      <div class="ece-hp" aria-hidden="true"><label>Website<input name="website" type="text" tabindex="-1" autocomplete="off"></label></div>
      <label class="ec-check"><input type="checkbox" name="over13"><span>I'm 13 or over.</span></label>
      <label class="ec-check"><input type="checkbox" name="consent"><span>${esc(consentText(ev))}</span></label>
      <p class="ec-error" role="alert" data-reg-error${r.error ? "" : " hidden"}>${esc(r.error || "")}</p>
      <button class="ec-btn ec-btn--block ec-btn--big" type="submit"${r.busy ? " disabled" : ""}>${r.busy ? "Sending..." : "Register"}</button>
    </form></section>`;
}

// ---- Pre: Home ----
export function homeView(S) {
  const ev = S.event, th = ev.theme || {}, T = terms(ev);
  const n = daysTo(ev.date);
  const countdown = n == null ? "" : n === 0 ? "Today" : n === 1 ? "Tomorrow" : n > 1 ? `${n} days to go` : "";
  const f = isFootball(ev);
  const nTeams = allTeams(ev).length, nBouts = ev.card.bouts.length;
  const tiles = [];
  if (f && nTeams) tiles.push(["teams", String(nTeams), "teams"]);
  if (f && ev.fixtures.length) tiles.push(["schedule", String(ev.fixtures.length), "games"]);
  if (f && ev.pitches.length) tiles.push(["schedule", String(ev.pitches.length), ev.pitches.length === 1 ? T.place : T.places]);
  if (!f && nBouts) tiles.push(["card", String(nBouts), nBouts === 1 ? "bout" : "bouts"]);
  return `<section class="ece-hero"><p class="ec-kicker">Before the day</p>${countdown ? `<p class="ece-count">${esc(countdown)}</p>` : ""}
    ${ev.about ? `<p class="ece-about">${esc(ev.about)}</p>` : `<p class="ece-about">The line-up, the schedule and everything else for the day will be here. Register to hear first.</p>`}
    ${ev.links && ev.links.tickets ? `<a class="ec-btn ec-btn--big ece-ticket" href="${esc(ev.links.tickets)}" target="_blank" rel="noopener">Get tickets</a>` : ""}</section>
    ${tiles.length ? `<ul class="ece-tiles">${tiles.map(([go, n2, l]) => `<li><button type="button" data-go="${go}"><b>${esc(n2)}</b><span>${esc(l)}</span></button></li>`).join("")}</ul>` : ""}
    ${registerCard(S)}
    ${th.partner ? `<p class="ece-note ece-center">${esc(th.partner)} and SHOT bring you the clubhouse for this event.</p>` : ""}`;
}

// ---- Leaderboards ----
export function leaderboard(S, o = {}) {
  const v = S.votes, ev = S.event;
  if (!v) return `<div class="ece-skel-block ec-skel" style="height:120px"></div>`;
  if (isFootball(ev)) {
    const L = v.leaders || [];
    if (!L.length) return `<section class="ece-sec"><h2 class="ece-h">${esc(o.title || "Fans' players of the day")}</h2>${empty("No votes yet", "Votes from fans at the ground add up here.")}</section>`;
    const max = Math.max(...L.map((l) => l.votes), 1);
    return `<section class="ece-sec"><h2 class="ece-h">${esc(o.title || "Fans' players of the day")} <span class="ece-h__n">${plural(v.total, "vote")}</span></h2><ol class="ece-lb">${L.slice(0, o.limit || 8).map((l, i) => `<li class="${i === 0 ? "is-top" : ""}"><span class="ece-lb__rank">${i + 1}</span><span class="ece-lb__who"><b>${esc(l.label)}</b><small>${esc(l.team)}</small></span><span class="ece-lb__n">${l.votes}</span><i style="--w:${Math.round((l.votes / max) * 100)}%"></i></li>`).join("")}</ol></section>`;
  }
  const F = v.fighters || [];
  if (!F.length) return `<section class="ece-sec"><h2 class="ece-h">${esc(o.title || "Fans' fighter of the night")}</h2>${empty("No votes yet", "Round votes from the crowd add up here.")}</section>`;
  const max = Math.max(...F.map((l) => l.votes), 1);
  const bouts = Object.fromEntries(ev.card.bouts.map((b) => [b.id, b]));
  return `<section class="ece-sec"><h2 class="ece-h">${esc(o.title || "Fans' fighter of the night")} <span class="ece-h__n">${plural(v.total, "vote")}</span></h2><ol class="ece-lb">${F.slice(0, o.limit || 6).map((l, i) => `<li class="ece-lb--${esc(l.corner)}${i === 0 ? " is-top" : ""}"><span class="ece-lb__rank">${i + 1}</span><span class="ece-lb__who"><b>${esc(l.name)}</b><small>${esc((bouts[l.bout] || {}).title || "")}</small></span><span class="ece-lb__n">${l.votes}</span><i style="--w:${Math.round((l.votes / max) * 100)}%"></i></li>`).join("")}</ol></section>`;
}

// ---- Post: the day ----
export function wrapView(S) {
  const ev = S.event, f = isFootball(ev), out = [];
  if (f) {
    ev.divisions.forEach((d) => {
      const c = champion(d, ev.fixtures, ev.settings.points);
      const t = c && c.id ? d.teams.find((x) => x.id === c.id) : null;
      if (t) out.push(`<section class="ece-champ" aria-label="Champions"><p class="ec-kicker">${esc(ev.divisions.length > 1 ? `${d.name} champions` : "Champions")}</p><p class="ece-champ__n">${esc(t.name)}</p><p>${esc(c.how)}</p></section>`);
    });
  } else {
    const done = [...ev.card.bouts].filter((b) => b.state === "done" && b.result).sort((a, b) => b.order - a.order)[0];
    if (done) out.push(`<section class="ece-champ" aria-label="Main event"><p class="ec-kicker">${esc(done.title || "Main event")}</p><p class="ece-champ__n">${esc(done.result.winner ? done[done.result.winner].name : cap(done.result.method === "DRAW" ? "Draw" : "No contest"))}</p><p>${esc(resultText(done))}</p></section>`);
  }
  if (!out.length) out.push(`<section class="ece-champ ece-champ--soft"><p class="ec-kicker">That's a wrap</p><p class="ece-champ__n">Thanks for being there</p><p>${esc(ev.name)} is done. Results and updates are below.</p></section>`);
  out.push(isJuniors(ev) ? `<section class="ece-sec">${youthNote(ev)}</section>` : leaderboard(S, { limit: 5 }));
  const ups = [...(ev.updates || [])].sort((a, b) => (b.at || 0) - (a.at || 0));
  out.push(`<section class="ece-sec" aria-labelledby="h-up"><h2 id="h-up" class="ece-h">Updates from the organiser</h2>${ups.length ? `<ol class="ece-feed">${ups.map((u) => `<li class="ece-card"><time datetime="${u.at ? new Date(u.at).toISOString() : ""}">${u.at ? esc(new Date(u.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })) : ""}</time><h3>${esc(u.title)}</h3>${u.body ? `<p>${esc(u.body)}</p>` : ""}${u.link ? `<a href="${esc(u.link)}" target="_blank" rel="noopener">Read more</a>` : ""}</li>`).join("")}</ol>` : empty("No updates yet", "The organiser's news and content will appear here.")}</section>`);
  if (ev.links && ev.links.clubhouse) out.push(`<section class="ece-card ece-cta"><p class="ec-kicker">After the day</p><h2 class="ece-h">Stay in the clubhouse</h2><p class="ece-lede">Results, updates and the next event, in one place.</p><a class="ec-btn ec-btn--big ec-btn--block" href="${esc(ev.links.clubhouse)}" target="_blank" rel="noopener">Join the Clubhouse</a></section>`);
  out.push(registerCard(S, { title: "Hear about the next one", lede: "Leave your email and we'll tell you when the next event is announced." }));
  return out.join("");
}

export function skeleton() {
  return `<div class="ece-wrap" aria-hidden="true"><div class="ec-skel" style="height:22px;width:55%;margin:20px 0 14px"></div>${[0, 1, 2].map(() => `<div class="ec-skel" style="height:96px;margin-bottom:12px;border-radius:14px"></div>`).join("")}</div>`;
}

export function viewFor(tab, S) {
  const ev = S.event;
  switch (tab) {
    case "home": return homeView(S);
    case "teams": return teamsView(S);
    case "groups": return groupsView(S);
    case "schedule": return scheduleView(S);
    case "now": return isFootball(ev) ? nowFootball(S) : nowBoxing(S);
    case "tables": return tablesView(S);
    case "knockouts": return knockoutsView(S);
    case "results": return resultsView(S);
    case "card": return cardView(S);
    case "wrap": return wrapView(S);
    default: return "";
  }
}
