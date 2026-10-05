// Fan app views for fitness events (timed races and workout games): Now, Heats, Leaderboard,
// Find me and Vote. Pure functions from state to HTML, like event-views.js. The router
// (event.js, event-views.js, event-vote.js) hands off here when ev.sport === "fitness".
//
// State owned here: which category is showing, which rows are open, the bib the fan looked up
// (remembered on this device) and the bib they are typing. Everything that came from the
// event goes through esc().

import { esc, plural } from "/js/ui.js";
import { terms } from "/core/model.js";
import { leaderboard, onCourse, nextHeats } from "/core/fitness.js";
import { comp, isRace, segs, catName, catOf, heatById, entryByBib, ordinal, valueText, legs, fmtTime, segmentsDone, STATE_TEXT } from "/js/fit-lib.js";

const slug = (location.pathname.match(/^\/e\/([^/]+)/) || [])[1] || "";
const KEY = `ece.fitme.${slug}`;
const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); return Number.isInteger(v) ? v : null; } catch (e) { return null; } };
const write = (v) => { try { if (v == null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* private mode: lasts the page */ } };

const FS = { cat: null, hcat: "all", open: new Set(), draft: "", bib: read(), err: "" };

const empty = (title, body = "") => `<div class="ece-empty"><b>${esc(title)}</b>${body ? `<span>${esc(body)}</span>` : ""}</div>`;
const entries = (ev) => comp(ev).entries;
const mineEntry = (ev) => (FS.bib == null ? null : entryByBib(ev, FS.bib));
const ofHeat = (ev, id) => entries(ev).filter((e) => e.heat === id).sort((a, b) => a.bib - b.bib);

// ---- Which sections apply ----
export function fitTabs(ev, votes) {
  const c = comp(ev), t = [];
  const people = c.entries.length > 0;
  if (ev.phase === "pre") {
    t.push(["home", "Clubhouse"]);
    if (c.heats.length) t.push(["heats", "Heats"]);
    if (people) t.push(["me", "Find me"]);
  } else if (ev.phase === "live") {
    t.push(["now", "Now"], ["heats", "Heats"], ["board", "Leaderboard"], ["me", "Find me"]);
    if (ev.settings.vote.open && !ev.settings.juniors) t.push(["vote", "Vote"]);
  } else {
    t.push(["wrap", "The day"], ["board", "Leaderboard"]);
    if (c.heats.length) t.push(["heats", "Heats"]);
    if (people) t.push(["me", "Find me"]);
  }
  return t;
}

export function fitView(tab, S) {
  const ev = S.event;
  switch (tab) {
    case "now": return nowView(ev);
    case "heats": return heatsView(ev);
    case "board": return boardView(ev);
    case "me": return meView(ev);
    default: return "";
  }
}

// ---- Small pieces ----
const heatBadge = (h) => (h.state === "live" ? `<span class="ec-badge ec-badge--live">On now</span>` : h.state === "done" ? `<span class="ec-badge ec-badge--ft">Finished</span>` : `<span class="ec-badge">Up next</span>`);
const bar = (done, total, label) => `<span class="ecf-bar" role="img" aria-label="${esc(label)}"><i style="--w:${total ? Math.round((done / total) * 100) : 0}%"></i></span>`;
const who = (e) => `<span class="ecf-who"><b>${esc(e.label)}</b>${e.club ? `<small>${esc(e.club)}</small>` : ""}</span>`;
const mineTag = (e) => (FS.bib === e.bib ? `<span class="ece-tag">You</span>` : "");

// What one athlete is doing right now, in words and numbers.
function progress(ev, e) {
  const g = segs(ev), n = g.length, done = segmentsDone(e), race = isRace(ev);
  if (e.state === "dns") return { tag: "Did not start", cls: "dns", line: "", done, n };
  if (e.state === "dnf") return { tag: "Did not finish", cls: "dnf", line: race && done ? `Out after ${done} of ${n}. Last split ${fmtTime(lastOf(e))}.` : done ? `Out after ${done} of ${n}.` : "", done, n };
  if (e.state === "finished") return { tag: "Finished", cls: "fin", line: race ? `Finish time ${fmtTime(lastOf(e))}` : scoreLine(ev, e), done, n };
  if (!done && e.state === "ready") return { tag: "Ready", cls: "rdy", line: "Waiting to start", done, n };
  const cur = e.results.findIndex((v) => v == null);
  const segName = cur >= 0 && g[cur] ? g[cur].name : "";
  const head = cur >= 0 ? `Segment ${cur + 1} of ${n}${segName ? `: ${segName}` : ""}` : `All ${n} done`;
  return { tag: "", cls: "on", line: `${head}${race && done ? `. Last split ${fmtTime(lastOf(e))}` : ""}${!race && done ? `. ${scoreLine(ev, e)}` : ""}`, done, n };
}
const lastOf = (e) => { for (let i = e.results.length - 1; i >= 0; i--) if (e.results[i] != null) return e.results[i]; return null; };
const scoreLine = (ev, e) => segs(ev).map((g, i) => (e.results[i] == null ? null : `${g.name} ${valueText(g, e.results[i])}`)).filter(Boolean).join(", ");

function athleteRow(ev, e) {
  const p = progress(ev, e);
  return `<li class="ecf-prog ecf-prog--${p.cls}${FS.bib === e.bib ? " is-mine" : ""}">
    ${who(e)}${mineTag(e)}
    ${p.tag ? `<span class="ecf-state ecf-state--${p.cls}">${esc(p.tag)}</span>` : ""}
    ${p.line ? `<span class="ecf-line">${esc(p.line)}</span>` : ""}
    ${bar(p.done, p.n, `${p.done} of ${p.n} segments done`)}
  </li>`;
}

function heatHead(ev, h, extra = "") {
  const k = catName(ev, h.category);
  return `<header class="ecf-heat__top"><span class="ecf-heat__time">${esc(h.time)}</span><span class="ecf-heat__name"><b>${esc(h.name)}</b>${k ? `<small>${esc(k)}</small>` : ""}</span>${heatBadge(h)}${extra}</header>`;
}

// ---- NOW ----
function nowView(ev) {
  const T = terms(ev), c = comp(ev);
  if (!c.heats.length) return empty("Heats to follow", "The schedule will appear here as soon as the organiser publishes it.");
  const out = [];
  const liveHeats = onCourse(ev);
  if (liveHeats.length) {
    out.push(`<section class="ece-sec" aria-labelledby="h-fl"><h2 id="h-fl" class="ece-h">On the ${esc(T.place)} <span class="ece-h__n">${liveHeats.length} on now</span></h2>${liveHeats.map(({ heat }) => {
      const rows = ofHeat(ev, heat.id);
      const fin = rows.filter((e) => e.state === "finished").length;
      return `<article class="ece-game ece-game--live ecf-heat" aria-label="${esc(`${heat.name} at ${heat.time}`)}">${heatHead(ev, heat)}
        <p class="ece-note ecf-heat__sum">${esc(plural(fin, "athlete"))} finished, ${esc(String(rows.length - fin))} to go.</p>
        <ul class="ecf-progs">${rows.map((e) => athleteRow(ev, e)).join("")}</ul></article>`;
    }).join("")}</section>`);
  } else out.push(empty(`Nothing on the ${T.place} right now`, "The next heat is below. This page updates by itself."));
  const next = nextHeats(ev, liveHeats.length ? 3 : 4);
  if (next.length) {
    out.push(`<section class="ece-sec" aria-labelledby="h-fn"><h2 id="h-fn" class="ece-h">Up next</h2>${next.map(({ heat, entries: es }) => `<article class="ece-game ecf-heat" aria-label="${esc(`${heat.name} at ${heat.time}`)}">${heatHead(ev, heat)}
      <p class="ece-note ecf-heat__sum">${es.length ? esc(`${plural(es.length, "athlete")}: ${es.slice(0, 6).map((e) => e.label).join(", ")}${es.length > 6 ? ` and ${es.length - 6} more` : ""}`) : "Athletes to be confirmed."}</p></article>`).join("")}
      <button type="button" class="ec-btn ec-btn--ghost ec-btn--block ece-more" data-go="heats">Full schedule</button></section>`);
  } else if (liveHeats.length) out.push(`<p class="ece-note">That is the last heat of the day.</p>`);
  const done = c.heats.filter((h) => h.state === "done").sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))[0];
  if (done && !liveHeats.length) {
    out.push(`<section class="ece-sec" aria-labelledby="h-fd"><h2 id="h-fd" class="ece-h">Just finished</h2><article class="ece-game ecf-heat">${heatHead(ev, done)}
      <ul class="ecf-progs">${ofHeat(ev, done.id).map((e) => athleteRow(ev, e)).join("")}</ul></article>
      <button type="button" class="ec-btn ec-btn--ghost ec-btn--block ece-more" data-go="board">Leaderboard</button></section>`);
  }
  return out.join("");
}

