// Boxing pieces shared by the Fight card tab and Live control: the bout form and the on-the-day
// controls (start, end round, next round, result, reopen). Same ops a referee sends.

import { METHOD_TEXT, resultText, judgeCard, cardsComplete } from "../core/boxing.js";
import { h, field, input, select, check, btn, msgBox, showMsg, withBusy, plainError } from "./admin-lib.js";

const METHOD_LABEL = { PTS: "Points decision", KO: "Knockout", TKO: "Technical knockout", RSC: "Referee stopped the contest", RTD: "Retired in the corner", DQ: "Disqualification", DRAW: "Draw", NC: "No contest" };

const resultOpen = new Set(); // bouts whose result form is open, kept across redraws

export const boutName = (b) => `${b.red.name} v ${b.blue.name}`;
export const boutState = (b) => (b.state === "scheduled" ? "Not started" : b.state === "live" ? `Round ${b.round} live` : b.state === "break" ? `Break after round ${b.round}` : "Done");

// The bout form. Returns { node, collect() } where collect() gives the op fields.
export function boutForm(ev, b = null, { onInput } = {}) {
  const judges = ev.officials.filter((o) => o.role === "judge");
  const v = b || { red: {}, blue: {}, rounds: 3, roundMins: 2, scoring: judges.length ? "judges" : "none", judges: [], title: "", weight: "" };
  const redName = input({ value: v.red.name || "", maxlength: "40", "aria-required": "true", placeholder: "Red corner boxer" });
  const redClub = input({ value: v.red.club || "", maxlength: "40", placeholder: "Club" });
  const blueName = input({ value: v.blue.name || "", maxlength: "40", "aria-required": "true", placeholder: "Blue corner boxer" });
  const blueClub = input({ value: v.blue.club || "", maxlength: "40", placeholder: "Club" });
  const weight = input({ value: v.weight || "", maxlength: "30", placeholder: "75kg" });
  const title = input({ value: v.title || "", maxlength: "60", placeholder: "Title fight (optional)" });
  const rounds = input({ type: "number", min: "1", max: "12", inputmode: "numeric", value: String(v.rounds) });
  const mins = input({ type: "number", min: "0.5", max: "5", step: "0.5", inputmode: "decimal", value: String(v.roundMins) });
  const scoring = select([["judges", "Scored by judges"], ["none", "No judges (referee or MC announces the winner)"]], v.scoring);
  const judgeBox = h("fieldset", { class: "ecx-fieldset" }, h("legend", { text: "Judges for this bout" }));
  const boxes = judges.map((j) => check(j.name, { checked: v.judges.includes(j.id), value: j.id }));
  const drawJudges = () => {
    judgeBox.hidden = scoring.value !== "judges";
    judgeBox.replaceChildren(h("legend", { text: "Judges for this bout" }),
      judges.length ? h("div", { class: "ecx-checks" }, boxes) : h("p", { class: "ec-small ec-muted", text: "No judges yet. Add them in Pitches and officials, then pick them here." }),
      scoring.value === "judges" ? h("p", { class: "ec-help", text: "Pick at least one judge so the decision can come from the cards." }) : null);
  };
  scoring.addEventListener("change", drawJudges); drawJudges();
  const node = h("div", { class: "ecx-stack", oninput: onInput },
    h("div", { class: "ecx-corners" },
      h("div", { class: "ecx-corner ecx-corner--red" }, h("h4", { class: "ec-label", text: "Red corner" }), field("Name", redName), field("Club", redClub)),
      h("div", { class: "ecx-corner ecx-corner--blue" }, h("h4", { class: "ec-label", text: "Blue corner" }), field("Name", blueName), field("Club", blueClub))),
    h("div", { class: "ecx-fields" }, field("Weight", weight), field("Title", title), field("Rounds", rounds), field("Round length (minutes)", mins)),
    field("Scoring", scoring), judgeBox);
  return {
    node,
    focus: () => redName.focus(),
    collect: () => ({
      title: title.value.trim(), weight: weight.value.trim(), rounds: Number(rounds.value), roundMins: Number(mins.value), scoring: scoring.value,
      judges: scoring.value === "judges" ? boxes.map((l) => l.querySelector("input")).filter((i) => i.checked).map((i) => i.value) : [],
      red: { name: redName.value.trim(), club: redClub.value.trim() }, blue: { name: blueName.value.trim(), club: blueClub.value.trim() },
    }),
    check: () => (!redName.value.trim() || !blueName.value.trim() ? "Give both corners a name." : ""),
  };
}

