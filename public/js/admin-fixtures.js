// Fixtures (football): the generator, then the games list with inline edits, an add-a-game form
// and the admin score override (the same ops a referee sends).

import { winnerOf } from "../core/standings.js";
import { h, field, input, select, btn, msgBox, showMsg, withBusy, plainError, confirmBox, plural, empty } from "./admin-lib.js";
import { generator } from "./admin-generator.js";
import { pitchName, officialName } from "./ui.js";
import { toMins, addMins, firstName } from "../core/model.js";

let view = "generator"; // generator | games
let genDivision = null;
let gameDivision = "";   // "" = all divisions
let fixtureDraft = null;

const STATE_TEXT = { scheduled: "Not started", live: "Live", ft: "Full time" };

export function fixtures(ctx) {
  const ev = ctx.event;
  if (!ev.divisions.length) return empty("Add a division and some teams first (Teams).", h("button", { type: "button", class: "ec-btn", text: "Go to Teams", onclick: () => ctx.go("teams") }));
  if (!genDivision || !ev.divisions.some((d) => d.id === genDivision)) genDivision = ev.divisions[0].id;
  const seg = h("div", { class: "ec-seg", role: "group", "aria-label": "Fixtures view" },
    [["generator", "Make a schedule"], ["games", `Games (${ev.fixtures.length})`]].map(([id, label]) =>
      h("button", { type: "button", "aria-pressed": String(view === id), text: label, key: `fx-view-${id}`, onclick: () => { view = id; ctx.render({ focusKey: `fx-view-${id}` }); } })));
  return h("div", { class: "ecx-stack" }, seg, view === "generator" ? generatorView(ctx) : gamesView(ctx));
}

function generatorView(ctx) {
  const ev = ctx.event;
  const div = ev.divisions.find((d) => d.id === genDivision);
  const pick = ev.divisions.length > 1 ? field("Division", select(ev.divisions.map((d) => [d.id, d.name]), genDivision, { key: "gen-division", onchange: (e) => { genDivision = e.target.value; ctx.render({ focusKey: "gen-division" }); } })) : null;
  return h("div", { class: "ecx-stack" },
    h("p", { class: "ec-lede", text: "Choose how the day should run. The preview updates as you type. Nothing is saved until you press Use this schedule." }),
    pick,
    generator(ctx, div, { onApplied: () => { view = "games"; gameDivision = div.id; ctx.render({ focus: true }); } }));
}

// ---- Games ----
function sideOptions(ev, div, current) {
  const teams = div.teams.map((t) => [t.id, t.name]);
  const groups = [...new Set(div.teams.map((t) => t.group).filter(Boolean))].sort();
  const stages = [...new Set(ev.fixtures.filter((f) => f.division === div.id && f.stage).map((f) => f.stage))];
  const places = [];
  groups.forEach((g) => { places.push(`1st Group ${g}`, `2nd Group ${g}`); });
  if (!groups.length && div.format !== "league") places.push("1st in table", "2nd in table");
  stages.forEach((s) => { if (!/^third place$/i.test(s)) places.push(`Winner ${s}`, `Loser ${s}`); });
  const all = [...teams, ...places.map((p) => [p, p])];
  if (current && !all.some(([v]) => v === current)) all.push([current, current]);
  return all;
}

function gamesView(ctx) {
  const ev = ctx.event;
  const divs = gameDivision ? ev.divisions.filter((d) => d.id === gameDivision) : ev.divisions;
  const pitchOrder = Object.fromEntries(ev.pitches.map((p, i) => [p.id, i]));
  const sort = (a, b) => toMins(a.time) - toMins(b.time) || (pitchOrder[a.pitch] ?? 99) - (pitchOrder[b.pitch] ?? 99);
  const filter = ev.divisions.length > 1 ? field("Show", select([["", "All divisions"], ...ev.divisions.map((d) => [d.id, d.name])], gameDivision, { key: "fx-filter", onchange: (e) => { gameDivision = e.target.value; ctx.render({ focusKey: "fx-filter" }); } })) : null;
  return h("div", { class: "ecx-stack" },
    filter,
    divs.map((d) => {
      const list = ev.fixtures.filter((f) => f.division === d.id).sort(sort);
      return h("section", { class: "ecx-stack", "aria-labelledby": `h-games-${d.id}` },
        h("h3", { class: "ec-d3", id: `h-games-${d.id}`, text: `${d.name}: ${plural(list.length, "game")}` }),
        list.length ? h("div", { class: "ecx-games" }, list.map((f) => gameCard(ctx, d, f))) : empty("No games yet. Make a schedule, or add a game below."));
    }),
    addGame(ctx));
}

