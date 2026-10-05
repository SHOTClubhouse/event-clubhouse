// Fan app for one event: /e/<slug>/. One page, no framework. State lives in S; views are pure
// (event-views.js, event-vote.js); this file polls, renders and wires the taps.

import { watchEvent, voterId, api } from "/js/api.js";
import { applyTheme, toast, esc, startVideos, streamHtml, side } from "/js/ui.js";
import { streamInfo } from "/core/model.js";
import { resultText } from "/core/boxing.js";
import { headerHtml, tabsFor, defaultTab, viewFor, skeleton } from "/js/event-views.js";
import { clubhouseView, syncPatches, loadPatches } from "/js/event-clubhouse.js";
import { voteView, over13, setOver13, loadMine, saveMine, loadFollow, saveFollow, loadReg, saveReg, lockText } from "/js/event-vote.js";

const slug = (location.pathname.match(/^\/e\/([^/]+)/) || [])[1] || "";
const $ = (s, r = document) => r.querySelector(s);
const S = { event: null, votes: null, votesAt: 0, tab: null, filters: { pitch: "all", div: "all", mineOnly: false }, follow: loadFollow(slug), mine: loadMine(slug), reg: loadReg(slug), patches: loadPatches(slug), lockAt: {}, pendingReason: {}, lastOk: 0, fails: 0, err: null, posting: false, streamSel: 0, streamOn: false };
const last = { head: "", nav: "", view: "", tab: "" };
let watcher = null, votesTimer = null, announceTimer = null;

// The poller (api.js watchEvent) gets 204 on a quiet event and never calls back, so the
// "updated Xs ago" clock hooks the shared client to learn that a check succeeded.
const rawGet = api.get;
api.get = async (path, opts) => {
  const r = await rawGet(path, opts);
  if (typeof path === "string" && path.startsWith(`/api/events/${slug}`) && !path.includes("/votes")) { S.lastOk = Date.now(); S.fails = 0; S.err = null; paintStatus(); }
  return r;
};

// ---- Rendering ----
function setHtml(el, key, html) { if (last[key] === html) return false; last[key] = html; el.innerHTML = html; return true; }

function activeTab(ev) {
  const tabs = tabsFor(ev, S.votes);
  const h = location.hash.slice(1);
  const id = tabs.some((t) => t[0] === h) ? h : tabs.some((t) => t[0] === S.tab) && !h ? S.tab : defaultTab(ev);
  return { tabs, id: tabs.some((t) => t[0] === id) ? id : tabs[0][0] };
}

function snapshotForms() {
  const f = $("form[data-reg]");
  if (!f) return null;
  return [...f.elements].filter((e) => e.name).map((e) => [e.name, e.type === "checkbox" ? e.checked : e.value]);
}
function restoreForms(snap) {
  const f = $("form[data-reg]");
  if (!f || !snap) return;
  snap.forEach(([n, v]) => { const e = f.elements[n]; if (!e) return; if (e.type === "checkbox") e.checked = v; else e.value = v; });
}

function render() {
  const ev = S.event, main = $("#view");
  if (!ev) {
    if (S.err) main.innerHTML = errorHtml(S.err);
    return;
  }
  applyTheme(ev);
  document.title = `${ev.name} | SHOT Event Clubhouse`;
  setHtml($("#head"), "head", headerHtml(ev));
  const { tabs, id } = activeTab(ev);
  const unlocked = syncPatches(S, slug);
  const changed = S.tab !== id;
  S.tab = id;
  const open = S.votes && S.votes.now ? S.votes.now.length : 0;
  setHtml($("#nav"), "nav", tabs.map(([k, n]) => `<a class="ece-tab" href="#${k}"${k === id ? ' aria-current="page"' : ""}>${esc(n)}${k === "vote" && open ? `<span class="ece-dot" aria-hidden="true">${open}</span><span class="ece-sr"> open now</span>` : ""}</a>`).join(""));
  const html = id === "vote" ? voteView(S) : id === "clubhouse" ? clubhouseView(S) : viewFor(id, S);
  const key = id + "|" + html;
  const focusKey = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.k : null;
  const snap = snapshotForms();
  if (last.view !== key) {
    last.view = key;
    main.innerHTML = html;
    main.dataset.tab = id;
    restoreForms(snap);
    if (focusKey) { const el = main.querySelector(`[data-k="${CSS.escape(focusKey)}"]`); if (el) el.focus({ preventScroll: true }); }
  }
  if (changed) {
    const top = $("#stick").getBoundingClientRect().top + window.scrollY;
    if (window.scrollY > top) window.scrollTo(0, top);
  }
  syncStream();
  tickLocks();
  paintStatus();
  // A small, polite toast once per patch, a moment after any other message.
  unlocked.forEach((r, i) => setTimeout(() => toast(`Patch unlocked: ${r.name}`, "ok", 3200), 1500 + i * 3400));
}

