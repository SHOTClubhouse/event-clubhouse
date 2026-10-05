// Clubhouse: the preview fans see in the Clubhouse tab (docs/CLUBHOUSE.md). One form, saved as a
// whole with the clubhouse.set op. Rows are drafts until Save; a refused save keeps what was typed.

import { SPOTIFY, LINEUP_ROLES, REWARD_HOWS } from "../core/model.js";
import { h, field, input, textarea, select, btn, msgBox, showMsg, withBusy, parseLines } from "./admin-lib.js";

const HOW_TEXT = {
  register: "Registers for the event",
  vote: "Casts a first vote",
  attend: "Opens the page while the event is live",
  streak: "Comes to three events (shows locked)",
  share: "Shares with a friend (shows locked)",
};
const KIND_TEXT = [["post", "Post"], ["photo", "Photo"], ["shoutout", "Shout-out"]];

export const blankClubhouse = () => ({ on: false, intro: "", members: 0, tiers: [], culture: { playlist: null, lineup: [], drops: [] }, community: { posts: [], next: [] }, rewards: [] });

// Core messages start with a field path. Say the field plainly.
const SAY = { "clubhouse.intro": "Intro", "clubhouse.tiers": "Tiers", "clubhouse.culture.playlist": "Playlist", "clubhouse.culture.lineup": "Line-up", "clubhouse.culture.drops": "Drops", "clubhouse.community.posts": "Posts", "clubhouse.community.next": "Next dates", "clubhouse.rewards": "Patches", "clubhouse.members": "Members" };
export function sayError(msg) {
  const s = String(msg || "Something went wrong. Try again.");
  const m = s.match(/^([a-zA-Z.]+): (.*)$/);
  return m && SAY[m[1]] ? `${SAY[m[1]]}: ${m[2]}` : s;
}

// A list of rows (up to max) with Add and Remove. fields: { key, label, make(value), read(control), help }.
function rowEditor({ id, help, noun, nouns = `${noun}s`, max, items, fields, prefix, onChange }) {
  const list = h("div", { class: "ecx-clrows" });
  const emptyNote = h("p", { class: "ec-help", text: `No ${nouns} yet.` });
  const count = h("p", { class: "ec-help", "aria-live": "polite" });
  const addBtn = btn(`Add ${noun}`, () => { add(null); onChange(); const last = rows[rows.length - 1]; const c = last && last.el.querySelector("input, textarea, select"); if (c) c.focus(); }, { cls: "ec-btn--ghost", key: `${id}-add` });
  const rows = [];
  const nextId = () => { let n = 1; const used = new Set(rows.map((r) => r.id)); while (used.has(`${prefix}${n}`)) n++; return `${prefix}${n}`; };
  const renumber = () => {
    rows.forEach((r, i) => {
      r.el.setAttribute("aria-label", `${noun} ${i + 1}`);
      r.title.textContent = `${noun[0].toUpperCase()}${noun.slice(1)} ${i + 1}`;
      r.rm.setAttribute("aria-label", `Remove ${noun} ${i + 1}`);
    });
    addBtn.disabled = rows.length >= max;
    emptyNote.hidden = rows.length > 0;
    count.textContent = `${rows.length} of ${max}`;
  };
  function add(item) {
    const controls = {};
    const row = { id: prefix ? (item && item.id) || nextId() : null, controls };
    row.title = h("h4", { class: "ecx-clrow__t" });
    row.rm = btn("Remove", () => {
      rows.splice(rows.indexOf(row), 1); row.el.remove(); renumber(); onChange();
      addBtn.focus();
    }, { cls: "ec-btn--ghost" });
    row.el = h("div", { class: "ecx-clrow", role: "group" },
      h("div", { class: "ecx-clrow__head" }, row.title, row.rm),
      h("div", { class: "ecx-fields" }, fields.map((f) => { controls[f.key] = f.make(item ? item[f.key] : undefined); return field(f.label, controls[f.key], f.help); })));
    rows.push(row); list.append(row.el); renumber();
  }
  (items || []).forEach((x) => add(x));
  return {
    el: h("div", { class: "ecx-stack" }, help ? h("p", { class: "ec-help", text: help }) : null, emptyNote, list, h("div", { class: "ec-row" }, addBtn, count)),
    read: () => rows.map((r) => ({ ...(r.id ? { id: r.id } : {}), ...Object.fromEntries(fields.map((f) => [f.key, f.read(r.controls[f.key])])) })),
  };
}

const txt = (attrs = {}) => (v) => input({ value: v == null ? "" : String(v), ...attrs });
const readTxt = (c) => c.value.trim();

