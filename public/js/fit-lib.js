// Fitness pages: small helpers the fan, big screen, timekeeper and admin pages share. Pure
// functions, no DOM. Rules live in core/fitness.js; this is only words and parsing.

import { comp, fmtTime, segmentsDone, currentSegment } from "../core/fitness.js";

export { comp, fmtTime, segmentsDone, currentSegment };

export const isRace = (ev) => comp(ev).ranking === "time";
export const segs = (ev) => comp(ev).segments;
export const catOf = (ev, id) => comp(ev).categories.find((c) => c.id === id) || null;
export const catName = (ev, id) => (catOf(ev, id) || {}).name || "";
export const heatById = (ev, id) => comp(ev).heats.find((h) => h.id === id) || null;
export const entryByBib = (ev, bib) => comp(ev).entries.find((e) => e.bib === bib) || null;

export function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10 > 3 ? 0 : n % 10] || "th"}`;
}

// A result as people say it: "80 kg", "42 reps", "4:07".
export function valueText(seg, v) {
  if (v == null) return "-";
  if (seg && seg.measure === "kg") return `${v} kg`;
  if (seg && seg.measure === "reps") return `${v} ${v === 1 ? "rep" : "reps"}`;
  return fmtTime(v);
}

// The leg between two splits: the time spent on one segment of a race.
export function legs(results) {
  let prev = 0;
  return results.map((v) => { if (v == null) return null; const d = v - prev; prev = v; return d; });
}

export const STATE_TEXT = { ready: "Ready", racing: "On the course", finished: "Finished", dnf: "Did not finish", dns: "Did not start" };

// "4:07", "1:02:03", or the keypad shorthand "407" and "10203". Returns whole seconds, or null.
export function parseClock(text, { plainSeconds = false } = {}) {
  const t = String(text ?? "").trim();
  if (!t) return null;
  let m;
  if ((m = t.match(/^(\d{1,3}):([0-5]\d)$/))) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = t.match(/^(\d{1,2}):([0-5]\d):([0-5]\d)$/))) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  if ((m = t.match(/^(\d{1,2})([0-5]\d)$/)) && t.length >= 3 && t.length <= 4) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = t.match(/^(\d{1,2})([0-5]\d)([0-5]\d)$/)) && t.length >= 5 && t.length <= 6) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  if (plainSeconds && /^\d{1,6}$/.test(t)) return Number(t);
  return null;
}

// What a timekeeper typed for one segment, as a number to send. { value } or { error }.
export function parseResult(ev, seg, text) {
  const t = String(text ?? "").trim();
  if (!t) return { error: `Type the ${seg.measure === "time" ? "time" : "score"} first.` };
  if (seg.measure === "time") {
    const v = parseClock(t, { plainSeconds: !isRace(ev) });
    if (v == null) return { error: isRace(ev) ? "Type the time as m:ss or h:mm:ss, for example 4:07 or 1:02:03." : "Type the time as m:ss, for example 4:07, or as whole seconds." };
    return { value: v };
  }
  if (!/^\d{1,6}$/.test(t)) return { error: `Type ${seg.measure === "kg" ? "the weight in whole kilograms" : "the reps as a whole number"}, for example 40.` };
  return { value: Number(t) };
}
