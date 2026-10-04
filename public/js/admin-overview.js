// Overview: counts, phase switch, quick links and QR code, and the "today" checklist.

import { h, btn, copyText, plural } from "./admin-lib.js";

const QR_SRC = "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js";
let qrLoad = null;
const qrCache = new Map();

function loadQr() {
  if (window.qrcode) return Promise.resolve();
  if (!qrLoad) qrLoad = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = QR_SRC; s.integrity = "sha384-mZT2gIty7ZDdOGkxfP6joZcYdMW1Jvj9dRlfpTmaJAKKXTqzygtB22k7FLe+KZC1"; s.crossOrigin = "anonymous"; s.onload = res; s.onerror = () => { qrLoad = null; rej(new Error("QR library did not load")); };
    document.head.append(s);
  });
  return qrLoad;
}

// A QR code for a link, as an image fans can scan from a poster or a screen.
export function qrImage(url, label) {
  const box = h("div", { class: "ecx-qr", role: "group", "aria-label": label });
  const draw = (src) => box.replaceChildren(h("img", { src, width: "176", height: "176", alt: `QR code for ${url}`, class: "ecx-qr__img" }));
  if (qrCache.has(url)) { draw(qrCache.get(url)); return box; }
  box.append(h("div", { class: "ec-skel ecx-qr__wait", "aria-hidden": "true" }));
  loadQr().then(() => {
    const q = window.qrcode(0, "M");
    q.addData(url); q.make();
    const src = q.createDataURL(8, 4);
    qrCache.set(url, src);
    draw(src);
  }).catch(() => box.replaceChildren(h("p", { class: "ec-small ec-muted", text: "The QR code could not load. The link above still works." })));
  return box;
}

const PHASES = [
  ["pre", "Before", "Fans see the event page: teams and fixtures, or the fight card. They can pre-register and follow the link to your tickets. Scores stay quiet."],
  ["live", "Live", "Fans see live scores on every pitch, tables, knockouts that fill themselves in, streams and the big screen. Voting works when you switch it on."],
  ["post", "After", "Fans see results, champions, fan-vote winners and your updates, and are invited to join the clubhouse."],
];

export function checklist(ctx) {
  const ev = ctx.event, football = ev.sport === "football";
  const teams = ev.divisions.reduce((n, d) => n + d.teams.length, 0);
  const codes = ctx.codes ? ctx.codes.filter((c) => !c.revoked && c.role !== "admin").length : null;
  const streams = !!(ev.stream && ev.stream.url) || (ev.pitches || []).some((p) => p.stream && p.stream.url);
  const refs = ev.officials.filter((o) => o.role === "referee").length;
  const judges = ev.officials.filter((o) => o.role === "judge").length;
  const items = football ? [
    { done: teams >= 2, label: "Teams added", hint: `${plural(teams, "team")} so far. You need at least two.`, tab: "teams" },
    { done: ev.pitches.length >= 1 && refs >= 1, label: "Pitches and referees added", hint: `${plural(ev.pitches.length, "pitch", "pitches")} and ${plural(refs, "referee")}.`, tab: "officials" },
    { done: ev.fixtures.length >= 1, label: "Fixtures made", hint: ev.fixtures.length ? `${plural(ev.fixtures.length, "game")} in the schedule.` : "Use the generator to make the schedule.", tab: "fixtures" },
  ] : [
    { done: ev.card.bouts.length >= 1, label: "Bouts on the card", hint: `${plural(ev.card.bouts.length, "bout")} so far.`, tab: "card" },
    { done: judges >= 1, label: "Judges added", hint: `${plural(judges, "judge")}. Bouts scored by judges need at least one.`, tab: "officials" },
  ];
  items.push(
    { done: codes == null ? false : codes >= 1, label: "Access codes issued", hint: codes == null ? "Checking…" : codes ? `${plural(codes, "code")} for referees, judges or coaches.` : "Give each referee, judge and coach a code.", tab: "codes" },
    { done: streams, label: "Stream added", hint: streams ? "A stream link is set." : "Optional. Add a YouTube, Twitch or Veo link.", tab: "live", optional: true },
    { done: ev.settings.vote.open, label: "Fan voting switched on", hint: ev.settings.vote.open ? "Fans can vote now." : "Switch it on when the first game or round starts.", tab: "live" },
  );
  return items;
}

