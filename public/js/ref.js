// Referee, timekeeper and judge dashboard. One page, opened as /ref/?e=<slug>.
//
// State ownership: S.server is the last copy the website gave us. What the screen shows is that
// copy with the phone's waiting ops applied on top (ref-queue.js), so a tap shows at once, a
// lost signal loses nothing, and nothing is ever applied twice.

import { api, session, sessionsFor, signOut, watchEvent } from "./api.js";
import { $, applyTheme, esc, plural, toast } from "./ui.js";
import * as Q from "./ref-queue.js";
import { formatCode, signInHtml, trySignIn } from "./ref-auth.js";
import * as Foot from "./ref-football.js";
import * as Box from "./ref-boxing.js";

const app = $("#app");
const live = $("#say");
const slug = (new URLSearchParams(location.search).get("e") || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
const STAFF = ["referee", "judge"];

const S = {
  view: "signin", sess: null, server: null, rev: 0, fromCache: false, loadError: "",
  auth: false, flushP: null, again: false, retry: 0, timer: null, savedAt: 0,
  refused: [], undo: null, ui: { drafts: {} }, watcher: null, pressing: false, dirty: false, lastHtml: "",
  signin: { value: "", error: "", busy: false, note: "" },
};

// ---------------------------------------------------------------- helpers
const actor = () => ({ role: S.sess.role, id: S.sess.subject });
const clock = (t) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const isNet = (e) => !!e && (e.name === "AbortError" || e.status === 0);
const CACHE = `ec.refcache.v1.${slug}`;
const sayIt = (m) => { live.textContent = ""; setTimeout(() => (live.textContent = m), 30); };

function ctx() {
  const event = Q.derive(S.server, Q.load(slug), actor());
  const off = (event.officials || []).find((o) => o.id === S.sess.subject);
  const me = { id: S.sess.subject, name: off ? off.name : S.sess.label, role: S.sess.role, pitch: off ? off.pitch ?? null : null };
  return { event, me, judging: S.judging, publicDemo: !!S.publicDemo, ui: S.ui, slug, sess: S.sess, send, sendNow, toast, rerender: render };
}

// ---------------------------------------------------------------- sending
function applyServer(r) {
  if (!r || !r.event || r.rev < S.rev) return;
  S.server = r.event; S.rev = r.rev; S.fromCache = false; if (r.judging) S.judging = r.judging; S.loadError = "";
  if (typeof r.publicDemo === "boolean") S.publicDemo = r.publicDemo;
  try { localStorage.setItem(CACHE, JSON.stringify({ rev: r.rev, event: r.event })); } catch (e) { /* too big or private mode: fine */ }
  applyTheme(r.event);
  document.title = `${r.event.name} | Referee | SHOT Event Clubhouse`;
}

function send(ops, { key = null, undo = null, haptic = 0, say: msg = "" } = {}) {
  const c = ctx();
  const err = Q.precheck(c.event, ops[0], actor());
  if (err) { toast(err, "warn", 3600); return false; }
  ops.forEach((op) => Q.push(slug, op, key));
  S.undo = undo ? { ops: undo, msg } : null;
  if (haptic && navigator.vibrate) { try { navigator.vibrate(haptic); } catch (e) { /* not supported */ } }
  if (msg) sayIt(msg);
  render();
  schedule(150);
  return true;
}

function undo() {
  if (!S.undo) return;
  S.undo.ops.forEach((op) => Q.push(slug, op, null));
  sayIt("Undone");
  S.undo = null;
  render();
  schedule(100);
}

function schedule(ms) { clearTimeout(S.timer); S.timer = setTimeout(() => flush(), ms); }

async function post(ops) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try { return await api.post(`/api/events/${encodeURIComponent(slug)}/ops`, { ops }, { token: S.sess.token, signal: ctrl.signal }); } finally { clearTimeout(t); }
}

// retry: try again later. auth: the sign-in has gone. refused: the rules said no, drop that op.
const classify = (e) => {
  if (isNet(e)) return "retry";
  if (e.status === 401) return "auth";
  if (e.status === 429 || e.status >= 500) return "retry";
  return "refused";
};