// ---- HEATS ----
function catSwitch(ev, current, kind, withAll) {
  const items = [...(withAll ? [["all", "All"]] : []), ...comp(ev).categories.map((k) => [k.id, k.name])];
  if (items.length < 2) return "";
  return `<div class="ece-seg ecf-cats" role="group" aria-label="Category">${items.map(([id, n]) => `<button type="button" data-k="${kind}-${esc(id)}" data-fit="${kind}" data-v="${esc(id)}" aria-pressed="${current === id}">${esc(n)}</button>`).join("")}</div>`;
}

function heatsView(ev) {
  const c = comp(ev);
  if (!c.heats.length) return empty("Heats to follow", "The schedule will appear here as soon as the organiser publishes it.");
  const f = c.categories.some((k) => k.id === FS.hcat) ? FS.hcat : "all";
  const list = c.heats.filter((h) => f === "all" || h.category === f || !h.category).sort((a, b) => String(a.time).localeCompare(String(b.time)) || String(a.id).localeCompare(String(b.id)));
  const mine = mineEntry(ev);
  const body = list.length ? list.map((h) => {
    const es = ofHeat(ev, h.id), open = FS.open.has(`h:${h.id}`), has = mine && mine.heat === h.id;
    return `<article class="ece-game ecf-heat${h.state === "live" ? " ece-game--live" : ""}${has ? " is-mine" : ""}" aria-label="${esc(`${h.time}, ${h.name}`)}">${heatHead(ev, h, has ? `<span class="ece-tag">Your heat</span>` : "")}
      <p class="ece-note ecf-heat__sum">${esc(plural(es.length, "athlete"))}</p>
      ${es.length ? `<button type="button" class="ecf-toggle" data-k="ho-${esc(h.id)}" data-fit="open" data-v="h:${esc(h.id)}" aria-expanded="${open}">${open ? "Hide athletes" : "Show athletes"}</button>${open ? `<ul class="ecf-names">${es.map((e) => `<li class="${FS.bib === e.bib ? "is-mine" : ""}">${who(e)}</li>`).join("")}</ul>` : ""}` : ""}</article>`;
  }).join("") : empty("No heats in that category");
  return `<section class="ece-sec"><h2 class="ece-h">Heats <span class="ece-h__n">${c.heats.length} in all</span></h2><div class="ece-filters">${catSwitch(ev, f, "hcat", true)}</div>${body}</section>`;
}

