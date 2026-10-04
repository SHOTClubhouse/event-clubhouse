// Boxing: the referee / timekeeper view (bout controls, round clock, result) and the judge view
// (score each round once it has ended). Rendering only; taps go through c.send() or c.sendNow().

import { esc, plural } from "./ui.js";
import { METHODS, firstName } from "../core/model.js";
import { currentBout, judgeCard, resultText } from "../core/boxing.js";

const METHOD_NAME = { PTS: "Points", KO: "KO", TKO: "TKO", RSC: "RSC", RTD: "RTD", DQ: "DQ", DRAW: "Draw", NC: "No contest" };
const STOPPAGES = ["KO", "TKO", "RSC", "RTD", "DQ"];
const BREAK_MS = 60000;
const sorted = (event) => [...(event.card.bouts || [])].sort((a, b) => a.order - b.order);
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

// ---- the round clock: a guide counted on this phone, not the official time ----
const CLOCK = (slug) => `ec.refclock.v1.${slug}`;
const clocks = (slug) => { try { return JSON.parse(localStorage.getItem(CLOCK(slug)) || "{}"); } catch (e) { return {}; } };
export function clockStart(slug, boutId, round, at = Date.now()) {
  const all = clocks(slug); all[boutId] = { round, at };
  try { localStorage.setItem(CLOCK(slug), JSON.stringify(all)); } catch (e) { /* the clock just restarts on reload */ }
}
function roundStart(slug, b) {
  const mine = clocks(slug)[b.id];
  if (mine && mine.round === b.round) return { at: mine.at, est: false };
  const guess = b.round === 1 ? b.startedAt : (b.roundEnds || {})[b.round - 1] ? b.roundEnds[b.round - 1] + BREAK_MS : null;
  return guess ? { at: guess, est: true } : null;
}

// Called every second by the page: updates the clock text without re-drawing anything else.
export function tick(c, root) {
  const el = root.querySelector("[data-clock]"); if (!el) return;
  const b = (c.event.card.bouts || []).find((x) => x.id === el.dataset.clock); if (!b) return;
  const text = el.querySelector("[data-clock-time]"), bar = el.querySelector("[data-clock-bar]"), note = el.querySelector("[data-clock-note]");
  const now = Date.now();
  let remaining, total, label, over = false;
  if (b.state === "live") {
    total = b.roundMins * 60000;
    const st = roundStart(c.slug, b);
    if (!st) { text.textContent = "--:--"; bar.style.width = "0%"; note.textContent = "Clock not running on this phone."; return; }
    remaining = total - (now - st.at);
    over = remaining < 0;
    label = over ? `Time. ${mmss(-remaining)} over.` : st.est ? "Round clock (estimate, started on another phone)" : "Round clock (a guide, not the official time)";
  } else if (b.state === "break") {
    total = BREAK_MS;
    const endedAt = (b.roundEnds || {})[b.round] || now;
    remaining = total - (now - endedAt);
    over = remaining < 0;
    label = over ? "Break over. Next round when the boxers are ready." : "Break";
  } else return;
  text.textContent = over ? "0:00" : mmss(remaining);
  bar.style.width = `${Math.max(0, Math.min(100, (remaining / total) * 100))}%`;
  note.textContent = label;
  el.classList.toggle("is-low", !over && remaining <= 10000);
  el.classList.toggle("is-over", over);
  if (!over && remaining <= 10000 && remaining > 9000 && b.state === "live" && navigator.vibrate) navigator.vibrate([60, 60, 60]);
}

export const boxingLive = (c) => { const b = currentBout(c.event.card); return !!b && (b.state === "live" || b.state === "break"); };

const corner = (b, which) => `<div class="ecr-corner ecr-corner--${which}">
  <p class="ecr-corner__tag"><span class="ecr-chip ecr-chip--${which}" aria-hidden="true">${which === "red" ? "R" : "B"}</span>${which === "red" ? "Red corner" : "Blue corner"}</p>
  <p class="ecr-corner__name">${esc(b[which].name)}</p>
  ${b[which].club ? `<p class="ecr-corner__club">${esc(b[which].club)}</p>` : ""}
</div>`;