export function clubhouse(ctx) {
  const draft = ctx.clubhouseDraft;
  const ch = (draft && draft.value) || ctx.event.clubhouse || blankClubhouse();
  const cu = ch.culture || {}, co = ch.community || {};
  const msg = msgBox(); msg.id = "ch-msg"; msg.setAttribute("tabindex", "-1");
  if (draft && draft.error) showMsg(msg, draft.error);
  const dirty = () => { ctx.dirty = true; if (!msg.hidden) { showMsg(msg, ""); if (ctx.clubhouseDraft) ctx.clubhouseDraft.error = ""; } };

  const on = h("input", { type: "checkbox", id: "ch-on", checked: !!ch.on });
  const intro = textarea({ rows: "3", maxlength: "300", placeholder: "One line on what the clubhouse is for this event." }); intro.value = ch.intro || "";
  const introCount = h("span", { class: "ec-help" });
  const countIntro = () => { introCount.textContent = `${intro.value.length} of 300`; };
  intro.addEventListener("input", countIntro); countIntro();

  // The live check on the playlist link
  const playlist = input({ type: "url", inputmode: "url", value: cu.playlist || "", placeholder: "https://open.spotify.com/playlist/..." });
  const plCheck = h("p", { class: "ec-help ecx-plcheck", id: "ch-plcheck", role: "status" });
  const checkPlaylist = () => {
    const v = playlist.value.trim(), m = v.match(SPOTIFY);
    plCheck.classList.toggle("ec-error", !!v && !m);
    plCheck.classList.toggle("ecx-ok", !!m);
    playlist.setAttribute("aria-invalid", v && !m ? "true" : "false");
    plCheck.textContent = !v ? "No playlist. Paste a Spotify link to add a player." : m ? `Spotify ${m[1]}. Fans play it inside the Clubhouse tab` : "That is not a Spotify link. Paste a playlist, album, artist or show link that starts with https://open.spotify.com/.";
  };
  playlist.addEventListener("input", checkPlaylist); checkPlaylist();
  const plField = field("Spotify link", playlist);
  playlist.setAttribute("aria-describedby", "ch-plcheck");

  const tiers = rowEditor({
    id: "tier", noun: "tier", max: 4, items: ch.tiers, prefix: "M", onChange: dirty,
    help: "Up to 4 tiers. Leave the price empty and fans see \"Price set by you\".",
    fields: [
      { key: "name", label: "Name", make: txt({ maxlength: "60" }), read: readTxt },
      { key: "benefits", label: "Benefits, one per line", help: "Up to 8 lines of 80 characters.", make: (v) => { const t = textarea({ rows: "4" }); t.value = (v || []).join("\n"); return t; }, read: (c) => parseLines(c.value) },
      { key: "price", label: "Price (optional)", make: txt({ maxlength: "30", placeholder: "Leave empty" }), read: (c) => c.value.trim() || null },
    ],
  });
  const lineup = rowEditor({
    id: "lineup", noun: "line-up row", max: 12, items: cu.lineup, prefix: "", onChange: dirty,
    help: "Who is on, and when. The time is optional.",
    fields: [
      { key: "time", label: "Time (optional)", make: (v) => input({ type: "time", value: v || "" }), read: (c) => c.value || null },
      { key: "name", label: "Name", make: txt({ maxlength: "60" }), read: readTxt },
      { key: "role", label: "Role", make: (v) => select(LINEUP_ROLES, v || LINEUP_ROLES[0]), read: (c) => c.value },
    ],
  });
  const drops = rowEditor({
    id: "drop", noun: "drop", max: 6, items: cu.drops, prefix: "K", onChange: dirty,
    help: "Merch, content or kit that fans can look forward to.",
    fields: [
      { key: "title", label: "Title", make: txt({ maxlength: "60" }), read: readTxt },
      { key: "body", label: "Text", make: (v) => { const t = textarea({ rows: "2", maxlength: "300" }); t.value = v || ""; return t; }, read: (c) => c.value.trim() },
      { key: "when", label: "When", make: txt({ maxlength: "30", placeholder: "Out now" }), read: readTxt },
      { key: "exclusive", label: "Members only", help: "Fans see a lock and \"Members only\".", make: (v) => h("input", { type: "checkbox", checked: !!v }), read: (c) => c.checked },
    ],
  });
  const posts = rowEditor({
    id: "post", noun: "post", max: 12, items: co.posts, prefix: "W", onChange: dirty,
    help: "What the community is saying. Use a first name or a team name. Never name a young person.",
    fields: [
      { key: "who", label: "Who", make: txt({ maxlength: "60" }), read: readTxt },
      { key: "text", label: "Text", make: (v) => { const t = textarea({ rows: "2", maxlength: "300" }); t.value = v || ""; return t; }, read: (c) => c.value.trim() },
      { key: "kind", label: "Kind", make: (v) => select(KIND_TEXT, v || "post"), read: (c) => c.value },
      { key: "ago", label: "How long ago", make: txt({ maxlength: "20", placeholder: "2h" }), read: readTxt },
    ],
  });
  const next = rowEditor({
    id: "next", noun: "date", max: 6, items: co.next, prefix: "", onChange: dirty,
    help: "The next events fans can join.",
    fields: [
      { key: "date", label: "Date", make: (v) => input({ type: "date", value: v || "" }), read: (c) => c.value },
      { key: "title", label: "Title", make: txt({ maxlength: "80" }), read: readTxt },
      { key: "where", label: "Where", make: txt({ maxlength: "80" }), read: readTxt },
    ],
  });
  const rewards = rowEditor({
    id: "reward", noun: "patch", nouns: "patches", max: 8, items: ch.rewards, prefix: "B", onChange: dirty,
    help: "Rewards for turning up. Progress is kept on each fan's phone.",
    fields: [
      { key: "name", label: "Name", make: txt({ maxlength: "60" }), read: readTxt },
      { key: "how", label: "How it is earned", make: (v) => select(REWARD_HOWS.map((k) => [k, HOW_TEXT[k]]), v || "register"), read: (c) => c.value },
      { key: "text", label: "Text", make: txt({ maxlength: "120" }), read: readTxt },
    ],
  });

  const collect = () => ({
    on: on.checked,
    intro: intro.value.trim(),
    members: Number.isInteger(ch.members) ? ch.members : 0,
    tiers: tiers.read(),
    culture: { playlist: playlist.value.trim() || null, lineup: lineup.read(), drops: drops.read() },
    community: { posts: posts.read(), next: next.read() },
    rewards: rewards.read(),
  });

  const save = async (e) => {
    e.preventDefault();
    showMsg(msg, "");
    const value = collect();
    ctx.clubhouseDraft = { value, error: "" };
    const go = e.submitter || form.querySelector("button[type=submit]");
    await withBusy(go, async () => {
      const r = await ctx.save([{ op: "clubhouse.set", clubhouse: value }], { success: "Clubhouse saved.", toastError: false });
      if (r.ok) { ctx.clubhouseDraft = null; ctx.dirty = false; ctx.render(); return; }
      // The page may have been redrawn while the save ran: show the message on whatever is there now.
      const text = sayError(r.error);
      ctx.clubhouseDraft = { value, error: text };
      const m = document.getElementById("ch-msg");
      if (m) { showMsg(m, text); m.focus(); }
    });
  };

  const card = (id, title, ...kids) => h("section", { class: "ec-card ecx-stack", "aria-labelledby": id }, h("h3", { class: "ec-d3", id, text: title }), ...kids);

  const form = h("form", { class: "ecx-stack", novalidate: true, oninput: dirty, onsubmit: save },
    h("p", { class: "ec-lede", text: "Before and after the day, fans live in the clubhouse. This is what they see in the Clubhouse tab on the event page and on the big screen." }),
    ctx.isDemo ? h("div", { class: "ecx-notice", role: "note" }, h("span", { text: "This is a demo event. On the public demos, saving the clubhouse is refused. Your own event can change it." })) : null,
    card("h-chon", "Show the clubhouse",
      h("label", { class: "ec-check", for: "ch-on" }, on, h("span", { text: "Show the Clubhouse tab to fans" })),
      field("Intro", intro, "One line on what the clubhouse is for this event."), introCount),
    card("h-chtiers", "Membership", tiers.el),
    card("h-chculture", "Culture and music",
      h("div", { class: "ecx-stack" }, plField, plCheck),
      h("h4", { class: "ecx-sub", text: "Line-up" }), lineup.el,
      h("h4", { class: "ecx-sub", text: "Drops" }), drops.el),
    card("h-chcomm", "Community",
      h("h4", { class: "ecx-sub", text: "Posts" }), posts.el,
      h("h4", { class: "ecx-sub", text: "Next dates" }), next.el),
    card("h-chpatch", "Patches", rewards.el),
    msg,
    h("div", { class: "ec-bar ecx-savebar" },
      h("div", { class: "ec-row" },
        btn("Save clubhouse", null, { type: "submit" }),
        btn("Undo changes", () => { ctx.clubhouseDraft = null; ctx.dirty = false; ctx.render(); }, { cls: "ec-btn--ghost" }))));
  return h("div", {}, form);
}