// ---- Splits and scores for one athlete ----
function detail(ev, e, row) {
  const g = segs(ev), race = isRace(ev);
  if (!g.length) return `<p class="ece-note">No segments set up yet.</p>`;
  const lg = legs(e.results);
  const items = g.map((s, i) => {
    const v = e.results[i];
    const val = v == null ? `<span class="ecf-none">Not yet</span>` : race ? `<b>${esc(fmtTime(v))}</b><small>leg ${esc(fmtTime(lg[i]))}</small>` : `<b>${esc(valueText(s, v))}</b>${row && row.ranks && row.ranks[i] ? `<small>${esc(ordinal(row.ranks[i]))}</small>` : ""}`;
    return `<li><span class="ecf-seg__n">${i + 1}</span><span class="ecf-seg__name">${esc(s.name)}</span><span class="ecf-seg__v">${val}</span></li>`;
  }).join("");
  return `<ol class="ecf-segs" aria-label="${race ? "Splits" : "Scores"}">${items}</ol>`;
}

const rankText = (row) => (row && row.rank != null ? ordinal(row.rank) : "-");

// ---- LEADERBOARD ----
function pickCat(ev) {
  const cs = comp(ev).categories;
  if (!cs.length) return null;
  if (cs.some((k) => k.id === FS.cat)) return FS.cat;
  const mine = mineEntry(ev);
  if (mine && cs.some((k) => k.id === mine.category)) return mine.category;
  const busy = cs.find((k) => entries(ev).some((e) => e.category === k.id && e.state !== "ready" && e.state !== "dns"));
  return (busy || cs[0]).id;
}

