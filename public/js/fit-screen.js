// Big screen for fitness events: slides (the live heats, a leaderboard for each category, the
// next waves) and the gentle "Finisher" moment. screen-slides.js hands off here for sport
// "fitness"; each slide is { key, max, build(n) } like the others.

import { esc } from "/js/ui.js";
import { leaderboard, onCourse, nextHeats } from "/core/fitness.js";
import { terms } from "/core/model.js";
import { fmtDate } from "/js/event-views.js";
import { comp, isRace, segs, catName, fmtTime, ordinal } from "/js/fit-lib.js";

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sortLive = (a, b) => (b.done - a.done) || (a.bib - b.bib);

function rowHtml(ev, e, N) {
  const race = isRace(ev);
  let right = "", cls = "";
  if (e.state === "finished") { cls = " is-fin"; right = race ? fmtTime(e.last) : "Finished"; }
  else if (e.state === "dnf") { cls = " is-out"; right = "Did not finish"; }
  else if (e.state === "dns") { cls = " is-out"; right = "Did not start"; }
  else right = e.last != null ? (race ? fmtTime(e.last) : "") : "";
  const seg = e.state === "racing" || e.state === "ready" ? (e.segment ? `${e.current + 1} of ${N}: ${e.segment.name}` : "") : "";
  return `<li class="ecvf-ath${cls}"><span class="ecvf-ath__who"><b>${esc(e.label)}</b><small>${esc(seg)}</small></span><span class="ecvf-ath__t">${esc(right)}</span><span class="ecvf-bar" aria-hidden="true"><i style="--w:${N ? Math.round((e.done / N) * 100) : 0}%"></i></span></li>`;
}

function liveSlide(S) {
  const ev = S.event, heats = onCourse(ev), N = segs(ev).length;
  if (!heats.length) return null;
  const most = Math.min(12, Math.max(...heats.map((h) => h.entries.length), 1));
  return { key: "fit:live", max: most, build: (n) => `<div class="ecv-slide ecvf-live" style="--c:${Math.min(heats.length, 3)}">${heats.slice(0, 3).map(({ heat, entries }) => {
    const sorted = [...entries].sort(sortLive), shown = sorted.slice(0, n);
    return `<section><h2 class="ecv-h">${esc(heat.name)} <small>${esc(heat.time)}${comp(ev).categories.length > 1 && heat.category ? `, ${esc(catName(ev, heat.category))}` : ""}</small></h2>
      <ul class="ecvf-aths">${shown.map((e) => rowHtml(ev, e, N)).join("")}</ul>${sorted.length > shown.length ? `<p class="ecv-h3">and ${sorted.length - shown.length} more</p>` : ""}</section>`;
  }).join("")}</div>` };
}

function boardSlides(S) {
  const ev = S.event, race = isRace(ev), N = segs(ev).length, byId = new Map(comp(ev).entries.map((e) => [e.id, e]));
  return comp(ev).categories.map((k) => {
    const rows = leaderboard(ev, k.id).filter((r) => r.rank != null);
    if (!rows.length) return null;
    return { key: `fit:lb:${k.id}`, max: 8, build: (n) => `<div class="ecv-slide"><h2 class="ecv-title">${esc(k.name)} <small>${esc(race ? "Leaderboard" : "Leaderboard, lowest points wins")}</small></h2>
      <ol class="ecv-lb ecvf-lb">${rows.slice(0, n).map((r) => {
        const e = byId.get(r.id);
        const val = race ? (r.state === "finished" ? fmtTime(r.total) : `${r.done} of ${N}`) : `${r.points} ${r.points === 1 ? "pt" : "pts"}`;
        const sub = [e && e.club, race && r.state !== "finished" ? "still racing" : !race ? `${r.done} of ${N} scored` : ""].filter(Boolean).join(", ");
        return `<li class="${r.rank === 1 ? "is-top" : ""}"><i style="--w:${N ? Math.round((r.done / N) * 100) : 0}%"></i><span class="r">${r.rank}</span><span class="w"><b>${esc(r.label)}</b><small>${esc(sub)}</small></span><span class="n">${esc(val)}</span></li>`;
      }).join("")}</ol></div>` };
  }).filter(Boolean);
}

