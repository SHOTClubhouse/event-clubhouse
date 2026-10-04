// Fight card (boxing): add, edit, reorder and remove bouts. The on-the-day controls sit on each bout.

import { h, btn, msgBox, showMsg, withBusy, plainError, confirmBox, plural, empty } from "./admin-lib.js";
import { boutForm, boutControls, boutName, boutState, cardsSummary, resultText } from "./admin-bouts.js";

const editing = new Set(); // bout ids whose form is open, kept across redraws
const days = new Set();    // bout ids whose "On the day" controls are open

export function card(ctx) {
  const ev = ctx.event;
  const bouts = [...ev.card.bouts].sort((a, b) => a.order - b.order);
  return h("div", { class: "ecx-stack" },
    h("p", { class: "ec-lede", text: "Build the fight card in running order. Fans see it before the night, and follow each round live." }),
    bouts.length
      ? h("ol", { class: "ecx-bouts", "aria-label": "Fight card" }, bouts.map((b, i) => boutCard(ctx, b, i, bouts)))
      : empty("No bouts yet. Add the first one below."),
    addBout(ctx));
}

function boutCard(ctx, b, i, all) {
  const ev = ctx.event;
  const open = editing.has(b.id);
  const judges = b.judges.map((id) => (ev.officials.find((o) => o.id === id) || {}).name).filter(Boolean);
  const move = (dir) => {
    const other = all[i + dir];
    ctx.save([{ op: "bout.edit", id: b.id, order: other.order }, { op: "bout.edit", id: other.id, order: b.order }], { success: "Order changed." });
  };
  const form = open ? editForm(ctx, b) : null;
  const toggle = btn(open ? "Close editor" : "Edit", () => { open ? editing.delete(b.id) : editing.add(b.id); ctx.render({ focusKey: `bout-${b.id}-edit` }); }, { cls: "ec-btn--ghost ec-btn--sm", key: `bout-${b.id}-edit`, label: `${open ? "Close the editor for" : "Edit"} ${boutName(b)}` });
  toggle.setAttribute("aria-expanded", String(open));
  return h("li", { class: `ecx-bout ec-card ecx-stack${b.state === "live" || b.state === "break" ? " is-live" : ""}` },
    h("div", { class: "ecx-split" },
      h("div", { class: "ecx-grow" },
        h("p", { class: "ec-caps ec-dim", text: `Bout ${i + 1}${b.title ? ` · ${b.title}` : ""}` }),
        h("h3", { class: "ecx-boutname" }, h("span", { class: "ecx-red", text: b.red.name }), " v ", h("span", { class: "ecx-blue", text: b.blue.name })),
        h("p", { class: "ec-small ec-muted", text: [b.red.club && `Red: ${b.red.club}`, b.blue.club && `Blue: ${b.blue.club}`, b.weight, `${b.rounds} × ${b.roundMins} min`, b.scoring === "judges" ? (judges.length ? `Judges: ${judges.join(", ")}` : "No judges picked") : "No judges"].filter(Boolean).join(" · ") })),
      h("span", { class: `ec-badge ${b.state === "live" ? "ec-badge--live" : ""}`, text: boutState(b) })),
    b.result ? h("p", { class: "ecx-result-text", text: resultText(b) }) : null,
    cardsSummary(ev, b),
    h("div", { class: "ec-row" },
      toggle,
      btn("Move up", () => move(-1), { cls: "ec-btn--ghost ec-btn--sm", key: `bout-${b.id}-up`, disabled: i === 0, label: `Move ${boutName(b)} up` }),
      btn("Move down", () => move(1), { cls: "ec-btn--ghost ec-btn--sm", key: `bout-${b.id}-down`, disabled: i === all.length - 1, label: `Move ${boutName(b)} down` }),
      btn("Remove", async () => {
        const yes = await confirmBox({ title: `Remove ${boutName(b)}?`, body: b.state === "scheduled" ? "The bout comes off the card." : "This bout has started. Removing it deletes its scorecards and result.", ok: "Yes, remove" });
        if (yes) { editing.delete(b.id); ctx.save([{ op: "bout.remove", id: b.id }], { success: "Bout removed." }); }
      }, { cls: "ec-btn--danger ec-btn--sm", label: `Remove ${boutName(b)}` })),
    form,
    h("details", { class: "ecx-day", open: days.has(b.id), ontoggle: (e) => { e.target.open ? days.add(b.id) : days.delete(b.id); } }, h("summary", { text: "On the day" }), boutControls(ctx, b)));
}

function editForm(ctx, b) {
  const f = boutForm(ctx.event, b, { onInput: () => { ctx.dirty = true; } });
  const msg = msgBox();
  const save = btn("Save bout", async () => {
    showMsg(msg, "");
    const problem = f.check();
    if (problem) { showMsg(msg, problem); return; }
    await withBusy(save, async () => {
      const r = await ctx.save([{ op: "bout.edit", id: b.id, ...f.collect() }], { success: "Bout saved.", toastError: false });
      if (r.ok) { editing.delete(b.id); ctx.render({ focusKey: `bout-${b.id}-edit` }); } else showMsg(msg, plainError(r.error));
    });
  }, { key: `bout-${b.id}-save` });
  return h("div", { class: "ecx-editbox", role: "group", "aria-label": `Edit ${boutName(b)}` }, f.node, msg, h("div", { class: "ec-row" }, save, btn("Cancel", () => { editing.delete(b.id); ctx.render(); }, { cls: "ec-btn--ghost" })));
}

function addBout(ctx) {
  const f = boutForm(ctx.event, null, { onInput: () => { ctx.dirty = true; } });
  const msg = msgBox();
  const go = btn("Add bout", null, { type: "submit" });
  return h("section", { class: "ec-card ecx-stack", "aria-labelledby": "h-addbout" },
    h("h3", { class: "ec-d3", id: "h-addbout", text: "Add a bout" }),
    h("form", { class: "ecx-stack", novalidate: true, onsubmit: async (e) => {
      e.preventDefault(); showMsg(msg, "");
      const problem = f.check();
      if (problem) { showMsg(msg, problem); f.focus(); return; }
      await withBusy(go, async () => {
        const r = await ctx.save([{ op: "bout.add", ...f.collect() }], { success: "Bout added.", toastError: false });
        if (r.ok) ctx.dirty = false; else showMsg(msg, plainError(r.error));
      });
    } }, f.node, msg, go));
}
