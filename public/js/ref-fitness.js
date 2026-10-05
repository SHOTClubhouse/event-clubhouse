// Timekeeper view for fitness events: the heats, start and end a heat, and the next split or
// score for every athlete. Pure rendering from the event as the phone should show it (the
// server's copy plus taps still waiting to send); every tap goes through c.send().

import { esc, plural } from "./ui.js";
import { terms } from "../core/model.js";
import * as Q from "./ref-queue.js";
import { comp, isRace, segs, catName, heatById, valueText, fmtTime, segmentsDone, STATE_TEXT, parseResult } from "./fit-lib.js";

const heats = (ev) => comp(ev).heats;
const inHeat = (ev, id) => comp(ev).entries.filter((e) => e.heat === id).sort((a, b) => a.bib - b.bib);
const nextIdx = (e) => e.results.findIndex((v) => v == null);
const fullName = (e) => e.name || e.label || `Bib ${e.bib}`;
const BADGE = { ready: "", racing: "", finished: '<span class="ec-badge ec-badge--ft">Finished</span>', dnf: '<span class="ec-badge ec-badge--red">Did not finish</span>', dns: '<span class="ec-badge">Did not start</span>' };

export const anyLive = (c) => heats(c.event).some((h) => h.state === "live");

function orderHeats(ev) {
  const t = (a, b) => String(a.time).localeCompare(String(b.time)) || String(a.id).localeCompare(String(b.id));
  const l = heats(ev);
  return {
    live: l.filter((h) => h.state === "live").sort(t),
    next: l.filter((h) => h.state === "scheduled").sort(t),
    done: l.filter((h) => h.state === "done").sort(t).reverse(),
  };
}

const heatBadge = (h) => (h.state === "live" ? '<span class="ec-badge ec-badge--live">Live</span>' : h.state === "done" ? '<span class="ec-badge ec-badge--ft">Finished</span>' : '<span class="ec-badge">Not started</span>');

// ---- Start and end a heat, with a question first ----
function heatActions(c, h, n) {
  const arm = c.ui.arm;
  if (arm === `start:${h.id}`) {
    return `<div class="ecf-confirm" role="group" aria-label="Start ${esc(h.name)}?"><p><b>Start ${esc(h.name)}?</b> The clock starts now for ${esc(plural(n, "athlete"))}.</p>
      <div class="ecr-two"><button type="button" class="ec-btn ec-btn--big" data-act="fit-start" data-id="${esc(h.id)}" data-f="hs:${esc(h.id)}">Yes, start</button><button type="button" class="ec-btn ec-btn--big ec-btn--ghost" data-act="fit-cancel" data-f="hc:${esc(h.id)}">Not yet</button></div></div>`;
  }
  if (arm === `end:${h.id}`) {
    return `<div class="ecf-confirm" role="group" aria-label="End ${esc(h.name)}?"><p><b>End ${esc(h.name)}?</b> Athletes with every result are finished. The others are marked as did not finish.</p>
      <div class="ecr-two"><button type="button" class="ec-btn ec-btn--big ec-btn--gold" data-act="fit-end" data-id="${esc(h.id)}" data-f="he:${esc(h.id)}">Yes, end heat</button><button type="button" class="ec-btn ec-btn--big ec-btn--ghost" data-act="fit-cancel" data-f="hc:${esc(h.id)}">Keep going</button></div></div>`;
  }
  if (h.state === "scheduled") return `<button type="button" class="ec-btn ec-btn--big ec-btn--block" data-act="fit-ask" data-ask="start:${esc(h.id)}" data-f="ha:${esc(h.id)}" aria-label="Start heat: ${esc(h.name)}">Start heat</button>`;
  if (h.state === "live") return `<button type="button" class="ec-btn ec-btn--big ec-btn--block ec-btn--gold" data-act="fit-ask" data-ask="end:${esc(h.id)}" data-f="ha:${esc(h.id)}" aria-label="End heat: ${esc(h.name)}">End heat</button>`;
  return `<p class="ecr-note">This heat is finished. Ask the organiser to reopen it if a result needs changing.</p>`;
}

