// Admin (organiser) tabs for fitness events: Set-up, Athletes, Heats, On the day, and the
// overview. admin.js picks these for sport "fitness"; the shared tabs (Details, Timekeepers,
// Access codes, After) are the ones every sport uses. Every save is an op (docs/FITNESS.md).

import { h, field, input, select, btn, msgBox, showMsg, withBusy, plainError, confirmBox, copyText, parseLines, plural, empty, SITE } from "./admin-lib.js";
import { qrImage } from "./admin-overview.js";
import { details } from "./admin-details.js";
import { officials } from "./admin-officials.js";
import { codes } from "./admin-codes.js";
import { after } from "./admin-after.js";
import { terms } from "../core/model.js";
import { comp, catName, heatById, isRace } from "./fit-lib.js";

export const fitnessTabs = (ev) => [
  ["overview", "Overview", overview], ["details", "Details", details], ["setup", "Set-up", setup], ["athletes", "Athletes", athletes],
  ["heats", "Heats", heats], ["officials", "Timekeepers", officials], ["codes", "Access codes", codes], ["live", "On the day", onTheDay], ["after", "After", after],
];

const hasResults = (ev) => comp(ev).entries.some((e) => e.results.some((v) => v != null));
const batches = (ops, n = 150) => { const out = []; for (let i = 0; i < ops.length; i += n) out.push(ops.slice(i, i + n)); return out; };
// Saves a long list of ops as several saves, in order, stopping at the first refusal.
async function saveAll(ctx, ops, opts) {
  const parts = batches(ops);
  for (let i = 0; i < parts.length; i++) {
    const r = await ctx.save(parts[i], { ...opts, success: i === parts.length - 1 ? opts.success : undefined });
    if (!r.ok) return r;
  }
  return { ok: true };
}
const list = (items) => h("ul", { class: "ecx-errors", role: "alert" }, items.map((t) => h("li", { text: t })));

// ================================================================== Overview
const PHASES = [
  ["pre", "Before", "Fans see the heats and can pre-register. Results stay quiet."],
  ["live", "Live", "Fans see the heats on the floor, the leaderboards and the big screen. Voting works when you switch it on."],
  ["post", "After", "Fans see the winners, the leaderboards and your updates, and are invited to join the clubhouse."],
];

function overview(ctx) {
  const ev = ctx.event, c = comp(ev), T = terms(ev);
  const fanUrl = `${location.origin}/e/${ev.slug}/`, screenUrl = `${fanUrl}screen/`, refUrl = `${location.origin}/ref/?e=${ev.slug}`;
  const cn = ctx.counts || {};
  const tile = (n, label) => h("div", { class: "ecx-tile" }, h("div", { class: "ecx-tile__n", text: n == null ? "–" : String(n) }), h("div", { class: "ecx-tile__l", text: label }));
  const done = c.heats.filter((x) => x.state === "done").length;
  const unplaced = c.entries.filter((e) => !e.heat).length;
  const refs = ev.officials.filter((o) => o.role === "referee").length;
  const codeCount = ctx.codes ? ctx.codes.filter((x) => !x.revoked && x.role === "referee").length : null;
  const items = [
    { done: c.segments.length >= 1 && c.categories.length >= 1, label: "Set-up done", hint: `${plural(c.segments.length, "segment")} and ${plural(c.categories.length, "category", "categories")}.`, tab: "setup" },
    { done: c.entries.length >= 1, label: "Athletes added", hint: `${plural(c.entries.length, "athlete")} so far.`, tab: "athletes" },
    { done: c.heats.length >= 1 && unplaced === 0 && c.entries.length > 0, label: "Heats made", hint: c.heats.length ? `${plural(c.heats.length, "heat")}. ${unplaced ? `${plural(unplaced, "athlete")} still without a heat.` : "Everyone has a heat."}` : "Generate the schedule from the athletes.", tab: "heats" },
    { done: refs >= 1 && codeCount >= 1, label: "Timekeepers have codes", hint: `${plural(refs, "timekeeper")}, ${codeCount == null ? "checking codes" : plural(codeCount, "code")}.`, tab: refs ? "codes" : "officials" },
    { done: ev.settings.vote.open, label: "Fan voting switched on", hint: ev.settings.vote.open ? "Fans can vote now." : "Optional. Switch it on in On the day.", tab: "live", optional: true },
  ];
  const ready = items.filter((i) => i.done).length;
  const phase = h("div", { class: "ecx-phase", role: "group", "aria-label": "Event phase" }, PHASES.map(([id, name, text]) =>
    h("button", { type: "button", class: "ecx-phase__opt", "aria-pressed": String(ev.phase === id), key: `phase-${id}`, onclick: () => { if (ev.phase !== id) ctx.save([{ op: "phase.set", phase: id }], { success: `Event is now ${name.toLowerCase()}.` }); } },
      h("span", { class: "ecx-phase__name", text: name }), h("span", { class: "ecx-phase__text", text }))));
  return h("div", { class: "ecx-stack" },
    h("div", { class: "ecx-tiles" }, tile(cn.registrations, "Pre-registrations"), tile(cn.votes, "Fan votes"), tile(c.entries.length, "Athletes"), tile(`${done}/${c.heats.length}`, "Heats done")),
    h("section", { class: "ec-card ecx-stack", "aria-labelledby": "h-phase" }, h("h3", { class: "ec-d3", id: "h-phase", text: "Where is the event?" }), h("p", { class: "ec-muted", text: "Pick the stage. Fans see the change within a few seconds." }), phase),
    h("div", { class: "ecx-two" },
      h("section", { class: "ec-card ecx-stack", "aria-labelledby": "h-today" },
        h("h3", { class: "ec-d3", id: "h-today", text: "Today's checklist" }),
        h("p", { class: "ec-muted ecx-progress", role: "status", text: `${ready} of ${items.length} ready` }),
        h("ul", { class: "ecx-check-list" }, items.map((i) => h("li", { class: `ecx-check-item${i.done ? " is-done" : ""}` },
          h("span", { class: "ecx-tick", "aria-hidden": "true", text: i.done ? "✓" : "" }),
          h("div", { class: "ecx-grow" }, h("strong", { text: i.label }), h("span", { class: "ecx-sr", text: i.done ? " Done." : " Not done yet." }), h("div", { class: "ec-small ec-muted", text: i.hint })),
          i.done ? null : h("button", { type: "button", class: "ec-btn ec-btn--ghost ec-btn--sm", text: "Go", "aria-label": `Go to ${i.label}`, onclick: () => ctx.go(i.tab) }))))),
      h("section", { class: "ec-card ecx-stack", "aria-labelledby": "h-links" },
        h("h3", { class: "ec-d3", id: "h-links", text: "Share and show" }),
        h("div", { class: "ecx-linkrow" }, h("div", { class: "ecx-grow" }, h("div", { class: "ec-label", text: "Fan page" }), h("a", { class: "ecx-url", href: fanUrl, target: "_blank", rel: "noopener", text: fanUrl })), btn("Copy", () => copyText(fanUrl, "Fan link copied."), { cls: "ec-btn--ghost ec-btn--sm", label: "Copy the fan page link" })),
        h("div", { class: "ecx-linkrow" }, h("div", { class: "ecx-grow" }, h("div", { class: "ec-label", text: "Timekeeper page" }), h("a", { class: "ecx-url", href: refUrl, target: "_blank", rel: "noopener", text: refUrl })), btn("Copy", () => copyText(refUrl, "Timekeeper link copied."), { cls: "ec-btn--ghost ec-btn--sm", label: "Copy the timekeeper page link" })),
        h("div", { class: "ec-row" }, h("a", { class: "ec-btn", href: fanUrl, target: "_blank", rel: "noopener", text: "Open fan page" }), h("a", { class: "ec-btn ec-btn--ghost", href: screenUrl, target: "_blank", rel: "noopener", text: "Open big screen" })),
        h("div", { class: "ecx-qrrow" }, qrImage(fanUrl, "QR code for the fan page"), h("p", { class: "ec-small ec-muted", text: `Put this on posters and the big screen. Fans scan it to find their athlete and follow the ${T.place}.` })))));
}