function rowValue(ev, r) {
  if (isRace(ev)) {
    if (r.state === "finished") return `<b>${esc(fmtTime(r.total))}</b>`;
    if (r.state === "racing" && r.done) return `<b>${esc(fmtTime(r.last))}</b><small>${r.done} of ${segs(ev).length} done</small>`;
    return `<small>${esc(STATE_TEXT[r.state] || "")}</small>`;
  }
  if (r.state === "dns") return `<small>${esc(STATE_TEXT.dns)}</small>`;
  if (!r.done) return `<small>No scores yet</small>`;
  return `<b>${r.points} ${r.points === 1 ? "pt" : "pts"}</b><small>${r.done} of ${segs(ev).length} scored</small>`;
}

function boardView(ev) {
  const c = comp(ev);
  if (!c.categories.length) return empty("Leaderboard to follow", "Results will appear here once the organiser sets up the categories.");
  const cat = pickCat(ev), rows = leaderboard(ev, cat), byId = new Map(c.entries.map((e) => [e.id, e]));
  const race = isRace(ev);
  const body = rows.length ? `<ol class="ecf-lb" aria-label="${esc(catName(ev, cat))} leaderboard">${rows.map((r) => {
    const e = byId.get(r.id), open = FS.open.has(`e:${r.id}`);
    return `<li class="ecf-lb__item${FS.bib === r.bib ? " is-mine" : ""}${r.rank === 1 ? " is-top" : ""}">
      <button type="button" class="ecf-lb__row" data-k="eo-${esc(r.id)}" data-fit="open" data-v="e:${esc(r.id)}" aria-expanded="${open}" aria-label="${esc(`${r.rank != null ? ordinal(r.rank) : "Not ranked"}, ${r.label}. ${open ? "Hide" : "Show"} ${race ? "splits" : "scores"}`)}">
        <span class="ecf-lb__rank">${r.rank != null ? r.rank : "-"}</span>
        <span class="ecf-lb__who"><b>${esc(r.label)}</b>${e && e.club ? `<small>${esc(e.club)}</small>` : ""}</span>
        <span class="ecf-lb__val">${rowValue(ev, r)}</span></button>
      ${open && e ? `<div class="ecf-lb__more">${detail(ev, e, r)}</div>` : ""}</li>`;
  }).join("")}</ol>` : empty("Nobody entered in this category yet");
  const note = race ? "Finishers first by time, then racers by how far they have got." : "Lowest total of placings wins. Each workout is ranked within the category.";
  return `<section class="ece-sec"><h2 class="ece-h">Leaderboard <span class="ece-h__n">${esc(catName(ev, cat))}</span></h2><div class="ece-filters">${catSwitch(ev, cat, "cat", false)}</div><p class="ece-note">${esc(note)} Tap a row to see ${race ? "the splits" : "the scores"}.</p>${body}</section>`;
}