function heatCard(c, h) {
  const ev = c.event, es = inHeat(ev, h.id);
  const fin = es.filter((e) => e.state === "finished").length;
  const k = catName(ev, h.category);
  return `<article class="ec-card ecr-game ecf-hcard${h.state === "live" ? " is-live" : ""}" aria-label="${esc(`${h.time}, ${h.name}`)}">
    <header class="ecr-game__head"><span class="ecr-time">${esc(h.time)}</span><span class="ecr-meta">${esc([h.name, k].filter(Boolean).join(" · "))}</span>${heatBadge(h)}</header>
    <p class="ecr-note">${esc(plural(es.length, "athlete"))}${h.state !== "scheduled" ? `, ${fin} finished` : ""}</p>
    <button type="button" class="ec-btn ec-btn--ghost ec-btn--block" data-act="fit-open" data-id="${esc(h.id)}" data-f="ho:${esc(h.id)}" aria-label="Open ${esc(h.name)}: enter results">Enter results</button>
    ${heatActions(c, h, es.length)}
  </article>`;
}

// ---- One athlete ----
function athleteCard(c, e, o = {}) {
  const ev = c.event, g = segs(ev), race = isRace(ev), d = c.ui.drafts || {};
  const n = g.length, done = segmentsDone(e), nx = nextIdx(e);
  const pickKey = `s:${e.id}`;
  const picked = d[pickKey] != null && d[pickKey] !== "" ? Number(d[pickKey]) : nx;
  const seg = g[picked] || null;
  const open = ["ready", "racing"].includes(e.state);
  const h = heatById(ev, e.heat);
  const err = (c.ui.errs || {})[e.id] || "";
  const last = [...e.results].reverse().find((v) => v != null);
  let status;
  if (e.state === "finished") status = `Finished${race && last != null ? ` in ${fmtTime(last)}` : ""}.`;
  else if (e.state === "dnf") status = `Did not finish. ${done} of ${n} done.`;
  else if (e.state === "dns") status = "Did not start.";
  else if (nx < 0) status = "Every segment has a result.";
  else status = `Next: ${g[nx] ? g[nx].name : ""} (segment ${nx + 1} of ${n}).${race && last != null ? ` Last split ${fmtTime(last)}.` : ""}`;
  const valKey = `d:${e.id}`;
  const val = d[valKey] ?? "";
  const heat = h && o.heat ? `<span class="ecr-meta">${esc(h.name)}</span>` : "";
  const canNow = h && h.state === "live" && race && h.startedAt;
  const form = open && seg ? `<form class="ecf-form" data-form="fit" data-entry="${esc(e.id)}" novalidate>
      <div class="ec-field"><label for="v-${esc(e.id)}">${esc(race ? `Split at the end of ${seg.name}` : `${seg.name}${seg.measure === "kg" ? ", weight in kg" : seg.measure === "reps" ? ", reps" : ", time"}`)}</label>
        <input id="v-${esc(e.id)}" class="ec-input ecf-in" type="text" inputmode="${seg.measure === "time" ? (race ? "numeric" : "text") : "numeric"}" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" placeholder="${seg.measure === "time" ? "m:ss or h:mm:ss" : seg.measure === "kg" ? "Kilograms" : "Reps"}" value="${esc(val)}" data-draft="${esc(valKey)}" data-f="in:${esc(e.id)}" aria-describedby="vh-${esc(e.id)}${err ? ` ve-${esc(e.id)}` : ""}"${err ? ' aria-invalid="true"' : ""}>
        <span id="vh-${esc(e.id)}" class="ec-help">${race ? "Time since the wave started. Type 4:07 or 407." : seg.measure === "time" ? "Type 4:07, or whole seconds." : "A whole number."}</span>
        ${err ? `<p id="ve-${esc(e.id)}" class="ecr-err" role="alert">${esc(err)}</p>` : ""}</div>
      <div class="${canNow ? "ecr-two" : ""}">${canNow ? `<button type="button" class="ec-btn ec-btn--big ec-btn--ghost" data-act="fit-now" data-entry="${esc(e.id)}" data-f="nw:${esc(e.id)}">Now</button>` : ""}<button type="submit" class="ec-btn ec-btn--big${canNow ? "" : " ec-btn--block"}" data-f="sv:${esc(e.id)}">Save ${race ? "split" : "score"}</button></div>
    </form>` : "";
  const more = open && done > 0 ? (c.ui.more === e.id
    ? `<div class="ec-field"><label for="sg-${esc(e.id)}">Which segment</label><select id="sg-${esc(e.id)}" class="ec-select" data-draft="${esc(pickKey)}" data-f="sg:${esc(e.id)}">${g.map((s2, i) => `<option value="${i}"${i === picked ? " selected" : ""}>${i + 1}. ${esc(s2.name)}${e.results[i] != null ? ` (${esc(valueText(s2, e.results[i]))})` : ""}</option>`).join("")}</select></div>`
    : `<button type="button" class="ecr-link" data-act="fit-more" data-entry="${esc(e.id)}" data-f="mo:${esc(e.id)}">Change an earlier result</button>`) : "";
  const tools = [];
  if (open) {
    tools.push(`<button type="button" class="ec-btn ec-btn--ghost" data-act="fit-state" data-entry="${esc(e.id)}" data-state="dnf" data-f="df:${esc(e.id)}" aria-label="DNF, did not finish: ${esc(fullName(e))}">DNF</button>`);
    tools.push(`<button type="button" class="ec-btn ec-btn--ghost" data-act="fit-state" data-entry="${esc(e.id)}" data-state="dns" data-f="dn:${esc(e.id)}" aria-label="DNS, did not start: ${esc(fullName(e))}">DNS</button>`);
    if (done > 0) tools.push(`<button type="button" class="ec-btn ec-btn--ghost" data-act="fit-undo" data-entry="${esc(e.id)}" data-f="ud:${esc(e.id)}" aria-label="Undo last result for ${esc(fullName(e))}">Undo last</button>`);
  } else if (e.state === "finished" && done > 0) {
    tools.push(`<button type="button" class="ec-btn ec-btn--ghost" data-act="fit-undo" data-entry="${esc(e.id)}" data-f="ud:${esc(e.id)}" aria-label="Undo last result for ${esc(fullName(e))}">Undo last</button>`);
  } else {
    tools.push(`<button type="button" class="ec-btn ec-btn--ghost" data-act="fit-state" data-entry="${esc(e.id)}" data-state="${done ? "racing" : "ready"}" data-f="pb:${esc(e.id)}">Put back on the course</button>`);
  }
  return `<article class="ec-card ecf-ath ecf-ath--${esc(e.state)}" aria-label="${esc(`Bib ${e.bib}, ${fullName(e)}`)}">
    <header class="ecf-ath__head"><b class="ecf-bib" aria-label="Bib ${e.bib}">${e.bib}</b><span class="ecf-ath__name"><b>${esc(fullName(e))}</b>${e.club ? `<small>${esc(e.club)}</small>` : ""}</span>${BADGE[e.state] || ""}</header>
    <p class="ecr-note">${esc(status)} ${heat}</p>
    ${form}${more}
    <div class="ecf-tools">${tools.join("")}</div>
  </article>`;
}

