// Coach dashboard: my team, my next game, my fixtures, my table, my squad, the fan link.
// Opened as /coach/?e=<slug>. The squad editor keeps a draft on the phone until it is saved.

import { ApiError, fullEvent, sendOps, session, sessionsFor, signOut, watchEvent } from "./api.js";
import { $, applyTheme, esc, officialName, pitchName, plural, side, toast } from "./ui.js";
import { tables, winnerOf } from "../core/standings.js";
import { formatCode, signInHtml, trySignIn } from "./ref-auth.js";

const app = $("#app");
const live = $("#say");
const slug = (new URLSearchParams(location.search).get("e") || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
const DRAFT = `ec.coachdraft.v1.${slug}`;

const S = { view: "signin", sess: null, event: null, rev: 0, squad: null, rows: null, savedAt: 0, busy: false, error: "", loadError: "", auth: false, watcher: null, lastHtml: "", pressing: false, dirty: false, signin: { value: "", error: "", busy: false, note: "", href: "" }, bulk: "", arm: false };

const clock = (t) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const sayIt = (m) => { live.textContent = ""; setTimeout(() => (live.textContent = m), 30); };
const toRows = (squad) => (squad || []).map((p) => ({ id: p.id, number: p.number == null ? "" : String(p.number), name: p.name || "" }));
const norm = (rows) => JSON.stringify(rows.map((r) => [r.number, r.name.trim()]));

function team() {
  for (const d of S.event.divisions) { const t = d.teams.find((x) => x.id === S.sess.subject); if (t) return { team: t, div: d }; }
  return null;
}

// ---- squad draft ----
function loadRows() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(DRAFT) || "null"); } catch (e) { /* none */ }
  if (saved && Array.isArray(saved.rows) && saved.base === norm(toRows(S.squad))) return saved.rows;
  return toRows(S.squad);
}
const saveDraft = () => { try { if (isDirty()) localStorage.setItem(DRAFT, JSON.stringify({ base: norm(toRows(S.squad)), rows: S.rows })); else localStorage.removeItem(DRAFT); } catch (e) { /* private mode */ } };
const isDirty = () => S.rows && S.squad && norm(S.rows.filter((r) => r.number !== "" || r.name.trim())) !== norm(toRows(S.squad));

function check(rows) {
  const seen = new Set();
  const used = rows.filter((r) => r.number !== "" || r.name.trim());
  if (used.length > 40) return "A squad can have up to 40 players. Remove a few.";
  for (const r of used) {
    if (r.number !== "") {
      if (!/^\d{1,3}$/.test(String(r.number).trim())) return `Shirt number "${r.number}" isn't right. Use a whole number from 0 to 999.`;
      const n = Number(r.number);
      if (seen.has(n)) return `Shirt number ${n} is used twice. Each number can only go to one player.`;
      seen.add(n);
    }
    if (r.name.length > 60) return `"${r.name.slice(0, 20)}…" is too long. Names can be up to 60 characters.`;
  }
  return "";
}

function parseBulk(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^#?(\d{1,3})\s*[.,:;)\-–]*\s*(.*)$/);
    return m ? { number: m[1], name: m[2].trim() } : { number: "", name: l };
  });
}

// ---- data ----
function applyFull(r) {
  if (!r || !r.event || r.rev < S.rev) return;
  const first = !S.event;
  S.event = r.event; S.rev = r.rev; S.loadError = ""; S.auth = false;
  applyTheme(r.event);
  document.title = `${r.event.name} | Coach | SHOT Event Clubhouse`;
  if (r.squad) {
    const wasDirty = S.rows && isDirty();
    S.squad = r.squad;
    if (first || !wasDirty) S.rows = loadRows();
  }
}

async function pullSquad() {
  try { applyFull(await fullEvent(slug)); render(); } catch (e) { if (e.status === 401) { S.auth = true; render(); } }
}

// ---- views ----
const fmtResult = (f, teamId, event) => {
  const home = side(event, f, "home").id === teamId;
  const mine = home ? f.homeScore : f.awayScore, theirs = home ? f.awayScore : f.homeScore;
  const w = winnerOf(f);
  const won = w ? (w === "home") === home : mine > theirs;
  const draw = mine === theirs && !w;
  return { text: `${mine}-${theirs}${f.pens ? " (pens)" : ""}`, tag: draw ? "Draw" : won ? "Won" : "Lost", cls: draw ? "d" : won ? "w" : "l", for: mine };
};