function errorHtml(e) {
  const nf = e && e.status === 404;
  return `<div class="ece-wrap"><div class="ece-card ece-error" role="alert"><h2 class="ece-h">${nf ? "We can't find that event" : "We can't load the event"}</h2><p>${esc(nf ? "Check the link, or try one of the live demos." : e.message || "Check your signal and try again.")}</p>${nf ? `<a class="ec-btn" href="/demo/">See the demo events</a>` : `<button type="button" class="ec-btn" data-retry>Try again</button>`}</div></div>`;
}

// ---- Status: freshness and offline ----
function paintStatus() {
  const f = $("#fresh"), b = $("#banner");
  if (!f) return;
  const age = S.lastOk ? Math.round((Date.now() - S.lastOk) / 1000) : null;
  f.textContent = age == null ? "Connecting" : age < 5 ? "Updated just now" : age < 60 ? `Updated ${age}s ago` : `Updated ${Math.floor(age / 60)}m ago`;
  const offline = !navigator.onLine || (S.lastOk && age > 20) || (!S.lastOk && S.fails > 1);
  f.classList.toggle("is-stale", !!offline);
  if (b) {
    b.hidden = !offline || !S.event;
    if (!b.hidden) b.textContent = !navigator.onLine ? "You're offline. Scores will update when you're back." : `Having trouble connecting. These scores are from ${age >= 60 ? Math.floor(age / 60) + " min" : age + "s"} ago.`;
  }
}

// ---- Locks ----
function tickLocks() {
  let expired = false;
  document.querySelectorAll("[data-lock]").forEach((el) => {
    const at = S.lockAt[el.dataset.lock];
    if (at == null) { el.textContent = "Open"; return; }
    const left = at - Date.now();
    el.textContent = lockText(left);
    el.classList.toggle("is-locked", left <= 0);
    if (left <= 0) expired = true;
  });
  if (expired && Date.now() - S.votesAt > 2500) loadVotes();
}

// ---- Votes ----
function ingest(t) {
  S.votes = t; S.votesAt = Date.now();
  const seen = new Set();
  (t.now || []).forEach((x) => {
    seen.add(x.target);
    if (x.locksIn == null) { delete S.lockAt[x.target]; return; }
    const at = Date.now() + x.locksIn * 1000, old = S.lockAt[x.target];
    if (!old || Math.abs(at - old) > 2500) S.lockAt[x.target] = at;
  });
  Object.keys(S.lockAt).forEach((k) => { if (!seen.has(k)) delete S.lockAt[k]; });
}
async function loadVotes() {
  if (!S.event || S.event.phase === "pre") return;
  try { ingest(await rawGet(`/api/events/${slug}/votes`)); render(); } catch (e) { /* the next poll tries again */ }
}
function scheduleVotes() {
  clearTimeout(votesTimer);
  const ev = S.event;
  if (!ev || ev.phase === "pre") return;
  const ms = ev.phase === "live" ? (ev.settings.vote.open ? 10000 : 30000) : 60000;
  votesTimer = setTimeout(async () => { if (!document.hidden) await loadVotes(); scheduleVotes(); }, ms);
}

async function castVote(target, choice, reason) {
  if (S.posting) return;
  if (!over13()) { toast("Confirm you're 13 or over first.", "warn"); return; }
  const prev = S.mine[target];
  S.posting = true;
  S.mine[target] = { choice, reason: reason || null };
  render();
  try {
    const r = await api.post(`/api/events/${slug}/votes`, { voter: voterId(), target, choice, reason: reason || null, over13: true });
    if (r.mine) S.mine[target] = { choice: r.mine.choice, reason: r.mine.reason || null };
    saveMine(slug, S.mine);
    if (r.tally) ingest(r.tally);
    toast(prev ? "Vote changed." : "Vote in. Thanks.", "ok");
  } catch (e) {
    if (prev) S.mine[target] = prev; else delete S.mine[target];
    toast(e.message, e.status === 409 ? "warn" : "error", 4000);
    if (e.status === 409) loadVotes();
  }
  S.posting = false;
  render();
}