function search(c) {
  const q = ((c.ui.drafts || {}).bibq || "").trim();
  return `<div class="ec-field ecf-search"><label for="ecf-q">Find an athlete by bib</label><input id="ecf-q" class="ec-input" type="search" inputmode="numeric" autocomplete="off" placeholder="Bib number" value="${esc(q)}" data-draft="bibq" data-f="bibq" maxlength="40"></div>`;
}

function results(c, q) {
  const ev = c.event, t = q.toLowerCase();
  const list = comp(ev).entries.filter((e) => (/^\d+$/.test(q) ? String(e.bib).startsWith(q) : `${e.name || ""} ${e.club || ""}`.toLowerCase().includes(t))).sort((a, b) => a.bib - b.bib);
  if (!list.length) return `<div class="ec-empty">No athlete matches "${esc(q)}". Check the bib number.</div>`;
  return `<section class="ecr-sec" aria-label="Search results"><h2 class="ecr-h">Search results <span class="ec-dim">${list.length}</span></h2>${list.slice(0, 12).map((e) => athleteCard(c, e, { heat: true })).join("")}${list.length > 12 ? `<p class="ecr-note">Showing the first 12. Type more of the bib to narrow it down.</p>` : ""}</section>`;
}

export function render(c) {
  const ev = c.event, T = terms(ev);
  if (!heats(ev).length) return `<div class="ec-empty">No heats yet. The organiser has not set them up. This page fills in by itself.</div>`;
  const q = ((c.ui.drafts || {}).bibq || "").trim();
  if (q) return `${search(c)}${results(c, q)}`;
  const open = c.ui.heat && heatById(ev, c.ui.heat);
  if (open) {
    const es = inHeat(ev, open.id), k = catName(ev, open.category);
    return `${search(c)}<section class="ecr-sec" aria-label="${esc(open.name)}">
      <button type="button" class="ecr-link ecf-back" data-act="fit-back" data-f="back">&larr; All heats</button>
      <article class="ec-card ecr-game ecf-hcard${open.state === "live" ? " is-live" : ""}"><header class="ecr-game__head"><span class="ecr-time">${esc(open.time)}</span><span class="ecr-meta">${esc([open.name, k].filter(Boolean).join(" · "))}</span>${heatBadge(open)}</header>${heatActions(c, open, es.length)}</article>
      <h2 class="ecr-h">Athletes <span class="ec-dim">${es.length}</span></h2>${es.length ? es.map((e) => athleteCard(c, e)).join("") : `<div class="ec-empty">Nobody is in this heat yet.</div>`}</section>`;
  }
  const L = orderHeats(ev);
  const sec = (title, list) => (list.length ? `<section class="ecr-sec" aria-label="${esc(title)}"><h2 class="ecr-h">${esc(title)} <span class="ec-dim">${list.length}</span></h2>${list.map((h) => heatCard(c, h)).join("")}</section>` : "");
  return `${search(c)}${sec(`On the ${T.place} now`, L.live)}${sec("Up next", L.next)}${sec("Finished", L.done)}`;
}