function gameLine(event, f, teamId) {
  const homeIsMe = side(event, f, "home").id === teamId;
  const opp = side(event, f, homeIsMe ? "away" : "home");
  const where = [pitchName(event, f.pitch), f.stage].filter(Boolean).join(" · ");
  let right;
  if (f.state === "ft") { const r = fmtResult(f, teamId, event); right = `<span class="ecc-res ecc-res--${r.cls}"><strong>${esc(r.tag)}</strong> ${esc(r.text)}</span>`; }
  else if (f.state === "live") right = `<span class="ec-badge ec-badge--live">Live</span> <strong>${f.homeScore ?? 0}-${f.awayScore ?? 0}</strong>`;
  else right = '<span class="ec-dim">Not started</span>';
  return `<li class="ecc-game"><span class="ecc-game__t">${esc(f.time)}</span><span class="ecc-game__m"><strong class="${opp.tbc ? "ec-dim" : ""}">${esc(opp.text)}</strong><span class="ec-dim ec-small">${esc(where)}${homeIsMe ? " · home" : " · away"}</span></span><span class="ecc-game__r">${right}</span></li>`;
}

function nextBanner(event, mine, teamId) {
  const live1 = mine.find((f) => f.state === "live");
  if (live1) {
    const h = side(event, live1, "home"), a = side(event, live1, "away");
    return `<section class="ec-card ecc-next is-live" aria-labelledby="ecc-n-h"><p class="ec-kicker" id="ecc-n-h">Live now</p>
      <p class="ecc-score"><span>${esc(h.text)}</span><strong>${live1.homeScore ?? 0}-${live1.awayScore ?? 0}</strong><span>${esc(a.text)}</span></p>
      <p class="ec-muted">${esc([live1.time, pitchName(event, live1.pitch), live1.ref ? `Ref ${officialName(event, live1.ref)}` : ""].filter(Boolean).join(" · "))}</p></section>`;
  }
  const nxt = mine.find((f) => f.state === "scheduled");
  if (nxt) {
    const homeIsMe = side(event, nxt, "home").id === teamId;
    const opp = side(event, nxt, homeIsMe ? "away" : "home");
    return `<section class="ec-card ecc-next" aria-labelledby="ecc-n-h"><p class="ec-kicker" id="ecc-n-h">Your next game</p>
      <p class="ecc-big">${esc(nxt.time)}</p>
      <p class="ecc-vs">v ${esc(opp.text)}</p>
      <p class="ec-muted">${esc([pitchName(event, nxt.pitch), nxt.stage, nxt.ref ? `Ref ${officialName(event, nxt.ref)}` : ""].filter(Boolean).join(" · "))}</p></section>`;
  }
  if (mine.length) return '<section class="ec-card ecc-next"><p class="ec-kicker">Your games</p><p class="ecc-vs">All done for now.</p><p class="ec-muted">If you go through to a knockout, the game appears here by itself.</p></section>';
  return '<section class="ec-card ecc-next"><p class="ec-kicker">Your games</p><p class="ecc-vs">No games yet.</p><p class="ec-muted">The organiser is still setting up the fixtures. This page fills in by itself.</p></section>';
}

function tableHtml(event, found) {
  const { div, team: t } = found;
  const tabs = tables(div, event.fixtures, event.settings.points);
  const tab = tabs.find((x) => x.rows.some((r) => r.id === t.id));
  const hasGroupGames = event.fixtures.some((f) => f.division === div.id && !f.stage);
  if (!tab || !hasGroupGames) return '<div class="ec-empty">No table for this event. It is all knockouts.</div>';
  return `<div class="ecc-tablewrap"><table class="ec-table ecc-table"><caption class="ecr-sr">${esc(tab.group ? `Group ${tab.group} table` : "Table")}</caption>
    <thead><tr><th scope="col" class="num">#</th><th scope="col">Team</th><th scope="col" class="num">P</th><th scope="col" class="num ecc-opt">W</th><th scope="col" class="num ecc-opt">D</th><th scope="col" class="num ecc-opt">L</th><th scope="col" class="num">GD</th><th scope="col" class="num">Pts</th></tr></thead>
    <tbody>${tab.rows.map((r, i) => `<tr class="${r.id === t.id ? "is-me" : ""}"><td class="num">${i + 1}</td><th scope="row" class="ecc-tn">${esc(r.name)}${r.id === t.id ? ' <span class="ecc-you">You</span>' : ""}</th><td class="num">${r.p}</td><td class="num ecc-opt">${r.w}</td><td class="num ecc-opt">${r.d}</td><td class="num ecc-opt">${r.l}</td><td class="num">${r.gd > 0 ? "+" : ""}${r.gd}</td><td class="num"><strong>${r.pts}</strong></td></tr>`).join("")}</tbody></table></div>
    <p class="ec-help">${esc(tab.group ? `Group ${tab.group}.` : "")} Only finished games count.</p>`;
}

