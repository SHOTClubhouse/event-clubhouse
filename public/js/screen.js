// Big screen for one event: /e/<slug>/screen/. No interaction. Polls every 5 seconds, rotates
// slides every 12, interrupts with a goal moment, and shrinks each slide until it fits the TV.

import { watchEvent, api } from "/js/api.js";
import { applyTheme, esc, side } from "/js/ui.js";
import { buildSlides, goalHtml } from "/js/screen-slides.js";
import { finishers } from "/js/fit-screen.js";

const slug = (location.pathname.match(/^\/e\/([^/]+)/) || [])[1] || "";
const $ = (s) => document.querySelector(s);
const ROTATE_MS = Number(new URLSearchParams(location.search).get("every")) * 1000 || 10000, GOAL_MS = 4000, SCALES = [1, 0.92, 0.84, 0.76, 0.68, 0.6, 0.52];
const S = { event: null, votes: null, qr: "", qrClub: "", fanUrl: `${location.origin}/e/${slug}/`, fanHost: `${location.host}/e/${slug}/`, clubUrl: `${location.origin}/e/${slug}/#clubhouse`, seenFt: {}, lastOk: 0, key: null, slides: [] };
let idx = 0, lastHtml = "", goalUntil = 0, goals = [], rotTimer = null;

const rawGet = api.get;
api.get = async (path, opts) => { const r = await rawGet(path, opts); if (typeof path === "string" && path.startsWith("/api/events/")) S.lastOk = Date.now(); return r; };

// ---- QR code (qrcode-generator, loaded once) ----
function loadQr() {
  const sc = document.createElement("script");
  sc.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js";
  sc.integrity = "sha384-mZT2gIty7ZDdOGkxfP6joZcYdMW1Jvj9dRlfpTmaJAKKXTqzygtB22k7FLe+KZC1"; sc.crossOrigin = "anonymous";
  sc.onload = () => {
    try {
      const q = window.qrcode(0, "M"); q.addData(S.fanUrl); q.make(); S.qr = q.createSvgTag({ scalable: true, margin: 0 });
      const c = window.qrcode(0, "M"); c.addData(S.clubUrl); c.make(); S.qrClub = c.createSvgTag({ scalable: true, margin: 0 }); // the same page, opened on the Clubhouse tab
      lastHtml = ""; paintFooter(); refresh(true);
    } catch (e) { /* the URL text still shows */ }
  };
  document.head.appendChild(sc);
}

// ---- Fit: fewer rows, then smaller type, until the slide fits ----
function fit(slide) {
  const stage = $("#stage");
  const ok = () => { const el = stage.firstElementChild; return !el || (el.offsetHeight <= stage.clientHeight + 1 && el.scrollWidth <= stage.clientWidth + 1); };
  const floor = slide.key === "games" ? 0 : 1;
  for (let n = slide.max; n >= floor; n--) {
    for (const f of SCALES) { stage.style.setProperty("--f", f); stage.innerHTML = slide.build(n); if (ok()) return true; }
  }
  return false;
}

// ---- Slides ----
function show(advance) {
  if (!S.event) return;
  if (Date.now() < goalUntil) return;
  S.slides = buildSlides(S);
  if (!S.slides.length) return;
  let i = S.slides.findIndex((s) => s.key === S.key);
  if (advance) i = i < 0 ? 0 : (i + 1) % S.slides.length;
  else if (i < 0) i = Math.min(idx, S.slides.length - 1);
  idx = i;
  const slide = S.slides[i];
  S.key = slide.key;
  const sig = slide.key + "|" + slide.build(slide.max);
  const stage = $("#stage");
  if (sig !== lastHtml || advance) { lastHtml = sig; fit(slide); stage.dataset.slide = slide.key; stage.classList.remove("is-in"); void stage.offsetWidth; stage.classList.add("is-in"); }
  $("#dots").innerHTML = S.slides.map((s, k) => `<i${k === i ? ' class="on"' : ""}></i>`).join("");
}
const refresh = (force) => { if (force) lastHtml = ""; show(false); };

