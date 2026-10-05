// Live control: the vote switch, stream links (event and per pitch) with what each link will do,
// and a live board of every game or bout with quick overrides.

import { streamInfo, terms } from "../core/model.js";
import { h, field, input, btn, msgBox, showMsg, withBusy, plainError, plural, empty } from "./admin-lib.js";
import { side, pitchName } from "./ui.js";
import { boutControls, boutName, boutState, cardsSummary, resultText } from "./admin-bouts.js";

let boardFilter = null; // live | next | done | all
let boardPicked = false; // until the organiser picks one, follow what is happening

export function streamVerdict(url, label = "") {
  const u = String(url || "").trim();
  if (!u) return { kind: "none", text: "No link yet. Paste a YouTube, Twitch or Veo link, or a direct video link." };
  if (!/^https:\/\//.test(u)) return { kind: "bad", text: "Links must start with https://" };
  const s = streamInfo({ url: u, on: true, label });
  if (!s) return { kind: "bad", text: "That link doesn't look right. Check it and try again." };
  if (s.kind === "youtube") return { kind: "ok", text: "YouTube found, plays in the page." };
  if (s.kind === "twitch") return { kind: "ok", text: "Twitch channel found, plays in the page." };
  if (s.kind === "video") return { kind: "ok", text: `Direct video ${s.format === "hls" ? "feed" : "file"} found, plays in our own player.` };
  if (s.host === "Veo") return { kind: "warn", text: "Veo match page: shows as a button. Veo doesn't let other sites show its pages, so fans open it in a new tab." };
  return { kind: "warn", text: `${s.host} page: shows as a button that opens in a new tab.` };
}

export function live(ctx) {
  const ev = ctx.event;
  return h("div", { class: "ecx-stack" },
    voteCard(ctx),
    h("section", { class: "ecx-stack", "aria-labelledby": "h-streams" },
      h("h3", { class: "ec-d3", id: "h-streams", text: "Streams" }),
      h("p", { class: "ec-small ec-muted", text: ev.sport === "football" ? `One stream for the whole event, and a stream for each ${terms(ev).place}. Fans see the ${terms(ev).place} stream on that ${terms(ev).place}'s games.` : "One stream for the whole event." }),
      h("div", { class: "ecx-streams" }, streamCard(ctx, "Event stream", ev.stream, null), ev.sport === "football" ? ev.pitches.map((p) => streamCard(ctx, p.name, p.stream, p.id)) : null)),
    board(ctx));
}

function voteCard(ctx) {
  const ev = ctx.event, on = ev.settings.vote.open, football = ev.sport === "football";
  const votes = ctx.counts && ctx.counts.votes != null ? ctx.counts.votes : null;
  const toggle = h("button", { type: "button", role: "switch", "aria-checked": String(on), class: `ecx-switch${on ? " is-on" : ""}`, key: "vote-switch", "aria-describedby": "vote-help", onclick: () => ctx.save([{ op: "vote.open", open: !on }], { success: on ? "Voting is off." : "Voting is on." }) },
    h("span", { class: "ecx-switch__knob", "aria-hidden": "true" }), h("span", { class: "ecx-switch__text", text: on ? "Fan voting is ON" : "Fan voting is OFF" }));
  return h("section", { class: "ec-card ecx-stack", "aria-labelledby": "h-vote" },
    h("h3", { class: "ec-d3", id: "h-vote", text: "Fan voting" }),
    toggle,
    h("p", { class: "ec-muted", id: "vote-help", text: football
      ? `On: fans pick a player of the game for any game that is live, and for ${ev.settings.lockSecs} seconds after full time. Off: nobody can vote, and votes already cast are kept.`
      : `On: fans pick who won each round while it is on, and for ${ev.settings.lockSecs} seconds after it ends, with a reason. Off: nobody can vote, and votes already cast are kept.` }),
    votes != null ? h("p", { class: "ec-small ec-dim", text: `${plural(votes, "vote")} so far.` }) : null);
}

function streamCard(ctx, title, stream, pitch) {
  const st = stream || { url: null, on: false, label: "" };
  const url = input({ type: "url", value: st.url || "", placeholder: "https://www.youtube.com/watch?v=…", inputmode: "url", spellcheck: "false", key: `st-${pitch || "event"}-url` });
  const label = input({ value: st.label || "", maxlength: "80", placeholder: `Live from the main ${terms(ctx.event).place}` });
  const verdict = h("p", { class: "ecx-verdict", role: "status" });
  const showV = () => { const v = streamVerdict(url.value, label.value); verdict.textContent = v.text; verdict.className = `ecx-verdict ecx-verdict--${v.kind}`; };
  url.addEventListener("input", showV); showV();
  const msg = msgBox();
  const send = (on, button, ok) => withBusy(button, async () => {
    showMsg(msg, "");
    const r = await ctx.save([{ op: "stream.set", ...(pitch ? { pitch } : {}), url: url.value.trim() || null, on, label: label.value.trim() }], { success: ok, toastError: false });
    if (!r.ok) showMsg(msg, plainError(r.error));
  });
  const saveBtn = btn("Save link", () => send(st.on, saveBtn, "Stream link saved."), { cls: "ec-btn--ghost", key: `st-${pitch || "event"}-save` });
  const onBtn = btn(st.on ? "Turn off" : "Turn on", () => send(!st.on, onBtn, st.on ? "Stream turned off." : "Stream turned on."), { cls: st.on ? "ec-btn--danger" : "", key: `st-${pitch || "event"}-on` });
  return h("div", { class: "ec-card ecx-stack ecx-stream", role: "group", "aria-label": title, oninput: () => { ctx.dirty = true; } },
    h("div", { class: "ecx-split" }, h("h4", { class: "ecx-h4", text: title }), h("span", { class: `ec-badge ${st.on ? "ec-badge--live" : ""}`, text: st.on ? "On for fans" : "Off" })),
    field("Stream link", url), field("Label (optional)", label), verdict, msg,
    h("div", { class: "ec-row" }, onBtn, saveBtn));
}

// ---- Live board ----
function board(ctx) {
  const ev = ctx.event, football = ev.sport === "football";
  const items = football ? ev.fixtures : ev.card.bouts;
  const isLive = (x) => (football ? x.state === "live" : x.state === "live" || x.state === "break");
  const isDone = (x) => (football ? x.state === "ft" : x.state === "done");
  const cnt = { live: items.filter(isLive).length, next: items.filter((x) => x.state === "scheduled").length, done: items.filter(isDone).length, all: items.length };
  if (!boardPicked || !(boardFilter in cnt)) boardFilter = cnt.live ? "live" : cnt.next ? "next" : "all";
  const pick = (f) => items.filter((x) => (f === "live" ? isLive(x) : f === "next" ? x.state === "scheduled" : f === "done" ? isDone(x) : true));
  const seg = h("div", { class: "ec-seg", role: "group", "aria-label": "Show" },
    [["live", "Live now"], ["next", "Up next"], ["done", "Finished"], ["all", "All"]].map(([id, label]) => h("button", { type: "button", "aria-pressed": String(boardFilter === id), key: `bf-${id}`, text: `${label} (${cnt[id]})`, onclick: () => { boardFilter = id; boardPicked = true; ctx.render({ focusKey: `bf-${id}` }); } })));
  let rows = pick(boardFilter);
  if (football) rows = [...rows].sort((a, b) => a.time.localeCompare(b.time));
  else rows = [...rows].sort((a, b) => a.order - b.order);
  return h("section", { class: "ecx-stack", "aria-labelledby": "h-board" },
    h("h3", { class: "ec-d3", id: "h-board", text: football ? "Live board" : "Bouts tonight" }),
    h("p", { class: "ec-small ec-muted", text: football ? "Every game. Use the buttons to fix a score or start and finish a game when a referee can't." : "Run the night from here if you need to. Referees and timekeepers can do the same from their phones." }),
    seg,
    rows.length ? h("div", { class: "ecx-board" }, rows.map((x) => (football ? gameRow(ctx, x) : boutRow(ctx, x)))) : empty(boardFilter === "live" ? (football ? "No game is live right now." : "No bout is on right now.") : "Nothing here yet."));
}

function gameRow(ctx, f) {
  const ev = ctx.event;
  const a = side(ev, f, "home"), b = side(ev, f, "away");
  const score = (which, delta) => {
    const cur = { home: f.homeScore ?? 0, away: f.awayScore ?? 0 };
    cur[which] = Math.max(0, Math.min(99, cur[which] + delta));
    return ctx.save([{ op: "fixture.score", id: f.id, home: cur.home, away: cur.away }], { success: "Score updated." });
  };
  const ctl = (which, name) => h("div", { class: "ecx-stepper" },
    btn("−", () => score(which, -1), { cls: "ec-btn--ghost ecx-step", key: `lv-${f.id}-${which}-minus`, disabled: (which === "home" ? f.homeScore : f.awayScore) == null || (which === "home" ? f.homeScore : f.awayScore) === 0, label: `Take a ${terms(ev).score} off ${name}` }),
    btn("+", () => score(which, 1), { cls: "ecx-step", key: `lv-${f.id}-${which}-plus`, label: `Add a ${terms(ev).score} for ${name}` }));
  const set = (state, label) => btn(label, () => ctx.save([{ op: "fixture.state", id: f.id, state }], { success: state === "live" ? "Game started." : state === "ft" ? "Full time." : "Game back to not started." }), { cls: state === "ft" ? "ec-btn--gold ec-btn--sm" : "ec-btn--sm", key: `lv-${f.id}-${state}`, label: `${label}: ${a.text} v ${b.text}` });
  const level = f.stage && f.state === "ft" && f.homeScore === f.awayScore;
  return h("article", { class: `ecx-lg${f.state === "live" ? " is-live" : ""}`, "aria-label": `${a.text} v ${b.text}` },
    h("div", { class: "ecx-lg__meta ec-caps" },
      h("span", { text: `${f.time}${f.pitch ? ` · ${pitchName(ev, f.pitch)}` : ""}${f.stage ? ` · ${f.stage}` : ""}` }),
      h("span", { class: `ec-badge ${f.state === "live" ? "ec-badge--live" : f.state === "ft" ? "ec-badge--ft" : ""}`, text: f.state === "live" ? "Live" : f.state === "ft" ? "Full time" : "Not started" })),
    h("div", { class: "ecx-lg__main" },
      h("div", { class: `ecx-lg__side${a.tbc ? " is-tbc" : ""}` }, h("strong", { text: a.text }), ctl("home", a.text)),
      h("div", { class: "ecx-lg__score ec-score", "aria-label": f.homeScore == null ? "Not started" : `${f.homeScore} to ${f.awayScore}`, text: f.homeScore == null ? "v" : `${f.homeScore}–${f.awayScore}` }),
      h("div", { class: `ecx-lg__side ecx-lg__side--away${b.tbc ? " is-tbc" : ""}` }, h("strong", { text: b.text }), ctl("away", b.text))),
    h("div", { class: "ec-row ecx-lg__acts" },
      f.state === "scheduled" ? set("live", "Start") : null,
      f.state === "live" ? set("ft", "Full time") : null,
      f.state === "ft" ? set("live", "Reopen") : null,
      f.state !== "scheduled" ? btn("Reset", () => ctx.save([{ op: "fixture.state", id: f.id, state: "scheduled" }], { success: "Game reset." }), { cls: "ec-btn--ghost ec-btn--sm", key: `lv-${f.id}-reset`, label: `Reset ${a.text} v ${b.text} to not started` }) : null,
      level ? h("label", { class: "ecx-inline" }, h("span", { class: "ec-small", text: "Penalties won by" }), (() => {
        const s = h("select", { class: "ec-select", "aria-label": `Penalty winner for ${a.text} v ${b.text}`, onchange: (e) => ctx.save([{ op: "fixture.pens", id: f.id, side: e.target.value || null }], { success: "Penalties saved." }) },
          [["", "Not set"], ["home", a.text], ["away", b.text]].map(([v, t]) => h("option", { value: v, text: t })));
        s.value = f.pens || ""; return s;
      })()) : null));
}

function boutRow(ctx, b) {
  const ev = ctx.event;
  return h("article", { class: `ecx-lg ecx-lb${b.state === "live" || b.state === "break" ? " is-live" : ""}`, "aria-label": boutName(b) },
    h("div", { class: "ecx-lg__meta ec-caps" }, h("span", { text: `Bout ${b.order}${b.title ? ` · ${b.title}` : ""}` }), h("span", { class: `ec-badge ${b.state === "live" ? "ec-badge--live" : ""}`, text: boutState(b) })),
    h("h4", { class: "ecx-boutname" }, h("span", { class: "ecx-red", text: b.red.name }), " v ", h("span", { class: "ecx-blue", text: b.blue.name })),
    b.result ? h("p", { class: "ecx-result-text", text: resultText(b) }) : null,
    cardsSummary(ev, b),
    boutControls(ctx, b));
}