function sent(batch, r) { Q.remove(slug, batch.map((e) => e.id)); applyServer(r); S.savedAt = Date.now(); S.retry = 0; }
function refuse(entry, message) {
  Q.remove(slug, [entry.id]);
  S.refused.push({ message });
  toast(message, "error", 4200);
  if (S.watcher) S.watcher.refresh();
}

// A queued boxing action the website has already done (the reply was lost, or another timekeeper
// got there first) is dropped quietly instead of being sent and refused.
function alreadyDone(op, event) {
  if (op.op !== "bout.action" || !event) return false;
  const b = (event.card.bouts || []).find((x) => x.id === op.id);
  if (!b) return false;
  if (op.action === "start") return b.state !== "scheduled";
  if (op.action === "end-round") return b.roundEnds && b.roundEnds[op.round] != null;
  if (op.action === "next-round") return b.round > op.round || b.state === "done";
  if (op.action === "reopen") return b.state !== "done";
  return false;
}
function dropDone() { const gone = Q.load(slug).filter((e) => alreadyDone(e.op, S.server)); if (gone.length) Q.remove(slug, gone.map((e) => e.id)); }

async function run(force) {
  if (!S.sess || !Q.size(slug)) return;
  if (!force && navigator.onLine === false) return;
  S.auth = false; render();
  // Boxing actions are not safe to resend blindly, so look at the latest event first.
  if (Q.load(slug).some((e) => e.op.op === "bout.action")) { try { applyServer(await api.get(`/api/events/${encodeURIComponent(slug)}/full`, { token: S.sess.token })); } catch (e) { /* offline: the send below fails the same way */ } }
  while (dropDone(), Q.size(slug)) {
    const batch = Q.load(slug).slice(0, 100);
    try { sent(batch, await post(batch.map((e) => e.op))); continue; } catch (e) {
      const k = classify(e);
      if (k === "auth") { S.auth = true; return; }
      if (k === "retry") return backoff();
      if (batch.length === 1) { refuse(batch[0], e.message); continue; }
    }
    // A batch is all or nothing, so one refused tap would hold up the rest: send them one by one.
    for (const entry of batch) {
      try { sent([entry], await post([entry.op])); } catch (e) {
        const k = classify(e);
        if (k === "auth") { S.auth = true; return; }
        if (k === "retry") return backoff();
        refuse(entry, e.message);
      }
    }
  }
}

function backoff() { S.retry++; schedule(Math.min(15000, 1500 * 2 ** (S.retry - 1))); }

function flush(force = false) {
  if (S.flushP) { S.again = true; return S.flushP; }
  S.flushP = run(force).catch(() => {}).finally(() => { S.flushP = null; render(); if (S.again) { S.again = false; schedule(0); } });
  return S.flushP;
}

// For things the website has to judge (a points decision): wait for the answer.
async function sendNow(op) {
  await flush(true);
  if (Q.size(slug)) return { error: "Some taps are still waiting to send. Try again when you have signal." };
  try { const r = await post([op]); applyServer(r); S.savedAt = Date.now(); render(); return { ok: true }; } catch (e) {
    return { error: isNet(e) ? "No signal. The website has to check the judges' cards. Try again when you're back online." : e.message };
  }
}

// ---------------------------------------------------------------- screen awake
let lock = null;
async function wake(on) {
  if (!("wakeLock" in navigator)) return;
  try {
    if (on && !lock && !document.hidden) { lock = await navigator.wakeLock.request("screen"); lock.addEventListener("release", () => { lock = null; }); }
    else if (!on && lock) { await lock.release(); lock = null; }
  } catch (e) { lock = null; }
}

// ---------------------------------------------------------------- views
function signInView() {
  const s = S.signin;
  const html = signInHtml({
    title: "Sign in to score", lede: s.note || "Type the code the organiser gave you. You only need to do it once on this phone.",
    value: s.value, error: s.error, busy: s.busy, devices: sessionsFor(STAFF), href: (sl) => `?e=${encodeURIComponent(sl)}`,
  });
  return `<main id="main" class="ecr-main">${html}${s.href ? `<p class="ec-narrow ecr-gap"><a class="ec-btn ec-btn--ghost ec-btn--block" href="${esc(s.href)}">Open the right page</a></p>` : ""}</main>`;
}

