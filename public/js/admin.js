// Admin (organiser) dashboard. Opens /admin/?e=<slug>. With no event it shows sign-in and
// "My events". Every save is an op: applied locally first (instant), sent with sendOps(), then
// replaced by the server's answer, or rolled back with the server's message.

import { applyOps } from "../core/ops.js";
import { api, session, signOut, sendOps, fullEvent, watchEvent } from "./api.js";
import { applyTheme, toast } from "./ui.js";
import { h, btn, skeleton } from "./admin-lib.js";
import { renderSignIn } from "./admin-signin.js";
import { overview } from "./admin-overview.js";
import { details } from "./admin-details.js";
import { teams } from "./admin-teams.js";
import { officials } from "./admin-officials.js";
import { fixtures } from "./admin-fixtures.js";
import { card } from "./admin-card.js";
import { codes } from "./admin-codes.js";
import { live } from "./admin-live.js";
import { after } from "./admin-after.js";

const app = document.getElementById("app");
const slug = new URLSearchParams(location.search).get("e");
const PHASE = { pre: "Before", live: "Live", post: "After" };

const tabsFor = (sport) => (sport === "boxing"
  ? [["overview", "Overview", overview], ["details", "Details", details], ["card", "Fight card", card], ["officials", "Judges and referees", officials], ["codes", "Access codes", codes], ["live", "Live control", live], ["after", "After", after]]
  : [["overview", "Overview", overview], ["details", "Details", details], ["teams", "Teams", teams], ["officials", "Pitches and officials", officials], ["fixtures", "Fixtures", fixtures], ["codes", "Access codes", codes], ["live", "Live control", live], ["after", "After", after]]);

function boot() {
  if (!slug) return renderSignIn(app, {});
  const s = session(slug);
  if (s && s.role === "admin") return dashboard(s);
  renderSignIn(app, { slug, message: s ? `This device is signed in to this event as a ${s.role}. Enter an admin code to run it.` : "" });
}

