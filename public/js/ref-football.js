// Football referee view: my games, big + and -, state buttons, penalties, the stream panel.
// Pure rendering from the event as the phone should show it; every tap goes through c.send().

import { esc, side, pitchName, stageText as stageName } from "./ui.js";
import { streamInfo, HTTPS, terms } from "../core/model.js";
import { restoreOps } from "./ref-queue.js";

const STATES = [["scheduled", "Not started"], ["live", "Live"], ["ft", "FT"]];
const isLevel = (f) => f.homeScore != null && f.homeScore === f.awayScore;
const needsPens = (f) => !!f.stage && f.state === "ft" && isLevel(f);
const byTime = (a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : a.id < b.id ? -1 : 1);
const fixture = (event, id) => event.fixtures.find((f) => f.id === id);

function stageText(event, f) {
  if (f.stage) return stageName(f.stage);
  const div = event.divisions.find((d) => d.id === f.division);
  const team = div && div.teams.find((t) => t.id === f.home);
  return [event.divisions.length > 1 && div ? div.name : "", team && team.group ? `Group ${team.group}` : ""].filter(Boolean).join(", ");
}

const sides = (event, f) => ({ home: side(event, f, "home"), away: side(event, f, "away") });

// The squad of the team on one side of a game: [{ id, number, name }], or [] when there is none.
const squadOf = (event, f, which) => {
  const id = side(event, f, which).id;
  const div = event.divisions.find((d) => d.id === f.division);
  const t = id && div && div.teams.find((x) => x.id === id);
  return t && Array.isArray(t.players) ? t.players : [];
};
const playerText = (p) => [p.number != null ? `#${p.number}` : "", (p.name || "").trim()].filter(Boolean).join(" ");

// "#9 Sam Brown 6'" under the score, one line per goal, home on the left and away on the right.
function goalList(event, f, s) {
  const goals = Array.isArray(f.goals) ? f.goals : [];
  if (!goals.length) return "";
  const div = event.divisions.find((d) => d.id === f.division);
  const rows = goals.map((g) => {
    const t = div && div.teams.find((x) => x.id === g.team);
    const p = g.player != null && t && (t.players || []).find((x) => x.id === g.player);
    const who = g.player == null ? "Not sure" : p ? playerText(p) || "Player" : "Unknown player";
    return `<li class="ecr-goal ecr-goal--${g.side}"><span class="ecr-sr">${esc(s[g.side].text)}: </span>${esc(who)}${g.min != null ? ` ${esc(String(g.min))}'` : ""}</li>`;
  }).join("");
  return `<ul class="ecr-goals" aria-label="Goals">${rows}</ul>`;
}

