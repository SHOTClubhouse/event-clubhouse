// Admin dashboard helpers: a tiny DOM builder, form fields, a confirm dialog, copy, and the
// text parsers for pasted team and squad lists. Nothing here knows about the event.

import { toast } from "./ui.js";

export const SITE = "https://events.shotclubhouse.com";

// h("div", { class: "x", onclick: fn, key: "stable-focus-key" }, child, "text", ...)
export function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  const props = [];
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "key") n.setAttribute("data-key", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (k === "value" || k === "checked" || k === "selected") props.push([k, v]);
    else n.setAttribute(k, v === true ? "" : v);
  }
  kids.flat(Infinity).forEach((c) => { if (c != null && c !== false) n.append(c.nodeType ? c : String(c)); });
  props.forEach(([k, v]) => { n[k] = v; });
  return n;
}

let uid = 0;
export const nid = (p = "ecx") => `${p}-${++uid}`;

// A labelled control. The label is tied to the control and help text is read with it.
export function field(label, control, help, cls = "") {
  if (!control.id) control.id = nid("f");
  const wrap = h("div", { class: `ec-field ${cls}`.trim() }, h("label", { for: control.id, text: label }), control);
  if (help) {
    const id = nid("h");
    wrap.append(h("span", { class: "ec-help", id, text: help }));
    control.setAttribute("aria-describedby", id);
  }
  return wrap;
}
export const input = (attrs = {}) => h("input", { class: "ec-input", type: "text", autocomplete: "off", ...attrs });
export const textarea = (attrs = {}) => h("textarea", { class: "ec-textarea", ...attrs });
// options: ["a", "b"] or [[value, label], ...]
export function select(options, value, attrs = {}) {
  const s = h("select", { class: "ec-select", ...attrs }, options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h("option", { value: v, text: l }); }));
  s.value = value == null ? "" : String(value);
  return s;
}
export const check = (label, attrs = {}) => h("label", { class: "ec-check" }, h("input", { type: "checkbox", ...attrs }), h("span", { text: label }));

// A button with a stable key so focus survives a redraw.
export const btn = (text, onclick, { cls = "", key, label, type = "button", disabled } = {}) =>
  h("button", { type, class: `ec-btn ${cls}`.trim(), text, onclick, key, "aria-label": label, disabled });

export const msgBox = () => h("p", { class: "ec-error ecx-msg", role: "alert", hidden: true });
export function showMsg(el, text, ok = false) {
  el.textContent = text || "";
  el.hidden = !text;
  el.classList.toggle("ecx-ok", !!ok);
}

// Disables a button while a promise runs, then puts it back (if it is still on the page).
export async function withBusy(button, fn) {
  const label = button.textContent;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "Saving…";
  try { return await fn(); }
  finally {
    if (button.isConnected) { button.disabled = false; button.removeAttribute("aria-busy"); button.textContent = label; }
  }
}

// Core error messages start with the field name ("theme.accent: a #rrggbb colour"). Say it plainly.
const NAMES = {
  name: "Event name", venue: "Venue", about: "About", date: "Date", "theme.accent": "Accent colour", "theme.logo": "Logo link",
  "theme.partner": "Partner name", "links.tickets": "Tickets link", "links.clubhouse": "Clubhouse link",
  "settings.lockSecs": "Vote lock", "settings.points": "Points", "settings.voteBy": "Players shown", stream: "Stream",
};
export function plainError(msg) {
  const s = String(msg || "Something went wrong. Try again.");
  const m = s.match(/^([a-zA-Z.]+): (.*)$/);
  if (m && NAMES[m[1]]) return `${NAMES[m[1]]}: ${m[2]}`;
  return s;
}

// ---- Confirm before anything destructive ----
export function confirmBox({ title, body, ok = "Yes, remove it", cancel = "Keep it", danger = true }) {
  return new Promise((resolve) => {
    const id = nid("dlg");
    const dlg = h("dialog", { class: "ecx-dialog", "aria-labelledby": id },
      h("form", { method: "dialog", class: "ecx-dialog__body" },
        h("h2", { id, class: "ec-d3", text: title }),
        h("p", { class: "ec-muted", text: body }),
        h("div", { class: "ec-row ecx-dialog__actions" },
          h("button", { class: "ec-btn ec-btn--ghost", value: "cancel", text: cancel, autofocus: true }),
          h("button", { class: `ec-btn ${danger ? "ec-btn--danger" : ""}`, value: "ok", text: ok }))));
    dlg.addEventListener("close", () => { const yes = dlg.returnValue === "ok"; dlg.remove(); resolve(yes); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

// ---- Copy to clipboard, with a fallback for browsers that refuse ----
export async function copyText(text, done = "Copied.") {
  try {
    await navigator.clipboard.writeText(text);
    toast(done, "ok");
    return true;
  } catch (e) {
    const t = h("textarea", { "aria-hidden": "true", style: "position:fixed;left:-9999px;top:0" });
    t.value = text;
    document.body.append(t);
    t.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
    t.remove();
    toast(ok ? done : "Couldn't copy. Select the text and copy it by hand.", ok ? "ok" : "warn", 4000);
    return ok;
  }
}

// ---- Dates ----
export const fmtDateTime = (ms) => (ms ? new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
export const fmtDate = (d) => {
  if (!d) return "No date yet";
  const t = new Date(`${d}T12:00:00`);
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
};

// The code id inside a session token (to spot "this is the code you are signed in with").
export function tokenCodeId(token) {
  try {
    const p = String(token).split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(p.padEnd(Math.ceil(p.length / 4) * 4, "="))).c || null;
  } catch (e) { return null; }
}

// ---- Pasted lists ----
const BULLET = /^\s*(?:[-*•·]+\s+)/;
export const parseLines = (text) => String(text || "").split(/\r?\n/).map((l) => l.replace(BULLET, "").trim()).filter(Boolean);

// "7 Sam Smith", "#7 Sam", "7. Sam", "7,Sam Smith", "Sam Smith" (no number), "7" (number only).
export function parseSquad(text) {
  const out = [], problems = [];
  parseLines(text).forEach((line, i) => {
    const m = line.match(/^#?(\d{1,3})(?:\s*[.,:;)\-–]\s*|\s+|$)(.*)$/);
    if (m) out.push({ number: Number(m[1]), name: m[2].trim() });
    else out.push({ number: null, name: line });
    if (out[out.length - 1].name.length > 60) problems.push(`Line ${i + 1}: names are up to 60 characters.`);
  });
  return { players: out, problems };
}

export const letters = (n) => "ABCDEFGHIJKLMNOP".slice(0, n).split("");
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function skeleton(rows = 4) {
  return h("div", { class: "ecx-skel", "aria-hidden": "true" }, Array.from({ length: rows }, () => h("div", { class: "ec-skel" })));
}
export const empty = (text, ...extra) => h("div", { class: "ec-empty" }, h("p", { text }), ...extra);