function knockouts(event, found, mine) {
  const { team: t } = found;
  const g = t.group ? String(t.group).toLowerCase() : null;
  const could = (ref) => { const m = String(ref).match(/^(1st|2nd|3rd|4th) (?:in table|Group (\S+))$/i); return !!m && (m[2] ? !!g && m[2].toLowerCase() === g : true); };
  const list = event.fixtures.filter((f) => f.stage && (mine.includes(f) || could(f.home) || could(f.away))).sort((a, b) => (a.time < b.time ? -1 : 1));
  if (!list.length) return '<div class="ec-empty">No knockout games for this event.</div>';
  return `<ul class="ecc-list">${list.map((f) => {
    const h = side(event, f, "home"), a = side(event, f, "away");
    const sure = mine.includes(f);
    return `<li class="ecc-ko"><span class="ecc-game__t">${esc(f.time)}</span><span class="ecc-game__m"><strong>${esc(f.stage)}</strong><span class="${h.id === t.id ? "ecc-me" : ""}">${esc(h.text)}</span> <span class="ec-dim">v</span> <span class="${a.id === t.id ? "ecc-me" : ""}">${esc(a.text)}</span><span class="ec-dim ec-small">${esc(pitchName(event, f.pitch))}</span></span><span class="ecc-game__r ec-small ${sure ? "" : "ec-dim"}">${sure ? "You're in" : "If you finish there"}</span></li>`;
  }).join("")}</ul>`;
}

function voteText(by) {
  if (by === "name") return "Fans see first names only.";
  if (by === "both") return "Fans see shirt numbers with first names.";
  return "Fans see shirt numbers only.";
}

function squadEditor(event) {
  const rows = S.rows || [];
  const err = S.error;
  return `<section class="ec-card ecc-squad" aria-labelledby="ecc-sq-h">
    <h2 class="ec-d3" id="ecc-sq-h">Your squad</h2>
    <p class="ec-muted">${esc(voteText(event.settings.voteBy))} That is the organiser's setting. Full names stay private: only you and the organiser can see them.</p>
    ${rows.length ? `<ul class="ecc-rows">${rows.map((r, i) => `<li class="ecc-prow">
      <div class="ec-field ecc-num"><label for="ecc-n${i}"${i ? " class=\"ecr-sr\"" : ""}>Shirt</label><input id="ecc-n${i}" class="ec-input" inputmode="numeric" pattern="[0-9]*" maxlength="3" autocomplete="off" value="${esc(r.number)}" data-row="${i}" data-k="number" data-f="n${i}"></div>
      <div class="ec-field ecc-nm"><label for="ecc-m${i}"${i ? " class=\"ecr-sr\"" : ""}>Name</label><input id="ecc-m${i}" class="ec-input" maxlength="60" autocomplete="off" value="${esc(r.name)}" data-row="${i}" data-k="name" data-f="m${i}"></div>
      <button type="button" class="ec-btn ec-btn--ghost ecc-rm" data-act="remove" data-i="${i}" data-f="rm${i}" aria-label="Remove player ${i + 1}${r.name ? ", " + esc(r.name) : ""}">&times;</button></li>`).join("")}</ul>`
      : '<div class="ec-empty">No players yet. Add one, or paste your list below.</div>'}
    <div class="ecc-actions"><button type="button" class="ec-btn ec-btn--ghost" data-act="add" data-f="add">Add a player</button></div>
    <details class="ecc-bulk"><summary data-f="bulk-s">Paste a list</summary>
      <div class="ec-field"><label for="ecc-bulk">One player a line, like "7 Sam Jones"</label><textarea id="ecc-bulk" class="ec-textarea" rows="5" spellcheck="false" data-bulk="1" data-f="bulk">${esc(S.bulk)}</textarea></div>
      <button type="button" class="ec-btn ec-btn--ghost" data-act="bulk" data-f="bulk-go">Add these players</button>
    </details>
    ${err ? `<p class="ec-error" role="alert">${esc(err)}</p>` : ""}
    <div class="ecc-save"><button type="button" class="ec-btn ec-btn--big ec-btn--block" data-act="save" data-f="save"${S.busy || !isDirty() ? " disabled" : ""}>${S.busy ? "Saving…" : "Save squad"}</button>
    <p class="ec-help" role="status">${isDirty() ? "You have changes that aren't saved yet." : S.savedAt ? `Saved ✓ ${clock(S.savedAt)}` : "Everything here is saved."}</p></div>
  </section>`;
}