function dashboard(s) {
  const ctx = {
    slug, token: s.token, event: null, rev: 0, counts: null, codes: null, codesError: "", isDemo: /^p-[a-z0-9]{10}$/.test(slug),
    dirty: false, stale: false, saving: 0, json: "", missed: false,
  };
  let watcher = null, timer = null, fails = 0, chain = Promise.resolve();
  document.title = `Admin: ${s.event.name} | SHOT Event Clubhouse`;

  // ---- Shell ----
  const eventName = h("h1", { class: "ec-d2 ecx-eventname", text: s.event.name });
  const phaseBadge = h("span", { class: "ec-badge" });
  const updated = h("span", { class: "ec-small ec-dim ecx-updated" });
  const banners = h("div", { class: "ecx-banners", "aria-live": "polite" });
  const staleBar = h("div", { class: "ecx-bar", hidden: true, role: "status" }, h("span", { text: "Someone changed this event. Your unsaved typing is safe." }), btn("Show the latest", () => render(), { cls: "ec-btn--ghost ec-btn--sm" }));
  const panel = h("div", { class: "ecx-panel", id: "panel" });
  const tabList = h("ul", { class: "ecx-tabs", id: "ecx-tabs" });
  const menuBtn = h("button", { type: "button", class: "ecx-menu-btn", "aria-expanded": "false", "aria-controls": "ecx-tabs", onclick: () => toggleMenu() });
  const nav = h("nav", { class: "ecx-nav ec-wrap", "aria-label": "Event sections" }, menuBtn, tabList);
  const main = h("main", { class: "ec-wrap ecx-main", id: "main", tabindex: "-1" }, banners, staleBar, panel);

  app.replaceChildren(
    h("header", { class: "ec-top" }, h("div", { class: "ec-wrap" },
      h("a", { class: "ec-brand", href: "/", "aria-label": "SHOT Event Clubhouse home" }, h("img", { src: "/assets/brand/shot-logo.png", alt: "", width: "56", height: "36" }), h("span", { class: "ecx-brandtext", text: "Event Clubhouse" })),
      h("span", { class: "ec-spacer" }),
      h("a", { class: "ec-btn ec-btn--ghost ec-btn--sm", href: "/admin/", text: "All events" }),
      btn("Sign out", () => { stop(); signOut(slug); location.href = "/admin/"; }, { cls: "ec-btn--ghost ec-btn--sm", label: `Sign out of ${s.event.name}` }))),
    h("div", { class: "ecx-head" }, h("div", { class: "ec-wrap ecx-head__in" }, h("div", { class: "ecx-grow" }, h("p", { class: "ec-kicker", text: "Organiser dashboard" }), eventName), h("div", { class: "ecx-head__meta" }, phaseBadge, updated))),
    nav, main);
  panel.append(h("div", { "aria-busy": "true" }, skeleton(5)));

  const tabs = () => tabsFor(ctx.event ? ctx.event.sport : s.event.sport);
  const current = () => { const id = location.hash.slice(1); const t = tabs().find((x) => x[0] === id); return t ? t[0] : "overview"; };
  ctx.tab = current;

  // ---- Draw ----
  function toggleMenu(force) {
    const open = force != null ? force : nav.classList.contains("is-open") === false;
    nav.classList.toggle("is-open", open);
    menuBtn.setAttribute("aria-expanded", String(open));
  }
  function drawNav() {
    const cur = current();
    const label = (tabs().find((t) => t[0] === cur) || [])[1];
    menuBtn.replaceChildren(h("span", { class: "ecx-menu-btn__k", text: "Section" }), h("span", { class: "ecx-menu-btn__v", text: label }), h("span", { "aria-hidden": "true", class: "ecx-menu-btn__caret", text: "▾" }));
    tabList.replaceChildren(...tabs().map(([id, name]) => h("li", {}, h("button", { type: "button", class: "ecx-tab", "aria-current": id === cur ? "page" : null, text: name, onclick: () => ctx.go(id) }))));
  }
  function drawHead() {
    const ev = ctx.event;
    eventName.textContent = ev.name;
    phaseBadge.textContent = PHASE[ev.phase] || ev.phase;
    phaseBadge.className = `ec-badge${ev.phase === "live" ? " ec-badge--live" : ""}`;
    document.title = `Admin: ${ev.name} | SHOT Event Clubhouse`;
    applyTheme(ev);
  }
  function render(opts = {}) {
    if (!ctx.event) return;
    ctx.dirty = false; ctx.stale = false; staleBar.hidden = true;
    const active = document.activeElement;
    const key = opts.focusKey || (active && panel.contains(active) ? active.getAttribute("data-key") : null);
    const id = current();
    const [, label, fn] = tabs().find((t) => t[0] === id);
    let body;
    try { body = fn(ctx); }
    catch (e) {
      console.error(e);
      body = h("div", { class: "ec-card ecx-stack", role: "alert" }, h("h3", { class: "ec-d3", text: "This section did not load" }), h("p", { class: "ec-muted", text: "Reload the page. If it keeps happening, tell SHOT what you were doing." }), btn("Reload", () => location.reload()));
    }
    panel.replaceChildren(h("h2", { class: "ec-d2 ecx-ph", id: "panel-title", tabindex: "-1", text: label }), body);
    drawNav();
    if (opts.focus) { window.scrollTo(0, 0); const t = panel.querySelector("#panel-title"); if (t) t.focus({ preventScroll: true }); }
    else if (key) { const el = panel.querySelector(`[data-key="${CSS.escape(key)}"]`); if (el && !el.disabled) el.focus({ preventScroll: true }); }
  }
  // A redraw triggered by something other than the organiser (a poll, a late answer): never
  // wipe what they are typing.
  function soft() {
    const a = document.activeElement;
    const typing = a && panel.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !["checkbox", "radio", "button", "submit"].includes(a.type);
    if (ctx.dirty || typing) { ctx.stale = true; staleBar.hidden = false; return; }
    render();
  }
  ctx.render = render; ctx.soft = soft;
  ctx.go = (id) => { toggleMenu(false); if (location.hash.slice(1) === id) render({ focus: true }); else location.hash = id; };
  window.addEventListener("hashchange", () => { toggleMenu(false); if (ctx.event) render({ focus: true }); else drawNav(); });
  ctx.toast = toast;
  ctx.hint = (text) => {
    const n = h("div", { class: "ecx-notice", role: "status" }, h("span", { text }), btn("Dismiss", () => n.remove(), { cls: "ec-btn--ghost ec-btn--sm" }));
    banners.append(n);
  };

  // ---- Event state ----
  function setEvent(ev, rev) { ctx.event = ev; ctx.rev = rev; ctx.json = JSON.stringify(ev); }
  function expired(message) {
    stop(); signOut(slug);
    renderSignIn(app, { slug, message: message || "Your sign-in has ended. Enter an admin code to carry on." });
  }
  ctx.expired = expired;
  function stop() { if (watcher) watcher.stop(); clearInterval(timer); }
  function online(ok) {
    if (ok) { fails = 0; setBanner(null); updated.textContent = `Updated ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`; }
    else if (++fails >= 2) setBanner("We can't reach the server. Trying again. Changes you make now may not save.");
  }
  let offline = null;
  function setBanner(text) {
    if (!text) { if (offline) { offline.remove(); offline = null; } return; }
    if (!offline) { offline = h("div", { class: "ecx-notice ecx-notice--warn", role: "alert" }); banners.prepend(offline); }
    offline.textContent = text;
  }

  // ---- Saving: local first, then the server, rolled back on a refusal ----
  async function doSave(ops, { success, toastError = true } = {}) {
    const before = ctx.event;
    const local = applyOps(before, ops, { role: "admin", id: null }, Date.now());
    if (!local.ok) { if (toastError) toast(local.error, "error", 5000); return { ok: false, error: local.error }; }
    ctx.event = local.doc; ctx.saving++; main.setAttribute("aria-busy", "true"); drawHead(); render();
    try {
      const r = await sendOps(slug, ops);
      setEvent(r.event, r.rev);
      if (r.counts) ctx.counts = r.counts;
      online(true);
      if (success) toast(success, "ok");
      return { ok: true };
    } catch (e) {
      ctx.event = before; ctx.json = JSON.stringify(before);
      if (e.status === 401) { expired(e.message); return { ok: false, error: e.message }; }
      if (e.status === 0) online(false);
      if (toastError) toast(e.message, "error", 6000);
      return { ok: false, error: e.message };
    } finally {
      ctx.saving--;
      if (!ctx.saving) main.removeAttribute("aria-busy");
      if (ctx.event) { drawHead(); render(); }
      if (!ctx.saving && ctx.missed) { ctx.missed = false; if (watcher) watcher.refresh(); }
    }
  }
  ctx.save = (ops, opts) => (chain = chain.then(() => doSave(ops, opts)));

  // ---- Other calls (staff token) ----
  async function call(fn, auth = true) {
    try { return await fn(); }
    catch (e) { if (e.status === 401 && auth) expired(e.message); throw e; }
  }
  ctx.get = (path, { auth = true } = {}) => call(() => api.get(path, { token: auth ? ctx.token : undefined }), auth);
  ctx.post = (path, body) => call(() => api.post(path, body, { token: ctx.token }));
  // The one place that needs the raw response: a file download. api.js only reads JSON.
  ctx.download = async (path, filename) => {
    let res;
    try { res = await fetch(path, { headers: { Authorization: `Bearer ${ctx.token}` }, cache: "no-store" }); }
    catch (e) { throw new Error("No connection. Check your signal and try again."); }
    if (res.status === 401) { const m = await res.json().catch(() => ({})); expired(m.error); throw new Error(m.error || "Sign in again."); }
    if (!res.ok) { const m = await res.json().catch(() => ({})); throw new Error(m.error || "The download didn't work. Try again."); }
    const url = URL.createObjectURL(await res.blob());
    const a = h("a", { href: url, download: filename });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  ctx.reloadCodes = async () => {
    try { const r = await ctx.get(`/api/events/${slug}/codes`); ctx.codes = r.codes || []; ctx.codesError = ""; }
    catch (e) { if (ctx.codes == null) ctx.codesError = e.message; }
  };
  ctx.reload = () => { if (watcher) watcher.refresh(); pollCounts(); };

  // ---- Polling ----
  function onEvent(ev, rev) {
    if (ctx.saving) { ctx.missed = true; return; }
    if (JSON.stringify(ev) === ctx.json) { ctx.rev = rev; return; }
    setEvent(ev, rev); drawHead(); soft();
  }
  async function pollCounts() {
    try {
      const r = await fullEvent(slug);
      online(true);
      const changed = JSON.stringify(r.counts) !== JSON.stringify(ctx.counts);
      ctx.counts = r.counts;
      if (changed && ["overview", "live"].includes(current())) soft();
    } catch (e) { if (e.status === 401) expired(e.message); else online(false); }
  }

  // ---- Start ----
  async function start() {
    panel.replaceChildren(h("div", { "aria-busy": "true" }, skeleton(5)));
    try {
      const r = await fullEvent(slug);
      setEvent(r.event, r.rev); ctx.counts = r.counts || null;
    } catch (e) {
      if (e.status === 401) return expired(e.message);
      panel.replaceChildren(h("div", { class: "ec-card ecx-stack", role: "alert" },
        h("h2", { class: "ec-d3", text: e.status === 404 ? "We can't find that event" : "The event did not load" }),
        h("p", { class: "ec-muted", text: e.message }),
        h("div", { class: "ec-row" }, btn("Try again", start), h("a", { class: "ec-btn ec-btn--ghost", href: "/admin/", text: "Back to all events" }))));
      return;
    }
    drawHead();
    if (!location.hash) history.replaceState(null, "", `${location.pathname}${location.search}#overview`);
    render();
    ctx.reloadCodes().then(() => { if (current() === "overview" || current() === "codes") soft(); });
    api.get("/api/demo").then((d) => { if ((d.events || []).some((e) => e.slug === slug) && !ctx.isDemo) { ctx.isDemo = true; soft(); } }).catch(() => {});
    watcher = watchEvent(slug, onEvent, { path: `/api/events/${slug}/full`, token: ctx.token, onError: (e) => { if (e.status === 401) expired(e.message); else online(false); } });
    timer = setInterval(() => { if (!document.hidden) pollCounts(); }, 10000);
  }
  start();
}

boot();