// ---- FIND ME ----
function meView(ev) {
  const e = mineEntry(ev), c = comp(ev);
  const T = terms(ev);
  let card = "";
  if (FS.bib != null && !e) card = `<div class="ece-card"><p>Bib ${esc(String(FS.bib))} is not in this event any more.</p><button type="button" class="ec-btn ec-btn--ghost" data-fit="clear">Forget it</button></div>`;
  if (e) {
    const row = leaderboard(ev, e.category).find((r) => r.id === e.id);
    const total = entries(ev).filter((x) => x.category === e.category).length;
    const h = heatById(ev, e.heat), p = progress(ev, e);
    card = `<article class="ece-card ecf-me" aria-labelledby="me-h"><p class="ec-kicker">Your athlete</p>
      <h2 id="me-h" class="ece-h">${esc(e.label)}</h2>
      <p class="ece-note">${[e.club, catName(ev, e.category)].filter(Boolean).map(esc).join(" &middot; ")}</p>
      <dl class="ecf-facts">
        <div><dt>Rank</dt><dd>${row && row.rank != null ? `${esc(ordinal(row.rank))} of ${total}` : "Not ranked yet"}</dd></div>
        <div><dt>Heat</dt><dd>${h ? `${esc(h.name)} at ${esc(h.time)}${h.state === "live" ? " (on now)" : h.state === "done" ? " (finished)" : ""}` : "Not in a heat yet"}</dd></div>
        <div><dt>Status</dt><dd>${esc(p.tag || STATE_TEXT[e.state] || "")}${p.line ? `. ${esc(p.line)}` : ""}</dd></div>
        ${!isRace(ev) && row && row.points != null && row.done ? `<div><dt>Points</dt><dd>${row.points}</dd></div>` : ""}
      </dl>
      ${detail(ev, e, row)}
      <button type="button" class="ec-btn ec-btn--ghost ecf-forget" data-fit="clear">Not me. Forget this bib</button></article>`;
  }
  const intro = e ? "Look up someone else" : "Find your athlete";
  return `<section class="ece-sec"><h2 class="ece-h">Find me</h2>
    <form class="ece-card ecf-find" data-fit-form="find" novalidate aria-labelledby="fit-find-h">
      <h3 id="fit-find-h" class="ece-h3">${esc(intro)}</h3>
      <div class="ec-field"><label for="fit-bib">Bib number</label><input id="fit-bib" name="bib" class="ec-input" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="5" data-k="fit-bib" value="${esc(FS.draft)}" aria-describedby="fit-bib-help${FS.err ? " fit-bib-err" : ""}"${FS.err ? ' aria-invalid="true"' : ""}>
        <span id="fit-bib-help" class="ec-help">The number on the bib. We remember it on this phone.</span>
        ${FS.err ? `<p id="fit-bib-err" class="ec-error" role="alert">${esc(FS.err)}</p>` : ""}</div>
      <button type="submit" class="ec-btn ec-btn--big ec-btn--block">Find</button></form>
    ${card || (c.entries.length ? "" : empty("Athletes to follow", `Who is on the ${T.place} will appear here once the organiser confirms the entries.`))}</section>`;
}

// ---- VOTE ----
function heatVote(t, S) {
  const ev = S.event, mine = S.mine[t.target] || null;
  const k = catName(ev, t.category);
  const pick = mine ? t.choices.find((c) => c.choice === mine.choice) : null;
  const tally = ((S.votes && S.votes.heats) || []).find((x) => x.target === t.target);
  const lead = tally && tally.leaders && tally.leaders[0];
  return `<article class="ece-vcard" data-target="${esc(t.target)}">
    <header class="ece-vcard__top"><span>${t.state === "live" ? `<span class="ec-badge ec-badge--live">On now</span>` : `<span class="ec-badge ec-badge--ft">Heat over</span>`}</span>
      <b class="ece-vcard__t">${esc(t.name)} <em>${esc(t.time)}</em></b>
      <small>${esc(k)}</small>
      <span class="ece-lockbadge" data-lock="${esc(t.target)}"></span></header>
    <p class="ece-q" id="q-${esc(t.target.replace(/:/g, "-"))}">Who is your favourite in this heat?</p>
    <div class="ece-chips" role="group" aria-labelledby="q-${esc(t.target.replace(/:/g, "-"))}">${t.choices.map((p) => `<button type="button" class="ece-chip" data-k="vc-${esc(p.choice)}" data-vote="${esc(p.choice)}" data-target="${esc(t.target)}" aria-pressed="${!!mine && mine.choice === p.choice}">${esc(p.label)}</button>`).join("")}</div>
    <p class="ece-vstat" aria-live="polite">${pick ? `Your vote: <b>${esc(pick.label)}</b>. Tap another athlete to change it.` : "Tap an athlete to vote. One vote per heat, and you can change it until it locks."}</p>
    ${lead ? `<p class="ece-note">Leading so far: ${esc(lead.label)} with ${esc(plural(lead.votes, "vote"))}.</p>` : ""}
  </article>`;
}

function favourites(S, limit = 8) {
  const v = S.votes, ev = S.event;
  if (!v) return `<div class="ece-skel-block ec-skel" style="height:120px"></div>`;
  const L = v.leaders || [];
  if (!L.length) return `<section class="ece-sec"><h2 class="ece-h">Fan favourites</h2>${empty("No votes yet", "Votes from fans at the event add up here.")}</section>`;
  const max = Math.max(...L.map((l) => l.votes), 1);
  return `<section class="ece-sec"><h2 class="ece-h">Fan favourites <span class="ece-h__n">${esc(plural(v.total, "vote"))}</span></h2><ol class="ece-lb">${L.slice(0, limit).map((l, i) => {
    const h = heatById(ev, l.heat);
    return `<li class="${i === 0 ? "is-top" : ""}"><span class="ece-lb__rank">${i + 1}</span><span class="ece-lb__who"><b>${esc(l.label)}</b><small>${esc([catName(ev, l.category), h ? h.name : ""].filter(Boolean).join(", "))}</small></span><span class="ece-lb__n">${l.votes}</span><i style="--w:${Math.round((l.votes / max) * 100)}%"></i></li>`;
  }).join("")}</ol></section>`;
}