function stateText(b) {
  if (b.state === "done") return resultText(b) || "Finished";
  if (b.state === "live") return `Round ${b.round} of ${b.rounds}, live`;
  if (b.state === "break") return `Round ${b.round} of ${b.rounds} ended, break`;
  return "Not started";
}

function boutHead(b, picked, always = false) {
  const running = !always && (b.state === "live" || b.state === "break");
  const bits = [b.weight, plural(b.rounds, "round") + " of " + b.roundMins + " min"].filter(Boolean);
  return `<section class="ec-card ecr-bout" aria-label="Current bout">
    <p class="ecr-bout__top"><span class="ecr-time">Bout ${b.order}</span>${b.title ? `<span class="ecr-meta">${esc(b.title)}</span>` : ""}<span class="ec-badge ${b.state === "live" ? "ec-badge--live" : ""}">${b.state === "break" ? "Break" : b.state === "done" ? "Done" : b.state === "live" ? "Live" : "Not started"}</span></p>
    <div class="ecr-corners">${corner(b, "red")}${corner(b, "blue")}</div>
    <p class="ecr-bout__info">${esc(bits.join(" · "))}</p>
    ${running ? "" : `<p class="ecr-bout__state" aria-live="polite">${esc(stateText(b))}</p>`}
    ${picked ? '<p class="ecr-note">This is not the bout that is on now.</p>' : ""}
  </section>`;
}

function clockHtml(b) {
  if (b.state !== "live" && b.state !== "break") return "";
  return `<section class="ec-card ecr-clock" data-clock="${esc(b.id)}" aria-label="${b.state === "live" ? "Round clock" : "Break clock"}">
    <p class="ecr-clock__round" aria-live="polite">${esc(stateText(b))}</p>
    <p class="ecr-clock__time" data-clock-time aria-hidden="true">--:--</p>
    <div class="ecr-clock__track" aria-hidden="true"><div class="ecr-clock__bar" data-clock-bar></div></div>
    <p class="ecr-clock__note" data-clock-note></p>
    ${b.state === "live" ? '<button type="button" class="ecr-link" data-act="clock-restart" data-f="clk">Restart the clock</button>' : ""}
  </section>`;
}

function waitingLine(c, b) {
  const js = judgeStatus(c, b);
  if (!js || b.state === "scheduled" || b.state === "done") return "";
  return js.waiting.length ? `<p class="ecr-wait" role="status">Waiting on ${esc(waitText(js.waiting))}</p>` : "";
}

function controls(c, b) {
  const { ui } = c;
  const armed = ui.arm === `end:${b.id}`;
  const last = b.round >= b.rounds;
  const btn = (act, label, on, cls = "", extra = "") => `<button type="button" class="ec-btn ec-btn--block ecr-ctl ${on ? "ecr-ctl--on" : "ec-btn--ghost ecr-ctl--off"} ${cls}" data-act="${act}" data-id="${esc(b.id)}" data-f="${act}" ${on ? "" : "disabled"} ${extra}>${label}</button>`;
  return `<section class="ecr-controls" aria-label="Bout controls">
    ${btn("bout-start", "Start bout", b.state === "scheduled")}
    ${btn("bout-end", armed ? `Tap again to end round ${b.round}` : `End round${b.state === "live" ? " " + b.round : ""}`, b.state === "live", armed ? "is-armed" : "")}
    ${btn("bout-next", `Next round${b.state === "break" && !last ? " " + (b.round + 1) : ""}`, b.state === "break" && !last)}
    ${b.state === "break" && last ? '<p class="ecr-note">That was the last round. Record the result.</p>' : ""}
    ${b.state === "done"
      ? `<button type="button" class="ec-btn ec-btn--ghost ec-btn--block" data-act="bout-reopen" data-id="${esc(b.id)}" data-f="reopen">Change the result</button>`
      : `<button type="button" class="ec-btn ec-btn--gold ec-btn--block ecr-ctl ecr-ctl--result" data-act="result-open" data-id="${esc(b.id)}" data-f="result"${b.state === "scheduled" ? " disabled" : ""} aria-expanded="${!!ui.result}">Result</button>`}
  </section>`;
}

