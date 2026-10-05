// Big screen slides: each slide is { key, max, build(n) }. build(n) returns HTML for at most n
// rows, so the fit loop in screen.js can shrink a slide until it fits the TV.

import { esc, side, pitchName } from "/js/ui.js";
import { tables, champion, winnerOf } from "/core/standings.js";
import { currentBout, ringsNow, resultText, decision } from "/core/boxing.js";
import { fmtDate, byTime, isJuniors, hasRings, ringName } from "/js/event-views.js";
import { terms } from "/core/model.js";

const RECENT_MS = 3 * 60 * 1000;
const score = (f) => (f.homeScore == null ? "v" : `${esc(f.homeScore)}<i>-</i>${esc(f.awayScore)}`);

function card(ev, f, o = {}) {
  const h = side(ev, f, "home"), a = side(ev, f, "away"), w = f.state === "ft" ? winnerOf(f) : null;
  const t = ev.divisions.find((d) => d.id === f.division);
  const g = t && (t.teams.find((x) => x.id === f.home) || {}).group;
  const meta = [f.state === "live" ? `<span class="ecv-live">Live</span>` : f.state === "ft" ? `<span class="ecv-ft">Full time</span>` : "", `<span>${esc(f.time)}</span>`, f.stage ? `<b>${esc(f.stage)}</b>` : g ? `<span>Group ${esc(g)}</span>` : "", f.pens ? "<span>Won on pens</span>" : ""].filter(Boolean).join("");
  return `<div class="ecv-game ecv-game--${esc(f.state)}${o.small ? " ecv-game--s" : ""}" data-fx="${esc(f.id)}"><div class="ecv-game__m">${meta}</div><div class="ecv-game__r"><span class="${h.tbc ? "is-tbc " : ""}${w === "home" ? "is-won" : ""}">${esc(h.text)}</span><b class="ecv-sc${f.homeScore == null ? " is-time" : ""}">${score(f)}</b><span class="r ${a.tbc ? "is-tbc " : ""}${w === "away" ? "is-won" : ""}">${esc(a.text)}</span></div></div>`;
}

function gamesSlide(S) {
  const ev = S.event, fx = ev.fixtures, now = Date.now(), T = terms(ev);
  if (!fx.length) return null;
  const groups = ev.pitches.map((p) => ({ id: p.id, name: p.name }));
  if (!groups.length || fx.some((f) => !f.pitch || !ev.pitches.some((p) => p.id === f.pitch))) groups.push({ id: null, name: groups.length ? "Other games" : "Games" });
  const inG = (g) => (f) => (g.id ? f.pitch === g.id : !f.pitch || !ev.pitches.some((p) => p.id === f.pitch));
  const recent = (f) => f.state === "ft" && now - Math.max(f.ftAt || 0, S.seenFt[f.id] || 0) < RECENT_MS;
  const cols = groups.map((g) => {
    const m = inG(g);
    return { g, live: fx.filter((f) => f.state === "live" && m(f)).sort(byTime), done: fx.filter((f) => recent(f) && m(f)).sort((a, b) => (b.ftAt || 0) - (a.ftAt || 0)), next: fx.filter((f) => f.state === "scheduled" && m(f)).sort(byTime) };
  }).filter((c) => c.live.length || c.done.length || c.next.length);
  if (!cols.length) return null;
  const anyLive = cols.some((c) => c.live.length);
  return { key: "games", max: 3, build: (n) => `<div class="ecv-slide ecv-games" style="--c:${Math.min(cols.length, 3)}">
    ${cols.map((c) => `<section><h2 class="ecv-h">${esc(c.g.name)}</h2>${c.live.map((f) => card(ev, f)).join("")}${c.done.slice(0, 2).map((f) => card(ev, f)).join("")}${c.next.length && n > 0 ? `<h3 class="ecv-h3">${c.live.length ? "Up next" : anyLive ? `Next on this ${T.place}` : "Up next"}</h3>${c.next.slice(0, c.live.length ? Math.min(n, 2) : n).map((f) => card(ev, f, { small: true })).join("")}` : ""}</section>`).join("")}</div>` };
}