export function overview(ctx) {
  const ev = ctx.event, football = ev.sport === "football";
  const fanUrl = `${location.origin}/e/${ev.slug}/`, screenUrl = `${fanUrl}screen/`;
  const c = ctx.counts || {};
  const played = football ? ev.fixtures.filter((f) => f.state === "ft").length : ev.card.bouts.filter((b) => b.state === "done").length;
  const total = football ? ev.fixtures.length : ev.card.bouts.length;
  const tile = (n, label, sub) => h("div", { class: "ecx-tile" }, h("div", { class: "ecx-tile__n", text: n == null ? "–" : String(n) }), h("div", { class: "ecx-tile__l", text: label }), sub ? h("div", { class: "ec-small ec-dim", text: sub }) : null);

  const items = checklist(ctx);
  const ready = items.filter((i) => i.done).length;

  const phase = h("div", { class: "ecx-phase", role: "group", "aria-label": "Event phase" }, PHASES.map(([id, name, text]) =>
    h("button", { type: "button", class: "ecx-phase__opt", "aria-pressed": String(ev.phase === id), key: `phase-${id}`, onclick: async () => {
      if (ev.phase === id) return;
      const r = await ctx.save([{ op: "phase.set", phase: id }], { success: `Event is now ${name.toLowerCase()}.` });
      if (r.ok && id === "live" && !ctx.event.settings.vote.open) ctx.hint("The event is live. Fan voting is still off. Switch it on in Live control when you are ready.");
      if (r.ok && id === "post" && ctx.event.settings.vote.open) ctx.hint("The event is over but fan voting is still on. Close it in Live control.");
    } },
    h("span", { class: "ecx-phase__name", text: name }), h("span", { class: "ecx-phase__text", text }))));

  return h("div", { class: "ecx-stack" },
    h("div", { class: "ecx-tiles" },
      tile(c.registrations, "Pre-registrations"),
      tile(c.votes, "Fan votes"),
      football ? tile(`${played}/${total}`, "Games played") : tile(`${played}/${total}`, "Bouts done"),
      tile(football ? ev.divisions.reduce((n, d) => n + d.teams.length, 0) : ev.officials.filter((o) => o.role === "judge").length, football ? "Teams" : "Judges")),

    h("section", { class: "ec-card ecx-stack", "aria-labelledby": "h-phase" },
      h("h3", { class: "ec-d3", id: "h-phase", text: "Where is the event?" }),
      h("p", { class: "ec-muted", text: "Pick the stage. Fans see the change within a few seconds." }),
      phase),

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
        h("div", { class: "ecx-linkrow" },
          h("div", { class: "ecx-grow" }, h("div", { class: "ec-label", text: "Fan page" }), h("a", { class: "ecx-url", href: fanUrl, target: "_blank", rel: "noopener", text: fanUrl })),
          btn("Copy", () => copyText(fanUrl, "Fan link copied."), { cls: "ec-btn--ghost ec-btn--sm", label: "Copy the fan page link" })),
        h("div", { class: "ec-row" },
          h("a", { class: "ec-btn", href: fanUrl, target: "_blank", rel: "noopener", text: "Open fan page" }),
          h("a", { class: "ec-btn ec-btn--ghost", href: screenUrl, target: "_blank", rel: "noopener", text: "Open big screen" })),
        h("div", { class: "ecx-qrrow" },
          qrImage(fanUrl, "QR code for the fan page"),
          h("p", { class: "ec-small ec-muted", text: "Put this on posters and the big screen. Fans scan it to open the fan page on their phone." })))));
}
