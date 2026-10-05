// The screen with no event open: sign in with an admin code or an organiser key, see the events
// this device is signed in to, list "My events", and create a new one (its admin code is shown once).

import { api, sessionsFor, signIn, signOut, organiser, organiserSignIn, organiserSignOut, organiserOpen } from "./api.js";
import { h, field, input, select, btn, msgBox, showMsg, withBusy, copyText, confirmBox, skeleton, fmtDate, plural } from "./admin-lib.js";

const SPORT = { football: "Football", boxing: "Boxing", fitness: "Fitness" };
const PHASE = { pre: "Before", live: "Live now", post: "After" };
const open = (slug) => { location.href = `/admin/?e=${encodeURIComponent(slug)}`; };

// opts: { slug (an event the link asked for), message (why we are here) }
export function renderSignIn(root, opts = {}) {
  const draft = { name: "", sport: "football", date: "" }; // survives a redraw while My events loads
  let created = null; // { slug, name, code } shown once
  let mine = { state: organiser() ? "loading" : "off", events: [], error: "" };

  const draw = () => {
    root.replaceChildren(
      h("main", { class: "ecx-signin ec-wrap", id: "main", tabindex: "-1" },
        h("header", { class: "ecx-signin__head" },
          h("p", { class: "ec-kicker", text: "Organiser dashboard" }),
          h("h1", { class: "ec-d1", id: "page-title", tabindex: "-1", text: "Run your event" }),
          h("p", { class: "ec-lede", text: "Set up teams or a fight card, make the schedule, hand out access codes and run the day from one place." })),
        opts.message ? h("p", { class: "ecx-notice", role: "status", text: opts.message }) : null,
        created ? createdCard() : null,
        h("div", { class: "ecx-signin__grid" },
          h("div", { class: "ecx-stack" }, codeCard(), signedInCard()),
          h("div", { class: "ecx-stack" }, organiserCard()))));
  };

  // ---- Event admin code ----
  function codeCard() {
    const msg = msgBox();
    const code = input({ placeholder: "ABCD-EFGH-JKLM", autocapitalize: "characters", spellcheck: "false", "aria-required": "true", class: "ec-input ecx-code-input" });
    const go = btn("Open the dashboard", null, { type: "submit", cls: "ec-btn--block" });
    const form = h("form", { class: "ecx-stack", novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      showMsg(msg, "");
      if (!code.value.trim()) { showMsg(msg, "Type your admin code first."); code.focus(); return; }
      await withBusy(go, async () => {
        try {
          const s = await signIn(code.value);
          if (s.role !== "admin") { signOut(s.slug); showMsg(msg, `That is a ${s.role} code. Use the ${s.role} page, or ask for an admin code.`); return; }
          open(s.slug);
        } catch (err) { showMsg(msg, err.message); code.focus(); }
      });
    } },
    field(opts.slug ? `Admin code for ${opts.slug}` : "Event admin code", code, "From the organiser who set up the event, or the code shown when it was created."), msg, go);
    return h("section", { class: "ec-card", "aria-labelledby": "h-code" }, h("h2", { class: "ec-d3", id: "h-code", text: "Sign in with an admin code" }), form);
  }

  // ---- Events this device already knows ----
  function signedInCard() {
    const list = sessionsFor(["admin"]);
    return h("section", { class: "ec-card", "aria-labelledby": "h-dev" },
      h("h2", { class: "ec-d3", id: "h-dev", text: "On this device" }),
      list.length
        ? h("ul", { class: "ecx-list" }, list.map((s) => h("li", { class: "ecx-list__row" },
          h("div", { class: "ecx-grow" }, h("strong", { text: s.event.name }), h("div", { class: "ec-small ec-muted", text: SPORT[s.event.sport] || s.event.sport })),
          btn("Open", () => open(s.slug), { cls: "ec-btn--sm", label: `Open ${s.event.name}` }),
          btn("Sign out", async () => { signOut(s.slug); draw(); }, { cls: "ec-btn--ghost ec-btn--sm", label: `Sign out of ${s.event.name}` }))))
        : h("p", { class: "ec-muted", text: "No events signed in here yet. Sign in with a code and this device remembers it." }));
  }

  // ---- Organiser key, my events, create ----
  function organiserCard() {
    const o = organiser();
    if (!o) return keyCard();
    return h("section", { class: "ec-card ecx-stack", "aria-labelledby": "h-org" },
      h("div", { class: "ec-row" },
        h("h2", { class: "ec-d3 ecx-grow", id: "h-org", text: "My events" }),
        btn("Sign out", () => { organiserSignOut(); mine = { state: "off", events: [], error: "" }; draw(); }, { cls: "ec-btn--ghost ec-btn--sm", label: `Sign out ${o.organiser.name}` })),
      h("p", { class: "ec-small ec-muted", text: `Signed in as ${o.organiser.name}.` }),
      myEvents(),
      createForm());
  }

  function keyCard() {
    const msg = msgBox();
    const key = input({ placeholder: "ABCD-EFGH-JKMN-PQRS", autocapitalize: "characters", spellcheck: "false", class: "ec-input ecx-code-input" });
    const go = btn("Sign in as organiser", null, { type: "submit", cls: "ec-btn--block ec-btn--ghost" });
    return h("section", { class: "ec-card", "aria-labelledby": "h-key" },
      h("h2", { class: "ec-d3", id: "h-key", text: "Create events with an organiser key" }),
      h("p", { class: "ec-muted", text: "SHOT gives each organiser a key. Sign in with it to see your events and create new ones." }),
      h("form", { class: "ecx-stack", novalidate: true, onsubmit: async (e) => {
        e.preventDefault(); showMsg(msg, "");
        if (!key.value.trim()) { showMsg(msg, "Type your organiser key first."); key.focus(); return; }
        await withBusy(go, async () => {
          try { await organiserSignIn(key.value); mine = { state: "loading", events: [], error: "" }; draw(); loadMine(); }
          catch (err) { showMsg(msg, err.message); key.focus(); }
        });
      } }, field("Organiser key", key), msg, go));
  }

  async function loadMine() {
    const o = organiser();
    if (!o) return;
    try {
      const r = await api.get("/api/organiser/events", { token: o.token });
      mine = { state: "ok", events: r.events || [], error: "" };
    } catch (e) {
      if (e.status === 401) { organiserSignOut(); mine = { state: "off", events: [], error: "" }; opts = { ...opts, message: "Your organiser sign-in has expired. Sign in again with your key." }; }
      else mine = { state: "error", events: [], error: e.message };
    }
    draw();
  }

  function myEvents() {
    if (mine.state === "loading") return skeleton(3);
    if (mine.state === "error") return h("div", { class: "ecx-stack" }, h("p", { class: "ec-error", role: "alert", text: mine.error }), btn("Try again", () => { mine.state = "loading"; draw(); loadMine(); }, { cls: "ec-btn--ghost ec-btn--sm" }));
    if (!mine.events.length) return h("div", { class: "ec-empty" }, h("p", { text: "You have no events yet. Create your first one below." }));
    const err = msgBox();
    return h("div", { class: "ecx-stack" }, h("ul", { class: "ecx-list", "aria-label": "My events" }, mine.events.map((ev) => h("li", { class: "ecx-list__row" },
      h("div", { class: "ecx-grow" },
        h("strong", { text: ev.name }),
        h("div", { class: "ec-small ec-muted", text: `${SPORT[ev.sport] || ev.sport} · ${fmtDate(ev.date)} · ${PHASE[ev.phase] || ev.phase}` })),
      btn("Open", async function () {
        showMsg(err, "");
        await withBusy(this, async () => {
          try { await organiserOpen(ev.slug); open(ev.slug); }
          catch (e) { showMsg(err, `${ev.name}: ${e.message}`); }
        });
      }, { cls: "ec-btn--sm", label: `Open ${ev.name}` })))), err);
  }

  function createForm() {
    const msg = msgBox();
    const name = input({ maxlength: "80", placeholder: "Summer Sixes Cup", "aria-required": "true", value: draft.name });
    const sport = select([["football", "Football (any variant)"], ["boxing", "Boxing"], ["fitness", "Fitness (races and workout games)"]], draft.sport);
    const date = input({ type: "date", value: draft.date });
    name.addEventListener("input", () => { draft.name = name.value; });
    sport.addEventListener("change", () => { draft.sport = sport.value; });
    date.addEventListener("input", () => { draft.date = date.value; });
    const go = btn("Create event", null, { type: "submit", cls: "ec-btn--block" });
    return h("form", { class: "ecx-stack ecx-create", novalidate: true, onsubmit: async (e) => {
      e.preventDefault(); showMsg(msg, "");
      if (!name.value.trim()) { showMsg(msg, "Give the event a name."); name.focus(); return; }
      await withBusy(go, async () => {
        try {
          const r = await api.post("/api/events", { name: name.value.trim(), sport: sport.value, ...(date.value ? { date: date.value } : {}) }, { token: organiser().token });
          await signIn(r.adminCode); // this device is now signed in as the event's admin
          draft.name = ""; draft.date = "";
          created = { slug: r.slug, name: r.event.name, code: r.adminCode };
          loadMine();
          draw();
          const c = root.querySelector("#created-h"); if (c) c.focus();
        } catch (err) {
          if (err.status === 401) { organiserSignOut(); opts = { ...opts, message: "Your organiser sign-in has expired. Sign in again with your key." }; draw(); return; }
          showMsg(msg, err.message);
        }
      });
    } },
    h("h3", { class: "ec-d3", text: "Create an event" }),
    field("Event name", name), field("Sport", sport), field("Date (you can change it later)", date), msg, go);
  }

  // ---- Shown once ----
  function createdCard() {
    return h("section", { class: "ecx-reveal ecx-reveal--big", "aria-labelledby": "created-h" },
      h("p", { class: "ec-kicker", text: "Event created" }),
      h("h2", { class: "ec-d2", id: "created-h", tabindex: "-1", text: created.name }),
      h("p", { class: "ecx-reveal__label", text: "Your admin code" }),
      h("p", { class: "ecx-code", "aria-label": `Admin code ${created.code.split("").join(" ")}`, text: created.code }),
      h("p", { class: "ecx-warn", role: "note", text: "Save this code now. We only show it once and can't show it again. Anyone with it can run your event." }),
      h("div", { class: "ec-row" },
        btn("Copy the code", () => copyText(created.code, "Admin code copied."), { cls: "ec-btn--gold" }),
        btn("Open the dashboard", () => open(created.slug)),
        btn("I have saved it", async () => { created = null; draw(); }, { cls: "ec-btn--ghost" })));
  }

  draw();
  if (mine.state === "loading") loadMine();
}