function tableSlides(S) {
  const ev = S.event, out = [], T = terms(ev);
  ev.divisions.filter((d) => d.format !== "exhibition" && d.format !== "knockout" && d.teams.length).forEach((d) => {
    const ts = tables(d, ev.fixtures, ev.settings.points);
    for (let i = 0; i < ts.length; i += 4) {
      const chunk = ts.slice(i, i + 4);
      out.push({ key: `tab:${d.id}:${i}`, max: 1, build: () => `<div class="ecv-slide"><h2 class="ecv-title">${esc(ev.divisions.length > 1 ? d.name : "Tables")}${ts.length > 4 ? ` <small>${i / 4 + 1}/${Math.ceil(ts.length / 4)}</small>` : ""}</h2><div class="ecv-tabs" style="--c:${chunk.length > 2 ? 2 : chunk.length}">${chunk.map((t) => `<table class="ecv-table"><caption>${t.group ? `Group ${esc(t.group)}` : "Table"}</caption><thead><tr><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>${esc(T.diff.abbr)}</th><th>Pts</th></tr></thead><tbody>${t.rows.map((r, k) => `<tr class="${k < 2 && r.p ? "is-up" : ""}"><td class="t"><i>${k + 1}</i>${esc(r.name)}</td><td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td>${r.gd > 0 ? "+" : ""}${r.gd}</td><td><b>${r.pts}</b></td></tr>`).join("")}</tbody></table>`).join("")}</div></div>` });
    }
  });
  return out;
}

function koSlides(S) {
  const ev = S.event, out = [];
  ev.divisions.forEach((d) => {
    const ko = ev.fixtures.filter((f) => f.division === d.id && f.stage).sort(byTime);
    if (!ko.length) return;
    const map = new Map();
    ko.forEach((f) => { const k = f.stage.replace(/\s*\d+$/, "").trim(); if (!map.has(k)) map.set(k, []); map.get(k).push(f); });
    out.push({ key: `ko:${d.id}`, max: 1, build: () => `<div class="ecv-slide"><h2 class="ecv-title">${esc(ev.divisions.length > 1 ? `${d.name} knockouts` : "Knockouts")}</h2><div class="ecv-bracket" style="--c:${map.size}">${[...map].map(([name, games]) => `<section><h3 class="ecv-h3">${esc(name)}</h3>${games.map((f) => {
      const h = side(ev, f, "home"), a = side(ev, f, "away"), w = winnerOf(f);
      return `<div class="ecv-ko ecv-ko--${esc(f.state)}"><div class="ecv-ko__m">${f.state === "live" ? `<span class="ecv-live">Live</span>` : ""}<span>${esc(f.time)}</span></div><div class="${h.tbc ? "is-tbc " : ""}${w === "home" ? "is-won" : ""}"><span>${esc(h.text)}</span><b>${f.homeScore ?? ""}</b></div><div class="${a.tbc ? "is-tbc " : ""}${w === "away" ? "is-won" : ""}"><span>${esc(a.text)}</span><b>${f.awayScore ?? ""}</b></div></div>`;
    }).join("")}</section>`).join("")}</div></div>` });
  });
  return out;
}

const qrBox = (S, label = "Scan to vote", o = {}) => `<div class="ecv-qrbox"><div class="ecv-qr" role="img" aria-label="QR code for ${esc(o.url || S.fanUrl)}">${o.qr || S.qr || ""}</div><b>${esc(label)}</b><small>${esc(o.host || S.fanHost)}</small></div>`;

