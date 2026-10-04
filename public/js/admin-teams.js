// Teams (football): divisions, teams (single or pasted lists, rename, group, remove) and squads.

import { h, field, input, textarea, select, check, btn, msgBox, showMsg, withBusy, plainError, confirmBox, parseLines, parseSquad, plural, empty } from "./admin-lib.js";

const FORMATS = [["league", "League (everyone plays everyone)"], ["groups-knockout", "Groups, then knockouts"], ["knockout", "Straight knockout"], ["exhibition", "Friendlies (no table)"]];
const openSquads = new Set(); // team ids whose squad editor is open, kept across redraws

export function teams(ctx) {
  const ev = ctx.event;
  return h("div", { class: "ecx-stack" },
    h("p", { class: "ec-lede", text: "Add the teams, then each team's squad. Fans vote by shirt number, so numbers matter more than names." }),
    ev.divisions.length ? ev.divisions.map((d) => division(ctx, d)) : empty("No divisions yet. Add one below to start adding teams."),
    addDivision(ctx));
}

function addDivision(ctx) {
  const msg = msgBox();
  const name = input({ maxlength: "40", placeholder: "Under 12s" });
  const fmt = select(FORMATS, "groups-knockout");
  const go = btn("Add division", null, { type: "submit", cls: "ec-btn--ghost" });
  return h("section", { class: "ec-card ecx-stack", "aria-labelledby": "h-adddiv" },
    h("h3", { class: "ec-d3", id: "h-adddiv", text: "Add a division" }),
    h("p", { class: "ec-small ec-muted", text: "Use divisions to keep age groups or leagues apart. One division is fine for most events." }),
    h("form", { class: "ecx-stack", novalidate: true, onsubmit: async (e) => {
      e.preventDefault(); showMsg(msg, "");
      if (!name.value.trim()) { showMsg(msg, "Give the division a name."); name.focus(); return; }
      await withBusy(go, async () => {
        const r = await ctx.save([{ op: "division.add", name: name.value.trim(), format: fmt.value }], { success: "Division added.", toastError: false });
        if (!r.ok) showMsg(msg, plainError(r.error));
      });
    } }, h("div", { class: "ecx-fields" }, field("Division name", name), field("Format", fmt)), msg, go));
}

function division(ctx, d) {
  const ev = ctx.event;
  const games = ev.fixtures.filter((f) => f.division === d.id).length;
  const rename = input({ value: d.name, maxlength: "40", "aria-label": "Division name" });
  rename.addEventListener("change", () => ctx.save([{ op: "division.edit", id: d.id, name: rename.value.trim() }], { success: "Division renamed." }));
  const fmt = select(FORMATS, d.format, { "aria-label": `Format for ${d.name}` });
  fmt.addEventListener("change", () => ctx.save([{ op: "division.edit", id: d.id, format: fmt.value }], { success: "Format changed." }));
  const votes = h("input", { type: "checkbox", checked: d.vote !== false, onchange: (e) => ctx.save([{ op: "division.edit", id: d.id, vote: e.target.checked }], { success: e.target.checked ? "Fans can vote in this division." : "Voting is off for this division." }) });

  const remove = btn("Remove division", async () => {
    const yes = await confirmBox({ title: `Remove ${d.name}?`, body: `This deletes ${plural(d.teams.length, "team")}, their squads and ${plural(games, "game")}. It can't be undone.`, ok: "Yes, remove it" });
    if (yes) ctx.save([{ op: "division.remove", id: d.id }], { success: "Division removed." });
  }, { cls: "ec-btn--danger ec-btn--sm", label: `Remove division ${d.name}` });

  return h("section", { class: "ec-card ecx-stack", "aria-labelledby": `h-${d.id}` },
    h("div", { class: "ecx-split" },
      h("div", { class: "ecx-grow" }, h("h3", { class: "ec-d3", id: `h-${d.id}`, text: d.name }), h("p", { class: "ec-small ec-muted", text: `${plural(d.teams.length, "team")} · ${plural(games, "game")}` })),
      remove),
    h("div", { class: "ecx-fields" }, field("Division name", rename), field("Format", fmt)),
    h("label", { class: "ec-check" }, votes, h("span", { text: "Fans vote for a player of the game in this division" })),
    d.teams.length
      ? h("ul", { class: "ecx-list", "aria-label": `Teams in ${d.name}` }, d.teams.map((t) => teamRow(ctx, d, t)))
      : empty("No teams yet. Paste your team names below, one per line."),
    addTeams(ctx, d));
}

