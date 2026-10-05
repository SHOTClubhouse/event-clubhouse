// Details: name, date, venue, about, look (accent, logo, partner), links and the rules of the day.

import { h, field, input, textarea, select, btn, msgBox, showMsg, withBusy, plainError } from "./admin-lib.js";
import { terms } from "../core/model.js";

const HEX = /^#[0-9a-fA-F]{6}$/;
const HTTPS = /^https:\/\/[^\s"'<>]+$/;

function onAccent(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "#0a0c0e" : "#ffffff";
}

export function details(ctx) {
  const ev = ctx.event, football = ev.sport === "football";
  const msg = msgBox();
  const dirty = () => { ctx.dirty = true; };

  const name = input({ value: ev.name, maxlength: "80", "aria-required": "true" });
  const date = input({ type: "date", value: ev.date || "" });
  const venue = input({ value: ev.venue || "", maxlength: "120", placeholder: "Riverside Sports Ground, Ely" });
  const about = textarea({ rows: "5", maxlength: "2000", placeholder: "Two or three sentences fans will see at the top of the event page." }); about.value = ev.about || "";
  const aboutCount = h("span", { class: "ec-help", "aria-live": "off" });
  const countAbout = () => { aboutCount.textContent = `${about.value.length} of 2000`; };
  about.addEventListener("input", countAbout); countAbout();

  const accentPick = h("input", { type: "color", class: "ecx-colour", value: HEX.test(ev.theme.accent) ? ev.theme.accent : "#1abc9c", "aria-label": "Pick the accent colour" });
  const accentHex = input({ value: ev.theme.accent, maxlength: "7", class: "ec-input ec-mono", spellcheck: "false", placeholder: "#1abc9c" });
  const logo = input({ type: "url", value: ev.theme.logo || "", placeholder: "https://example.com/logo.png", inputmode: "url" });
  const partner = input({ value: ev.theme.partner || "", maxlength: "60", placeholder: "Your sponsor or partner" });
  const tickets = input({ type: "url", value: ev.links.tickets || "", placeholder: "https://tickets.example.com/your-event", inputmode: "url" });
  const clubhouse = input({ type: "url", value: ev.links.clubhouse || "", inputmode: "url" });

  const voteBy = select([["number", "Shirt number only (safest)"], ["name", "First name only"], ["both", "Shirt number and first name"]], ev.settings.voteBy);
  const lock = input({ type: "number", min: "0", max: "600", inputmode: "numeric", value: String(ev.settings.lockSecs) });
  const win = input({ type: "number", min: "0", max: "10", inputmode: "numeric", value: String(ev.settings.points.win) });
  const draw = input({ type: "number", min: "0", max: "10", inputmode: "numeric", value: String(ev.settings.points.draw) });
  const loss = input({ type: "number", min: "0", max: "10", inputmode: "numeric", value: String(ev.settings.points.loss) });
  const cards = select([["after", "After the bout is decided"], ["live", "As each round is scored"], ["never", "Never"]], ev.settings.showCards || "after");

  const tm = terms(ev);
  const place = select([["pitch", "Pitch"], ["court", "Court"], ["cage", "Cage"], ["ring", "Ring"], ["arena", "Arena"]], tm.place);
  const scored = select([["goal", "Goals"], ["point", "Points"]], tm.score);
  const discipline = input({ value: tm.discipline, maxlength: "30", placeholder: football ? "Futsal" : "White-collar boxing" });

  // Live preview of the event's look
  const preview = h("div", { class: "ecx-preview", role: "img", "aria-label": "Preview of how the event looks to fans" });
  const drawPreview = () => {
    const a = HEX.test(accentHex.value) ? accentHex.value : "#1abc9c";
    preview.style.setProperty("--accent", a);
    preview.style.setProperty("--on-accent", onAccent(a));
    const ok = HTTPS.test(logo.value.trim());
    preview.replaceChildren(
      h("div", { class: "ecx-preview__top" },
        ok ? h("img", { src: logo.value.trim(), alt: "", class: "ecx-preview__logo", onerror: (e) => e.target.remove() }) : null,
        h("div", { class: "ecx-grow" },
          h("div", { class: "ecx-preview__name", text: name.value.trim() || "Your event name" }),
          partner.value.trim() ? h("div", { class: "ecx-preview__partner", text: `${partner.value.trim()} × SHOT` }) : null)),
      h("div", { class: "ecx-preview__meta", text: [date.value, venue.value.trim()].filter(Boolean).join(" · ") || "Date and venue show here" }),
      h("div", { class: "ec-row" }, h("span", { class: "ec-btn ecx-preview__btn", text: "Register interest" }), h("span", { class: "ecx-preview__chip", text: "Live" })));
  };
  accentPick.addEventListener("input", () => { accentHex.value = accentPick.value; drawPreview(); });
  accentHex.addEventListener("input", () => { if (HEX.test(accentHex.value)) accentPick.value = accentHex.value; drawPreview(); });
  [name, date, venue, logo, partner].forEach((i) => i.addEventListener("input", drawPreview));
  drawPreview();

  const save = async (e) => {
    e.preventDefault();
    showMsg(msg, "");
    const val = (i) => i.value.trim();
    const ops = [{
      op: "event.set", name: val(name), date: date.value || null, venue: val(venue), about: about.value.trim(),
      theme: { accent: val(accentHex), logo: val(logo) || null, partner: val(partner) || null },
      links: { tickets: val(tickets) || null, clubhouse: val(clubhouse) || null },
    }, {
      op: "settings.set", lockSecs: Number(lock.value), ...(football ? { voteBy: voteBy.value, points: { win: Number(win.value), draw: Number(draw.value), loss: Number(loss.value) } } : { showCards: cards.value }),
      terms: { ...(football ? { place: place.value, score: scored.value } : {}), discipline: val(discipline) },
    }];
    if (lock.value === "") { showMsg(msg, "Vote lock: type a number of seconds from 0 to 600."); lock.focus(); return; }
    const go = e.submitter || form.querySelector("button[type=submit]");
    await withBusy(go, async () => {
      const r = await ctx.save(ops, { success: "Details saved.", toastError: false });
      if (r.ok) { ctx.dirty = false; ctx.render(); } else showMsg(msg, plainError(r.error));
    });
  };

  const form = h("form", { class: "ecx-stack", novalidate: true, oninput: dirty, onsubmit: save },
    h("div", { class: "ecx-two" },
      h("section", { class: "ec-card ecx-stack", "aria-labelledby": "h-basics" },
        h("h3", { class: "ec-d3", id: "h-basics", text: "The event" }),
        field("Event name", name), field("Date", date), field("Venue", venue),
        field("About", about), aboutCount),
      h("div", { class: "ecx-stack" },
        h("section", { class: "ec-card ecx-stack", "aria-labelledby": "h-look" },
          h("h3", { class: "ec-d3", id: "h-look", text: "How it looks" }),
          preview,
          h("div", { class: "ec-field" }, h("label", { for: "accent-hex", text: "Accent colour" }), h("div", { class: "ecx-colourrow" }, accentPick, (accentHex.id = "accent-hex", accentHex))),
          field("Logo link (https)", logo, "A square or wide image. Leave empty to show the event name."),
          field("Partner name", partner, "Shows as \"Partner × SHOT\" on the fan page.")),
        h("section", { class: "ec-card ecx-stack", "aria-labelledby": "h-links" },
          h("h3", { class: "ec-d3", id: "h-links", text: "Links" }),
          field("Tickets link (https)", tickets, "Your own ticketing page. Fans follow it from the fan page."),
          field("Clubhouse link (https)", clubhouse, "Where fans join the clubhouse afterwards.")))),

    h("section", { class: "ec-card ecx-stack", "aria-labelledby": "h-rules" },
      h("h3", { class: "ec-d3", id: "h-rules", text: "Rules of the day" }),
      h("div", { class: "ecx-fields" },
        football ? field("Players shown to fans", voteBy, "Full names never leave the server. Fans see what you pick here.") : null,
        field("Vote lock (seconds)", lock, football ? "How long fans can still vote after full time." : "How long fans can still vote after a round ends."),
        football ? field("Points for a win", win) : null,
        football ? field("Points for a draw", draw) : null,
        football ? field("Points for a loss", loss) : null,
        football ? null : field("Judges' cards show", cards, "Keep cards private until each bout is decided, or show them as rounds are scored."))),

    h("section", { class: "ec-card ecx-stack", "aria-labelledby": "h-words" },
      h("h3", { class: "ec-d3", id: "h-words", text: "Words" }),
      h("div", { class: "ecx-fields" },
        football ? field("Games are played on a", place, "Fans, referees and the big screen use this word.") : null,
        football ? field("Games are scored in", scored, "Goals or points, in scores and tables.") : null,
        field("Sport shown to fans (optional)", discipline, "Up to 30 characters. Shows by the date on the fan page."))),

    msg,
    h("div", { class: "ec-bar ecx-savebar" },
      h("div", { class: "ec-row" },
        btn("Save details", null, { type: "submit" }),
        btn("Undo changes", () => { ctx.dirty = false; ctx.render(); }, { cls: "ec-btn--ghost" }))));

  return h("div", {}, form);
}