// ---- Streams: a host outside the re-rendered view, so a playing stream is never rebuilt ----
function streamList(ev) {
  const l = [];
  const e = streamInfo(ev.stream);
  if (e) l.push({ id: "event", name: "Event stream", label: (ev.stream && ev.stream.label) || "Live stream", info: e });
  ev.pitches.forEach((p) => { const i = streamInfo(p.stream); if (i) l.push({ id: p.id, name: p.name, label: p.stream.label || p.name, info: i }); });
  return l;
}
function syncStream() {
  const host = $("#stream"), ev = S.event;
  const list = ev && ev.phase === "live" ? streamList(ev) : [];
  if (!list.length || S.tab !== "now") { if (!host.hidden || last.stream) { host.hidden = true; host.innerHTML = ""; last.stream = ""; } return; }
  if (S.streamSel >= list.length) S.streamSel = 0;
  const sig = JSON.stringify(list.map((x) => [x.id, x.info.url])) + S.streamSel + S.streamOn;
  if (sig === last.stream) return;
  last.stream = sig; host.hidden = false;
  const cur = list[S.streamSel];
  host.innerHTML = `<section class="ece-stream" aria-label="Live stream"><div class="ece-stream__top"><h2 class="ece-h">Watch live</h2>${list.length > 1 ? `<div class="ece-seg" role="group" aria-label="Choose a stream">${list.map((x, i) => `<button type="button" data-stream="${i}" aria-pressed="${i === S.streamSel}">${esc(x.name)}</button>`).join("")}</div>` : ""}</div>
    ${S.streamOn || cur.info.kind === "link" ? streamHtml({ ...(cur.id === "event" ? ev.stream : ev.pitches.find((p) => p.id === cur.id).stream) }) : `<button type="button" class="ece-poster" data-play><span class="ece-poster__play" aria-hidden="true"></span><b>Watch ${esc(cur.label)}</b><small>Starts muted. Tap the video for sound.</small></button>`}</section>`;
  startVideos(host);
}

// ---- Announcements for screen readers, and the score flash ----
function announce(msg) {
  const el = $("#announce");
  clearTimeout(announceTimer);
  el.textContent = "";
  announceTimer = setTimeout(() => { el.textContent = msg; }, 60);
}
function changes(oldEv, ev) {
  const msgs = [], flash = [];
  const o = new Map(oldEv.fixtures.map((f) => [f.id, f]));
  ev.fixtures.forEach((f) => {
    const p = o.get(f.id);
    if (!p || (p.homeScore === f.homeScore && p.awayScore === f.awayScore && p.state === f.state)) return;
    const h = side(ev, f, "home").text, a = side(ev, f, "away").text;
    if (p.homeScore !== f.homeScore || p.awayScore !== f.awayScore) flash.push(f.id);
    msgs.push(f.state === "ft" ? `Full time: ${h} ${f.homeScore}, ${a} ${f.awayScore}` : f.homeScore != null ? `${f.state === "live" && p.state !== "live" ? "Kick-off. " : "Score: "}${h} ${f.homeScore}, ${a} ${f.awayScore}` : "");
  });
  const ob = new Map((oldEv.card.bouts || []).map((b) => [b.id, b]));
  ev.card.bouts.forEach((b) => {
    const p = ob.get(b.id);
    if (!p || (p.state === b.state && p.round === b.round)) return;
    msgs.push(b.state === "done" ? resultText(b) : b.state === "break" ? `Round ${b.round} over` : b.state === "live" ? `${b.red.name} against ${b.blue.name}, round ${b.round}` : "");
  });
  return { msgs: msgs.filter(Boolean).slice(0, 3), flash };
}
function flashScores(ids) {
  ids.forEach((id) => document.querySelectorAll(`[data-fx="${CSS.escape(id)}"] [data-score]`).forEach((el) => { el.classList.remove("is-flash"); void el.offsetWidth; el.classList.add("is-flash"); setTimeout(() => el.classList.remove("is-flash"), 1800); }));
}

// ---- Data in ----
function onChange(ev) {
  const old = S.event;
  S.event = ev; S.err = null;
  const phaseChanged = !old || old.phase !== ev.phase;
  const c = old ? changes(old, ev) : { msgs: [], flash: [] };
  render();
  if (c.flash.length) flashScores(c.flash);
  if (c.msgs.length) announce(c.msgs.join(". "));
  if (phaseChanged || !S.votes) { loadVotes(); scheduleVotes(); }
}
function onError(e) {
  S.fails++;
  if (!S.event) { S.err = e; render(); }
  paintStatus();
}

// ---- Taps ----
function go(tab) { if (location.hash.slice(1) === tab) render(); else location.hash = tab; }

