// Access codes: issue codes for the organiser team, referees, judges and coaches. A new code is
// shown once with a ready-to-send message. Existing codes can be revoked.

import { terms } from "../core/model.js";
import { h, field, input, select, btn, msgBox, showMsg, withBusy, plainError, confirmBox, copyText, tokenCodeId, fmtDateTime, plural, SITE, empty, skeleton } from "./admin-lib.js";

const revealed = []; // codes issued this visit: { id, role, label, code }
const ROLE_NAME = { admin: "Admin", referee: "Referee", judge: "Judge", coach: "Coach" };
const PAGE = { admin: "/admin/", referee: "/ref/", judge: "/ref/", coach: "/coach/" };

export const messageFor = (ev, c) => `Your Event Clubhouse code for ${ev.name}: ${c.code}. Open ${SITE}${PAGE[c.role]} and enter it. Keep it to yourself.`;

export function codes(ctx) {
  const ev = ctx.event;
  const teams = ev.divisions.flatMap((d) => d.teams.map((t) => ({ id: t.id, name: t.name })));
  const refs = ev.officials.filter((o) => o.role === "referee");
  const judges = ev.officials.filter((o) => o.role === "judge");
  const list = ctx.codes;
  const has = (subject) => !!(list && list.some((c) => c.subject === subject && !c.revoked));

  return h("div", { class: "ecx-stack" },
    h("p", { class: "ec-lede", text: "Everyone who works the event signs in with their own code. Each code opens only what that person needs." }),
    revealed.length ? revealCard(ctx) : null,
    issueForm(ctx, { teams, refs, judges }),
    bulkCard(ctx, { teams, refs, judges, has }),
    existing(ctx));
}

// ---- Shown once ----
function revealCard(ctx) {
  const ev = ctx.event;
  const many = revealed.length > 1;
  return h("section", { class: "ecx-reveal", "aria-labelledby": "h-reveal" },
    h("h3", { class: "ec-d3", id: "h-reveal", tabindex: "-1", text: many ? "New codes" : "New code" }),
    h("p", { class: "ecx-warn", role: "note", text: "These codes are shown once. We can't show them again. Copy them now and send each one to the right person." }),
    h("ul", { class: "ecx-list" }, revealed.map((c, i) => h("li", { class: "ecx-reveal__item" },
      h("p", { class: "ecx-reveal__label", text: `${ROLE_NAME[c.role]}: ${c.label}` }),
      h("p", { class: "ecx-code ecx-code--sm", "aria-label": `Code ${c.code.split("").join(" ")}`, text: c.code }),
      h("p", { class: "ec-small ec-muted ecx-msgtext", text: messageFor(ev, c) }),
      h("div", { class: "ec-row" },
        btn("Copy code", () => copyText(c.code, "Code copied."), { cls: "ec-btn--gold ec-btn--sm", key: `rv-code-${i}`, label: `Copy the code for ${c.label}` }),
        btn("Copy message", () => copyText(messageFor(ev, c), "Message copied."), { cls: "ec-btn--ghost ec-btn--sm", key: `rv-msg-${i}`, label: `Copy the message for ${c.label}` }))))),
    h("div", { class: "ec-row" },
      many ? btn("Copy all messages", () => copyText(revealed.map((c) => `${c.label}\n${messageFor(ev, c)}`).join("\n\n"), "All messages copied."), { cls: "ec-btn--gold", key: "rv-all" }) : null,
      btn("I have saved these", () => { revealed.length = 0; ctx.render(); }, { cls: "ec-btn--ghost", key: "rv-done" })));
}