// Who still has to score: from the website's judging progress (names and round numbers, never scores).
function judgeStatus(c, b) {
  const list = c.judging && c.judging[b.id];
  if (b.scoring !== "judges" || !list) return null;
  const ended = [];
  for (let n = 1; n <= b.rounds; n++) if (n < b.round || (n === b.round && (b.state === "break" || b.state === "done"))) ended.push(n);
  const waiting = list.map((j) => ({ name: j.name, rounds: ended.filter((n) => !j.rounds.includes(n)) })).filter((j) => j.rounds.length);
  const complete = list.every((j) => Array.from({ length: b.rounds }, (_, i) => i + 1).every((n) => j.rounds.includes(n)));
  return { waiting, complete };
}
const waitText = (w) => w.map((j) => `${firstName(j.name)}: ${j.rounds.length > 1 ? "rounds" : "round"} ${j.rounds.join(", ")}`).join(". ");

function resultSheet(c, b) {
  const r = c.ui.result;
  if (!r || r.bout !== b.id) return "";
  const judged = b.scoring === "judges";
  const needsWinner = r.method !== "DRAW" && r.method !== "NC" && !(r.method === "PTS" && judged);
  const stop = STOPPAGES.includes(r.method);
  const js = judgeStatus(c, b);
  const ptsBlocked = r.method === "PTS" && judged && js && !js.complete;
  const ready = !!r.method && (!needsWinner || !!r.winner) && !ptsBlocked;
  let summary = "";
  if (ready) {
    if (r.method === "PTS" && judged) summary = "On points. The result comes from the judges' cards.";
    else summary = resultText({ ...b, result: { method: r.method, winner: needsWinner ? r.winner : null, round: stop ? r.round : null } });
  }
  return `<section class="ec-card ecr-result" aria-labelledby="ecr-res-h">
    <h2 id="ecr-res-h" class="ecr-h">Record the result</h2>
    <fieldset class="ecr-fs"><legend>How did it end?</legend>
      <div class="ecr-methods">${METHODS.map((m) => `<button type="button" class="ecr-method" data-act="res-method" data-v="${m}" data-f="rm:${m}" aria-pressed="${r.method === m}">${m === "PTS" ? "Points decision" : METHOD_NAME[m]}</button>`).join("")}</div>
    </fieldset>
    ${r.method && needsWinner ? `<fieldset class="ecr-fs"><legend>Who won?</legend><div class="ecr-winners">
      ${["red", "blue"].map((w) => `<button type="button" class="ecr-win ecr-win--${w}" data-act="res-winner" data-v="${w}" data-f="rw:${w}" aria-pressed="${r.winner === w}"><span class="ecr-chip ecr-chip--${w}" aria-hidden="true">${w === "red" ? "R" : "B"}</span>${w === "red" ? "Red" : "Blue"}: ${esc(b[w].name)}</button>`).join("")}</div></fieldset>` : ""}
    ${r.method && stop ? `<div class="ec-field"><label for="ecr-res-round">Round it ended in</label><select id="ecr-res-round" class="ec-select" data-change="res-round" data-f="rr">${Array.from({ length: b.rounds }, (_, i) => `<option value="${i + 1}"${r.round === i + 1 ? " selected" : ""}>Round ${i + 1}</option>`).join("")}</select></div>` : ""}
    ${r.method === "PTS" && judged ? `<p class="${ptsBlocked ? "ecr-wait" : "ec-help"}" role="status">${ptsBlocked ? esc(js.waiting.length ? `Waiting on ${waitText(js.waiting)}.` : `Waiting on the judges to score every round (${b.rounds}).`) : "Every judge has scored every round. The website adds up the cards."}</p>` : ""}
    ${summary ? `<p class="ecr-summary">${esc(summary)}</p>` : ""}
    ${r.error ? `<p class="ecr-err" role="alert">${esc(r.error)}</p>` : ""}
    ${r.confirm
      ? `<p class="ecr-note" role="alert">This shows to everyone. Sure?</p><div class="ecr-two"><button type="button" class="ec-btn ec-btn--big ec-btn--gold" data-act="res-go" data-f="res-go"${r.busy ? " disabled" : ""}>${r.busy ? "Saving…" : "Yes, record it"}</button><button type="button" class="ec-btn ec-btn--big ec-btn--ghost" data-act="res-back" data-f="res-back">Back</button></div>`
      : `<div class="ecr-two"><button type="button" class="ec-btn ec-btn--big" data-act="res-confirm" data-f="res-confirm"${ready ? "" : " disabled"}>Record result</button><button type="button" class="ec-btn ec-btn--big ec-btn--ghost" data-act="res-cancel" data-f="res-cancel">Cancel</button></div>`}
  </section>`;
}