// ---- Taps ----
const actorOf = (c) => ({ role: c.sess.role, id: c.sess.subject });

// The server's own rule, run on this phone first. Returns the plain message, or "". A refusal is
// shown beside the athlete and as a message.
function refuse(c, op, entryId) {
  const msg = Q.precheck(c.event, op, actorOf(c));
  if (!msg) { if (entryId && c.ui.errs) delete c.ui.errs[entryId]; return ""; }
  if (entryId) c.ui.errs = { ...(c.ui.errs || {}), [entryId]: msg };
  c.toast(msg, "warn", 3600);
  c.rerender();
  return msg;
}
const trySend = (c, ops, opts, entryId) => (refuse(c, ops[0], entryId) ? false : c.send(ops, opts));

const entry = (c, id) => comp(c.event).entries.find((e) => e.id === id);

export function act(c, name, el) {
  const { ui } = c;
  const id = el.dataset.id || el.dataset.entry;
  if (name === "fit-open") { ui.heat = id; ui.arm = null; window.scrollTo(0, 0); return c.rerender(); }
  if (name === "fit-back") { ui.heat = null; ui.arm = null; return c.rerender(); }
  if (name === "fit-ask") { ui.arm = el.dataset.ask; return c.rerender(); }
  if (name === "fit-cancel") { ui.arm = null; return c.rerender(); }
  if (name === "fit-start" || name === "fit-end") {
    ui.arm = null;
    const h = heatById(c.event, id); if (!h) return c.rerender();
    const start = name === "fit-start";
    return trySend(c, [{ op: start ? "heat.start" : "heat.end", id }], { haptic: 20, say: `${h.name} ${start ? "started" : "ended"}` });
  }
  if (name === "fit-more") { ui.more = id; return c.rerender(); }
  const e = entry(c, id);
  if (!e) return;
  if (name === "fit-now") {
    const h = heatById(c.event, e.heat);
    if (!h || h.state !== "live" || !h.startedAt) return c.toast("Start the heat first. Then Now fills in the time since the start.", "warn");
    const secs = Math.max(0, Math.round((Date.now() - h.startedAt) / 1000));
    ui.drafts[`d:${e.id}`] = fmtTime(secs);
    if (ui.errs) delete ui.errs[e.id];
    return c.rerender();
  }
  if (name === "fit-save") {
    const g = segs(c.event);
    const d = ui.drafts || {};
    const pick = d[`s:${e.id}`] != null && d[`s:${e.id}`] !== "" ? Number(d[`s:${e.id}`]) : e.results.findIndex((v) => v == null);
    const seg = g[pick];
    if (!seg) return;
    const r = parseResult(c.event, seg, d[`d:${e.id}`]);
    if (r.error) { ui.errs = { ...(ui.errs || {}), [e.id]: r.error }; return c.rerender(); }
    const op = { op: "result.set", entry: e.id, segment: pick, value: r.value };
    if (refuse(c, op, e.id)) return;
    delete d[`d:${e.id}`]; delete d[`s:${e.id}`]; if (ui.more === e.id) ui.more = null;
    return c.send([op], { haptic: 25, say: `${fullName(e)}, ${seg.name}, ${valueText(seg, r.value)}` });
  }
  if (name === "fit-state") return trySend(c, [{ op: "entry.state", entry: e.id, state: el.dataset.state }], { haptic: 20, say: `${fullName(e)}: ${STATE_TEXT[el.dataset.state] || el.dataset.state}` }, e.id);
  if (name === "fit-undo") {
    const i = e.results.reduce((a, v, k) => (v != null ? k : a), -1);
    if (i < 0) return;
    return trySend(c, [{ op: "result.set", entry: e.id, segment: i, value: null }], { haptic: 12, say: `${fullName(e)}: result cleared` }, e.id);
  }
}