function gameCard(ctx, d, f) {
  const ev = ctx.event;
  const edit = (patch, success) => ctx.save([{ op: "fixture.edit", id: f.id, ...patch }], { success });
  const live = f.state === "live";
  const lbl = `${f.home} v ${f.away}`;
  const time = input({ type: "time", value: f.time, "aria-label": `Kick-off time for game ${f.id}`, key: `fx-${f.id}-time` });
  time.addEventListener("change", () => edit({ time: time.value }, "Time saved."));
  const pitch = select([["", "No pitch"], ...ev.pitches.map((p) => [p.id, p.name])], f.pitch || "", { "aria-label": `Pitch for game ${f.id}`, key: `fx-${f.id}-pitch` });
  pitch.addEventListener("change", () => edit({ pitch: pitch.value || null }, "Pitch saved."));
  const refs = ev.officials.filter((o) => o.role === "referee");
  const ref = select([["", "No referee"], ...refs.map((r) => [r.id, r.name])], f.ref || "", { "aria-label": `Referee for game ${f.id}`, key: `fx-${f.id}-ref` });
  ref.addEventListener("change", () => edit({ ref: ref.value || null }, "Referee saved."));

  const side = (which) => {
    const aria = `${which === "home" ? "Home" : "Away"} side for game ${f.id}`;
    if (d.format === "exhibition") {
      const t = input({ value: f[which], maxlength: "40", "aria-label": aria, key: `fx-${f.id}-${which}` });
      t.addEventListener("change", () => edit({ [which]: t.value.trim() }, "Side saved."));
      return t;
    }
    const s = select(sideOptions(ev, d, f[which]), f[which], { "aria-label": aria, key: `fx-${f.id}-${which}` });
    s.addEventListener("change", () => edit({ [which]: s.value }, "Side saved."));
    return s;
  };

  // score override
  const hs = input({ type: "number", min: "0", max: "99", inputmode: "numeric", class: "ec-input ecx-score", value: f.homeScore == null ? "" : String(f.homeScore), "aria-label": `Home score for game ${f.id}` });
  const as = input({ type: "number", min: "0", max: "99", inputmode: "numeric", class: "ec-input ecx-score", value: f.awayScore == null ? "" : String(f.awayScore), "aria-label": `Away score for game ${f.id}` });
  const st = select([["scheduled", "Not started"], ["live", "Live"], ["ft", "Full time"]], f.state, { "aria-label": `Status of game ${f.id}` });
  const pens = f.stage ? select([["", "No penalties"], ["home", "Home won on pens"], ["away", "Away won on pens"]], f.pens || "", { "aria-label": `Penalty winner for game ${f.id}` }) : null;
  const msg = msgBox();
  const saveScore = btn("Save score", async () => {
    showMsg(msg, "");
    const ops = [];
    if (st.value === "scheduled") ops.push({ op: "fixture.state", id: f.id, state: "scheduled" });
    else {
      if (hs.value === "" || as.value === "") { showMsg(msg, "Enter both scores, or set the game to Not started."); return; }
      ops.push({ op: "fixture.score", id: f.id, home: Number(hs.value), away: Number(as.value) }, { op: "fixture.state", id: f.id, state: st.value });
      if (pens && st.value === "ft" && hs.value === as.value) ops.push({ op: "fixture.pens", id: f.id, side: pens.value || null });
    }
    await withBusy(saveScore, async () => {
      const r = await ctx.save(ops, { success: "Score saved.", toastError: false });
      if (!r.ok) showMsg(msg, plainError(r.error));
    });
  }, { cls: "ec-btn--sm", key: `fx-${f.id}-save` });
  const remove = btn("Remove", async () => {
    const yes = await confirmBox({ title: `Remove game ${f.id}?`, body: f.state === "scheduled" ? "The game is taken off the schedule." : "This game has a result. Removing it also removes the result from the tables.", ok: "Yes, remove" });
    if (yes) ctx.save([{ op: "fixture.remove", id: f.id }], { success: "Game removed." });
  }, { cls: "ec-btn--danger ec-btn--sm", label: `Remove game ${f.id}` });

  return h("article", { class: `ecx-game${live ? " is-live" : ""}`, "aria-label": `Game ${f.id}: ${lbl}` },
    h("div", { class: "ecx-game__top" },
      h("span", { class: "ec-caps ecx-game__id", text: `${f.id}${f.stage ? ` · ${f.stage}` : ""}` }),
      h("span", { class: `ec-badge ${live ? "ec-badge--live" : f.state === "ft" ? "ec-badge--ft" : ""}`, text: STATE_TEXT[f.state] })),
    h("div", { class: "ecx-game__cfg" }, field("Time", time), field("Pitch", pitch), field("Referee", ref)),
    h("div", { class: "ecx-game__sides" }, field("Home", side("home")), h("div", { class: "ecx-game__score" }, hs, h("span", { "aria-hidden": "true", text: "–" }), as), field("Away", side("away"))),
    h("div", { class: "ecx-game__acts" },
      field("Status", st), pens ? field("Penalties", pens) : null,
      h("div", { class: "ec-row ecx-game__btns" }, saveScore, remove)),
    msg);
}

