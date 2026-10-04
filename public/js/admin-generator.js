// The fixture generator: options on the left, a live timetable preview on the right (rows are
// times, columns are pitches, colours are groups), then "Use this schedule". The rules are the
// core's: checkOptions() for the errors, generate() for the games, fixtures.replace to save.

import { checkOptions, generate } from "../core/generator.js";
import { toMins } from "../core/model.js";
import { h, field, input, select, check, btn, msgBox, showMsg, withBusy, plainError, confirmBox, plural, letters } from "./admin-lib.js";

const states = new Map(); // division id -> options, so a redraw (or a poll) never loses them

const FORMATS = [["groups-knockout", "Groups, then knockouts"], ["league", "League (everyone plays everyone)"], ["knockout", "Straight knockout"]];

function defaults(div) {
  return {
    format: ["league", "groups-knockout", "knockout"].includes(div.format) ? div.format : "groups-knockout",
    groups: 2, advance: 2, thirdPlace: false, legs: 1,
    start: "10:00", gameMins: 10, gapMins: 2, minRest: 1,
    pitchIds: null, refIds: null, refMode: "pitch",
  };
}

// The options exactly as the core wants them.
export function buildOptions(ev, div, s) {
  const pitches = ev.pitches.filter((p) => !s.pitchIds || s.pitchIds.includes(p.id)).map((p) => p.id);
  const chosen = ev.officials.filter((o) => o.role === "referee" && (!s.refIds || s.refIds.includes(o.id)));
  let refs = [];
  if (s.refMode === "pitch") {
    const left = [...chosen];
    const first = pitches.map((pid) => { const i = left.findIndex((r) => r.pitch === pid); return i >= 0 ? left.splice(i, 1)[0] : null; });
    refs = first.map((r) => r || left.shift()).filter(Boolean);
  } else if (s.refMode === "rotate") refs = chosen;
  return {
    division: div.id, format: s.format, teams: div.teams.map((t) => ({ id: t.id, name: t.name })),
    start: s.start, gameMins: s.gameMins, gapMins: s.gapMins, minRest: s.minRest, pitches,
    refs: refs.map((r) => r.id), refMode: s.refMode === "rotate" ? "rotate" : "pitch",
    groups: s.groups, advance: s.advance, thirdPlace: s.thirdPlace, legs: s.legs, idPrefix: "M",
  };
}

