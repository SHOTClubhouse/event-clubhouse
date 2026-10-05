// Pitches and officials: pitches, referees (with a pitch) and judges (boxing).

import { terms } from "../core/model.js";
import { h, field, input, textarea, select, btn, msgBox, showMsg, withBusy, plainError, confirmBox, parseLines, plural, empty } from "./admin-lib.js";

export function officials(ctx) {
  const ev = ctx.event, football = ev.sport === "football", fit = ev.sport === "fitness", T = terms(ev);
  const refs = ev.officials.filter((o) => o.role === "referee");
  const judges = ev.officials.filter((o) => o.role === "judge");
  return h("div", { class: "ecx-stack" },
    h("p", { class: "ec-lede", text: football ? `${T.Places} are where games are played. Add a referee for each ${T.place}, then give each one a code in Access codes.` : fit ? "Add the timekeepers who post splits and scores from their phones. Then give each one a code in Access codes." : "Add the referees who run the bouts and the judges who score them. Give each one a code in Access codes." }),
    football ? pitchesCard(ctx) : null,
    officialsCard(ctx, { role: "referee", title: football ? "Referees" : fit ? "Timekeepers" : "Referees and timekeepers", list: refs, pitches: football, noun: fit ? "timekeeper" : "referee" }),
    ev.sport !== "boxing" ? null : officialsCard(ctx, { role: "judge", title: "Judges", list: judges, pitches: false, noun: "judge" }));
}

function pitchesCard(ctx) {
  const ev = ctx.event, T = terms(ev);
  const msg = msgBox();
  const box = textarea({ rows: "3", placeholder: `${T.Place} 2\n${T.Place} 3\nCentre ${T.place}`, spellcheck: "false" });
  const go = btn(`Add ${T.places}`, null, { type: "submit" });
  return h("section", { class: "ec-card ecx-stack", "aria-labelledby": "h-pitches" },
    h("h3", { class: "ec-d3", id: "h-pitches", text: T.Places }),
    ev.pitches.length ? h("ul", { class: "ecx-list", "aria-label": T.Places }, ev.pitches.map((p) => {
      const nm = input({ value: p.name, maxlength: "40", "aria-label": `Name of ${p.name}` });
      nm.addEventListener("change", () => ctx.save([{ op: "pitch.edit", id: p.id, name: nm.value.trim() }], { success: `${T.Place} renamed.` }));
      const games = ev.fixtures.filter((f) => f.pitch === p.id).length;
      return h("li", { class: "ecx-list__row" },
        field(T.Place, nm, games ? `${plural(games, "game")} scheduled` : null, "ecx-grow"),
        btn("Remove", async () => {
          const yes = await confirmBox({ title: `Remove ${p.name}?`, body: games ? `${plural(games, "game")} are on this ${T.place}, so it can't be removed until they move.` : `Referees on this ${T.place} become unassigned.`, ok: "Yes, remove" });
          if (yes) ctx.save([{ op: "pitch.remove", id: p.id }], { success: `${T.Place} removed.` });
        }, { cls: "ec-btn--danger ec-btn--sm", label: `Remove ${p.name}` }));
    })) : empty(`No ${T.places} yet. Add at least one.`),
    h("form", { class: "ecx-stack ecx-addbox", novalidate: true, oninput: () => { ctx.dirty = true; }, onsubmit: async (e) => {
      e.preventDefault(); showMsg(msg, "");
      const names = parseLines(box.value);
      if (!names.length) { showMsg(msg, `Type at least one ${T.place} name.`); box.focus(); return; }
      await withBusy(go, async () => {
        const r = await ctx.save(names.map((name) => ({ op: "pitch.add", name })), { success: `${plural(names.length, T.place, T.places)} added.`, toastError: false });
        if (r.ok) ctx.dirty = false; else showMsg(msg, plainError(r.error));
      });
    } }, field(`Add ${T.places}`, box, "One per line."), msg, go));
}

function officialsCard(ctx, { role, title, list, pitches, noun }) {
  const ev = ctx.event, T = terms(ev);
  const msg = msgBox();
  const box = textarea({ rows: "3", placeholder: "Jordan Hale\nMina Okafor", spellcheck: "false" });
  const pitch = pitches ? select([["", `No ${T.place} yet`], ...ev.pitches.map((p) => [p.id, p.name])], "") : null;
  const go = btn(`Add ${noun}s`, null, { type: "submit" });
  const pitchOptions = [["", `No ${T.place}`], ...ev.pitches.map((p) => [p.id, p.name])];
  const used = (o) => (role === "referee" ? ev.fixtures.filter((f) => f.ref === o.id).length : ev.card.bouts.filter((b) => b.judges.includes(o.id)).length);
  const headId = `h-${role}s`;
  return h("section", { class: "ec-card ecx-stack", "aria-labelledby": headId },
    h("h3", { class: "ec-d3", id: headId, text: title }),
    list.length ? h("ul", { class: "ecx-list", "aria-label": title }, list.map((o) => {
      const nm = input({ value: o.name, maxlength: "40", "aria-label": `Name of ${o.name}` });
      nm.addEventListener("change", () => ctx.save([{ op: "official.edit", id: o.id, name: nm.value.trim() }], { success: "Name saved." }));
      const ps = pitches ? select(pitchOptions, o.pitch || "", { "aria-label": `${T.Place} for ${o.name}` }) : null;
      if (ps) ps.addEventListener("change", () => ctx.save([{ op: "official.edit", id: o.id, pitch: ps.value || null }], { success: `${T.Place} saved.` }));
      const n = used(o);
      return h("li", { class: "ecx-list__row ecx-wrapnarrow" },
        field(role === "referee" ? "Referee" : "Judge", nm, null, "ecx-grow"),
        ps ? field(T.Place, ps) : null,
        btn("Remove", async () => {
          const yes = await confirmBox({ title: `Remove ${o.name}?`, body: n ? `${o.name} is on ${plural(n, role === "referee" ? "game" : "bout")}. Move ${n === 1 ? "it" : "them"} first, or the server will refuse.` : "Their access code stops working once you revoke it in Access codes.", ok: "Yes, remove" });
          if (yes) ctx.save([{ op: "official.remove", id: o.id }], { success: `${o.name} removed.` });
        }, { cls: "ec-btn--danger ec-btn--sm", label: `Remove ${o.name}` }));
    })) : empty(`No ${noun}s yet.`),
    h("form", { class: "ecx-stack ecx-addbox", novalidate: true, oninput: () => { ctx.dirty = true; }, onsubmit: async (e) => {
      e.preventDefault(); showMsg(msg, "");
      const names = parseLines(box.value);
      if (!names.length) { showMsg(msg, `Type at least one ${noun}'s name.`); box.focus(); return; }
      if (names.some((x) => x.length > 40)) { showMsg(msg, "Names are up to 40 characters."); return; }
      await withBusy(go, async () => {
        const r = await ctx.save(names.map((name) => ({ op: "official.add", name, role, pitch: pitch && pitch.value ? pitch.value : null })), { success: `${plural(names.length, noun)} added.`, toastError: false });
        if (r.ok) ctx.dirty = false; else showMsg(msg, plainError(r.error));
      });
    } },
    field(`Add ${noun}s`, box, "One name per line."), pitch ? field("Put them on", pitch, `Pick a ${T.place}, or leave it and set it per referee above.`) : null, msg, go));
}