// ================================================================== Set-up
const TEMPLATES = {
  race: { label: "A timed race: 8 runs and 8 stations", ranking: "time", segments: Array.from({ length: 16 }, (_, i) => ({ name: i % 2 === 0 ? `Run ${i / 2 + 1}` : `Station ${(i + 1) / 2}`, measure: "time" })), categories: [{ name: "Open", size: 1 }, { name: "Pairs", size: 2 }] },
  games: { label: "Workout games: 3 workouts", ranking: "placings", segments: [{ name: "Workout 1", measure: "kg" }, { name: "Workout 2", measure: "time" }, { name: "Workout 3", measure: "reps" }], categories: [{ name: "Individual", size: 1 }, { name: "Pairs", size: 2 }] },
};
const SIZES = [["1", "One athlete"], ["2", "Pairs"], ["4", "Relay of four"]];
const MEASURES = [["time", "Time"], ["reps", "Reps"], ["kg", "Weight in kg"]];

function setup(ctx) {
  const ev = ctx.event, c = comp(ev), locked = hasResults(ev);
  const d = { ranking: c.ranking, segs: c.segments.map((s) => ({ ...s })), cats: c.categories.map((k) => ({ ...k })) };
  const msg = msgBox();
  const dirty = () => { ctx.dirty = true; };
  const rank = select([["time", "Fastest time wins (a timed race)"], ["placings", "Lowest total of placings wins (workout games)"]], d.ranking, { key: "fit-rank" });
  const box = h("div", { class: "ecx-stack" });

  const segRow = (s, i) => {
    const nm = input({ value: s.name, maxlength: "40", key: `sg-${i}-name`, "aria-label": `Name of segment ${i + 1}` });
    nm.addEventListener("input", () => { s.name = nm.value; dirty(); });
    const ms = d.ranking === "placings" ? select(MEASURES, s.measure || "time", { key: `sg-${i}-measure`, "aria-label": `How segment ${i + 1} is scored` }) : null;
    if (ms) ms.addEventListener("change", () => { s.measure = ms.value; dirty(); });
    return h("li", { class: "ecx-list__row ecx-wrapnarrow" }, field(`Segment ${i + 1}`, nm, null, "ecx-grow"), ms ? field("Scored as", ms) : null,
      h("div", { class: "ec-row" },
        btn("Up", () => { if (i) { [d.segs[i - 1], d.segs[i]] = [d.segs[i], d.segs[i - 1]]; draw(`sg-${i - 1}-name`); } dirty(); }, { cls: "ec-btn--ghost ec-btn--sm", disabled: i === 0, label: `Move segment ${i + 1} up` }),
        btn("Down", () => { if (i < d.segs.length - 1) { [d.segs[i + 1], d.segs[i]] = [d.segs[i], d.segs[i + 1]]; draw(`sg-${i + 1}-name`); } dirty(); }, { cls: "ec-btn--ghost ec-btn--sm", disabled: i === d.segs.length - 1, label: `Move segment ${i + 1} down` }),
        btn("Remove", () => { d.segs.splice(i, 1); draw(); dirty(); }, { cls: "ec-btn--danger ec-btn--sm", label: `Remove segment ${i + 1}` })));
  };
  const catRow = (k, i) => {
    const nm = input({ value: k.name, maxlength: "40", key: `ct-${i}-name`, "aria-label": `Name of category ${i + 1}` });
    nm.addEventListener("input", () => { k.name = nm.value; dirty(); });
    const sz = select(SIZES, String(k.size || 1), { key: `ct-${i}-size`, "aria-label": `Athletes per entry in category ${i + 1}` });
    sz.addEventListener("change", () => { k.size = Number(sz.value); dirty(); });
    return h("li", { class: "ecx-list__row ecx-wrapnarrow" }, field(`Category ${i + 1}`, nm, null, "ecx-grow"), field("Athletes per entry", sz),
      btn("Remove", () => { d.cats.splice(i, 1); draw(); dirty(); }, { cls: "ec-btn--danger ec-btn--sm", label: `Remove category ${i + 1}` }));
  };
  function draw(focusKey) {
    box.replaceChildren(
      h("section", { class: "ec-card ecx-stack", "aria-labelledby": "h-segs" },
        h("h3", { class: "ec-d3", id: "h-segs", text: "Segments" }),
        h("p", { class: "ec-small ec-muted", text: d.ranking === "time" ? "The runs and stations, in the order athletes do them. Timekeepers post the time since the wave started at the end of each one." : "The workouts, in order. Each one is scored as a time, reps or weight, and ranked within the category." }),
        d.segs.length ? h("ul", { class: "ecx-list", "aria-label": "Segments" }, d.segs.map(segRow)) : empty("No segments yet. Add one, or start from a ready-made shape above."),
        btn("Add a segment", () => { d.segs.push({ name: "", measure: "time" }); draw(`sg-${d.segs.length - 1}-name`); dirty(); }, { cls: "ec-btn--ghost", key: "sg-add", disabled: d.segs.length >= 20 }),
        d.segs.length >= 20 ? h("p", { class: "ec-small ec-muted", text: "That is the most a race can have: 20." }) : null),
      h("section", { class: "ec-card ecx-stack", "aria-labelledby": "h-cats" },
        h("h3", { class: "ec-d3", id: "h-cats", text: "Categories" }),
        h("p", { class: "ec-small ec-muted", text: "Each category has its own leaderboard. Pick pairs or relay for categories where athletes enter together." }),
        d.cats.length ? h("ul", { class: "ecx-list", "aria-label": "Categories" }, d.cats.map(catRow)) : empty("No categories yet."),
        btn("Add a category", () => { d.cats.push({ name: "", size: 1 }); draw(`ct-${d.cats.length - 1}-name`); dirty(); }, { cls: "ec-btn--ghost", key: "ct-add", disabled: d.cats.length >= 16 })));
    if (focusKey) { const el = box.querySelector(`[data-key="${CSS.escape(focusKey)}"]`); if (el) el.focus(); }
  }
  rank.addEventListener("change", () => { d.ranking = rank.value; if (d.ranking === "time") d.segs.forEach((s) => { s.measure = "time"; }); draw(); dirty(); });

  // Start from a ready-made shape
  const from = select([["", "Choose a shape"], ...Object.entries(TEMPLATES).map(([k, t]) => [k, t.label])], "", { key: "fit-from" });
  const load = btn("Load this shape", () => {
    const t = TEMPLATES[from.value];
    if (!t) { showMsg(msg, "Pick a shape first."); from.focus(); return; }
    showMsg(msg, "");
    d.ranking = t.ranking; rank.value = t.ranking;
    d.segs = t.segments.map((s) => ({ ...s }));
    if (!d.cats.length) d.cats = t.categories.map((k) => ({ ...k }));
    draw(); dirty();
    ctx.toast("Shape loaded. Check it, then save.", "ok");
  }, { cls: "ec-btn--ghost", key: "fit-load", disabled: locked });

  const save = btn("Save set-up", null, { type: "submit", disabled: locked });
  const form = h("form", { class: "ecx-stack", novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); showMsg(msg, "");
    if (d.segs.some((s) => !s.name.trim())) { showMsg(msg, "Give every segment a name."); return; }
    if (d.cats.some((k) => !k.name.trim())) { showMsg(msg, "Give every category a name."); return; }
    const keep = new Set(d.cats.map((k) => k.id).filter(Boolean));
    const lost = c.categories.find((k) => !keep.has(k.id) && (c.entries.some((x) => x.category === k.id) || c.heats.some((x) => x.category === k.id)));
    if (lost) { showMsg(msg, `${lost.name} still has athletes or heats. Move or remove them first.`); return; }
    await withBusy(save, async () => {
      const r = await ctx.save([{ op: "comp.set", ranking: d.ranking, segments: d.segs.map((s) => ({ ...(s.id ? { id: s.id } : {}), name: s.name.trim(), measure: d.ranking === "time" ? "time" : s.measure || "time" })), categories: d.cats.map((k) => ({ ...(k.id ? { id: k.id } : {}), name: k.name.trim(), size: k.size || 1 })) }], { success: "Set-up saved.", toastError: false });
      if (r.ok) ctx.dirty = false; else showMsg(msg, plainError(r.error));
    });
  } },
  h("section", { class: "ec-card ecx-stack", "aria-labelledby": "h-shape" },
    h("h3", { class: "ec-d3", id: "h-shape", text: "How the event is ranked" }),
    field("Ranking", rank, "A timed race ranks by finish time. Workout games rank each workout and add up the placings."),
    h("div", { class: "ecx-stack ecx-addbox" }, field("Start from", from, "Fills in the ranking and the segments. Your categories stay as they are, unless you have none yet."), load)),
  box, msg, h("div", { class: "ec-bar ecx-savebar" }, h("div", { class: "ec-row" }, save, btn("Undo changes", () => { ctx.dirty = false; ctx.render(); }, { cls: "ec-btn--ghost" }))));
  draw();
  return h("div", { class: "ecx-stack" },
    locked ? h("div", { class: "ecx-notice ecx-notice--warn", role: "status" }, h("span", { text: "Results have been recorded, so the format is locked. Changing it now would lose them." })) : null,
    form);
}