// gate: the "13 and over" card from event-vote.js; ok: this phone has confirmed it.
export function fitVote(S, gate, ok) {
  const v = S.votes, ev = S.event;
  let body;
  if (!v) body = `<div class="ec-skel" style="height:140px;border-radius:14px"></div>`;
  else if (!ev.settings.vote.open && !(v.now && v.now.length)) body = `<div class="ece-empty"><b>Voting is closed</b><span>Here is how the fans voted.</span></div>`;
  else if (!v.now.length) body = `<div class="ece-empty"><b>Voting opens when a heat starts</b><span>This page updates by itself. Keep it open.</span></div>`;
  else body = ok ? v.now.map((t) => heatVote(t, S)).join("") : "";
  return `<section class="ece-sec"><h2 class="ece-h">Fan favourite of the heat</h2>${gate}${body}</section>${favourites(S)}`;
}

// ---- Post: the day ----
export function fitWrapParts(S) {
  const ev = S.event, out = [];
  comp(ev).categories.forEach((k) => {
    const win = leaderboard(ev, k.id).find((r) => r.rank === 1);
    if (!win) return;
    const e = entries(ev).find((x) => x.id === win.id);
    const how = isRace(ev) ? `Finish time ${fmtTime(win.total)}` : `${win.points} ${win.points === 1 ? "point" : "points"}`;
    out.push(`<section class="ece-champ" aria-label="${esc(k.name)} winner"><p class="ec-kicker">${esc(k.name)}</p><p class="ece-champ__n">${esc(win.label)}</p><p>${esc([e && e.club, how].filter(Boolean).join(". "))}</p></section>`);
  });
  if (S.votes && (S.votes.leaders || []).length) out.push(favourites(S, 5));
  return out;
}

// ---- Screen-reader messages for changes ----
export function fitChanges(old, ev) {
  const msgs = [];
  const o = new Map(comp(old).heats.map((h) => [h.id, h]));
  comp(ev).heats.forEach((h) => {
    const p = o.get(h.id);
    if (!p || p.state === h.state) return;
    if (h.state === "live") msgs.push(`${h.name} has started`);
    else if (h.state === "done") msgs.push(`${h.name} is over`);
  });
  const oe = new Map(comp(old).entries.map((e) => [e.id, e]));
  const race = isRace(ev);
  comp(ev).entries.forEach((e) => {
    const p = oe.get(e.id);
    if (race && p && p.state !== "finished" && e.state === "finished") msgs.push(`${e.label} finished in ${fmtTime(lastOf(e))}`);
  });
  return { msgs: msgs.slice(0, 3), flash: [] };
}

// ---- Taps and typing (event.js calls these) ----
// Each returns true when it changed something the page should redraw for.
export function fitClick(el) {
  const k = el.dataset.fit;
  if (k === "cat") { FS.cat = el.dataset.v; return true; }
  if (k === "hcat") { FS.hcat = el.dataset.v; return true; }
  if (k === "open") { const id = el.dataset.v; if (FS.open.has(id)) FS.open.delete(id); else FS.open.add(id); return true; }
  if (k === "clear") { FS.bib = null; FS.err = ""; FS.draft = ""; write(null); return true; }
  return false;
}
export function fitInput(el) { if (el.id === "fit-bib") { FS.draft = el.value.replace(/\D/g, "").slice(0, 5); if (el.value !== FS.draft) el.value = FS.draft; } }
// Returns a message for screen readers, or "".
export function fitSubmit(form, S) {
  const ev = S.event;
  const text = FS.draft.trim();
  if (!text) { FS.err = "Type the number on the bib."; return FS.err; }
  const e = entryByBib(ev, Number(text));
  if (!e) { FS.err = `We can't find bib ${Number(text)}. Check the number and try again.`; return FS.err; }
  FS.err = ""; FS.bib = e.bib; FS.draft = ""; FS.cat = null; write(e.bib);
  return `Found ${e.label}.`;
}