// ---- Issue one ----
function issueForm(ctx, { teams, refs, judges }) {
  const ev = ctx.event;
  const roles = [["admin", "Admin (the organiser's team)"]];
  if (ev.sport === "football") roles.push(["referee", "Referee"], ["coach", "Coach or team manager"]);
  else roles.push(["referee", "Referee or timekeeper"], ["judge", "Judge"]);
  const role = select(roles, "referee", { key: "code-role" });
  const subject = select([["", ""]], "");
  const label = input({ maxlength: "60", placeholder: "Shows in the codes list" });
  const msg = msgBox();
  let touched = false;
  const who = () => (role.value === "referee" ? refs : role.value === "judge" ? judges : role.value === "coach" ? teams : []);
  const defaultLabel = () => {
    const w = who().find((x) => x.id === subject.value);
    if (role.value === "admin") return "Organiser team";
    if (!w) return "";
    return role.value === "coach" ? `${w.name} coach` : w.name;
  };
  const subjectWrap = h("div", {});
  const drawSubject = () => {
    const list = who();
    subjectWrap.replaceChildren();
    if (role.value === "admin") { subjectWrap.hidden = true; if (!touched) label.value = defaultLabel(); return; }
    subjectWrap.hidden = false;
    const nm = role.value === "coach" ? "team" : role.value;
    if (!list.length) {
      subjectWrap.append(h("p", { class: "ec-small ec-muted", text: role.value === "coach" ? "Add teams first (Teams)." : `Add a ${nm} first (${terms(ev).Places} and officials).` }));
      subject.replaceChildren(); subject.value = "";
    } else {
      subject.replaceChildren(...list.map((x) => h("option", { value: x.id, text: x.name })));
      subject.value = list[0].id;
      subjectWrap.append(field(role.value === "coach" ? "Which team" : `Which ${nm}`, subject));
    }
    if (!touched) label.value = defaultLabel();
  };
  role.addEventListener("change", () => { touched = false; drawSubject(); });
  subject.addEventListener("change", () => { if (!touched) label.value = defaultLabel(); });
  label.addEventListener("input", () => { touched = true; });
  drawSubject();
  const go = btn("Issue code", null, { type: "submit" });
  return h("section", { class: "ec-card ecx-stack", "aria-labelledby": "h-issue" },
    h("h3", { class: "ec-d3", id: "h-issue", text: "Issue a code" }),
    h("form", { class: "ecx-stack", novalidate: true, onsubmit: async (e) => {
      e.preventDefault(); showMsg(msg, "");
      if (role.value !== "admin" && !subject.value) { showMsg(msg, "Pick who the code is for first."); return; }
      await withBusy(go, async () => {
        try {
          const r = await ctx.post(`/api/events/${ctx.slug}/codes`, { role: role.value, ...(role.value !== "admin" ? { subject: subject.value } : {}), label: label.value.trim() });
          revealed.unshift({ id: r.id, role: role.value, label: label.value.trim() || defaultLabel() || "Organiser", code: r.code });
          await ctx.reloadCodes();
          ctx.render();
          const t = document.getElementById("h-reveal"); if (t) t.focus();
        } catch (err) { showMsg(msg, plainError(err.message)); }
      });
    } },
    h("div", { class: "ecx-fields" }, field("Role", role), subjectWrap, field("Label", label, "How you will spot this code in the list.")), msg, go));
}

// ---- Issue for everyone without one ----
function bulkCard(ctx, { teams, refs, judges, has }) {
  const ev = ctx.event;
  const sets = [];
  const missRefs = refs.filter((r) => !has(r.id)), missJudges = judges.filter((r) => !has(r.id)), missTeams = teams.filter((r) => !has(r.id));
  if (refs.length) sets.push({ role: "referee", noun: "referee", list: missRefs, name: (x) => x.name });
  if (judges.length) sets.push({ role: "judge", noun: "judge", list: missJudges, name: (x) => x.name });
  if (ev.sport === "football" && teams.length) sets.push({ role: "coach", noun: "team", list: missTeams, name: (x) => `${x.name} coach` });
  if (!sets.length) return null;
  const msg = msgBox();
  return h("section", { class: "ec-card ecx-stack", "aria-labelledby": "h-bulk" },
    h("h3", { class: "ec-d3", id: "h-bulk", text: "Issue codes for everyone" }),
    h("p", { class: "ec-small ec-muted", text: "One code each, for everyone who doesn't have a live code yet. You get all the messages together to copy." }),
    h("div", { class: "ec-row" }, sets.map((s) => {
      const b = btn(s.list.length ? `${s.role === "coach" ? "Coaches" : s.role === "referee" ? "Referees" : "Judges"} (${s.list.length})` : `${s.role === "coach" ? "Coaches" : s.role === "referee" ? "Referees" : "Judges"}: all have codes`, async () => {
        showMsg(msg, "");
        await withBusy(b, async () => {
          let done = 0;
          try {
            for (const x of s.list) {
              const r = await ctx.post(`/api/events/${ctx.slug}/codes`, { role: s.role, subject: x.id, label: s.name(x) });
              revealed.unshift({ id: r.id, role: s.role, label: s.name(x), code: r.code });
              done++;
            }
          } catch (err) { showMsg(msg, `${plainError(err.message)} ${done ? `${plural(done, "code")} were issued before that and are shown above.` : ""}`); }
          await ctx.reloadCodes();
          ctx.render();
          const t = document.getElementById("h-reveal"); if (t) t.focus();
        });
      }, { cls: "ec-btn--ghost", disabled: !s.list.length, key: `bulk-${s.role}` });
      return b;
    })), msg);
}