function cardList(c, cur) {
  const list = sorted(c.event);
  return `<section class="ecr-sec" aria-label="The card"><h2 class="ecr-h">The card <span class="ec-dim">${list.length}</span></h2>
    <ul class="ecr-card-list">${list.map((b) => `<li><button type="button" class="ec-card ecr-row${b.id === cur.id ? " is-picked" : ""}" data-act="pick-bout" data-id="${esc(b.id)}" data-f="pb:${esc(b.id)}" aria-pressed="${b.id === cur.id}">
      <span class="ecr-row__n">${b.order}</span>
      <span class="ecr-row__who"><span class="ecr-row__names"><span class="ecr-dot ecr-dot--red" aria-hidden="true"></span>${esc(b.red.name)} <span class="ec-dim">v</span> <span class="ecr-dot ecr-dot--blue" aria-hidden="true"></span>${esc(b.blue.name)}</span><span class="ec-dim ec-small">${esc(stateText(b))}</span></span>
    </button></li>`).join("")}</ul></section>`;
}

export function renderReferee(c) {
  const { event, ui } = c;
  const bouts = sorted(event);
  if (!bouts.length) return '<div class="ec-empty">No bouts on the card yet. This page fills in by itself.</div>';
  const live = currentBout(event.card);
  const cur = (ui.bout && bouts.find((b) => b.id === ui.bout)) || live || bouts[bouts.length - 1];
  const picked = !!live && cur.id !== live.id;
  const doneAll = !live && bouts.every((b) => b.state === "done");
  return `${doneAll ? '<div class="ec-empty">Every bout on the card is done. Thank you.</div>' : ""}${boutHead(cur, picked)}${clockHtml(cur)}${waitingLine(c, cur)}${controls(c, cur)}${resultSheet(c, cur)}${cardList(c, cur)}`;
}

// ---- Referee actions ----
export async function actReferee(c, name, el) {
  const { event, ui } = c;
  const id = el.dataset.id;
  const b = id ? (event.card.bouts || []).find((x) => x.id === id) : null;
  if (name === "pick-bout") { ui.bout = id; ui.result = null; return c.rerender(); }
  if (name === "clock-restart") { const t = (event.card.bouts || []).find((x) => x.id === ui.bout) || currentBout(event.card); if (t) clockStart(c.slug, t.id, t.round); return c.rerender(); }
  if (name === "bout-start" && b) { clockStart(c.slug, b.id, 1); ui.bout = b.id; return c.send([{ op: "bout.action", id, action: "start" }], { haptic: 20, say: `Bout ${b.order} started` }); }
  if (name === "bout-end" && b) {
    if (ui.arm !== `end:${id}`) { ui.arm = `end:${id}`; clearTimeout(ui.armTimer); ui.armTimer = setTimeout(() => { ui.arm = null; c.rerender(); }, 4000); return c.rerender(); }
    ui.arm = null;
    return c.send([{ op: "bout.action", id, action: "end-round", round: b.round }], { haptic: [40, 40, 40], say: `Round ${b.round} ended` });
  }
  if (name === "bout-next" && b) { clockStart(c.slug, b.id, b.round + 1); return c.send([{ op: "bout.action", id, action: "next-round", round: b.round }], { haptic: 20, say: `Round ${b.round + 1} started` }); }
  if (name === "bout-reopen" && b) return c.send([{ op: "bout.action", id, action: "reopen" }], { say: "Result cleared" });
  if (name === "result-open" && b) { ui.result = ui.result && ui.result.bout === id ? null : { bout: id, method: null, winner: null, round: b.round || 1, confirm: false, error: "" }; return c.rerender(); }
  const r = ui.result;
  if (!r) return;
  if (name === "res-cancel") { ui.result = null; return c.rerender(); }
  if (name === "res-method") { r.method = el.dataset.v; r.error = ""; r.confirm = false; return c.rerender(); }
  if (name === "res-winner") { r.winner = el.dataset.v; r.error = ""; r.confirm = false; return c.rerender(); }
  if (name === "res-confirm") { r.confirm = true; return c.rerender(); }
  if (name === "res-back") { r.confirm = false; return c.rerender(); }
  if (name === "res-go") {
    const bt = (event.card.bouts || []).find((x) => x.id === r.bout); if (!bt) return;
    const judged = bt.scoring === "judges";
    const op = { op: "bout.result", id: bt.id, method: r.method };
    if (r.method !== "DRAW" && r.method !== "NC" && !(r.method === "PTS" && judged)) op.winner = r.winner;
    if (STOPPAGES.includes(r.method)) op.round = Number(r.round);
    if (r.method === "PTS" && judged) {
      r.busy = true; r.error = ""; c.rerender();
      const out = await c.sendNow(op);
      r.busy = false;
      if (out.ok) { ui.result = null; c.toast("Result saved.", "ok"); } else { r.error = out.error; r.confirm = false; }
      return c.rerender();
    }
    ui.result = null;
    return c.send([op], { haptic: [60, 40, 60], say: "Result recorded" });
  }
}