function teamRow(ctx, d, t) {
  const open = openSquads.has(t.id);
  const nm = input({ value: t.name, maxlength: "40", "aria-label": `Name of team ${t.name}` });
  nm.addEventListener("change", () => ctx.save([{ op: "team.edit", division: d.id, id: t.id, name: nm.value.trim() }], { success: "Team renamed." }));
  const grp = input({ value: t.group || "", maxlength: "4", class: "ec-input ecx-narrow", "aria-label": `Group for ${t.name}`, placeholder: "–" });
  grp.addEventListener("change", () => ctx.save([{ op: "team.edit", division: d.id, id: t.id, group: grp.value.trim() || null }], { success: "Group saved." }));
  const n = (t.players || []).length;
  const toggle = btn(open ? "Close squad" : `Squad (${n})`, () => { open ? openSquads.delete(t.id) : openSquads.add(t.id); ctx.render(); }, { cls: "ec-btn--ghost ec-btn--sm", key: `squad-${t.id}`, label: `${open ? "Close" : "Open"} the squad for ${t.name}, ${plural(n, "player")}` });
  toggle.setAttribute("aria-expanded", String(open));
  const remove = btn("Remove", async () => {
    const yes = await confirmBox({ title: `Remove ${t.name}?`, body: n ? `Their squad of ${plural(n, "player")} goes too.` : "You can add them again later.", ok: "Yes, remove" });
    if (yes) { openSquads.delete(t.id); ctx.save([{ op: "team.remove", division: d.id, id: t.id }], { success: "Team removed." }); }
  }, { cls: "ec-btn--danger ec-btn--sm", label: `Remove ${t.name}` });
  return h("li", { class: "ecx-team" },
    h("div", { class: "ecx-teamrow" },
      field("Team", nm, null, "ecx-grow"), field("Group", grp, null, "ecx-groupfield"),
      h("div", { class: "ecx-teamrow__btns" }, toggle, remove)),
    open ? squadEditor(ctx, d, t) : null);
}

function addTeams(ctx, d) {
  const msg = msgBox();
  const box = textarea({ rows: "4", placeholder: "Riverside Rovers\nTown Juniors\nPark United", spellcheck: "false" });
  const go = btn("Add teams", null, { type: "submit" });
  return h("form", { class: "ecx-stack ecx-addbox", novalidate: true, oninput: () => { ctx.dirty = true; }, onsubmit: async (e) => {
    e.preventDefault(); showMsg(msg, "");
    const names = parseLines(box.value);
    if (!names.length) { showMsg(msg, "Type or paste at least one team name."); box.focus(); return; }
    const long = names.find((x) => x.length > 40);
    if (long) { showMsg(msg, `Team names are up to 40 characters. Shorten "${long.slice(0, 30)}…".`); return; }
    const have = new Set(d.teams.map((t) => t.name.toLowerCase()));
    const seen = new Set(), fresh = [];
    names.forEach((x) => { const k = x.toLowerCase(); if (!have.has(k) && !seen.has(k)) { seen.add(k); fresh.push(x); } });
    const skipped = names.length - fresh.length;
    if (!fresh.length) { showMsg(msg, "Those teams are already in this division."); return; }
    await withBusy(go, async () => {
      const r = await ctx.save(fresh.map((name) => ({ op: "team.add", division: d.id, name })), { success: `${plural(fresh.length, "team")} added${skipped ? `, ${skipped} skipped as repeats` : ""}.`, toastError: false });
      if (r.ok) ctx.dirty = false; else showMsg(msg, plainError(r.error));
    });
  } },
  field(`Add teams to ${d.name}`, box, "One per line. Paste a whole list from a spreadsheet. The order is the seeding the fixture generator uses."), msg, go);
}