document.addEventListener("click", async (e) => {
  const t = e.target.closest("button, a");
  if (!t) return;
  if (t.dataset.vote) {
    const target = t.dataset.target, mine = S.mine[target];
    const isRound = target.startsWith("r:");
    castVote(target, t.dataset.vote, isRound ? (mine && mine.reason) || S.pendingReason[target] || null : null);
  } else if (t.dataset.reason) {
    const target = t.dataset.target, mine = S.mine[target], r = t.dataset.reason;
    if (mine) castVote(target, mine.choice, mine.reason === r ? null : r);
    else { S.pendingReason[target] = S.pendingReason[target] === r ? null : r; render(); }
  } else if ("over13" in t.dataset) { setOver13(); render(); }
  else if (t.dataset.go) go(t.dataset.go);
  else if (t.dataset.fpitch) { S.filters.pitch = t.dataset.fpitch; render(); }
  else if (t.dataset.followTeam) { S.follow = S.follow === t.dataset.followTeam ? null : t.dataset.followTeam; saveFollow(slug, S.follow); render(); toast(S.follow ? "Following. We'll highlight their games." : "Unfollowed.", "ok"); }
  else if (t.dataset.stream != null) { S.streamSel = Number(t.dataset.stream); S.streamOn = true; syncStream(); }
  else if ("play" in t.dataset) { S.streamOn = true; syncStream(); const v = $("#stream iframe, #stream video"); if (v) v.focus(); }
  else if ("retry" in t.dataset) { S.err = null; $("#view").innerHTML = skeleton(); watcher.refresh(); }
  else if ("share" in t.dataset) share();
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if ("follow" in t.dataset) { S.follow = t.value || null; saveFollow(slug, S.follow); if (!S.follow) S.filters.mineOnly = false; render(); }
  else if ("fdiv" in t.dataset) { S.filters.div = t.value; render(); }
  else if ("mine" in t.dataset) { S.filters.mineOnly = t.checked; render(); }
});
document.addEventListener("submit", (e) => {
  const f = e.target.closest("form[data-reg]");
  if (!f) return;
  e.preventDefault();
  register(f);
});
window.addEventListener("hashchange", () => render());
window.addEventListener("online", () => { paintStatus(); if (watcher) watcher.refresh(); });
window.addEventListener("offline", paintStatus);
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadVotes(); });

async function share() {
  const ev = S.event, url = `${location.origin}/e/${slug}/`;
  if (navigator.share) { try { await navigator.share({ title: ev ? ev.name : "Event", text: `Follow ${ev ? ev.name : "the event"} live`, url }); } catch (e) { /* closed the sheet */ } return; }
  try { await navigator.clipboard.writeText(url); toast("Link copied.", "ok"); }
  catch (e) {
    const ta = document.createElement("textarea"); ta.value = url; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch (x) { /* ignore */ }
    ta.remove(); toast(ok ? "Link copied." : url, ok ? "ok" : "warn", 5000);
  }
}

// ---- Register ----
async function register(form) {
  const err = form.querySelector("[data-reg-error]"), btn = form.querySelector("button[type=submit]");
  const v = new FormData(form), name = String(v.get("firstName") || "").trim(), email = String(v.get("email") || "").trim();
  const bad = (field, msg) => { err.textContent = msg; err.hidden = false; const el = form.elements[field]; if (el) { el.setAttribute("aria-invalid", "true"); el.focus(); } };
  form.querySelectorAll("[aria-invalid]").forEach((x) => x.removeAttribute("aria-invalid"));
  err.hidden = true;
  if (!name) return bad("firstName", "Add your first name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return bad("email", "That email address doesn't look right. Check it and try again.");
  if (!v.get("over13")) return bad("over13", "Registration is for people aged 13 and over. Tick the box to confirm.");
  if (!v.get("consent")) return bad("consent", "Tick the box to say you're happy to hear from us.");
  btn.disabled = true; btn.textContent = "Sending...";
  try {
    const r = await api.post(`/api/events/${slug}/register`, { firstName: name, email, over13: true, consent: true, website: String(v.get("website") || "") });
    S.reg = { state: r.demo ? "demo" : "ok", name, at: Date.now() }; // the name stays on this device
    saveReg(slug, S.reg);
    render();
    const h = $("#view .ece-reg--done h2") || $("#view [data-member-card]"); if (h) { h.setAttribute("tabindex", "-1"); h.focus(); }
  } catch (e) {
    btn.disabled = false; btn.textContent = "Register";
    err.textContent = e.message; err.hidden = false;
  }
}

// ---- Go ----
$("#view").innerHTML = skeleton();
setInterval(() => { paintStatus(); tickLocks(); }, 1000);
watcher = watchEvent(slug, onChange, { every: 5000, onError });