function nextSlide(S) {
  const ev = S.event, T = terms(ev), list = nextHeats(ev, 6);
  if (!list.length) return null;
  return { key: "fit:next", max: 6, build: (n) => `<div class="ecv-slide"><h2 class="ecv-title">Up next on the ${esc(T.place)}</h2><div class="ecvf-next">${list.slice(0, n).map(({ heat, entries }) => `<div class="ecvf-wave"><span class="ecvf-wave__t">${esc(heat.time)}</span><span class="ecvf-wave__w"><b>${esc(heat.name)}</b><small>${esc([catName(ev, heat.category), plural(entries.length, "athlete")].filter(Boolean).join(", "))}</small></span></div>`).join("")}</div></div>` };
}

function helloSlide(S) {
  const ev = S.event;
  return { key: "fit:hello", max: 1, build: () => `<div class="ecv-slide ecv-hello"><div><p class="ecv-kicker">${ev.phase === "pre" ? "Coming up" : ev.phase === "post" ? "That's a wrap" : "Welcome"}</p><h2>${esc(ev.name)}</h2><p>${esc([fmtDate(ev.date), ev.venue].filter(Boolean).join(" at "))}</p>${terms(ev).discipline ? `<p>${esc(terms(ev).discipline)}</p>` : ""}</div></div>` };
}

export function fitSlides(S) {
  const ev = S.event, out = [];
  const add = (s) => { if (s) out.push(s); };
  if (ev.phase === "pre") { add(helloSlide(S)); add(nextSlide(S)); return out; }
  if (ev.phase === "post") { add(helloSlide(S)); boardSlides(S).forEach(add); return out; }
  add(liveSlide(S));
  boardSlides(S).forEach(add);
  add(nextSlide(S));
  if (!out.length) add(helloSlide(S));
  return out;
}

// ---- The Finisher moment ----
// A small banner, not a takeover. At most one every GAP_MS, however many finish together.
const SHOW_MS = 4200, GAP_MS = 6000, MAX_QUEUE = 3;
const queue = [];
let busy = false, lastAt = 0, layer = null;

function host() {
  if (layer) return layer;
  layer = document.createElement("div");
  layer.className = "ecvf-fin";
  layer.setAttribute("role", "status");
  layer.hidden = true;
  document.body.appendChild(layer);
  return layer;
}

function pump() {
  if (busy || !queue.length) return;
  busy = true;
  const wait = Math.max(0, lastAt + GAP_MS - Date.now());
  setTimeout(() => {
    const f = queue.shift(), el = host();
    el.innerHTML = `<p>Finisher</p><h2>${esc(f.label)}</h2><div>${esc(f.time)}${f.rank ? ` &middot; ${esc(f.rank)}` : ""}</div>`;
    el.hidden = false;
    lastAt = Date.now();
    setTimeout(() => { el.hidden = true; el.innerHTML = ""; busy = false; pump(); }, SHOW_MS);
  }, wait);
}

export function finishers(old, ev) {
  if (!old || !isRace(ev) || document.hidden) return;
  const was = new Map(comp(old).entries.map((e) => [e.id, e]));
  comp(ev).entries.forEach((e) => {
    const p = was.get(e.id);
    if (!p || p.state === "finished" || e.state !== "finished") return;
    const row = leaderboard(ev, e.category).find((r) => r.id === e.id);
    const k = catName(ev, e.category);
    const rank = row && row.rank ? `${ordinal(row.rank)}${k ? ` in ${k}` : ""}` : k;
    if (queue.length < MAX_QUEUE) queue.push({ label: e.label, time: fmtTime(e.results[e.results.length - 1]), rank });
  });
  pump();
}