// ---- The list ----
function existing(ctx) {
  const ev = ctx.event;
  const mine = tokenCodeId(ctx.token);
  const nameOf = (c) => {
    if (c.role === "admin") return "";
    if (c.role === "coach") { for (const d of ev.divisions) { const t = d.teams.find((x) => x.id === c.subject); if (t) return t.name; } return "Removed team"; }
    return (ev.officials.find((o) => o.id === c.subject) || {}).name || "Removed official";
  };
  let body;
  if (ctx.codes == null) body = ctx.codesError ? h("div", { class: "ecx-stack" }, h("p", { class: "ec-error", role: "alert", text: ctx.codesError }), btn("Try again", () => ctx.reloadCodes().then(() => ctx.render()), { cls: "ec-btn--ghost ec-btn--sm" })) : skeleton(3);
  else if (!ctx.codes.length) body = empty("No codes yet.");
  else body = h("ul", { class: "ecx-list", "aria-label": "Access codes" }, ctx.codes.map((c) => h("li", { class: `ecx-list__row ecx-code-row${c.revoked ? " is-revoked" : ""}` },
    h("div", { class: "ecx-grow" },
      h("strong", { text: c.label || ROLE_NAME[c.role] }),
      h("div", { class: "ec-small ec-muted", text: [ROLE_NAME[c.role], nameOf(c), `issued ${fmtDateTime(c.created_at)}`].filter(Boolean).join(" · ") }),
      mine === c.id ? h("div", { class: "ec-small ecx-here", text: "The code this device is signed in with" }) : null),
    h("span", { class: `ec-badge ${c.revoked ? "" : "ecx-badge--ok"}`, text: c.revoked ? "Revoked" : "Active" }),
    c.revoked || ctx.isDemo ? null : btn("Revoke", async () => {
      const yes = await confirmBox({ title: `Revoke ${c.label || ROLE_NAME[c.role]}?`, body: mine === c.id ? "This is the code you are signed in with. You will be signed out straight away." : "They are signed out at once and the code stops working. You can issue a new one.", ok: "Yes, revoke it" });
      if (!yes) return;
      try {
        await ctx.post(`/api/events/${ctx.slug}/codes/${c.id}/revoke`, {});
        if (mine === c.id) { ctx.expired("You revoked the code you were signed in with. Sign in again with another admin code."); return; }
        await ctx.reloadCodes(); ctx.render(); ctx.toast("Code revoked.");
      } catch (err) { ctx.toast(plainError(err.message), "error", 5000); }
    }, { cls: "ec-btn--danger ec-btn--sm", key: `revoke-${c.id}`, label: `Revoke the code for ${c.label || ROLE_NAME[c.role]}` }))));
  return h("section", { class: "ec-card ecx-stack", "aria-labelledby": "h-codelist" },
    h("h3", { class: "ec-d3", id: "h-codelist", text: "Codes in use" }),
    ctx.isDemo ? h("p", { class: "ecx-notice", text: "These are public demo codes. They can't be revoked. Use Reset demo in After to put the demo back as it was." }) : null,
    body);
}