export function generator(ctx, div, { onApplied }) {
  const ev = ctx.event;
  if (!states.has(div.id)) states.set(div.id, defaults(div));
  const s = states.get(div.id);
  const root = h("div", { class: "ecx-gen" });
  const preview = h("div", { class: "ecx-genpreview", "aria-live": "polite" });
  const applyMsg = msgBox();

  const started = ev.fixtures.some((f) => f.division === div.id && f.state !== "scheduled");
  const existing = ev.fixtures.filter((f) => f.division === div.id).length;

  const numField = (label, key, { min, max, help, step = "1" } = {}) => {
    const i = input({ type: "number", min, max, step, inputmode: "numeric", value: Number.isNaN(s[key]) ? "" : String(s[key]), key: `gen-${key}` });
    i.addEventListener("input", () => { s[key] = i.value === "" ? NaN : Number(i.value); drawPreview(); });
    return field(label, i, help);
  };

  function form() {
    const fmt = select(FORMATS, s.format, { key: "gen-format" });
    fmt.addEventListener("change", () => { s.format = fmt.value; redraw("gen-format"); });
    const start = input({ type: "time", value: s.start, key: "gen-start" });
    start.addEventListener("input", () => { s.start = start.value; drawPreview(); });

    const pitchBoxes = ev.pitches.map((p) => {
      const on = !s.pitchIds || s.pitchIds.includes(p.id);
      return check(p.name, { checked: on, onchange: (e) => {
        const cur = s.pitchIds || ev.pitches.map((x) => x.id);
        s.pitchIds = e.target.checked ? [...new Set([...cur, p.id])] : cur.filter((x) => x !== p.id);
        drawPreview();
      } });
    });

    const refs = ev.officials.filter((o) => o.role === "referee");
    const mode = select([["pitch", "One referee per pitch"], ["rotate", "Rotate through the referees"], ["none", "No referees yet"]], s.refMode, { key: "gen-refmode" });
    mode.addEventListener("change", () => { s.refMode = mode.value; redraw("gen-refmode"); });
    const refBoxes = refs.map((r) => check(r.pitch ? `${r.name} (${(ev.pitches.find((p) => p.id === r.pitch) || {}).name || "pitch"})` : r.name, { checked: !s.refIds || s.refIds.includes(r.id), onchange: (e) => {
      const cur = s.refIds || refs.map((x) => x.id);
      s.refIds = e.target.checked ? [...new Set([...cur, r.id])] : cur.filter((x) => x !== r.id);
      drawPreview();
    } }));

    return h("section", { class: "ec-card ecx-stack ecx-genform", "aria-labelledby": "h-genform" },
      h("h3", { class: "ec-d3", id: "h-genform", text: "How should the day run?" }),
      h("p", { class: "ec-small ec-muted", text: `${plural(div.teams.length, "team")} in ${div.name}, seeded in the order you entered them.` }),
      field("Format", fmt),
      s.format === "groups-knockout" ? h("div", { class: "ecx-fields" }, numField("Groups", "groups", { min: "1", max: "16" }), numField("Go through from each group", "advance", { min: "1", max: "4" })) : null,
      s.format === "league" ? field("Legs", select([["1", "Play each other once"], ["2", "Home and away (twice)"]], String(s.legs), { key: "gen-legs", onchange: (e) => { s.legs = Number(e.target.value); drawPreview(); } })) : null,
      s.format !== "league" ? check("Add a third-place game", { checked: s.thirdPlace, onchange: (e) => { s.thirdPlace = e.target.checked; drawPreview(); } }) : null,
      h("div", { class: "ecx-fields" }, field("First kick-off", start), numField("Game length (minutes)", "gameMins", { min: "1", max: "120" }), numField("Gap between games (minutes)", "gapMins", { min: "0", max: "60" }), numField("Rest slots between a team's games", "minRest", { min: "0", max: "10", help: "A slot is one game plus the gap." })),
      h("fieldset", { class: "ecx-fieldset" }, h("legend", { text: "Pitches to use" }), ev.pitches.length ? h("div", { class: "ecx-checks" }, pitchBoxes) : h("p", { class: "ec-error", text: "Add a pitch first (Pitches and officials)." })),
      field("Referees", mode),
      s.refMode !== "none" ? h("fieldset", { class: "ecx-fieldset" }, h("legend", { text: "Which referees" }), refs.length ? h("div", { class: "ecx-checks" }, refBoxes) : h("p", { class: "ec-small ec-muted", text: "No referees added yet. Games will have none until you add them." })) : null);
  }

  function drawPreview() {
    const opts = buildOptions(ev, div, s);
    const errors = checkOptions(opts);
    applyMsg.hidden = true;
    if (errors.length) {
      preview.replaceChildren(h("section", { class: "ec-card ecx-stack" },
        h("h3", { class: "ec-d3", text: "Fix this to see the schedule" }),
        h("ul", { class: "ecx-errors" }, errors.map((e) => h("li", { text: e })))));
      return;
    }
    const res = generate(opts);
    if (!res.ok) { preview.replaceChildren(h("p", { class: "ec-error", text: res.errors[0] })); return; }
    const notes = [];
    if (s.refMode === "pitch" && opts.refs.length && opts.refs.length < opts.pitches.length) notes.push("There are fewer referees than pitches, so referees will rotate.");
    if (s.refMode !== "none" && !opts.refs.length) notes.push("No referees are selected, so games will not have a referee.");
    if (s.format === "groups-knockout") {
      const sizes = letters(Math.max(1, s.groups)).map((g) => res.teams.filter((t) => (t.group || "") === (s.groups === 1 ? "" : g)).length);
      if (new Set(sizes).size > 1) notes.push("Groups are not the same size, so some teams play fewer games.");
    }
    const blocked = started;
    const useBtn = btn(existing ? "Use this schedule (replaces the current games)" : "Use this schedule", null, { key: "gen-apply", disabled: blocked });
    useBtn.addEventListener("click", () => apply(res, useBtn));
    const sum = res.summary;
    preview.replaceChildren(h("section", { class: "ec-card ecx-stack", "aria-labelledby": "h-genprev" },
      h("h3", { class: "ec-d3", id: "h-genprev", text: "Preview" }),
      h("div", { class: "ecx-sumrow" },
        sumTile(sum.games, "games"), sumTile(sum.groupGames, s.format === "league" ? "league games" : "group games"), sum.knockoutGames ? sumTile(sum.knockoutGames, "knockout games") : null,
        sumTile(sum.perTeam.min === sum.perTeam.max ? sum.perTeam.min : `${sum.perTeam.min} to ${sum.perTeam.max}`, "games per team"), sumTile(sum.ends, "finishes")),
      notes.length ? h("ul", { class: "ecx-notes" }, notes.map((n) => h("li", { text: n }))) : null,
      timetable(ev, res, opts),
      legend(res),
      blocked ? h("p", { class: "ec-error", role: "alert", text: "Games in this division have started, so the schedule can't be replaced. Edit games one by one in Games." }) : existing ? h("p", { class: "ec-small ec-muted", text: `This replaces the ${plural(existing, "game")} already in ${div.name}. Nothing has been played yet.` }) : null,
      h("div", { class: "ec-row" }, useBtn), applyMsg));
  }

  async function apply(res, button) {
    showMsg(applyMsg, "");
    if (existing) {
      const yes = await confirmBox({ title: "Replace the schedule?", body: `The ${plural(existing, "game")} in ${div.name} are deleted and these ${res.fixtures.length} take their place.`, ok: "Yes, replace", cancel: "Keep the old one", danger: false });
      if (!yes) return;
    }
    const prefix = ev.divisions.length > 1 ? `${div.id.slice(0, 12)}-` : "";
    const fixtures = res.fixtures.map((f) => ({ ...f, id: `${prefix}${f.id}` }));
    await withBusy(button, async () => {
      const r = await ctx.save([{ op: "fixtures.replace", division: div.id, format: s.format, groups: res.teams.map((t) => ({ id: t.id, group: t.group || null })), fixtures }], { success: `Schedule saved: ${plural(fixtures.length, "game")}.`, toastError: false });
      if (r.ok) onApplied(); else showMsg(applyMsg, plainError(r.error));
    });
  }

  function redraw(focusKey) {
    root.replaceChildren(form(), preview);
    drawPreview();
    if (focusKey) { const el = root.querySelector(`[data-key="${focusKey}"]`); if (el) el.focus(); }
  }
  redraw();
  return root;
}