function shareCard() {
  const link = `${location.origin}/e/${encodeURIComponent(slug)}/`;
  return `<section class="ec-card ecc-share" aria-labelledby="ecc-sh-h"><h2 class="ec-d3" id="ecc-sh-h">Share with your fans</h2>
    <p class="ec-muted">Parents and fans open this link to follow the scores. No app needed.</p>
    <p class="ecc-link ec-mono"><a href="${esc(link)}" target="_blank" rel="noopener">${esc(link)}</a></p>
    <div class="ecc-actions"><button type="button" class="ec-btn" data-act="copy" data-f="copy">Copy link</button>${navigator.share ? '<button type="button" class="ec-btn ec-btn--ghost" data-act="share" data-f="share">Share…</button>' : ""}</div></section>`;
}

function eventView() {
  if (!S.event) {
    if (S.loadError) return `<main id="main" class="ecr-main ec-narrow"><div class="ec-card ecr-state-card" role="alert"><h1 class="ec-d3">We couldn't load your team</h1><p>${esc(S.loadError)}</p><button type="button" class="ec-btn ec-btn--big ec-btn--block" data-act="retry" data-f="retry">Try again</button><a class="ecr-link" href="/coach/">Use a different code</a></div></main>`;
    return '<main id="main" class="ecr-main ec-narrow" aria-busy="true"><div class="ec-skel" style="height:110px"></div><div class="ec-skel" style="height:160px;margin-top:12px"></div><p class="ec-dim" role="status">Loading your team…</p></main>';
  }
  const event = S.event, found = team();
  const head = `<header class="ec-top"><div class="ec-wrap ecr-top"><span class="ec-brand"><img src="/assets/brand/shot-logo.png" alt="SHOT" width="44" height="28"></span><div class="ecr-top__txt"><p class="ecr-event">${esc(event.name)}</p><p class="ecr-me">Coach${found ? `: ${esc(found.team.name)}` : ""}</p></div></div></header>`;
  if (!found) return `${head}<main id="main" class="ecr-main ec-narrow"><div class="ec-empty">We can't find your team in this event. Ask the organiser to check your code.</div></main>`;
  const { team: t, div } = found;
  const mine = event.fixtures.filter((f) => side(event, f, "home").id === t.id || side(event, f, "away").id === t.id).sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  const banner = S.auth ? `<div class="ecr-banner ecr-banner--warn" role="alert"><p><strong>Your sign-in has run out.</strong> Enter your code again to keep editing.</p><button type="button" class="ec-btn" data-act="resign" data-f="resign">Enter your code</button></div>` : "";
  return `${head}<main id="main" class="ecr-main ec-narrow">${banner}
    <section class="ec-card ecc-team" aria-label="Your team"><p class="ec-kicker">${esc(event.date || "")}${event.venue ? ` · ${esc(event.venue)}` : ""}</p><h1 class="ec-d2">${esc(t.name)}</h1>
      <p class="ec-muted">${esc([div.name, t.group ? `Group ${t.group}` : ""].filter(Boolean).join(" · "))}</p></section>
    ${nextBanner(event, mine, t.id)}
    <section class="ecr-sec" aria-labelledby="ecc-fx-h"><h2 class="ecr-h" id="ecc-fx-h">Your games <span class="ec-dim">${mine.length}</span></h2>${mine.length ? `<ul class="ecc-list ec-card ecc-flat">${mine.map((f) => gameLine(event, f, t.id)).join("")}</ul>` : '<div class="ec-empty">No games yet.</div>'}</section>
    <section class="ecr-sec" aria-labelledby="ecc-tb-h"><h2 class="ecr-h" id="ecc-tb-h">${esc(t.group ? `Group ${t.group} table` : "Table")}</h2>${tableHtml(event, found)}</section>
    <section class="ecr-sec" aria-labelledby="ecc-ko-h"><h2 class="ecr-h" id="ecc-ko-h">Knockouts</h2>${knockouts(event, found, mine)}</section>
    ${squadEditor(event)}${shareCard()}
    <footer class="ecr-foot"><button type="button" class="ecr-link" data-act="refresh" data-f="refresh">Refresh now</button><button type="button" class="ecr-link${S.arm ? " is-armed" : ""}" data-act="signout" data-f="signout">${S.arm ? "Tap again to sign out" : "Sign out of this phone"}</button></footer>
  </main>`;
}

