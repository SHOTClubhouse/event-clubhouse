// Fight-card rules: judges' scorecards under the 10-point must system, decisions, and how a
// bout moves through its rounds.
//
// A judge scores each round: the round's winner gets 10, the loser 9 (or fewer for knockdowns
// and dominance), an even round is 10-10. The bout's result comes from the judges' totals
// (PTS) unless the referee stops it (KO, TKO, RSC, RTD, DQ) or it's declared a draw or no
// contest. White-collar and exhibition bouts can run without judges (scoring "none"), where the
// referee or MC announces the winner.

import { mustScore } from "./model.js";

export const METHOD_TEXT = {
  PTS: "on points", KO: "by knockout", TKO: "by technical knockout", RSC: "referee stopped the contest",
  RTD: "retired in the corner", DQ: "by disqualification", DRAW: "draw", NC: "no contest",
};

// One judge's card for a bout: rounds scored so far and the running totals.
export function judgeCard(scorecards, boutId, judgeId) {
  const rounds = ((scorecards || {})[boutId] || {})[judgeId] || {};
  let red = 0, blue = 0;
  const list = Object.keys(rounds).map(Number).sort((a, b) => a - b).map((n) => {
    const [r, b] = rounds[n];
    red += r; blue += b;
    return { round: n, red: r, blue: b };
  });
  return { judge: judgeId, rounds: list, red, blue, winner: red > blue ? "red" : blue > red ? "blue" : null };
}

// Every judge's card has every round scored.
export function cardsComplete(bout, scorecards) {
  if (bout.scoring !== "judges" || !bout.judges.length) return false;
  const lastRound = bout.result && bout.result.round ? bout.result.round : bout.rounds;
  return bout.judges.every((j) => {
    const c = ((scorecards || {})[bout.id] || {})[j] || {};
    for (let n = 1; n <= lastRound; n++) if (!c[n] || !mustScore(c[n][0], c[n][1])) return false;
    return true;
  });
}

// The decision from the judges' cards. Unanimous: every judge has the same winner. Split: the
// winner has more judges, at least one judge has the other boxer. Majority: the winner has more
// judges, the rest scored it even. Anything else is a draw.
export function decision(bout, scorecards) {
  const cards = bout.judges.map((j) => judgeCard(scorecards, bout.id, j));
  const red = cards.filter((c) => c.winner === "red").length;
  const blue = cards.filter((c) => c.winner === "blue").length;
  const even = cards.length - red - blue;
  const totals = cards.map((c) => `${c.red}-${c.blue}`);
  if (red === blue) return { winner: null, kind: red === 0 ? "draw" : even ? "majority draw" : "split draw", cards, totals };
  const winner = red > blue ? "red" : "blue";
  const w = Math.max(red, blue), l = Math.min(red, blue);
  const kind = l === 0 && even === 0 ? "unanimous" : l > 0 ? "split" : "majority";
  return { winner, kind, cards, totals };
}

// A sentence for the result: "Red wins by technical knockout in round 3."
export function resultText(bout) {
  const r = bout.result;
  if (!r) return "";
  if (r.method === "DRAW") return r.kind ? `${cap(r.kind)}.` : "Draw.";
  if (r.method === "NC") return "No contest.";
  const who = r.winner === "red" ? bout.red.name : bout.blue.name;
  if (r.method === "PTS") return `${who} wins on points${r.kind ? ` (${r.kind} decision)` : ""}.`;
  return `${who} wins ${METHOD_TEXT[r.method]}${r.round ? ` in round ${r.round}` : ""}.`;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// The bout's state machine, driven by the referee or timekeeper:
//   scheduled --start--> live (round 1)
//   live --end round--> break        (the round's fan vote locks lockSecs later)
//   break --next round--> live (round + 1)
//   live|break --result--> done
// Returns the new bout fields, or an error.
export function nextState(bout, action, now) {
  const ends = { ...(bout.roundEnds || {}) };
  if (action === "start") {
    if (bout.state !== "scheduled") return { error: "This bout has already started." };
    return { state: "live", round: 1, roundEnds: {}, startedAt: now };
  }
  if (action === "end-round") {
    if (bout.state !== "live") return { error: "No round is running." };
    ends[bout.round] = now;
    return { state: "break", roundEnds: ends };
  }
  if (action === "next-round") {
    if (bout.state !== "break") return { error: "End the round first." };
    if (bout.round >= bout.rounds) return { error: `This bout is ${bout.rounds} rounds. Record the result.` };
    return { state: "live", round: bout.round + 1 };
  }
  if (action === "reopen") {
    if (bout.state !== "done") return { error: "This bout isn't finished." };
    return { state: "break", result: null };
  }
  return { error: "Unknown action." };
}

// The bout currently on (live or between rounds), else the next one scheduled.
// The bout on now, or next up. With a ring id, only that ring's bouts (bouts with no ring count as
// the first ring's when firstRing is given).
export function currentBout(card, ring, firstRing) {
  const inRing = (b) => ring === undefined || (b.pitch || firstRing || null) === ring;
  const bouts = [...(card.bouts || [])].filter(inRing).sort((a, b) => a.order - b.order);
  return bouts.find((b) => b.state === "live" || b.state === "break") || bouts.find((b) => b.state === "scheduled") || null;
}

// One entry per ring that has bouts: { ring, bout } with the bout on now or next. A card without
// rings (or with one) gives a single entry with ring null.
export function ringsNow(doc) {
  const rings = doc.pitches && doc.pitches.length > 1 ? doc.pitches.map((p) => p.id) : [null];
  if (rings[0] === null) return [{ ring: null, bout: currentBout(doc.card) }];
  return rings.map((r) => ({ ring: r, bout: currentBout(doc.card, r, rings[0]) })).filter((x) => x.bout);
}
