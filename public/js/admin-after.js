// After: post updates, results (champions, fan-vote leaders), registrations and the CSV, and for
// demo events a reset button.

import { champion } from "../core/standings.js";
import { terms } from "../core/model.js";
import { resultText } from "../core/boxing.js";
import { leaderboard } from "../core/fitness.js";
import { comp, isRace, fmtTime } from "./fit-lib.js";
import { h, field, input, textarea, btn, msgBox, showMsg, withBusy, plainError, confirmBox, fmtDateTime, plural, empty, skeleton } from "./admin-lib.js";

const reg = { state: "idle", count: 0, rows: [], error: "" };     // registrations
const votes = { state: "idle", data: null, error: "" };           // public vote tally
const SHOWN = 100;

export function after(ctx) {
  if (reg.state === "idle") loadReg(ctx);
  if (votes.state === "idle") loadVotes(ctx);
  return h("div", { class: "ecx-stack" },
    h("p", { class: "ec-lede", text: "Keep the clubhouse alive after the day: post updates, see the results and collect the people who signed up." }),
    results(ctx),
    updates(ctx),
    registrations(ctx),
    ctx.isDemo ? demoReset(ctx) : null);
}

async function loadReg(ctx) {
  reg.state = "loading"; reg.error = "";
  try { const r = await ctx.get(`/api/events/${ctx.slug}/registrations`); reg.count = r.count; reg.rows = r.rows || []; reg.state = "ok"; }
  catch (e) { reg.state = "error"; reg.error = plainError(e.message); }
  if (ctx.tab() === "after") ctx.soft();
}
async function loadVotes(ctx) {
  votes.state = "loading"; votes.error = "";
  try { votes.data = await ctx.get(`/api/events/${ctx.slug}/votes`, { auth: false }); votes.state = "ok"; }
  catch (e) { votes.state = "error"; votes.error = plainError(e.message); }
  if (ctx.tab() === "after") ctx.soft();
}