function header(c) {
  const roleText = c.me.role === "judge" ? "Judge" : c.event.sport === "boxing" ? "Referee and timekeeper" : "Referee";
  const where = c.me.pitch ? `, ${esc(((c.event.pitches || []).find((p) => p.id === c.me.pitch) || {}).name || "")}` : "";
  return `<header class="ec-top"><div class="ec-wrap ecr-top">
    <span class="ec-brand"><img src="/assets/brand/shot-logo.png" alt="SHOT" width="44" height="28"></span>
    <div class="ecr-top__txt"><p class="ecr-event">${esc(c.event.name)}</p><p class="ecr-me">${esc(roleText)}: ${esc(c.me.name)}${where}</p></div>
  </div></header>`;
}

function banners(c) {
  const n = Q.taps(slug);
  const out = [];
  if (S.auth) out.push(`<div class="ecr-banner ecr-banner--warn" role="alert"><p><strong>Your sign-in has run out.</strong> ${n ? `${plural(n, "tap")} saved on this phone will send once you sign in again.` : ""}</p><button type="button" class="ec-btn" data-act="resign" data-f="resign">Enter your code</button></div>`);
  else if (n && (navigator.onLine === false || S.retry)) out.push(`<div class="ecr-banner ecr-banner--warn" role="status"><p><strong>No signal.</strong> ${plural(n, "tap")} saved on this phone. ${n === 1 ? "It" : "They"} will send by themselves when you're back online. Nothing is lost.</p><button type="button" class="ec-btn" data-act="save" data-f="save-b">Save now</button></div>`);
  else if (navigator.onLine === false) out.push('<div class="ecr-banner ecr-banner--warn" role="status"><p><strong>No signal.</strong> You can keep scoring. Taps send when you are back online.</p></div>');
  if (S.fromCache) out.push('<div class="ecr-banner" role="status"><p>Showing the last copy saved on this phone. Updating…</p></div>');
  S.refused.forEach((r, i) => out.push(`<div class="ecr-banner ecr-banner--err" role="alert"><p><strong>One change was refused.</strong> ${esc(r.message)}</p><button type="button" class="ec-btn ec-btn--ghost" data-act="dismiss" data-i="${i}" data-f="dis:${i}">OK</button></div>`));
  return out.join("");
}

function statusBar(c) {
  const n = Q.taps(slug);
  const canUndo = c.me.role === "referee" && c.event.sport === "football";
  let text, tone = "ok";
  if (S.auth) { text = "Not saved. Sign in again to send."; tone = "warn"; }
  else if (S.flushP && n) { text = "Saving…"; tone = "busy"; }
  else if (n) { text = `Not saved yet: ${plural(n, "tap")} on this phone.`; tone = "warn"; }
  else if (S.savedAt) text = `On the website ✓ ${clock(S.savedAt)}`;
  else text = "Ready. Taps save to the website.";
  return `<div class="ec-bar ecr-bar" data-tone="${tone}"><div class="ec-wrap ecr-bar__in">
    <p class="ecr-status" id="ecr-status">${esc(text)}</p>
    ${canUndo ? `<button type="button" class="ec-btn ec-btn--ghost ecr-undo" data-act="undo" data-f="undo"${S.undo ? "" : " disabled"}>Undo</button>` : ""}
    ${n || S.auth ? '<button type="button" class="ec-btn ecr-save" data-act="save" data-f="save">Save now</button>' : ""}
  </div></div>`;
}

function footer(c) {
  const armed = S.ui.arm === "signout";
  const n = Q.taps(slug);
  return `<footer class="ecr-foot">
    <button type="button" class="ecr-link" data-act="refresh" data-f="refresh">Refresh now</button>
    <button type="button" class="ecr-link${armed ? " is-armed" : ""}" data-act="signout" data-f="signout">${armed ? `Tap again to sign out${n ? ` (${plural(n, "tap")} not sent yet)` : ""}` : "Sign out of this phone"}</button>
    <a class="ecr-link" href="/e/${encodeURIComponent(slug)}/" target="_blank" rel="noopener">What fans see</a>
  </footer>`;
}