// ---- Squad ----
function squadEditor(ctx, d, t) {
  const msg = msgBox();
  const rows = h("div", { class: "ecx-squad__rows" });
  const addRow = (p = {}) => {
    const r = h("div", { class: "ecx-squad__row", "data-id": p.id || "" },
      h("input", { class: "ec-input ecx-num", type: "number", min: "0", max: "999", inputmode: "numeric", value: p.number == null ? "" : String(p.number), "aria-label": "Shirt number", placeholder: "#" }),
      h("input", { class: "ec-input", type: "text", maxlength: "60", value: p.name || "", "aria-label": "Player name", placeholder: "Player name", autocomplete: "off" }),
      h("button", { type: "button", class: "ec-btn ec-btn--ghost ec-btn--sm", text: "×", "aria-label": "Remove this player", onclick: () => { r.remove(); ctx.dirty = true; } }));
    rows.append(r);
    return r;
  };
  (t.players || []).slice().sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9)).forEach(addRow);
  if (!t.players || !t.players.length) for (let i = 0; i < 3; i++) addRow();

  const collect = () => [...rows.children].map((r) => {
    const [num, nm] = r.querySelectorAll("input");
    return { id: r.dataset.id || undefined, number: num.value === "" ? null : Number(num.value), name: nm.value.trim() };
  }).filter((p) => p.number != null || p.name);

  const check = (players) => {
    if (players.length > 40) return "A squad is up to 40 players.";
    const nums = new Map();
    for (const p of players) {
      if (p.number == null && !p.name) continue;
      if (p.number != null) { if (nums.has(p.number)) return `Shirt number ${p.number} is used twice. Each number can only go to one player.`; nums.set(p.number, 1); }
    }
    return "";
  };
  const send = async (players, button, success) => {
    const problem = check(players);
    if (problem) { showMsg(msg, problem); return false; }
    return withBusy(button, async () => {
      const r = await ctx.save([{ op: "team.players", division: d.id, id: t.id, players }], { success, toastError: false });
      if (r.ok) { ctx.dirty = false; return true; }
      showMsg(msg, plainError(r.error)); return false;
    });
  };

  const bulk = textarea({ rows: "5", placeholder: "7 Sam Smith\n9 Alex Jones\n10 Priya Patel", spellcheck: "false", "aria-label": `Paste players for ${t.name}` });
  const bulkBtn = btn("Add these players", async () => {
    showMsg(msg, "");
    const parsed = parseSquad(bulk.value);
    if (!parsed.players.length) { showMsg(msg, "Paste at least one line, like \"7 Sam Smith\"."); bulk.focus(); return; }
    if (parsed.problems.length) { showMsg(msg, parsed.problems[0]); return; }
    const merged = [...collect(), ...parsed.players];
    if (await send(merged, bulkBtn, `${plural(parsed.players.length, "player")} added to ${t.name}.`)) bulk.value = "";
  }, { cls: "ec-btn--ghost ec-btn--sm" });
  const saveBtn = btn("Save squad", () => { showMsg(msg, ""); return send(collect(), saveBtn, `${t.name} squad saved.`); }, { key: `save-squad-${t.id}` });

  return h("div", { class: "ecx-squad", role: "group", "aria-label": `Squad for ${t.name}`, oninput: () => { ctx.dirty = true; } },
    h("div", { class: "ecx-squad__cols ec-label", "aria-hidden": "true" }, h("span", { text: "No." }), h("span", { text: "Name" })),
    rows,
    h("div", { class: "ec-row" },
      btn("Add a player", () => { const r = addRow(); r.querySelector("input").focus(); }, { cls: "ec-btn--ghost ec-btn--sm" }), saveBtn),
    h("div", { class: "ecx-stack ecx-bulk" },
      field("Paste a list", bulk, "One player a line: shirt number, then name. A name on its own is fine. This saves straight away."), bulkBtn),
    msg);
}