// ---- Results ----
function results(ctx) {
  const ev = ctx.event, football = ev.sport === "football", fit = ev.sport === "fitness";
  const refresh = btn("Refresh", () => { votes.state = "idle"; reg.state = "idle"; ctx.render(); }, { cls: "ec-btn--ghost ec-btn--sm", key: "res-refresh", label: "Refresh results and votes" });
  let main;
  if (fit) {
    const c = comp(ev), done = c.heats.filter((x) => x.state === "done").length;
    main = h("div", { class: "ecx-stack" },
      h("p", { class: "ec-muted", text: `${done} of ${plural(c.heats.length, "heat")} finished.` }),
      c.categories.length ? h("ul", { class: "ecx-list", "aria-label": "Winners" }, c.categories.map((k) => {
        const w = leaderboard(ev, k.id).find((r) => r.rank === 1);
        return h("li", { class: "ecx-list__row" }, h("div", { class: "ecx-grow" }, h("p", { class: "ec-caps ec-dim", text: k.name }),
          w ? h("p", { class: "ecx-champ", text: w.label }) : h("p", { class: "ec-muted", text: "No winner yet." }),
          w ? h("p", { class: "ec-small ec-muted", text: isRace(ev) ? `Finish time ${fmtTime(w.total)}` : `${w.points} ${w.points === 1 ? "point" : "points"}` }) : null));
      })) : empty("No categories."));
  } else if (football) {
    const played = ev.fixtures.filter((f) => f.state === "ft").length;
    const goals = ev.fixtures.reduce((n, f) => n + (f.state !== "scheduled" && f.homeScore != null ? f.homeScore + f.awayScore : 0), 0);
    main = h("div", { class: "ecx-stack" },
      h("p", { class: "ec-muted", text: `${played} of ${plural(ev.fixtures.length, "game")} played, ${plural(goals, terms(ev).score)} scored.` }),
      ev.divisions.length ? h("ul", { class: "ecx-list", "aria-label": "Champions" }, ev.divisions.map((d) => {
        const c = champion(d, ev.fixtures, ev.settings.points);
        const t = c && c.id ? d.teams.find((x) => x.id === c.id) : null;
        return h("li", { class: "ecx-list__row" }, h("div", { class: "ecx-grow" },
          h("p", { class: "ec-caps ec-dim", text: d.name }),
          t ? h("p", { class: "ecx-champ", text: `${t.name}` }) : h("p", { class: "ec-muted", text: c ? "Won, but the team is still to be confirmed." : "No champion yet. It appears when the final is decided, or a league is complete." }),
          t ? h("p", { class: "ec-small ec-muted", text: c.how }) : null));
      })) : empty("No divisions."));
  } else {
    const done = ev.card.bouts.filter((b) => b.result).sort((a, b) => a.order - b.order);
    main = done.length ? h("ul", { class: "ecx-list", "aria-label": "Bout results" }, done.map((b) => h("li", { class: "ecx-list__row" }, h("div", { class: "ecx-grow" }, h("p", { class: "ec-caps ec-dim", text: `Bout ${b.order}` }), h("p", { text: `${b.red.name} v ${b.blue.name}` }), h("p", { class: "ec-small ec-muted", text: resultText(b) }))))) : empty("No bouts are decided yet.");
  }
  let leaders;
  if (votes.state === "ok" && votes.data) {
    const rows = fit ? (votes.data.leaders || []).slice(0, 5).map((l) => ({ name: l.label, n: l.votes })) : football ? (votes.data.leaders || []).slice(0, 5).map((l) => ({ name: `${l.label} (${l.team})`, n: l.votes })) : (votes.data.fighters || []).slice(0, 5).map((l) => ({ name: l.name, n: l.votes }));
    leaders = rows.length ? h("ol", { class: "ecx-leaders", "aria-label": football || fit ? "Fan vote leaders" : "Fans' fighter of the night" }, rows.map((r) => h("li", {}, h("span", { text: r.name }), h("strong", { text: plural(r.n, "vote") })))) : empty("No fan votes yet.");
  } else if (votes.state === "error") leaders = h("p", { class: "ec-error", role: "alert", text: votes.error });
  else leaders = skeleton(3);
  return h("section", { class: "ec-card ecx-stack", "aria-labelledby": "h-results" },
    h("div", { class: "ecx-split" }, h("h3", { class: "ec-d3 ecx-grow", id: "h-results", text: "Results" }), refresh),
    main,
    h("h4", { class: "ecx-h4", text: fit ? "Fan favourites" : football ? "Fan vote leaders (player of the game)" : "Fans' fighter of the night" }),
    leaders);
}

// ---- Updates ----
function updates(ctx) {
  const ev = ctx.event;
  const msg = msgBox();
  const title = input({ maxlength: "120", placeholder: "Thanks for coming", "aria-required": "true" });
  const body = textarea({ rows: "4", maxlength: "2000", placeholder: "A few sentences for the people who were there, and the people who weren't." });
  const link = input({ type: "url", inputmode: "url", placeholder: "https://… (optional)" });
  const go = btn("Post update", null, { type: "submit" });
  return h("section", { class: "ec-card ecx-stack", "aria-labelledby": "h-updates" },
    h("h3", { class: "ec-d3", id: "h-updates", text: "Updates" }),
    h("p", { class: "ec-small ec-muted", text: "Updates show on the fan page, newest first. Fans can read them before, during and after the day." }),
    h("form", { class: "ecx-stack", novalidate: true, oninput: () => { ctx.dirty = true; }, onsubmit: async (e) => {
      e.preventDefault(); showMsg(msg, "");
      if (!title.value.trim()) { showMsg(msg, "Give the update a title."); title.focus(); return; }
      await withBusy(go, async () => {
        const r = await ctx.save([{ op: "update.add", title: title.value.trim(), body: body.value.trim(), link: link.value.trim() || null }], { success: "Update posted.", toastError: false });
        if (r.ok) ctx.dirty = false; else showMsg(msg, plainError(r.error));
      });
    } }, field("Title", title), field("Message", body), field("Link (https)", link, "A photo album, a video or the results page."), msg, go),
    ev.updates.length ? h("ul", { class: "ecx-list", "aria-label": "Posted updates" }, ev.updates.map((u) => h("li", { class: "ecx-list__row ecx-update" },
      h("div", { class: "ecx-grow" },
        h("strong", { text: u.title }), h("div", { class: "ec-small ec-dim", text: fmtDateTime(u.at) }),
        u.body ? h("p", { class: "ec-muted ecx-pre", text: u.body }) : null,
        u.link ? h("a", { class: "ec-small", href: u.link, target: "_blank", rel: "noopener", text: u.link }) : null),
      btn("Remove", async () => {
        const yes = await confirmBox({ title: "Remove this update?", body: `"${u.title}" disappears from the fan page.`, ok: "Yes, remove" });
        if (yes) ctx.save([{ op: "update.remove", id: u.id }], { success: "Update removed." });
      }, { cls: "ec-btn--danger ec-btn--sm", key: `upd-${u.id}`, label: `Remove the update ${u.title}` })))) : empty("No updates yet."));
}