function addGame(ctx) {
  const ev = ctx.event;
  const msg = msgBox();
  const d0 = ev.divisions.find((d) => d.id === (gameDivision || ev.divisions[0].id)) || ev.divisions[0];
  const last = ev.fixtures.filter((f) => f.division === d0.id).map((f) => f.time).sort((a, b) => toMins(a) - toMins(b)).pop();
  const div = select(ev.divisions.map((d) => [d.id, d.name]), d0.id, { key: "add-div" });
  const time = input({ type: "time", value: last ? addMins(last, 12) : "10:00" });
  const pitch = select([["", "No pitch"], ...ev.pitches.map((p) => [p.id, p.name])], ev.pitches[0] ? ev.pitches[0].id : "");
  const ref = select([["", "No referee"], ...ev.officials.filter((o) => o.role === "referee").map((r) => [r.id, r.name])], "");
  const home = h("span", { class: "ecx-sidepick" }), away = h("span", { class: "ecx-sidepick" });
  const stage = input({ maxlength: "30", placeholder: "Final, or leave empty" });
  let homeCtl, awayCtl;
  const drawSides = () => {
    const d = ev.divisions.find((x) => x.id === div.value);
    const ex = d.format === "exhibition";
    const mk = (cur) => ex ? input({ maxlength: "40", placeholder: "Any name" }) : select([["", "Pick a team"], ...d.teams.map((t) => [t.id, t.name])], "");
    homeCtl = mk(); awayCtl = mk();
    home.replaceChildren(field("Home", homeCtl)); away.replaceChildren(field("Away", awayCtl));
  };
  div.addEventListener("change", drawSides); drawSides();
  const go = btn("Add game", null, { type: "submit" });
  return h("section", { class: "ec-card ecx-stack", "aria-labelledby": "h-addgame" },
    h("h3", { class: "ec-d3", id: "h-addgame", text: "Add a game" }),
    h("form", { class: "ecx-stack", novalidate: true, oninput: () => { ctx.dirty = true; }, onsubmit: async (e) => {
      e.preventDefault(); showMsg(msg, "");
      if (!homeCtl.value.trim() || !awayCtl.value.trim()) { showMsg(msg, "Pick both sides."); return; }
      if (homeCtl.value === awayCtl.value) { showMsg(msg, "A team can't play itself."); return; }
      const fixture = { division: div.value, time: time.value, pitch: pitch.value || null, ref: ref.value || null, home: homeCtl.value.trim(), away: awayCtl.value.trim(), ...(stage.value.trim() ? { stage: stage.value.trim() } : {}) };
      await withBusy(go, async () => {
        const r = await ctx.save([{ op: "fixture.add", fixture }], { success: "Game added.", toastError: false });
        if (r.ok) ctx.dirty = false; else showMsg(msg, plainError(r.error));
      });
    } },
    h("div", { class: "ecx-fields" }, ev.divisions.length > 1 ? field("Division", div) : null, field("Kick-off", time), field("Pitch", pitch), field("Referee", ref)),
    h("div", { class: "ecx-fields" }, home, away, field("Stage (optional)", stage, "Add a name for a knockout game, like Final. Leave empty for a normal game.")),
    msg, go));
}