// The clubhouse: who it is for, what it gives, and a code that opens the Clubhouse tab.
function clubSlide(S) {
  const ev = S.event, ch = ev.clubhouse;
  if (!ch || ch.on !== true) return null;
  const rewards = (ch.rewards || []).filter((r) => !(r.how === "vote" && isJuniors(ev)));
  return { key: "club", max: Math.max(1, Math.min(rewards.length, 6)), build: (n) => `<div class="ecv-slide ecv-club"><div><p class="ecv-kicker">Join the clubhouse</p><h2>${esc(ev.name)}</h2>${ch.intro ? `<p>${esc(ch.intro)}</p>` : ""}${rewards.length ? `<ul class="ecv-patches" aria-label="Patches to earn">${rewards.slice(0, n).map((r) => `<li class="ecv-patch"><i aria-hidden="true"></i><span><b>${esc(r.name)}</b>${r.text ? `<small>${esc(r.text)}</small>` : ""}</span></li>`).join("")}</ul>` : ""}</div>${qrBox(S, "Scan to join", { qr: S.qrClub, url: S.clubUrl, host: `${S.fanHost}#clubhouse` })}</div>` };
}

function voteSlide(S) {
  const ev = S.event, v = S.votes;
  if (!v) return null;
  const L = v.leaders || [];
  const max = Math.max(...L.map((l) => l.votes), 1);
  return { key: "vote", max: 5, build: (n) => `<div class="ecv-slide ecv-vote"><div><h2 class="ecv-title">Fans' players of the day</h2>${L.length ? `<ol class="ecv-lb">${L.slice(0, n).map((l, i) => `<li class="${i === 0 ? "is-top" : ""}"><i style="--w:${Math.round((l.votes / max) * 100)}%"></i><span class="r">${i + 1}</span><span class="w"><b>${esc(l.label)}</b><small>${esc(l.team)}</small></span><span class="n">${l.votes}</span></li>`).join("")}</ol>` : `<p class="ecv-empty">Votes open when a game kicks off. Scan the code to be first.</p>`}</div>${qrBox(S)}</div>` };
}

function resultsSlide(S) {
  const ev = S.event;
  const done = ev.fixtures.filter((f) => f.state === "ft").sort((a, b) => (b.ftAt || 0) - (a.ftAt || 0) || byTime(b, a));
  if (!done.length) return null;
  return { key: "results", max: 8, build: (n) => `<div class="ecv-slide"><h2 class="ecv-title">Results</h2><div class="ecv-results">${done.slice(0, n).map((f) => card(ev, f, { small: true })).join("")}</div></div>` };
}

function helloSlide(S) {
  const ev = S.event;
  const champs = ev.phase === "post" ? ev.divisions.map((d) => { const c = champion(d, ev.fixtures, ev.settings.points); const t = c && c.id ? d.teams.find((x) => x.id === c.id) : null; return t ? { d, t, c } : null; }).filter(Boolean) : [];
  const bout = ev.phase === "post" && ev.sport === "boxing" ? [...ev.card.bouts].filter((b) => b.result).sort((a, b) => b.order - a.order)[0] : null;
  if (ev.phase === "post" && (champs.length || bout)) {
    return { key: "champ", max: 1, build: () => `<div class="ecv-slide ecv-champ"><p class="ecv-kicker">${champs.length ? "Champions" : esc(bout.title || "Main event")}</p><h2>${esc(champs.length ? champs[0].t.name : bout.result.winner ? bout[bout.result.winner].name : "No winner")}</h2><p>${esc(champs.length ? champs[0].c.how : resultText(bout))}</p>${qrBox(S, "Results and updates")}</div>` };
  }
  return { key: "hello", max: 1, build: () => `<div class="ecv-slide ecv-hello"><div><p class="ecv-kicker">${ev.phase === "pre" ? "Coming up" : ev.phase === "post" ? "That's a wrap" : "Welcome"}</p><h2>${esc(ev.name)}</h2><p>${esc([fmtDate(ev.date), ev.venue].filter(Boolean).join(" at "))}</p>${terms(ev).discipline ? `<p>${esc(terms(ev).discipline)}</p>` : ""}</div>${qrBox(S, ev.phase === "pre" ? "Scan to register" : "Scan to follow live")}</div>` };
}

// ---- Boxing ----
const fighter = (b, k, won) => `<div class="ecv-f ecv-f--${k}${won ? " is-won" : ""}"><small>${k === "red" ? "Red corner" : "Blue corner"}</small><b>${esc(b[k].name)}</b><span>${esc(b[k].club || "")}</span></div>`;

// Two or more rings: the bout on in each ring, side by side.
function ringsSlide(S, entries) {
  const ev = S.event, votes = (S.votes && S.votes.rounds) || [];
  return { key: "bout", max: 1, build: () => `<div class="ecv-slide ecv-rings" style="--c:${entries.length}">${entries.map(({ ring, bout: b }) => {
    const live = b.state === "live" || b.state === "break";
    const r = votes.find((x) => x.bout === b.id && x.round === b.round), t = r ? r.red + r.blue : 0, rp = t ? Math.round((r.red / t) * 100) : 50;
    return `<section class="ecv-ring"><h2 class="ecv-ring__n">${esc(ringName(ev, { pitch: ring }))}</h2><div class="ecv-bout__top">${b.state === "live" ? `<span class="ecv-live">Live</span>` : b.state === "break" ? `<span class="ecv-brk">Break</span>` : `<span class="ecv-next">Up next</span>`}<span>Bout ${esc(b.order)}</span>${b.title ? `<b>${esc(b.title)}</b>` : ""}</div>
      <p class="ecv-round">${live ? `Round <b>${esc(b.round)}</b> of ${esc(b.rounds)}` : `${esc(b.rounds)} rounds`}</p>
      <div class="ecv-vs">${fighter(b, "red", false)}<span class="ecv-vs__v">v</span>${fighter(b, "blue", false)}</div>
      ${live ? `<div class="ecv-fansplit"><div class="ecv-split"><span style="width:${rp}%"></span><em>${t ? rp + "%" : ""}</em><em>${t ? 100 - rp + "%" : ""}</em></div></div>` : ""}</section>`;
  }).join("")}</div>` };
}

function boutSlide(S) {
  const ev = S.event, bouts = [...ev.card.bouts].sort((a, b) => a.order - b.order);
  const rn = hasRings(ev) ? ringsNow(ev) : [];
  if (rn.length > 1) return ringsSlide(S, rn);
  const b = (rn.length === 1 ? rn[0].bout : currentBout(ev.card)) || [...bouts].reverse().find((x) => x.state === "done");
  if (!b) return null;
  const live = b.state === "live" || b.state === "break";
  const r = ((S.votes && S.votes.rounds) || []).find((x) => x.bout === b.id && x.round === b.round);
  const t = r ? r.red + r.blue : 0, rp = t ? Math.round((r.red / t) * 100) : 50;
  const dec = b.state === "done" && b.scoring === "judges" && (ev.scorecards || {})[b.id] ? decision(b, ev.scorecards) : null;
  return { key: "bout", max: 1, build: () => `<div class="ecv-slide ecv-bout"><div class="ecv-bout__top">${b.state === "live" ? `<span class="ecv-live">Live</span>` : b.state === "break" ? `<span class="ecv-brk">Break</span>` : b.state === "done" ? `<span class="ecv-ft">Result</span>` : `<span class="ecv-next">Up next</span>`}${ringName(ev, b) ? `<b>${esc(ringName(ev, b))}</b>` : ""}<span>Bout ${esc(b.order)} of ${bouts.length}</span>${b.title ? `<b>${esc(b.title)}</b>` : ""}${b.weight ? `<span>${esc(b.weight)}</span>` : ""}</div>
    <p class="ecv-round">${live ? `Round <b>${esc(b.round)}</b> of ${esc(b.rounds)}` : b.state === "done" ? esc(resultText(b)) : `${esc(b.rounds)} rounds`}</p>
    <div class="ecv-vs">${fighter(b, "red", b.result && b.result.winner === "red")}<span class="ecv-vs__v">v</span>${fighter(b, "blue", b.result && b.result.winner === "blue")}</div>
    ${live ? `<div class="ecv-fansplit"><p>Fans, round ${esc(b.round)}</p><div class="ecv-split"><span style="width:${rp}%"></span><em>${t ? rp + "%" : "Vote now"}</em><em>${t ? 100 - rp + "%" : ""}</em></div></div>` : ""}
    ${dec && b.result && b.result.method === "PTS" ? `<p class="ecv-judges">Judges ${dec.totals.map(esc).join(" &middot; ")}</p>` : ""}</div>` };
}
function cardSlide(S) {
  const ev = S.event, bouts = [...ev.card.bouts].sort((a, b) => a.order - b.order);
  if (!bouts.length) return null;
  return { key: "card", max: bouts.length, build: (n) => `<div class="ecv-slide"><h2 class="ecv-title">Fight card</h2><div class="ecv-card">${bouts.slice(0, n).map((b) => `<div class="ecv-brow ecv-brow--${esc(b.state)}"><i>${esc(b.order)}</i><span class="red${b.result && b.result.winner === "red" ? " is-won" : ""}">${esc(b.red.name)}</span><em>v</em><span class="blue${b.result && b.result.winner === "blue" ? " is-won" : ""}">${esc(b.blue.name)}</span><small>${[ringName(ev, b), b.result ? resultText(b) : b.state === "live" || b.state === "break" ? `Round ${b.round}` : b.title || ""].filter(Boolean).map(esc).join(" &middot; ")}</small></div>`).join("")}</div></div>` };
}
function fansSlide(S) {
  const v = S.votes, F = (v && v.fighters) || [];
  if (!v) return null;
  const max = Math.max(...F.map((l) => l.votes), 1);
  return { key: "fans", max: 5, build: (n) => `<div class="ecv-slide ecv-vote"><div><h2 class="ecv-title">Fans' fighter of the night</h2>${F.length ? `<ol class="ecv-lb">${F.slice(0, n).map((l, i) => `<li class="ecv-lb--${esc(l.corner)}${i === 0 ? " is-top" : ""}"><i style="--w:${Math.round((l.votes / max) * 100)}%"></i><span class="r">${i + 1}</span><span class="w"><b>${esc(l.name)}</b></span><span class="n">${l.votes}</span></li>`).join("")}</ol>` : `<p class="ecv-empty">Vote every round from your phone. Scan the code.</p>`}</div>${qrBox(S)}</div>` };
}

export function buildSlides(S) {
  const ev = S.event, out = [];
  const add = (s) => { if (s) out.push(s); };
  const votes = !isJuniors(ev); // a youth event has no fan voting, so no vote slide
  if (ev.sport === "boxing") {
    if (ev.phase === "post") add(helloSlide(S));
    add(boutSlide(S)); add(cardSlide(S));
    if (ev.phase !== "pre") { if (votes) add(fansSlide(S)); } else add(helloSlide(S));
    add(clubSlide(S));
    return out;
  }
  if (ev.phase === "pre") { add(helloSlide(S)); add(gamesSlide(S)); tableSlides(S).forEach(add); add(clubSlide(S)); return out; }
  if (ev.phase === "post") { add(helloSlide(S)); add(resultsSlide(S)); tableSlides(S).forEach(add); koSlides(S).forEach(add); if (votes) add(voteSlide(S)); add(clubSlide(S)); return out; }
  add(gamesSlide(S));
  tableSlides(S).forEach(add);
  koSlides(S).forEach(add);
  if (votes) add(voteSlide(S));
  if (!out.length) add(helloSlide(S));
  add(clubSlide(S));
  return out;
}

export function goalHtml(S, g) {
  const ev = S.event, f = ev.fixtures.find((x) => x.id === g.id);
  if (!f) return "";
  const h = side(ev, f, "home"), a = side(ev, f, "away");
  return `<div class="ecv-goal" role="status"><p>${esc(terms(ev).Score)}</p><h2>${esc(g.team)}</h2><div class="ecv-goal__s"><span>${esc(h.text)}</span><b>${esc(f.homeScore)}<i>-</i>${esc(f.awayScore)}</b><span>${esc(a.text)}</span></div><small>${esc(pitchName(ev, f.pitch))}</small></div>`;
}