function paintHead() {
  const ev = S.event; if (!ev) return;
  const th = ev.theme || {};
  $("#title").textContent = ev.name;
  document.title = `Big screen | ${ev.name}`;
  $("#partner").innerHTML = (th.logo ? `<img src="${esc(th.logo)}" alt="${esc(th.partner || ev.name)}">` : "") + (th.partner ? `${th.logo ? "" : `<span>${esc(th.partner)}</span>`}<i aria-hidden="true">&times;</i>` : "");
  $("#livetag").hidden = ev.phase !== "live";
  $("#phase").textContent = ev.phase === "pre" ? "Coming up" : ev.phase === "post" ? "Full time" : "";
}
function paintFooter() {
  $("#fqr").innerHTML = S.qr;
  $("#furl").textContent = S.fanHost;
  const ev = S.event;
  $("#fpartner").textContent = ev && ev.theme && ev.theme.partner ? `${ev.theme.partner} with SHOT` : "";
}
function tick() {
  const d = new Date();
  $("#clock").textContent = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const stale = S.lastOk && Date.now() - S.lastOk > 20000;
  $("#stale").hidden = !stale;
  if (stale) $("#stale").textContent = "Reconnecting to live scores";
}

// ---- Goals ----
function detectGoals(old, ev) {
  if (!old || ev.sport !== "football") return;
  const o = new Map(old.fixtures.map((f) => [f.id, f]));
  ev.fixtures.forEach((f) => {
    const p = o.get(f.id);
    const pg = p ? (p.goals || []).length : 0, fg = (f.goals || []).length;
    if (p && p.state !== "ft" && f.state !== "ft" && fg > pg) {
      f.goals.slice(pg).forEach((g) => goals.push({ id: f.id, team: side(ev, f, g.side).text, label: g.label || "", min: g.min == null ? null : g.min }));
    } else if (p && p.state !== "ft" && f.state !== "ft" && !fg && f.homeScore != null && p.homeScore != null) {
      if (f.homeScore > p.homeScore) goals.push({ id: f.id, team: side(ev, f, "home").text });
      else if (f.awayScore > p.awayScore) goals.push({ id: f.id, team: side(ev, f, "away").text });
    }
    if (p && p.state !== "ft" && f.state === "ft") S.seenFt[f.id] = Date.now();
  });
}
function playGoal() {
  if (Date.now() < goalUntil || !goals.length || !S.event) return;
  const g = goals.shift();
  const html = goalHtml(S, g);
  if (!html) return playGoal();
  goalUntil = Date.now() + GOAL_MS;
  const layer = $("#goal");
  layer.innerHTML = html; layer.hidden = false;
  setTimeout(() => { layer.hidden = true; layer.innerHTML = ""; goalUntil = 0; lastHtml = ""; if (goals.length) playGoal(); else show(false); }, GOAL_MS);
}

// ---- Data ----
function onChange(ev) {
  const old = S.event;
  S.event = ev;
  detectGoals(old, ev);
  if (ev.sport === "fitness") finishers(old, ev);
  applyTheme(ev); paintHead(); paintFooter();
  show(false);
  playGoal();
}
async function votes() {
  if (!S.event || S.event.phase === "pre") return;
  try { S.votes = await rawGet(`/api/events/${slug}/votes`); S.lastOk = Date.now(); show(false); } catch (e) { /* next poll */ }
}

// ---- Full screen button ----
const fs = $("#fs");
fs.addEventListener("click", () => { const el = document.documentElement; (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el); fs.hidden = true; });
document.addEventListener("fullscreenchange", () => { fs.hidden = !!document.fullscreenElement; });
window.addEventListener("resize", () => refresh(true));

loadQr();
setInterval(tick, 1000); tick();
setInterval(votes, 5000);
rotTimer = setInterval(() => show(true), ROTATE_MS);
watchEvent(slug, (ev) => { onChange(ev); if (!S.votes) votes(); }, { every: 5000, onError: () => { $("#stage").dataset.err = "1"; if (!S.event) $("#stage").innerHTML = `<div class="ecv-slide ecv-hello"><div><h2>Waiting for the event</h2><p>Check the link. This screen keeps trying.</p></div></div>`; } });