function eventView() {
  if (!S.server) {
    if (S.loadError) return `<main id="main" class="ecr-main ec-narrow"><div class="ec-card ecr-state-card" role="alert"><h1 class="ec-d3">We couldn't load this event</h1><p>${esc(S.loadError)}</p><button type="button" class="ec-btn ec-btn--big ec-btn--block" data-act="retry" data-f="retry">Try again</button><a class="ecr-link" href="/ref/">Use a different code</a></div></main>`;
    return '<main id="main" class="ecr-main ec-narrow" aria-busy="true"><div class="ec-skel" style="height:120px"></div><div class="ec-skel" style="height:220px;margin-top:12px"></div><p class="ec-dim" role="status">Loading your games…</p></main>';
  }
  const c = ctx();
  const body = c.me.role === "judge" ? Box.renderJudge(c) : c.event.sport === "boxing" ? Box.renderReferee(c) : Foot.render(c);
  return `${header(c)}<main id="main" class="ecr-main ec-narrow">${banners(c)}${body}${footer(c)}</main>${statusBar(c)}`;
}

// ---------------------------------------------------------------- render
function saveFocus() {
  const el = document.activeElement;
  if (!el || !app.contains(el) || !el.dataset || !el.dataset.f) return null;
  return { f: el.dataset.f, start: el.selectionStart, end: el.selectionEnd };
}
function restoreFocus(p) {
  if (!p) return;
  const el = app.querySelector(`[data-f="${CSS.escape(p.f)}"]`);
  if (!el || el.disabled) return;
  el.focus({ preventScroll: true });
  if (p.start != null && el.setSelectionRange) { try { el.setSelectionRange(p.start, p.end); } catch (e) { /* not a text field */ } }
}

function render() {
  if (S.pressing) { S.dirty = true; return; }
  S.dirty = false;
  const html = S.view === "signin" ? signInView() : eventView();
  if (html !== S.lastHtml) {
    const f = saveFocus();
    app.innerHTML = html; S.lastHtml = html;
    restoreFocus(f);
    if (S.view === "signin" && !f) { const code = $("#ecr-code"); if (code && !S.signin.value) code.focus({ preventScroll: true }); }
  }
  tick();
  if (S.view === "event" && S.server) {
    const c = ctx();
    const on = c.me.role === "judge" ? Box.boxingLive(c) : c.event.sport === "boxing" ? Box.boxingLive(c) : Foot.anyLive(c);
    wake(on);
  }
}

function tick() { if (S.view === "event" && S.server) { const c = ctx(); if (c.event.sport === "boxing") Box.tick(c, app); } }
setInterval(tick, 500);

// ---------------------------------------------------------------- events
function handle(name, el) {
  if (name === "undo") return undo();
  if (name === "save") { toast("Sending…", "ok", 1200); return flush(true); }
  if (name === "refresh") { if (S.watcher) S.watcher.refresh(); return toast("Refreshing…", "ok", 1200); }
  if (name === "retry") { S.loadError = ""; render(); return S.watcher && S.watcher.refresh(); }
  if (name === "dismiss") { S.refused.splice(Number(el.dataset.i), 1); return render(); }
  if (name === "resign") { S.signin = { value: "", error: "", busy: false, note: "Your sign-in has run out. Type your code again. Anything saved on this phone will send once you are in." }; S.view = "signin"; return render(); }
  if (name === "signout") {
    if (S.ui.arm !== "signout") { S.ui.arm = "signout"; clearTimeout(S.ui.armTimer); S.ui.armTimer = setTimeout(() => { S.ui.arm = null; render(); }, 4000); return render(); }
    if (S.watcher) S.watcher.stop();
    signOut(slug); wake(false);
    S.sess = null; S.server = null; S.view = "signin"; S.ui = { drafts: {} };
    S.signin = { value: "", error: "", busy: false, note: "" };
    history.replaceState(null, "", "/ref/");
    return render();
  }
  const c = ctx();
  if (c.me.role === "judge") return Box.actJudge(c, name, el);
  if (c.event.sport === "boxing") return Box.actReferee(c, name, el);
  return Foot.act(c, name, el);
}