// ---- Judge ----
const ended = (b, n) => n < b.round || (n === b.round && (b.state === "break" || b.state === "done"));
const decided = (b) => b.state === "done" && !!b.result;

function scoreButton(b, n, side2, loser) {
  const red = side2 === "red" ? 10 : loser, blue = side2 === "blue" ? 10 : loser;
  const text = side2 === "even" ? "Even 10-10" : `${side2 === "red" ? "Red" : "Blue"} 10-${loser}`;
  const cls = side2 === "even" ? "even" : side2;
  return `<button type="button" class="ecr-sc ecr-sc--${cls}" data-act="score-round" data-bout="${esc(b.id)}" data-round="${n}" data-red="${side2 === "even" ? 10 : red}" data-blue="${side2 === "even" ? 10 : blue}" data-f="sc:${n}:${cls}:${loser}">${side2 === "even" ? "" : `<span class="ecr-chip ecr-chip--${side2}" aria-hidden="true">${side2 === "red" ? "R" : "B"}</span>`}${text}</button>`;
}

export function renderJudge(c) {
  const { event, me, ui } = c;
  const mine = sorted(event).filter((b) => (b.judges || []).includes(me.id));
  if (!mine.length) return '<div class="ec-empty">You are not judging any bouts yet. If you think that is wrong, tell the organiser.</div>';
  const live = mine.find((b) => b.state === "live" || b.state === "break") || mine.find((b) => b.state === "scheduled");
  const cur = (ui.bout && mine.find((b) => b.id === ui.bout)) || live || mine[mine.length - 1];
  const card = judgeCard(event.scorecards, cur.id, me.id);
  const have = Object.fromEntries(card.rounds.map((r) => [r.round, r]));
  const locked = decided(cur);
  const rounds = Array.from({ length: cur.rounds }, (_, i) => i + 1);
  const firstOpen = rounds.find((n) => ended(cur, n) && !have[n]);
  const target = ui.edit && ended(cur, ui.edit) ? ui.edit : firstOpen;
  const waiting = !locked && !target && cur.state !== "done";
  const total = `<p class="ecr-totals" aria-label="Your card so far"><span class="ecr-tot ecr-tot--red"><span class="ecr-chip ecr-chip--red" aria-hidden="true">R</span>Red ${card.red}</span><span class="ecr-tot ecr-tot--blue"><span class="ecr-chip ecr-chip--blue" aria-hidden="true">B</span>Blue ${card.blue}</span></p>`;
  const panel = locked
    ? '<p class="ecr-note">This bout is decided. Ask the organiser if a card needs changing.</p>'
    : target
      ? `<section class="ec-card ecr-scorepanel" aria-labelledby="ecr-sp-h"><h2 id="ecr-sp-h" class="ecr-h">${have[target] ? `Change round ${target}` : `Score round ${target}`}</h2>
          <div class="ecr-scores">${scoreButton(cur, target, "red", 9)}${scoreButton(cur, target, "blue", 9)}${scoreButton(cur, target, "even", 10)}${scoreButton(cur, target, "red", 8)}${scoreButton(cur, target, "blue", 8)}
          <button type="button" class="ecr-sc ecr-sc--other" data-act="score-other" data-f="sc:other" aria-expanded="${!!ui.other}">Other (10-7, 10-6)</button>
          ${ui.other ? `${scoreButton(cur, target, "red", 7)}${scoreButton(cur, target, "blue", 7)}${scoreButton(cur, target, "red", 6)}${scoreButton(cur, target, "blue", 6)}` : ""}</div>
          ${ui.edit ? '<button type="button" class="ecr-link" data-act="score-cancel" data-f="sc:cancel">Cancel the change</button>' : ""}
        </section>`
      : waiting
        ? `<div class="ec-empty">${cur.state === "scheduled" ? "This bout hasn't started. Rounds open for scoring as the timekeeper ends them." : cur.state === "live" ? `Round ${cur.round} is live. You can score it the moment the timekeeper ends it.` : "Every round so far is scored."}</div>`
        : "";
  const rows = rounds.map((n) => {
    const r = have[n];
    const text = r ? `${r.red === r.blue ? "Even" : r.red > r.blue ? "Red" : "Blue"} ${r.red}-${r.blue}` : ended(cur, n) ? "Needs your score" : n === cur.round && cur.state === "live" ? "Live now" : "Not ended yet";
    return `<li class="ecr-rrow${r ? "" : " is-empty"}"><span class="ecr-rrow__n">Round ${n}</span><span class="ecr-rrow__v">${esc(text)}</span>${r && !locked ? `<button type="button" class="ec-btn ec-btn--ghost ec-btn--sm ecr-rrow__b" data-act="score-edit" data-round="${n}" data-f="re:${n}" aria-label="Change round ${n}">Change</button>` : ""}</li>`;
  }).join("");
  const others = mine.length > 1
    ? `<section class="ecr-sec" aria-label="My bouts"><h2 class="ecr-h">My bouts <span class="ec-dim">${mine.length}</span></h2><ul class="ecr-card-list">${mine.map((b) => `<li><button type="button" class="ec-card ecr-row${b.id === cur.id ? " is-picked" : ""}" data-act="pick-bout" data-id="${esc(b.id)}" data-f="pb:${esc(b.id)}" aria-pressed="${b.id === cur.id}"><span class="ecr-row__n">${b.order}</span><span class="ecr-row__who"><span class="ecr-row__names"><span class="ecr-dot ecr-dot--red" aria-hidden="true"></span>${esc(b.red.name)} <span class="ec-dim">v</span> <span class="ecr-dot ecr-dot--blue" aria-hidden="true"></span>${esc(b.blue.name)}</span><span class="ec-dim ec-small">${esc(stateText(b))}</span></span></button></li>`).join("")}</ul></section>`
    : "";
  return `${boutHead(cur, false, true)}${panel}
    <section class="ec-card ecr-mycard" aria-labelledby="ecr-mc-h"><h2 id="ecr-mc-h" class="ecr-h">My card</h2>${total}<ul class="ecr-rrows">${rows}</ul></section>${others}`;
}

export function actJudge(c, name, el) {
  const { event, ui } = c;
  if (name === "pick-bout") { ui.bout = el.dataset.id; ui.edit = null; ui.other = false; return c.rerender(); }
  if (name === "score-other") { ui.other = !ui.other; return c.rerender(); }
  if (name === "score-edit") { ui.edit = Number(el.dataset.round); return c.rerender(); }
  if (name === "score-cancel") { ui.edit = null; ui.other = false; return c.rerender(); }
  if (name === "score-round") {
    const b = (event.card.bouts || []).find((x) => x.id === el.dataset.bout); if (!b) return;
    const n = Number(el.dataset.round), red = Number(el.dataset.red), blue = Number(el.dataset.blue);
    ui.edit = null; ui.other = false;
    return c.send([{ op: "score.round", bout: b.id, round: n, red, blue }], { key: `score:${b.id}:${n}`, haptic: 18, say: `Round ${n}: red ${red}, blue ${blue}` });
  }
}