// The "Who scored?" sheet. ui.pick = { id, side, f } while it is open.
function sheet(c) {
  const { event, ui } = c;
  const pick = ui.pick;
  const f = pick && fixture(event, pick.id);
  if (!f) return "";
  const nm = sides(event, f)[pick.side];
  const list = squadOf(event, f, pick.side).map((p) => `<li><button type="button" class="ecr-pl" data-act="pick-player" data-player="${esc(p.id)}" data-f="pl:${esc(p.id)}">${p.number != null ? `<span class="ecr-pl__n">#${esc(String(p.number))}</span>` : ""}${(p.name || "").trim() ? `<span class="ecr-pl__name">${esc(p.name.trim())}</span>` : ""}</button></li>`).join("");
  return `<div class="ecr-sheetwrap">
    <div class="ecr-backdrop" data-act="pick-close"></div>
    <div class="ecr-sheet" role="dialog" aria-modal="true" aria-labelledby="ecr-sheet-h" tabindex="-1">
      <h2 id="ecr-sheet-h" class="ecr-sheet__h">Who scored for ${esc(nm.text)}?</h2>
      <ul class="ecr-squad">${list}</ul>
      <div class="ecr-sheet__foot ecr-two">
        <button type="button" class="ec-btn ec-btn--big" data-act="pick-player" data-player="" data-f="pl:none">Not sure</button>
        <button type="button" class="ec-btn ec-btn--big ec-btn--ghost" data-act="pick-close" data-f="pl:close">Cancel</button>
      </div>
    </div>
  </div>`;
}

export function mine(me) { return (f) => f.ref === me.id || (!!me.pitch && f.pitch === me.pitch); }

// Which games this referee is looking at, split into the three lists.
export function lists(c) {
  const { event, me, ui } = c;
  const scope = ui.scope || "mine";
  const pitch = ui.pitch || "all";
  let list = event.fixtures.filter((f) => (scope === "all" || mine(me)(f)) && (pitch === "all" || f.pitch === pitch));
  list = [...list].sort(byTime);
  return {
    list,
    live: list.filter((f) => f.state === "live"),
    next: list.filter((f) => f.state === "scheduled"),
    done: list.filter((f) => f.state === "ft").reverse(),
  };
}

export const anyLive = (c) => lists(c).live.length > 0;

function sideCol(c, f, which, nm) {
  const T = terms(c.event);
  const n = f[which === "home" ? "homeScore" : "awayScore"];
  const started = f.state !== "scheduled";
  return `<div class="ecr-side">
    <p class="ecr-name${nm.tbc ? " is-tbc" : ""}">${esc(nm.text)}</p>
    <p class="ecr-score${started ? "" : " is-idle"}" aria-label="${esc(nm.text)} ${n ?? 0}">${n ?? 0}</p>
    <button type="button" class="ec-btn ecr-plus" data-act="goal" data-id="${esc(f.id)}" data-side="${which}" data-d="1" data-f="p:${esc(f.id)}:${which}" aria-label="${esc(T.Score)} for ${esc(nm.text)}">+</button>
    <button type="button" class="ec-btn ec-btn--ghost ecr-minus" data-act="goal-undo" data-id="${esc(f.id)}" data-side="${which}" data-d="-1" data-f="m:${esc(f.id)}:${which}" aria-label="Take a ${esc(T.score)} off ${esc(nm.text)}"${(n ?? 0) === 0 ? " disabled" : ""}>&minus;</button>
  </div>`;
}

function meta(c, f, badge) {
  const { event } = c;
  const bits = [pitchName(event, f.pitch), stageText(event, f)].filter(Boolean);
  return `<span class="ecr-time">${esc(f.time)}</span>${bits.length ? `<span class="ecr-meta">${esc(bits.join(" · "))}</span>` : ""}${badge}`;
}

const badgeFor = (f) => (f.state === "live" ? '<span class="ec-badge ec-badge--live">Live</span>' : f.state === "ft" ? '<span class="ec-badge ec-badge--ft">FT</span>' : '<span class="ec-badge">Not started</span>');

function full(c, f) {
  const { event, ui } = c;
  const s = sides(event, f);
  const armed = ui.arm === f.id;
  const seg = STATES.map(([v, text]) => {
    const label = v === "scheduled" && armed ? "Clear score? Tap again" : text;
    return `<button type="button" class="ecr-state${armed && v === "scheduled" ? " is-armed" : ""}" data-act="state" data-id="${esc(f.id)}" data-state="${v}" data-f="st:${esc(f.id)}:${v}" aria-pressed="${f.state === v}">${label}</button>`;
  }).join("");
  const pens = needsPens(f)
    ? `<fieldset class="ecr-pens${f.pens ? "" : " is-needed"}"><legend>Level at full time. Who won the penalties?</legend>
        ${["home", "away"].map((w) => `<button type="button" class="ecr-pen" data-act="pens" data-id="${esc(f.id)}" data-side="${w}" data-f="pn:${esc(f.id)}:${w}" aria-pressed="${f.pens === w}">${esc(s[w].text)}</button>`).join("")}
        ${f.pens ? "" : '<p class="ecr-pens__hint" role="alert">Pick a winner so the knockout can move on.</p>'}
      </fieldset>`
    : "";
  return `<article class="ec-card ecr-game is-${f.state}" aria-label="${esc(`${f.time}, ${s.home.text} v ${s.away.text}`)}">
    <header class="ecr-game__head">${meta(c, f, badgeFor(f))}</header>
    <div class="ecr-sides">${sideCol(c, f, "home", s.home)}<span class="ecr-v" aria-hidden="true">v</span>${sideCol(c, f, "away", s.away)}</div>
    <div class="ecr-states" role="group" aria-label="Game state">${seg}</div>
    ${goalList(c.event, f, s)}
    ${f.state === "scheduled" ? '<p class="ec-help ecr-hint">Tap + to score. The game goes live by itself.</p>' : ""}
    ${pens}
  </article>`;
}

function compact(c, f) {
  const s = sides(c.event, f);
  const score = f.homeScore == null ? "v" : `${f.homeScore}-${f.awayScore}${f.pens ? " (p)" : ""}`;
  return `<button type="button" class="ec-card ecr-mini" data-act="open" data-id="${esc(f.id)}" data-f="o:${esc(f.id)}" aria-label="${esc(`${f.state === "ft" ? "Edit" : "Open"} ${f.time}, ${s.home.text} ${score} ${s.away.text}`)}">
    <span class="ecr-mini__top">${meta(c, f, badgeFor(f))}</span>
    <span class="ecr-mini__row"><span class="ecr-mini__side${s.home.tbc ? " is-tbc" : ""}">${esc(s.home.text)}</span><span class="ecr-mini__score">${esc(score)}</span><span class="ecr-mini__side ecr-mini__side--away${s.away.tbc ? " is-tbc" : ""}">${esc(s.away.text)}</span></span>
  </button>`;
}

function section(title, count, html, extra = "") {
  return `<section class="ecr-sec" aria-label="${esc(title)}"><h2 class="ecr-h">${esc(title)} <span class="ec-dim">${count}</span></h2>${html}${extra}</section>`;
}

function filters(c) {
  const { event, ui } = c;
  const scope = ui.scope || "mine";
  const pitches = event.pitches || [], T = terms(event);
  return `<div class="ecr-filters">
    <div class="ec-seg" role="group" aria-label="Which games">
      <button type="button" data-act="scope" data-v="mine" aria-pressed="${scope === "mine"}" data-f="sc:mine">My games</button>
      <button type="button" data-act="scope" data-v="all" aria-pressed="${scope === "all"}" data-f="sc:all">All games</button>
    </div>
    ${pitches.length > 1 ? `<div class="ec-field ecr-pitchsel"><label for="ecr-pitch">${esc(T.Place)}</label><select id="ecr-pitch" class="ec-select" data-change="pitch" data-f="pitch">
      <option value="all">All ${esc(T.places)}</option>${pitches.map((p) => `<option value="${esc(p.id)}"${ui.pitch === p.id ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>` : ""}
  </div>`;
}

// The stream panel works on one pitch: the one picked in the filter, else mine, else the whole event.
export function streamTarget(c) {
  const { ui, me } = c;
  return ui.pitch && ui.pitch !== "all" ? ui.pitch : me.pitch || null;
}
function streamNow(event, target) {
  if (target == null) return event.stream || { url: null, on: false, label: "" };
  const p = (event.pitches || []).find((x) => x.id === target);
  return (p && p.stream) || { url: null, on: false, label: "" };
}
function verdict(url) {
  if (!url) return "Paste a YouTube, Twitch or Veo link, or a video link.";
  if (!HTTPS.test(url)) return "Links start with https://";
  const s = streamInfo({ url, on: true });
  if (!s) return "That link doesn't look right. Check it and try again.";
  if (s.kind === "youtube") return "YouTube link. Fans watch it inside the page.";
  if (s.kind === "twitch") return "Twitch link. Fans watch it inside the page.";
  if (s.kind === "video") return "Video link. Fans watch it in our player.";
  return `${s.host} link. Fans get a Watch on ${s.host} button.`;
}

function streamPanel(c) {
  const { event, ui } = c;
  const target = streamTarget(c);
  const now = streamNow(event, target);
  const d = ui.drafts || {};
  const url = d[`stream:${target}:url`] ?? now.url ?? "";
  const label = d[`stream:${target}:label`] ?? now.label ?? "";
  const where = target ? pitchName(event, target) : "the event", T = terms(event);
  const dirty = url !== (now.url ?? "") || label !== (now.label ?? "");
  if (c.publicDemo) {
    return `<section class="ec-card ecr-stream" aria-labelledby="ecr-stream-h">
    <h2 id="ecr-stream-h" class="ecr-h">Live stream for ${esc(where)}</h2>
    <p class="ec-help" data-demo-stream>On your own event, you paste the stream link here (YouTube, Twitch, Veo or a video link) and switch it on when you're live. Fans watch it on the event page. In this public demo the link is fixed.</p>
  </section>`;
  }
  return `<section class="ec-card ecr-stream" aria-labelledby="ecr-stream-h">
    <h2 id="ecr-stream-h" class="ecr-h">Live stream for ${esc(where)}</h2>
    <div class="ec-field"><label for="ecr-stream-url">Stream link</label>
      <input id="ecr-stream-url" class="ec-input" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://youtube.com/live/…" value="${esc(url)}" data-draft="stream:${esc(String(target))}:url" data-f="su" aria-describedby="ecr-stream-verdict"></div>
    <p id="ecr-stream-verdict" class="ec-help ecr-verdict" aria-live="polite">${esc(verdict(url))}</p>
    <div class="ec-field"><label for="ecr-stream-label">Title fans see (optional)</label>
      <input id="ecr-stream-label" class="ec-input" maxlength="80" autocomplete="off" placeholder="${esc(T.Place)} 1, live" value="${esc(label)}" data-draft="stream:${esc(String(target))}:label" data-f="sl"></div>
    <div class="ecr-onoff" role="group" aria-label="Stream on or off">
      <button type="button" data-act="stream" data-on="false" aria-pressed="${!now.on}" data-f="s:off">Off</button>
      <button type="button" data-act="stream" data-on="true" aria-pressed="${!!now.on}" data-f="s:on">On</button>
    </div>
    <button type="button" class="ec-btn ec-btn--ghost ec-btn--block" data-act="stream-save" data-f="s:save"${dirty ? "" : " disabled"}>Save link</button>
    <p class="ec-help">${now.on ? "Fans can see this stream now." : "Fans can't see a stream yet. Switch it on when you're live."}</p>
  </section>`;
}

export function render(c) {
  const { event, ui } = c;
  const L = lists(c);
  if (!event.fixtures.length) return `<div class="ec-empty">No games yet. The organiser hasn't added the fixtures. This page fills in by itself.</div>${streamPanel(c)}`;
  const openIds = new Set([...L.live.map((f) => f.id), ...(L.next[0] ? [L.next[0].id] : []), ...(ui.open ? [ui.open] : [])]);
  const card = (f) => (openIds.has(f.id) ? full(c, f) : compact(c, f));
  let body = "";
  if (!L.list.length) {
    const scope = ui.scope || "mine";
    body = `<div class="ec-empty">${scope === "mine" ? "No games are assigned to you yet." : `No games on this ${terms(event).place}.`}${scope === "mine" ? '<p><button type="button" class="ec-btn" data-act="scope" data-v="all" data-f="sc:all2">Show all games</button></p>' : ""}</div>`;
  } else {
    if (L.live.length) body += section("Live now", L.live.length, L.live.map(card).join(""));
    if (L.next.length) body += section(L.live.length ? "Next up" : "Next up", L.next.length, L.next.map(card).join(""));
    if (L.done.length) body += section("Finished", L.done.length, L.done.map(card).join(""));
    if (!L.live.length && !L.next.length) body = `<div class="ec-empty">${(ui.scope || "mine") === "mine" ? "All your games are finished. Thank you." : "All games are finished."}</div>` + body;
  }
  return `${filters(c)}${body}${streamPanel(c)}${sheet(c)}`;
}

function sendGoal(c, f, which, player) {
  const s = sides(c.event, f);
  const h = (f.homeScore ?? 0) + (which === "home" ? 1 : 0), a = (f.awayScore ?? 0) + (which === "away" ? 1 : 0);
  if (h > 99 || a > 99) return;
  const op = { op: "goal.add", id: f.id, side: which, ...(player ? { player } : {}) };
  return c.send([op], { undo: restoreOps(f), haptic: 18, say: `${s[which].text} scored. ${s.home.text} ${h}, ${s.away.text} ${a}` });
}

export function act(c, name, el) {
  const { event, ui } = c;
  const id = el.dataset.id;
  if (name === "scope") { ui.scope = el.dataset.v; ui.open = null; return c.rerender(); }
  if (name === "open") { ui.open = id; return c.rerender(); }
  if (name === "score") {
    const f = fixture(event, id); if (!f) return;
    const d = Number(el.dataset.d);
    let h = f.homeScore ?? 0, a = f.awayScore ?? 0;
    if (el.dataset.side === "home") h += d; else a += d;
    if (h < 0 || a < 0 || h > 99 || a > 99) return;
    const s = sides(event, f);
    return c.send([{ op: "fixture.score", id, home: h, away: a }], { key: `score:${id}`, undo: restoreOps(f), haptic: d > 0 ? 18 : 8, say: `${s.home.text} ${h}, ${s.away.text} ${a}` });
  }
  if (name === "goal") {
    const f = fixture(event, id); if (!f) return;
    const which = el.dataset.side;
    // A finished game keeps the plain +1 so a result can still be corrected.
    if (f.state === "ft") return act(c, "score", el);
    if (event.settings.juniors || !squadOf(event, f, which).length) return sendGoal(c, f, which, null);
    ui.pick = { id, side: which, f: el.dataset.f };
    return c.rerender();
  }
  if (name === "pick-close") { ui.pick = null; return c.rerender(); }
  if (name === "pick-player") {
    const pick = ui.pick; if (!pick) return;
    const f = fixture(event, pick.id);
    ui.pick = null;
    if (!f) return c.rerender();
    return sendGoal(c, f, pick.side, el.dataset.player || null);
  }
  if (name === "goal-undo") {
    const f = fixture(event, id); if (!f) return;
    const which = el.dataset.side;
    const n = f[which === "home" ? "homeScore" : "awayScore"] ?? 0;
    if (n <= 0) return;
    const mineGoals = (f.goals || []).filter((g) => g.side === which);
    const last = mineGoals[mineGoals.length - 1];
    // Put the goal back with its scorer where we can; otherwise restore the whole game.
    const back = last && mineGoals.length === n && f.state !== "ft"
      ? [{ op: "goal.add", id, side: which, ...(last.player != null ? { player: last.player } : {}), ...(last.min != null ? { min: last.min } : {}) }]
      : restoreOps(f);
    return c.send([{ op: "goal.undo", id, side: which }], { undo: back, haptic: 8, say: `Goal taken off ${sides(event, f)[which].text}` });
  }
  if (name === "state") {
    const f = fixture(event, id); if (!f) return;
    const to = el.dataset.state;
    if (f.state === to) return;
    if (to === "scheduled" && (f.state === "ft" || f.homeScore > 0 || f.awayScore > 0) && ui.arm !== id) {
      ui.arm = id; clearTimeout(ui.armTimer); ui.armTimer = setTimeout(() => { ui.arm = null; c.rerender(); }, 4000); return c.rerender();
    }
    ui.arm = null;
    const s = sides(event, f);
    return c.send([{ op: "fixture.state", id, state: to }], { undo: restoreOps(f), haptic: 12, say: `${s.home.text} v ${s.away.text}: ${to === "ft" ? "full time" : to === "live" ? "live" : "not started"}` });
  }
  if (name === "pens") {
    const f = fixture(event, id); if (!f) return;
    const side2 = f.pens === el.dataset.side ? null : el.dataset.side;
    return c.send([{ op: "fixture.pens", id, side: side2 }], { undo: restoreOps(f), haptic: 12, say: side2 ? `${sides(event, f)[side2].text} win on penalties` : "Penalty winner cleared" });
  }
  if (name === "stream" || name === "stream-save") {
    const target = streamTarget(c);
    const now = streamNow(event, target);
    const d = ui.drafts || {};
    const url = (d[`stream:${target}:url`] ?? now.url ?? "").trim();
    const label = (d[`stream:${target}:label`] ?? now.label ?? "").trim();
    const on = name === "stream" ? el.dataset.on === "true" : !!now.on;
    if (url && !HTTPS.test(url)) return c.toast("Links start with https://", "warn");
    if (on && !url) return c.toast("Add a link first, then switch it on.", "warn");
    const sent = c.send([{ op: "stream.set", pitch: target, url: url || null, on, label }], { key: `stream:${target}`, say: on ? "Stream on" : "Stream off" });
    delete ui.drafts[`stream:${target}:url`]; delete ui.drafts[`stream:${target}:label`];
    return sent;
  }
}

// The sheet's keyboard and focus. ref.js redraws the page by replacing its HTML, so this watches
// the page: focus moves into the sheet when it opens, Tab stays inside it, Escape closes it, and
// focus goes back to the + button that opened it.
if (typeof document !== "undefined") {
  let wasOpen = false, opener = null;
  const sheetEl = () => document.querySelector(".ecr-sheet");
  const sync = () => {
    const el = sheetEl();
    document.body.classList.toggle("ecr-sheet-open", !!el);
    if (el) {
      if (!wasOpen) { const a = document.activeElement; opener = a && a.dataset ? a.dataset.f || null : null; }
      if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });
    } else if (wasOpen && opener) {
      const back = document.querySelector(`[data-f="${CSS.escape(opener)}"]`);
      if (back && !back.disabled) back.focus({ preventScroll: true });
      opener = null;
    }
    wasOpen = !!el;
  };
  const start = () => { const app = document.getElementById("app"); if (app) new MutationObserver(sync).observe(app, { childList: true, subtree: true }); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  document.addEventListener("keydown", (e) => {
    const el = sheetEl(); if (!el) return;
    if (e.key === "Escape") { e.preventDefault(); const x = el.querySelector('[data-act="pick-close"]'); if (x) x.click(); return; }
    if (e.key !== "Tab") return;
    const items = [...el.querySelectorAll("button:not([disabled])")];
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1], on = document.activeElement;
    if (!el.contains(on) || (on === el && e.shiftKey)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    else if (e.shiftKey && on === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && on === last) { e.preventDefault(); first.focus(); }
  });
}