const sumTile = (n, label) => h("div", { class: "ecx-sum" }, h("strong", { text: String(n) }), h("span", { text: label }));

function groupClass(letter) { return letter ? `ecx-g${(letter.charCodeAt(0) - 65) % 8}` : "ecx-g0"; }

function timetable(ev, res, opts) {
  const teamName = Object.fromEntries(res.teams.map((t) => [t.id, t.name]));
  const group = Object.fromEntries(res.teams.map((t) => [t.id, t.group]));
  const nameOf = (r) => teamName[r] || r;
  const start = toMins(opts.start);
  const slot = (t) => (toMins(t) - start + 1440) % 1440;
  const times = [...new Set(res.fixtures.map((f) => f.time))].sort((a, b) => slot(a) - slot(b));
  const cell = new Map(res.fixtures.map((f) => [`${f.time}|${f.pitch}`, f]));
  const refName = (id) => ((ev.officials.find((o) => o.id === id) || {}).name || "");
  return h("div", { class: "ecx-tt ec-scroll", role: "region", "aria-label": "Timetable preview. Scroll sideways to see every pitch.", tabindex: "0" },
    h("table", { class: "ecx-tt__table" },
      h("caption", { class: "ecx-sr", text: "Timetable preview: rows are kick-off times, columns are pitches." }),
      h("thead", {}, h("tr", {}, h("th", { scope: "col", text: "Time" }), opts.pitches.map((p) => h("th", { scope: "col", text: (ev.pitches.find((x) => x.id === p) || {}).name || p })))),
      h("tbody", {}, times.map((t) => h("tr", {}, h("th", { scope: "row", class: "ec-mono", text: t }),
        opts.pitches.map((p) => {
          const f = cell.get(`${t}|${p}`);
          if (!f) return h("td", { class: "ecx-tt__empty", "aria-label": "No game", text: "·" });
          const g = f.stage ? null : group[f.home];
          return h("td", { class: `ecx-tt__game ${f.stage ? "ecx-gk" : groupClass(g)}` },
            h("div", { class: "ecx-tt__in" },
              h("span", { class: "ecx-tt__tag", text: f.stage || (g ? `Group ${g}` : "League") }),
              h("span", { class: "ecx-tt__vs", text: `${nameOf(f.home)} v ${nameOf(f.away)}` }),
              f.ref ? h("span", { class: "ecx-tt__ref", text: refName(f.ref) }) : null));
        }))))));
}

function legend(res) {
  const gs = [...new Set(res.teams.map((t) => t.group).filter(Boolean))].sort();
  if (!gs.length && !res.summary.knockoutGames) return null;
  return h("ul", { class: "ecx-legend", "aria-label": "Colour key" },
    gs.map((g) => h("li", {}, h("span", { class: `ecx-swatch ${groupClass(g)}`, "aria-hidden": "true" }), `Group ${g}`)),
    res.summary.knockoutGames ? h("li", {}, h("span", { class: "ecx-swatch ecx-gk", "aria-hidden": "true" }), "Knockouts") : null);
}