function signInView() {
  const s = S.signin;
  return `<main id="main" class="ecr-main">${signInHtml({ title: "Coach sign in", lede: s.note || "Type the code the organiser gave your team. This phone remembers it.", value: s.value, error: s.error, busy: s.busy, devices: sessionsFor(["coach"]), href: (sl) => `?e=${encodeURIComponent(sl)}` })}${s.href ? `<p class="ec-narrow ecr-gap"><a class="ec-btn ec-btn--ghost ec-btn--block" href="${esc(s.href)}">Open the right page</a></p>` : ""}</main>`;
}

function render() {
  if (S.pressing) { S.dirty = true; return; }
  S.dirty = false;
  const html = S.view === "signin" ? signInView() : eventView();
  if (html === S.lastHtml) return;
  const el = document.activeElement;
  const f = el && app.contains(el) && el.dataset && el.dataset.f ? { f: el.dataset.f, a: el.selectionStart, b: el.selectionEnd } : null;
  const open = app.querySelector(".ecc-bulk") ? app.querySelector(".ecc-bulk").open : false;
  app.innerHTML = html; S.lastHtml = html;
  const bulk = app.querySelector(".ecc-bulk"); if (bulk && open) bulk.open = true;
  if (f) { const n = app.querySelector(`[data-f="${CSS.escape(f.f)}"]`); if (n && !n.disabled) { n.focus({ preventScroll: true }); if (f.a != null && n.setSelectionRange) { try { n.setSelectionRange(f.a, f.b); } catch (e) { /* ignore */ } } } }
}

// ---- events ----
async function save() {
  S.error = "";
  const err = check(S.rows);
  if (err) { S.error = err; return render(); }
  const found = team();
  const players = S.rows.filter((r) => r.number !== "" || r.name.trim()).map((r) => ({ ...(r.id ? { id: r.id } : {}), number: r.number === "" ? null : Number(r.number), name: r.name.trim() }));
  S.busy = true; render();
  try {
    const r = await sendOps(slug, [{ op: "team.players", division: found.div.id, id: found.team.id, players }]);
    S.rows = null; applyFull(r); S.rows = toRows(S.squad);
    S.savedAt = Date.now(); saveDraft(); sayIt("Squad saved");
  } catch (e) {
    S.error = e instanceof ApiError ? (e.status === 0 ? "No signal. Your changes are kept on this phone. Try again when you're back online." : e.status === 401 ? "Your sign-in has run out. Enter your code again, then save." : e.message) : "Something went wrong. Try again.";
    if (e.status === 401) S.auth = true;
  }
  S.busy = false; render();
}