// Cards so far, per judge, for a bout.
export function cardsSummary(ev, b) {
  if (b.scoring !== "judges" || !b.judges.length) return null;
  const rows = b.judges.map((id) => { const j = ev.officials.find((o) => o.id === id); const c = judgeCard(ev.scorecards, b.id, id); return { name: j ? j.name : id, c }; });
  return h("ul", { class: "ecx-cards", "aria-label": `Judges' cards for ${boutName(b)}` }, rows.map(({ name, c }) =>
    h("li", {}, h("strong", { text: name }), h("span", { class: "ec-mono", text: c.rounds.length ? ` ${c.red}-${c.blue} after ${c.rounds.length} ${c.rounds.length === 1 ? "round" : "rounds"}` : " no rounds scored yet" }))));
}

// Start, end round, next round, result, reopen.
export function boutControls(ctx, b) {
  const ev = ctx.event;
  const msg = msgBox();
  const act = (action, label, ok, cls = "") => btn(label, async function () {
    showMsg(msg, "");
    await withBusy(this, async () => {
      const r = await ctx.save([{ op: "bout.action", id: b.id, action }], { success: ok, toastError: false });
      if (!r.ok) showMsg(msg, plainError(r.error));
    });
  }, { cls, key: `bout-${b.id}-${action}`, label: `${label}: ${boutName(b)}` });

  const buttons = [];
  if (b.state === "scheduled") buttons.push(act("start", "Start bout", "Bout started."));
  if (b.state === "live") buttons.push(act("end-round", `End round ${b.round}`, `Round ${b.round} ended.`));
  if (b.state === "break" && b.round < b.rounds) buttons.push(act("next-round", `Start round ${b.round + 1}`, `Round ${b.round + 1} started.`));
  if (b.state === "done") buttons.push(act("reopen", "Reopen the bout", "Bout reopened.", "ec-btn--ghost"));

  const parts = [h("div", { class: "ec-row" }, buttons)];
  if (b.state === "live" || b.state === "break") parts.push(resultForm(ctx, b, msg));
  parts.push(msg);
  return h("div", { class: "ecx-stack ecx-bctl" }, parts);
}

function resultForm(ctx, b, msg) {
  const method = select(Object.keys(METHOD_TEXT).map((m) => [m, METHOD_LABEL[m]]), "PTS", { key: `bout-${b.id}-method` });
  const winner = select([["red", `Red: ${b.red.name}`], ["blue", `Blue: ${b.blue.name}`]], "red");
  const round = input({ type: "number", min: "1", max: String(b.rounds), inputmode: "numeric", value: String(b.round || 1) });
  const wWrap = field("Winner", winner), rWrap = field("Stopped in round", round);
  const note = h("p", { class: "ec-help" });
  const sync = () => {
    const m = method.value, judged = m === "PTS" && b.scoring === "judges";
    wWrap.hidden = m === "DRAW" || m === "NC" || judged;
    rWrap.hidden = m === "PTS" || m === "DRAW" || m === "NC";
    note.textContent = judged ? (cardsComplete({ ...b, result: { round: b.rounds } }, ctx.event.scorecards) ? "The judges' cards decide the winner." : "Every judge must score every round before a points decision. Use a stoppage or draw if it ended early.") : "";
  };
  method.addEventListener("change", sync); sync();
  const go = btn("Save result", async () => {
    showMsg(msg, "");
    const op = { op: "bout.result", id: b.id, method: method.value };
    if (!wWrap.hidden) op.winner = winner.value;
    if (!rWrap.hidden) op.round = Number(round.value);
    await withBusy(go, async () => {
      const r = await ctx.save([op], { success: "Result saved.", toastError: false });
      if (!r.ok) showMsg(msg, plainError(r.error));
    });
  }, { cls: "ec-btn--gold" });
  return h("details", { class: "ecx-result", open: resultOpen.has(b.id), ontoggle: (e) => { e.target.open ? resultOpen.add(b.id) : resultOpen.delete(b.id); } },
    h("summary", { text: "Record the result" }),
    h("div", { class: "ecx-stack", oninput: () => { ctx.dirty = true; } }, field("How did it end?", method), wWrap, rWrap, note, go));
}

export { resultText };
