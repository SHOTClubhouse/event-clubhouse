// Demo hub: lists the demo events, links to their fan view and big screen, and signs a visitor
// in with a published demo code before sending them to the right dashboard.

import { api, signIn } from "/js/api.js";

const list = document.getElementById("events");
const status = document.getElementById("status");

const DEST = { admin: "/admin/", referee: "/ref/", judge: "/ref/", coach: "/coach/" };
const ROLE_NAME = { admin: "Admin", referee: "Referee", judge: "Judge", coach: "Coach" };
const PHASE = { pre: "Before", before: "Before", live: "Live now", post: "After", after: "After" };
const SPORT = { football: "Football", boxing: "Boxing", fitness: "Fitness" };

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  kids.flat().forEach((c) => c != null && n.append(c));
  return n;
}

function say(msg) { status.textContent = msg; }

function phaseOf(ev) {
  if (ev.live || ev.phase === "live") return "live";
  return ev.phase === "post" || ev.phase === "after" ? "post" : "pre";
}

async function copy(code, btn) {
  const tag = btn.querySelector("span");
  try {
    await navigator.clipboard.writeText(code);
    tag.textContent = "Copied";
    say("Code copied.");
  } catch (e) {
    // No clipboard access (older browsers, insecure origin): select the text so it can be copied by hand.
    const r = document.createRange();
    r.selectNodeContents(btn.firstChild);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    tag.textContent = "Select";
    say("Press copy to copy the selected code.");
  }
  setTimeout(() => { tag.textContent = "Copy"; }, 1800);
}

function roleRow(ev, c) {
  const name = c.label || ROLE_NAME[c.role] || c.role;
  const err = el("p", { class: "ecs-role-err", role: "alert", hidden: true });
  const go = el("button", { type: "button", class: "btn btn-teal btn-sm", text: name, "aria-label": `Sign in as ${name} for ${ev.name}` });
  const code = el("button", { type: "button", class: "ecs-code", "aria-label": `Copy the ${name} code for ${ev.name}: ${c.code}` }, c.code, el("span", { text: "Copy" }));
  code.addEventListener("click", () => copy(c.code, code));
  go.addEventListener("click", async () => {
    err.hidden = true;
    go.disabled = true;
    go.textContent = "Signing in…";
    say(`Signing in as ${name}.`);
    try {
      const s = await signIn(c.code);
      go.textContent = "Opening…";
      const dest = DEST[s.role] || DEST[c.role];
      location.href = dest ? `${dest}?e=${encodeURIComponent(s.slug)}` : "/";
    } catch (e) {
      go.disabled = false;
      go.textContent = name;
      err.textContent = (e && e.message) || "That didn't work. Try again.";
      err.hidden = false;
      say(err.textContent);
    }
  });
  return el("div", { class: "ecs-role" }, go, code, err);
}

function card(ev) {
  const ph = phaseOf(ev);
  const codes = Array.isArray(ev.codes) ? ev.codes : [];
  const base = `/e/${encodeURIComponent(ev.slug)}/`;
  return el("article", { class: "ecs-event", "data-sport": ev.sport, "aria-labelledby": `h-${ev.slug}` },
    el("div", { class: "ecs-event-head" },
      el("div", { class: "ecs-badges" },
        el("span", { class: "ecs-badge is-sport", text: SPORT[ev.sport] || ev.sport || "Event" }),
        el("span", { class: `ecs-badge${ph === "live" ? " is-live" : ""}`, text: PHASE[ph] })),
      el("h2", { id: `h-${ev.slug}`, text: ev.name }),
      ev.blurb ? el("p", { text: ev.blurb }) : null),
    el("div", { class: "ecs-views" },
      el("a", { class: "btn btn-gold btn-sm", href: base, text: "Fan view" }),
      el("a", { class: "btn btn-ghost btn-sm", href: `${base}screen/`, text: "Big screen" })),
    codes.length
      ? el("div", { class: "ecs-roles" }, el("h3", { text: "Sign in as" }), codes.map((c) => roleRow(ev, c)))
      : el("div", { class: "ecs-roles" }, el("p", { class: "ecs-note", text: "No staff codes are published for this event." })));
}

function stateBox(title, text, retry) {
  const box = el("div", { class: "ecs-state" }, el("h2", { text: title }), el("p", { text }));
  if (retry) {
    const b = el("button", { type: "button", class: "btn btn-gold btn-sm", text: "Try again" });
    b.addEventListener("click", load);
    box.append(b);
  }
  return box;
}

async function load() {
  list.setAttribute("aria-busy", "true");
  list.classList.remove("is-multi");
  list.replaceChildren(el("div", { class: "ecs-skel", "aria-hidden": "true" }, el("i"), el("i"), el("i"), el("i")));
  say("Loading the demo events.");
  try {
    const data = await api.get("/api/demo");
    const events = (data && data.events) || [];
    if (!events.length) {
      list.replaceChildren(stateBox("No demo events right now", "They are being reset. Check back in a minute, or email contact@shotclubhouse.com and we will run you through it.", true));
      say("There are no demo events right now.");
    } else {
      list.classList.toggle("is-multi", events.length > 1);
      list.replaceChildren(...events.map(card));
      say(`${events.length} demo ${events.length === 1 ? "event" : "events"} loaded.`);
    }
  } catch (e) {
    const m = (e && e.message) || "Something went wrong.";
    list.replaceChildren(stateBox("The demo did not load", `${m} Check your signal and try again.`, true));
    say("The demo events did not load.");
  } finally {
    list.setAttribute("aria-busy", "false");
  }
}

load();