async function handle(name, el) {
  if (name === "add") { S.rows.push({ number: "", name: "" }); render(); const i = S.rows.length - 1; const n = $(`#ecc-n${i}`); if (n) n.focus(); return; }
  if (name === "remove") { S.rows.splice(Number(el.dataset.i), 1); saveDraft(); S.error = ""; return render(); }
  if (name === "bulk") {
    const add = parseBulk(S.bulk);
    if (!add.length) { S.error = "Paste one player a line first."; return render(); }
    add.forEach((p) => { const hit = p.number !== "" && S.rows.find((r) => r.number === p.number); if (hit) { if (p.name) hit.name = p.name; } else S.rows.push(p); });
    S.bulk = ""; S.error = ""; saveDraft(); sayIt(`${plural(add.length, "player")} added`); return render();
  }
  if (name === "save") return save();
  if (name === "copy") {
    const link = `${location.origin}/e/${slug}/`;
    try { await navigator.clipboard.writeText(link); toast("Link copied.", "ok"); } catch (e) { const a = $(".ecc-link a"); if (a) { const r = document.createRange(); r.selectNode(a); getSelection().removeAllRanges(); getSelection().addRange(r); } toast("Press and hold the link to copy it.", "warn", 4000); }
    return;
  }
  if (name === "share") { try { await navigator.share({ title: S.event.name, url: `${location.origin}/e/${slug}/` }); } catch (e) { /* cancelled */ } return; }
  if (name === "refresh") { toast("Refreshing…", "ok", 1200); return pullSquad(); }
  if (name === "retry") { S.loadError = ""; render(); return S.watcher && S.watcher.refresh(); }
  if (name === "resign") { S.signin = { value: "", error: "", busy: false, note: "Your sign-in has run out. Type your code again. Your squad changes stay on this phone.", href: "" }; S.view = "signin"; return render(); }
  if (name === "signout") {
    if (!S.arm) { S.arm = true; setTimeout(() => { S.arm = false; render(); }, 4000); return render(); }
    if (S.watcher) S.watcher.stop();
    signOut(slug); S.sess = null; S.event = null; S.view = "signin"; S.arm = false;
    history.replaceState(null, "", "/coach/"); S.signin = { value: "", error: "", busy: false, note: "", href: "" }; return render();
  }
}

app.addEventListener("click", (e) => { const el = e.target.closest("[data-act]"); if (el && !el.disabled) handle(el.dataset.act, el); });
app.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (e.target.dataset.form !== "signin" || S.signin.busy) return;
  S.signin.busy = true; S.signin.error = ""; S.signin.href = ""; render();
  const r = await trySignIn(S.signin.value);
  S.signin.busy = false;
  if (r.error) { S.signin.error = r.error; return render(); }
  if (r.session.role !== "coach") {
    S.signin.error = r.session.role === "admin" ? "That is an organiser code. Open the admin page instead." : "That is a referee or judge code. Open the referee page instead.";
    S.signin.href = `/${r.session.role === "admin" ? "admin" : "ref"}/?e=${encodeURIComponent(r.session.slug)}`;
    return render();
  }
  location.replace(`/coach/?e=${encodeURIComponent(r.session.slug)}`);
});
app.addEventListener("input", (e) => {
  const el = e.target;
  if (el.id === "ecr-code") { el.value = formatCode(el.value); S.signin.value = el.value; return; }
  if (el.dataset.bulk) { S.bulk = el.value; return; }
  if (el.dataset.row !== undefined) {
    const row = S.rows[Number(el.dataset.row)]; if (!row) return;
    row[el.dataset.k] = el.dataset.k === "number" ? el.value.replace(/\D/g, "").slice(0, 3) : el.value;
    if (el.dataset.k === "number") el.value = row.number;
    S.error = ""; saveDraft();
    const btn = $('[data-act="save"]'); if (btn) btn.disabled = !isDirty() || S.busy;
  }
});
app.addEventListener("pointerdown", () => { S.pressing = true; clearTimeout(S.pt); S.pt = setTimeout(() => { S.pressing = false; if (S.dirty) render(); }, 1500); }, true);
["pointerup", "pointercancel"].forEach((t) => document.addEventListener(t, () => { if (!S.pressing) return; S.pressing = false; clearTimeout(S.pt); if (S.dirty) setTimeout(render, 60); }, true));

// ---- start ----
const s0 = slug ? session(slug, ["coach"]) : null;
if (s0) {
  S.sess = s0; S.view = "event"; render();
  S.watcher = watchEvent(slug, (event, rev, resp) => {
    if (rev < S.rev) return;
    applyFull({ event, rev, squad: resp && resp.squad }); render();
  }, {
    path: `/api/events/${encodeURIComponent(slug)}/full`, token: s0.token,
    onError: (e) => {
      if (e.status === 401) { S.auth = true; return render(); }
      if (!S.event) { S.loadError = e.status === 0 ? "No signal. Check your connection, then try again." : e.status === 404 ? "We can't find that event. Check the link, or sign in with your code." : e.message; render(); }
    },
  });
} else {
  if (slug && session(slug)) S.signin.note = "That code is for a different job. Sign in with your coach code.";
  else if (slug) S.signin.note = "Type the code the organiser gave your team.";
  render();
}