// ---- Registrations ----
function registrations(ctx) {
  let body;
  if (reg.state === "loading" || reg.state === "idle") body = skeleton(3);
  else if (reg.state === "error") body = h("div", { class: "ecx-stack" }, h("p", { class: "ec-error", role: "alert", text: reg.error }), btn("Try again", () => { reg.state = "idle"; ctx.render(); }, { cls: "ec-btn--ghost ec-btn--sm" }));
  else if (!reg.rows.length) body = empty("Nobody has pre-registered yet. Share the fan page link or QR code from Overview.");
  else body = h("div", { class: "ec-scroll ecx-regs", role: "region", "aria-label": "Registrations table", tabindex: "0" },
    h("table", { class: "ec-table" },
      h("thead", {}, h("tr", {}, ["First name", "Email", "Registered"].map((t) => h("th", { scope: "col", text: t })))),
      h("tbody", {}, reg.rows.slice(0, SHOWN).map((r) => h("tr", {}, h("td", { text: r.first_name }), h("td", { text: r.email }), h("td", { text: fmtDateTime(r.created_at) }))))),
    reg.rows.length > SHOWN ? h("p", { class: "ec-small ec-muted", text: `Showing the first ${SHOWN} of ${reg.rows.length}. Download the CSV for everyone.` }) : null);
  const msg = msgBox();
  const dl = btn("Download CSV", async () => {
    showMsg(msg, "");
    await withBusy(dl, async () => {
      try { await ctx.download(`/api/events/${ctx.slug}/registrations?format=csv`, `${ctx.slug}-registrations.csv`); ctx.toast("CSV downloaded."); }
      catch (e) { showMsg(msg, plainError(e.message)); }
    });
  }, { cls: reg.rows.length ? "" : "ec-btn--ghost", key: "reg-csv" });
  return h("section", { class: "ec-card ecx-stack", "aria-labelledby": "h-regs" },
    h("div", { class: "ecx-split" }, h("h3", { class: "ec-d3 ecx-grow", id: "h-regs", text: `Registrations${reg.state === "ok" ? ` (${reg.count})` : ""}` }), dl),
    h("p", { class: "ec-small ec-muted", text: "Each person agreed to hear from you and SHOT Clubhouse. Only use these emails for that." }),
    msg, body);
}

// ---- Demo reset ----
function demoReset(ctx) {
  const msg = msgBox();
  const go = btn("Reset demo", async () => {
    const yes = await confirmBox({ title: "Reset this demo?", body: "Scores, votes, updates and any changes go back to how the demo started.", ok: "Yes, reset it", danger: true });
    if (!yes) return;
    await withBusy(go, async () => {
      try { await ctx.post(`/api/events/${ctx.slug}/reset`, {}); ctx.toast("Demo reset."); ctx.reload(); }
      catch (e) { showMsg(msg, plainError(e.message)); }
    });
  }, { cls: "ec-btn--danger", key: "demo-reset" });
  return h("section", { class: "ec-card ecx-stack", "aria-labelledby": "h-demo" },
    h("h3", { class: "ec-d3", id: "h-demo", text: "Reset demo" }),
    h("p", { class: "ec-muted", text: "This is a demo event. Put it back as it was when you have finished showing it." }), msg, go);
}