app.addEventListener("click", (e) => { const el = e.target.closest("[data-act]"); if (el && !el.disabled) handle(el.dataset.act, el); });
app.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (e.target.dataset.form !== "signin" || S.signin.busy) return;
  S.signin.busy = true; S.signin.error = ""; S.signin.href = ""; render();
  const r = await trySignIn(S.signin.value);
  S.signin.busy = false;
  if (r.error) { S.signin.error = r.error; return render(); }
  const s = r.session;
  if (!STAFF.includes(s.role)) {
    S.signin.error = s.role === "coach" ? "That is a coach code. Open the coach page instead." : "That is an organiser code. Open the admin page instead.";
    S.signin.href = `/${s.role === "coach" ? "coach" : "admin"}/?e=${encodeURIComponent(s.slug)}`;
    return render();
  }
  history.replaceState(null, "", `/ref/?e=${encodeURIComponent(s.slug)}`);
  boot(s.slug);
});
app.addEventListener("input", (e) => {
  const el = e.target;
  if (el.id === "ecr-code") { el.value = formatCode(el.value); S.signin.value = el.value; return; }
  if (el.dataset.draft) { S.ui.drafts[el.dataset.draft] = el.value; render(); }
});
app.addEventListener("change", (e) => {
  const el = e.target, k = el.dataset.change;
  if (k === "pitch") { S.ui.pitch = el.value; S.ui.open = null; render(); }
  if (k === "res-round" && S.ui.result) { S.ui.result.round = Number(el.value); render(); }
});
// Never swap the buttons under a thumb: a redraw waits until the finger lifts.
app.addEventListener("pointerdown", () => { S.pressing = true; clearTimeout(S.pressT); S.pressT = setTimeout(() => { S.pressing = false; if (S.dirty) render(); }, 1500); }, true);
["pointerup", "pointercancel"].forEach((t) => document.addEventListener(t, () => { if (!S.pressing) return; S.pressing = false; clearTimeout(S.pressT); if (S.dirty) setTimeout(render, 60); }, true));
window.addEventListener("online", () => { S.retry = 0; flush(true); });
window.addEventListener("offline", render);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { render(); if (Q.size(slug)) flush(); } });

// ---------------------------------------------------------------- start
function boot(sl) {
  const s = session(sl, STAFF);
  if (!s) { S.view = "signin"; return render(); }
  if (sl !== slug) { location.replace(`/ref/?e=${encodeURIComponent(sl)}`); return; }
  S.sess = s; S.view = "event"; S.ui = { drafts: {} };
  try { const cached = JSON.parse(localStorage.getItem(CACHE) || "null"); if (cached && cached.event) { S.server = cached.event; S.rev = 0; S.fromCache = true; applyTheme(cached.event); } } catch (e) { /* no cache */ }
  render();
  if (S.watcher) S.watcher.stop();
  S.watcher = watchEvent(slug, (event, rev, resp) => { if (rev < S.rev) return; applyServer({ event, rev, judging: resp && resp.judging }); render(); }, {
    path: `/api/events/${encodeURIComponent(slug)}/full`, token: s.token,
    onError: (e) => {
      if (e.status === 401) { S.auth = true; return render(); }
      if (e.status === 404) { S.loadError = "We can't find that event. Check the link, or sign in with your code."; return render(); }
      if (!S.server || S.fromCache) { if (!S.server) { S.loadError = e.status === 0 ? "No signal. Check your connection, then try again." : e.message; render(); } }
    },
  });
  if (Q.size(slug)) flush();
}

if (slug && session(slug, STAFF)) boot(slug);
else {
  if (slug && session(slug)) S.signin.note = "That code is for a different job. Sign in with your referee or judge code.";
  else if (slug) S.signin.note = "Type the code the organiser gave you for this event.";
  render();
}