// ================================================================== Athletes
// "bib, name, club, category" lines. Returns { rows } or { errors }.
export function parseAthletes(text, ev, taken = new Map()) {
  const c = comp(ev), errors = [], rows = [], seen = new Map();
  const lines = parseLines(text);
  if (!lines.length) return { errors: ["Paste one athlete a line first, like 101, Sam Smith, Riverside Club, Open."] };
  if (!c.categories.length) return { errors: ["Add the categories in Set-up first. Every athlete needs one."] };
  const names = c.categories.map((k) => k.name).join(", ");
  lines.forEach((line, i) => {
    const at = `Line ${i + 1}`;
    const parts = (line.includes("\t") ? line.split("\t") : line.split(",")).map((x) => x.trim());
    if (parts.length !== 4) { errors.push(`${at}: use four parts, bib, name, club, category. Leave the club empty if there is none, like 101, Sam Smith, , Open.`); return; }
    const [b, name, club, cat] = parts;
    const bibText = b.replace(/^#/, "");
    if (!/^\d{1,5}$/.test(bibText) || Number(bibText) < 1) { errors.push(`${at}: the bib "${b}" must be a whole number from 1 to 99999.`); return; }
    const bib = Number(bibText);
    if (seen.has(bib)) { errors.push(`${at}: bib ${bib} is already used on line ${seen.get(bib)}.`); return; }
    if (taken.has(bib)) { errors.push(`${at}: bib ${bib} already belongs to ${taken.get(bib)}.`); return; }
    seen.set(bib, i + 1);
    if (!name) { errors.push(`${at}: add a name.`); return; }
    if (name.length > 120) { errors.push(`${at}: names are up to 120 characters.`); return; }
    if (club.length > 60) { errors.push(`${at}: clubs are up to 60 characters.`); return; }
    const k = c.categories.find((x) => x.name.toLowerCase() === cat.toLowerCase() || x.id === cat);
    if (!k) { errors.push(`${at}: the category "${cat}" is not set up. Yours are: ${names}.`); return; }
    rows.push({ bib, name, club, category: k.id });
  });
  return errors.length ? { errors } : { rows };
}

let athleteFilter = { q: "", cat: "", shown: 50 };

function athletes(ctx) {
  const ev = ctx.event, c = comp(ev), locked = hasResults(ev);
  const msg = msgBox();
  const errBox = h("div", {});
  const paste = h("textarea", { class: "ec-textarea", rows: "6", spellcheck: "false", placeholder: "101, Sam Smith, Riverside Club, Open\n102, Alex Jones, , Open\n201, Sam Smith & Alex Jones, Hilltop Club, Pairs", "aria-describedby": "paste-help" });
  const addBtn = btn("Add these athletes", null, { type: "submit", key: "ath-add" });
  const repBtn = btn("Replace the whole list", null, { cls: "ec-btn--ghost", key: "ath-replace", disabled: locked });
  const taken = new Map(c.entries.map((e) => [e.bib, e.name]));
  const run = async (mode, button) => {
    showMsg(msg, ""); errBox.replaceChildren();
    const r = parseAthletes(paste.value, ev, mode === "add" ? taken : new Map());
    if (r.errors) { errBox.replaceChildren(list([...r.errors.slice(0, 8), ...(r.errors.length > 8 ? [`And ${r.errors.length - 8} more lines to fix.`] : [])])); paste.focus(); return; }
    if (mode === "add" && c.entries.length + r.rows.length > 800) { showMsg(msg, "An event can have up to 800 athletes."); return; }
    if (mode === "replace") {
      const yes = await confirmBox({ title: "Replace every athlete?", body: `This removes the ${plural(c.entries.length, "athlete")} you have now, and their heats, and puts these ${r.rows.length} in their place.`, ok: "Yes, replace them" });
      if (!yes) return;
    }
    await withBusy(button, async () => {
      const res = mode === "add" ? await saveAll(ctx, r.rows.map((x) => ({ op: "entry.add", ...x })), { success: `${plural(r.rows.length, "athlete")} added.`, toastError: false })
        : await ctx.save([{ op: "entries.replace", entries: r.rows }], { success: `${plural(r.rows.length, "athlete")} saved.`, toastError: false });
      if (res.ok) { ctx.dirty = false; paste.value = ""; } else showMsg(msg, plainError(res.error));
    });
  };
  const form = h("form", { class: "ecx-stack ecx-addbox", novalidate: true, oninput: () => { ctx.dirty = true; }, onsubmit: (e) => { e.preventDefault(); run("add", addBtn); } },
    field("Paste your athletes", paste, "One a line: bib, name, club, category. For pairs, join the names with &. Full names stay private. Fans see the bib, or first names if you choose that."),
    h("span", { id: "paste-help", class: "ecx-sr", text: "Four parts a line, separated by commas." }),
    errBox, msg, h("div", { class: "ec-row" }, addBtn, repBtn));
  repBtn.addEventListener("click", () => run("replace", repBtn));

  const q = input({ value: athleteFilter.q, type: "search", placeholder: "Bib, name or club", key: "ath-q", "aria-label": "Search athletes" });
  q.addEventListener("input", () => { athleteFilter.q = q.value; athleteFilter.shown = 50; ctx.render({ focusKey: "ath-q" }); });
  const cat = select([["", "All categories"], ...c.categories.map((k) => [k.id, k.name])], athleteFilter.cat, { key: "ath-cat", "aria-label": "Category" });
  cat.addEventListener("change", () => { athleteFilter.cat = cat.value; athleteFilter.shown = 50; ctx.render({ focusKey: "ath-cat" }); });
  const t = athleteFilter.q.trim().toLowerCase();
  const all = c.entries.filter((e) => (!athleteFilter.cat || e.category === athleteFilter.cat) && (!t || String(e.bib).startsWith(t) || `${e.name} ${e.club}`.toLowerCase().includes(t))).sort((a, b) => a.bib - b.bib);
  const shown = all.slice(0, athleteFilter.shown);
  const counts = c.categories.map((k) => `${k.name} ${c.entries.filter((e) => e.category === k.id).length}`).join(", ");

  return h("div", { class: "ecx-stack" },
    h("section", { class: "ec-card ecx-stack", "aria-labelledby": "h-paste" }, h("h3", { class: "ec-d3", id: "h-paste", text: "Add athletes" }), locked ? h("p", { class: "ec-small ec-muted", text: "Results are recorded, so you can add athletes but not replace the whole list." }) : null, form),
    h("section", { class: "ec-card ecx-stack", "aria-labelledby": "h-ath" },
      h("h3", { class: "ec-d3", id: "h-ath", text: `Athletes (${c.entries.length})` }),
      counts ? h("p", { class: "ec-small ec-muted", text: counts }) : null,
      c.entries.length ? h("div", { class: "ecx-fields" }, field("Search", q), field("Category", cat)) : null,
      shown.length ? h("ul", { class: "ecx-list", "aria-label": "Athletes" }, shown.map((e) => athleteRow(ctx, e))) : empty(c.entries.length ? "No athletes match that search." : "No athletes yet. Paste your list above."),
      all.length > shown.length ? btn(`Show more (${all.length - shown.length} left)`, () => { athleteFilter.shown += 50; ctx.render({ focusKey: "ath-more" }); }, { cls: "ec-btn--ghost", key: "ath-more" }) : null));
}

function athleteRow(ctx, e) {
  const ev = ctx.event, c = comp(ev);
  const edit = (patch, ok) => ctx.save([{ op: "entry.edit", id: e.id, ...patch }], { success: ok });
  const bib = input({ value: String(e.bib), inputmode: "numeric", maxlength: "5", key: `ar-${e.id}-bib`, "aria-label": `Bib for ${e.name}` });
  bib.addEventListener("change", () => { const v = bib.value.trim(); if (!/^\d{1,5}$/.test(v) || Number(v) < 1) { ctx.toast("A bib is a whole number from 1 to 99999.", "error"); ctx.render(); return; } edit({ bib: Number(v) }, "Bib saved."); });
  const nm = input({ value: e.name, maxlength: "120", key: `ar-${e.id}-name`, "aria-label": `Name for bib ${e.bib}` });
  nm.addEventListener("change", () => edit({ name: nm.value.trim() }, "Name saved."));
  const cl = input({ value: e.club || "", maxlength: "60", key: `ar-${e.id}-club`, "aria-label": `Club for ${e.name}` });
  cl.addEventListener("change", () => edit({ club: cl.value.trim() }, "Club saved."));
  const ct = select(c.categories.map((k) => [k.id, k.name]), e.category, { key: `ar-${e.id}-cat`, "aria-label": `Category for ${e.name}` });
  ct.addEventListener("change", () => edit({ category: ct.value }, "Category saved."));
  const hs = select([["", "No heat"], ...c.heats.filter((x) => !x.category || x.category === e.category).map((x) => [x.id, `${x.time} ${x.name}`])], e.heat || "", { key: `ar-${e.id}-heat`, "aria-label": `Heat for ${e.name}` });
  hs.addEventListener("change", () => edit({ heat: hs.value || null }, "Heat saved."));
  return h("li", { class: "ecx-list__row ecx-wrapnarrow ecx-athlete" },
    field("Bib", bib), field("Name", nm, null, "ecx-grow"), field("Club", cl), field("Category", ct), field("Heat", hs),
    btn("Remove", async () => {
      const yes = await confirmBox({ title: `Remove ${e.name}?`, body: `Bib ${e.bib} and any results are removed.`, ok: "Yes, remove" });
      if (yes) ctx.save([{ op: "entry.remove", id: e.id }], { success: "Athlete removed." });
    }, { cls: "ec-btn--danger ec-btn--sm", key: `ar-${e.id}-rm`, label: `Remove ${e.name}, bib ${e.bib}` }));
}

// ================================================================== Heats
const toMins = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

// Heats for the athletes who have none yet: category by category, bib order, perHeat to a heat,
// each heat `gap` minutes after the one before. Returns { ops, count } or { error }.
export function planHeats(ev, { start, gap, per, category }) {
  const c = comp(ev);
  const t0 = toMins(start);
  if (t0 == null || t0 > 23 * 60 + 59) return { error: "Type the start time as HH:MM, like 09:30." };
  if (!Number.isInteger(gap) || gap < 0 || gap > 600) return { error: "Minutes between heats is a whole number from 0 to 600." };
  if (!Number.isInteger(per) || per < 1 || per > 200) return { error: "Athletes per heat is a whole number from 1 to 200." };
  const cats = c.categories.filter((k) => !category || k.id === category);
  const used = new Set([...c.heats.map((x) => x.id), ...c.entries.map((x) => x.id), ...c.segments.map((x) => x.id), ...c.categories.map((x) => x.id)]);
  const nextId = () => { let i = 1; while (used.has(`H${i}`)) i++; used.add(`H${i}`); return `H${i}`; };
  const heatOps = [], editOps = [];
  let at = t0, n = c.heats.length;
  for (const k of cats) {
    const who = c.entries.filter((e) => e.category === k.id && !e.heat).sort((a, b) => a.bib - b.bib);
    for (let i = 0; i < who.length; i += per) {
      if (at > 23 * 60 + 59) return { error: "That runs past midnight. Start earlier, use fewer minutes between heats, or put more athletes in each heat." };
      const id = nextId();
      n += 1;
      heatOps.push({ op: "heat.add", id, time: hhmm(at), name: `Heat ${n}`, category: k.id });
      who.slice(i, i + per).forEach((e) => editOps.push({ op: "entry.edit", id: e.id, heat: id }));
      at += gap;
    }
  }
  if (!heatOps.length) return { error: "Everyone in that category already has a heat. Clear the heats to start again." };
  if (c.heats.length + heatOps.length > 120) return { error: `That would make ${c.heats.length + heatOps.length} heats. An event can have up to 120. Put more athletes in each heat.` };
  return { ops: [...heatOps, ...editOps], count: heatOps.length };
}

function heats(ctx) {
  const ev = ctx.event, c = comp(ev);
  const lastTime = c.heats.length ? [...c.heats].sort((a, b) => String(a.time).localeCompare(String(b.time))).pop().time : "09:00";
  const startDefault = c.heats.length ? hhmm(Math.min(23 * 60 + 59, (toMins(lastTime) || 540) + 10)) : "09:00";
  const msg = msgBox();
  const start = input({ type: "time", value: startDefault, key: "hg-start" });
  const gap = input({ type: "number", min: "0", max: "600", inputmode: "numeric", value: "10", key: "hg-gap" });
  const per = input({ type: "number", min: "1", max: "200", inputmode: "numeric", value: "10", key: "hg-per" });
  const cat = select([["", "All categories, one after another"], ...c.categories.map((k) => [k.id, k.name])], "", { key: "hg-cat" });
  const go = btn("Make the heats", null, { type: "submit", key: "hg-go" });
  const waiting = c.entries.filter((e) => !e.heat).length;
  const gen = h("form", { class: "ecx-stack", novalidate: true, oninput: () => { ctx.dirty = true; }, onsubmit: async (e) => {
    e.preventDefault(); showMsg(msg, "");
    const r = planHeats(ev, { start: start.value, gap: Number(gap.value), per: Number(per.value), category: cat.value });
    if (r.error) { showMsg(msg, r.error); return; }
    await withBusy(go, async () => {
      const res = await saveAll(ctx, r.ops, { success: `${plural(r.count, "heat")} made.`, toastError: false });
      if (res.ok) ctx.dirty = false; else showMsg(msg, plainError(res.error));
    });
  } },
  h("p", { class: "ec-muted", text: c.entries.length ? `${plural(waiting, "athlete")} without a heat. Athletes go in bib order, category by category.` : "Add the athletes first. Then the heats can be made from them." }),
  h("div", { class: "ecx-fields" }, field("First heat starts", start), field("Minutes between heats", gap), field("Athletes per heat", per), field("For", cat)),
  msg, h("div", { class: "ec-row" }, go,
    btn("Clear all heats", async () => {
      const busy = c.heats.find((x) => x.state !== "scheduled");
      if (busy) { ctx.toast(`${busy.name} has started. Heats that have run can't be cleared.`, "error", 5000); return; }
      if (!c.heats.length) { ctx.toast("There are no heats to clear.", "warn"); return; }
      const yes = await confirmBox({ title: "Clear every heat?", body: `This removes all ${c.heats.length} heats and puts the athletes back in the waiting list. Athletes and categories stay.`, ok: "Yes, clear them" });
      if (!yes) return;
      const ops = [...c.entries.filter((e) => e.heat).map((e) => ({ op: "entry.edit", id: e.id, heat: null })), ...c.heats.map((x) => ({ op: "heat.remove", id: x.id }))];
      await saveAll(ctx, ops, { success: "Heats cleared." });
    }, { cls: "ec-btn--danger", key: "hg-clear" })));
  go.disabled = !c.entries.length || !c.categories.length;

  return h("div", { class: "ecx-stack" },
    h("section", { class: "ec-card ecx-stack", "aria-labelledby": "h-gen" }, h("h3", { class: "ec-d3", id: "h-gen", text: "Make the heats" }), gen),
    h("section", { class: "ec-card ecx-stack", "aria-labelledby": "h-hl" },
      h("h3", { class: "ec-d3", id: "h-hl", text: `The schedule (${c.heats.length})` }),
      c.heats.length ? h("ul", { class: "ecx-list", "aria-label": "Heats" }, [...c.heats].sort((a, b) => String(a.time).localeCompare(String(b.time)) || a.id.localeCompare(b.id)).map((x) => heatRow(ctx, x))) : empty("No heats yet."),
      addHeat(ctx)));
}

function heatRow(ctx, x) {
  const c = comp(ctx.event), n = c.entries.filter((e) => e.heat === x.id).length;
  const edit = (patch, ok) => ctx.save([{ op: "heat.edit", id: x.id, ...patch }], { success: ok });
  const tm = input({ type: "time", value: x.time, key: `hr-${x.id}-time`, "aria-label": `Start time for ${x.name}` });
  tm.addEventListener("change", () => { if (/^\d{2}:\d{2}$/.test(tm.value)) edit({ time: tm.value }, "Time saved."); else { ctx.toast("Type the time as HH:MM.", "error"); ctx.render(); } });
  const nm = input({ value: x.name, maxlength: "40", key: `hr-${x.id}-name`, "aria-label": `Name of the heat at ${x.time}` });
  nm.addEventListener("change", () => { if (nm.value.trim()) edit({ name: nm.value.trim() }, "Name saved."); else { ctx.toast("A heat needs a name.", "error"); ctx.render(); } });
  const ct = select([["", "Any category"], ...c.categories.map((k) => [k.id, k.name])], x.category || "", { key: `hr-${x.id}-cat`, "aria-label": `Category for ${x.name}` });
  ct.addEventListener("change", () => edit({ category: ct.value || null }, "Category saved."));
  return h("li", { class: "ecx-list__row ecx-wrapnarrow" }, field("Time", tm), field("Name", nm, null, "ecx-grow"), field("Category", ct),
    h("div", { class: "ecx-heatmeta" }, h("span", { class: `ec-badge ${x.state === "live" ? "ec-badge--live" : ""}`, text: x.state === "live" ? "Live" : x.state === "done" ? "Done" : "Scheduled" }), h("span", { class: "ec-small ec-muted", text: plural(n, "athlete") })),
    btn("Remove", async () => {
      const yes = await confirmBox({ title: `Remove ${x.name}?`, body: n ? `${plural(n, "athlete")} are in it. The server will ask you to move them first.` : "The heat is removed from the schedule.", ok: "Yes, remove" });
      if (yes) ctx.save([{ op: "heat.remove", id: x.id }], { success: "Heat removed." });
    }, { cls: "ec-btn--danger ec-btn--sm", key: `hr-${x.id}-rm`, label: `Remove ${x.name} at ${x.time}` }));
}

function addHeat(ctx) {
  const c = comp(ctx.event), msg = msgBox();
  const tm = input({ type: "time", value: "09:00", key: "ah-time" });
  const nm = input({ maxlength: "40", placeholder: `Heat ${c.heats.length + 1}`, key: "ah-name" });
  const ct = select([["", "Any category"], ...c.categories.map((k) => [k.id, k.name])], "", { key: "ah-cat" });
  const go = btn("Add heat", null, { type: "submit", cls: "ec-btn--ghost", key: "ah-go" });
  return h("form", { class: "ecx-stack ecx-addbox", novalidate: true, oninput: () => { ctx.dirty = true; }, onsubmit: async (e) => {
    e.preventDefault(); showMsg(msg, "");
    if (!/^\d{2}:\d{2}$/.test(tm.value)) { showMsg(msg, "Type the start time as HH:MM."); tm.focus(); return; }
    await withBusy(go, async () => {
      const r = await ctx.save([{ op: "heat.add", time: tm.value, name: nm.value.trim() || `Heat ${c.heats.length + 1}`, category: ct.value || null }], { success: "Heat added.", toastError: false });
      if (r.ok) ctx.dirty = false; else showMsg(msg, plainError(r.error));
    });
  } }, h("h4", { class: "ecx-h4", text: "Add one heat" }), h("div", { class: "ecx-fields" }, field("Start time", tm), field("Name", nm), field("Category", ct)), msg, go);
}

// ================================================================== On the day
let boardFilter = null, boardPicked = false;

function onTheDay(ctx) {
  const ev = ctx.event, c = comp(ev), on = ev.settings.vote.open, juniors = !!ev.settings.juniors;
  const refUrl = `${location.origin}/ref/?e=${ev.slug}`;
  const toggle = h("button", { type: "button", role: "switch", "aria-checked": String(on), class: `ecx-switch${on ? " is-on" : ""}`, key: "vote-switch", "aria-describedby": "vote-help", onclick: () => ctx.save([{ op: "vote.open", open: !on }], { success: on ? "Voting is off." : "Voting is on." }) },
    h("span", { class: "ecx-switch__knob", "aria-hidden": "true" }), h("span", { class: "ecx-switch__text", text: on ? "Fan voting is ON" : "Fan voting is OFF" }));
  const votes = ctx.counts && ctx.counts.votes != null ? ctx.counts.votes : null;
  const cnt = { live: c.heats.filter((x) => x.state === "live").length, next: c.heats.filter((x) => x.state === "scheduled").length, done: c.heats.filter((x) => x.state === "done").length, all: c.heats.length };
  if (!boardPicked || !(boardFilter in cnt)) boardFilter = cnt.live ? "live" : cnt.next ? "next" : "all";
  const pick = (f) => c.heats.filter((x) => (f === "live" ? x.state === "live" : f === "next" ? x.state === "scheduled" : f === "done" ? x.state === "done" : true));
  const seg = h("div", { class: "ec-seg", role: "group", "aria-label": "Show" }, [["live", "On now"], ["next", "Up next"], ["done", "Finished"], ["all", "All"]].map(([id, label]) => h("button", { type: "button", "aria-pressed": String(boardFilter === id), key: `bf-${id}`, text: `${label} (${cnt[id]})`, onclick: () => { boardFilter = id; boardPicked = true; ctx.render({ focusKey: `bf-${id}` }); } })));
  const rows = pick(boardFilter).sort((a, b) => String(a.time).localeCompare(String(b.time)));
  return h("div", { class: "ecx-stack" },
    h("section", { class: "ec-card ecx-stack", "aria-labelledby": "h-vote" },
      h("h3", { class: "ec-d3", id: "h-vote", text: "Fan voting" }), toggle,
      h("p", { class: "ec-muted", id: "vote-help", text: juniors ? "This is a juniors event, so fans never vote, whatever this switch says." : `On: fans pick a favourite for any heat that is on, and for ${ev.settings.lockSecs} seconds after it ends. Off: nobody can vote, and votes already cast are kept.` }),
      votes != null ? h("p", { class: "ec-small ec-dim", text: `${plural(votes, "vote")} so far.` }) : null),
    h("section", { class: "ec-card ecx-stack", "aria-labelledby": "h-tk" },
      h("h3", { class: "ec-d3", id: "h-tk", text: "Timekeepers" }),
      h("p", { class: "ec-muted", text: "Timekeepers sign in with their code and post splits and scores from their phones. They can start and end heats too." }),
      h("div", { class: "ec-row" }, h("a", { class: "ec-btn", href: refUrl, target: "_blank", rel: "noopener", text: "Open the timekeeper page" }), btn("Copy the link", () => copyText(refUrl, "Timekeeper link copied."), { cls: "ec-btn--ghost", key: "tk-copy" }))),
    h("section", { class: "ecx-stack", "aria-labelledby": "h-board" },
      h("h3", { class: "ec-d3", id: "h-board", text: "Heats today" }),
      h("p", { class: "ec-small ec-muted", text: "Every heat. Use the buttons if a timekeeper can't start or end a heat." }),
      seg,
      rows.length ? h("div", { class: "ecx-board" }, rows.map((x) => heatCard(ctx, x))) : empty(boardFilter === "live" ? "No heat is on right now." : "Nothing here yet.")));
}

function heatCard(ctx, x) {
  const ev = ctx.event, c = comp(ev), es = c.entries.filter((e) => e.heat === x.id);
  const fin = es.filter((e) => e.state === "finished").length, out = es.filter((e) => e.state === "dnf" || e.state === "dns").length;
  const k = catName(ev, x.category);
  const act = (op, text, ok, cls = "", confirm = null) => btn(text, async () => {
    if (confirm && !(await confirmBox({ ...confirm, danger: false }))) return;
    ctx.save([{ op, id: x.id }], { success: ok });
  }, { cls: `ec-btn--sm ${cls}`.trim(), key: `hb-${x.id}-${op}`, label: `${text}: ${x.name}` });
  return h("article", { class: `ecx-lg${x.state === "live" ? " is-live" : ""}`, "aria-label": `${x.time}, ${x.name}` },
    h("div", { class: "ecx-lg__meta ec-caps" }, h("span", { text: `${x.time}${k ? ` · ${k}` : ""}` }), h("span", { class: `ec-badge ${x.state === "live" ? "ec-badge--live" : x.state === "done" ? "ec-badge--ft" : ""}`, text: x.state === "live" ? "Live" : x.state === "done" ? "Finished" : "Not started" })),
    h("h4", { class: "ecx-boutname", text: x.name }),
    h("p", { class: "ec-small ec-muted", text: `${plural(es.length, "athlete")}${x.state !== "scheduled" ? `, ${fin} finished${out ? `, ${out} out` : ""}` : ""}` }),
    h("div", { class: "ec-row ecx-lg__acts" },
      x.state === "scheduled" ? act("heat.start", "Start heat", "Heat started.") : null,
      x.state === "live" ? act("heat.end", "End heat", "Heat ended.", "ec-btn--gold", { title: `End ${x.name}?`, body: "Athletes with every result are finished. The others are marked as did not finish.", ok: "Yes, end it", cancel: "Keep going" }) : null,
      x.state === "done" ? act("heat.reopen", "Reopen heat", "Heat reopened.", "", { title: `Reopen ${x.name}?`, body: "It goes back to live so results can be changed.", ok: "Yes, reopen", cancel: "Leave it" }) : null));
}
