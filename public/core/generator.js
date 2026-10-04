// Fixture generator: the job London 26's schedule scripts did by hand, as a function.
//
// Formats:
//   league            everyone plays everyone (once, or twice with legs: 2)
//   groups-knockout   snake-seeded groups, round robin in each, then a knockout bracket
//   knockout          a straight bracket from the seeding, with byes for the top seeds
//
// Scheduling fills time slots across every pitch. A slot is gameMins + gapMins long. A team
// never plays twice in one slot and always gets at least minRest empty slots between games;
// earlier rounds go first, the most-rested teams next, and consecutive games alternate groups
// where possible (so a one-pitch day runs A, B, A, B). Knockout rounds wait for the round
// before (placeholders like "1st Group A" and "Winner Semi-final 1" fill in from the scores).

import { addMins, TIME } from "./model.js";

const LETTERS = "ABCDEFGHIJKLMNOP";
const ORD = ["1st", "2nd", "3rd", "4th"];
const pow2 = (n) => n >= 2 && (n & (n - 1)) === 0;

export function checkOptions(o) {
  const e = [];
  const n = (o.teams || []).length;
  if (!["league", "groups-knockout", "knockout"].includes(o.format)) e.push("Pick a format.");
  if (n < 2) e.push("Add at least two teams.");
  if (new Set((o.teams || []).map((t) => t.id)).size !== n) e.push("Every team needs its own id.");
  if (!TIME.test(o.start || "")) e.push("Start time must be HH:MM.");
  if (!(Number.isInteger(o.gameMins) && o.gameMins >= 1 && o.gameMins <= 120)) e.push("Games last 1 to 120 minutes.");
  if (!(Number.isInteger(o.gapMins ?? 0) && (o.gapMins ?? 0) >= 0 && (o.gapMins ?? 0) <= 60)) e.push("The gap between games is 0 to 60 minutes.");
  if (!Array.isArray(o.pitches) || !o.pitches.length) e.push("Add at least one pitch.");
  if (!(Number.isInteger(o.minRest ?? 0) && (o.minRest ?? 0) >= 0 && (o.minRest ?? 0) <= 10)) e.push("Rest between games is 0 to 10 slots.");
  if (o.format === "league" && ![1, 2].includes(o.legs ?? 1)) e.push("A league is played once or twice (legs 1 or 2).");
  if (o.format === "groups-knockout") {
    const g = o.groups ?? 2, a = o.advance ?? 2;
    if (!(Number.isInteger(g) && g >= 1 && g <= 16)) e.push("Use 1 to 16 groups.");
    else if (n < g * 2) e.push(`${g} groups need at least ${g * 2} teams.`);
    if (!(Number.isInteger(a) && a >= 1 && a <= 4)) e.push("1 to 4 teams go through from each group.");
    else if (Number.isInteger(g) && !pow2(g * a)) e.push(`${g} groups with ${a} through makes ${g * a} teams in the knockouts. That needs to be 2, 4, 8, 16 or 32.`);
    else if (Number.isInteger(g) && a > Math.floor(n / g)) e.push(`Groups of ${Math.floor(n / g)} can't send ${a} through.`);
  }
  return e;
}

// Round robin by the circle method: every pairing exactly once, in rounds where nobody plays twice.
export function roundRobin(ids) {
  const list = ids.length % 2 ? [...ids, null] : [...ids];
  const n = list.length, rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = list[i], b = list[n - 1 - i];
      if (a != null && b != null) pairs.push(i === 0 && r % 2 ? [b, a] : [a, b]);
    }
    rounds.push(pairs);
    list.splice(1, 0, list.pop());
  }
  return rounds;
}

// Snake seeding: seeds 1..G go to groups A..G, seeds G+1..2G back from G to A, and so on.
export function snakeGroups(teams, groups) {
  return teams.map((t, i) => {
    const row = Math.floor(i / groups);
    const col = i % groups;
    return { ...t, group: LETTERS[row % 2 ? groups - 1 - col : col] };
  });
}

// Standard bracket order, so the top two seeds can only meet in the final.
export function seedOrder(size) {
  let o = [1];
  while (o.length < size) { const n = o.length * 2; o = o.flatMap((s) => [s, n + 1 - s]); }
  return o;
}

const roundName = (matches, i, third) => {
  if (third) return "Third place";
  if (matches === 1) return "Final";
  const base = matches === 2 ? "Semi-final" : matches === 4 ? "Quarter-final" : `Round of ${matches * 2}`;
  return `${base} ${i + 1}`;
};

// The bracket as rounds of { home, away, stage }. qualifiers are labels or team ids in seed
// order. When the field isn't a power of two the top seeds get byes, and the first round's
// games are called "Round 1 game n" because they aren't a full round.
export function bracket(qualifiers, thirdPlace = false) {
  let size = 2;
  while (size < qualifiers.length) size *= 2;
  let entrants = seedOrder(size).map((s) => (s <= qualifiers.length ? qualifiers[s - 1] : null));
  const rounds = [];
  while (entrants.length > 1) {
    const pairs = [];
    for (let i = 0; i < entrants.length; i += 2) pairs.push([entrants[i], entrants[i + 1]]);
    const byes = pairs.some(([h, a]) => h == null || a == null);
    const round = [], next = [];
    pairs.forEach(([home, away]) => {
      if (home == null || away == null) { next.push(home ?? away); return; }
      const stage = byes ? `Round 1 game ${round.length + 1}` : roundName(pairs.length, round.length);
      round.push({ home, away, stage });
      next.push(`Winner ${stage}`);
    });
    rounds.push(round);
    entrants = next;
  }
  if (thirdPlace && rounds.length >= 2) {
    const semis = rounds[rounds.length - 2];
    if (semis.length === 2) rounds[rounds.length - 1].unshift({ home: `Loser ${semis[0].stage}`, away: `Loser ${semis[1].stage}`, stage: "Third place" });
  }
  return rounds;
}

export function generate(o) {
  const errors = checkOptions(o);
  if (errors.length) return { ok: false, errors };
  const division = o.division || "main";
  const pitches = o.pitches;
  const refs = o.refs || [];
  const minRest = o.minRest ?? 1;
  const slotMins = o.gameMins + (o.gapMins ?? 0);
  const prefix = o.idPrefix || "M";

  let teams = o.teams.map((t) => ({ ...t }));
  const groupList = [];
  if (o.format === "groups-knockout") {
    teams = snakeGroups(teams, o.groups ?? 2);
    if ((o.groups ?? 2) === 1) teams.forEach((t) => delete t.group);
  } else teams.forEach((t) => delete t.group);
  if (o.format === "groups-knockout" && (o.groups ?? 2) > 1) {
    for (let g = 0; g < (o.groups ?? 2); g++) groupList.push({ letter: LETTERS[g], ids: teams.filter((t) => t.group === LETTERS[g]).map((t) => t.id) });
  } else if (o.format !== "knockout") groupList.push({ letter: null, ids: teams.map((t) => t.id) });

  // Group-stage pairings, interleaved: round 1 of every group, then round 2, alternating groups.
  const queue = [];
  const legs = o.format === "league" ? o.legs ?? 1 : 1;
  const perGroup = groupList.map((g) => roundRobin(g.ids));
  const maxRounds = Math.max(0, ...perGroup.map((r) => r.length));
  for (let leg = 0; leg < legs; leg++) {
    for (let r = 0; r < maxRounds; r++) {
      const lists = perGroup.map((rounds, gi) => (rounds[r] || []).map((p) => ({ home: leg ? p[1] : p[0], away: leg ? p[0] : p[1], group: groupList[gi].letter, round: leg * maxRounds + r })));
      const longest = Math.max(0, ...lists.map((l) => l.length));
      for (let i = 0; i < longest; i++) lists.forEach((l) => l[i] && queue.push(l[i]));
    }
  }

  const fixtures = [];
  const last = {}; // team -> last slot played
  let n = 0;
  const id = () => `${prefix}${String(++n).padStart(2, "0")}`;
  const timeOf = (slot) => addMins(o.start, slot * slotMins);
  let refTurn = 0;
  const refFor = (pitchIndex) => {
    if (!refs.length) return null;
    if ((o.refMode || "pitch") === "pitch" && refs.length >= pitches.length) return refs[pitchIndex % refs.length];
    return refs[refTurn++ % refs.length];
  };
  const rested = (t, slot) => last[t] === undefined || slot - last[t] - 1 >= minRest;

  let slot = 0, lastGroup = null;
  const pending = queue.slice();
  while (pending.length && slot < 5000) {
    const busy = new Set();
    for (let p = 0; p < pitches.length; p++) {
      const ok = pending.filter((m) => !busy.has(m.home) && !busy.has(m.away) && rested(m.home, slot) && rested(m.away, slot));
      if (!ok.length) break;
      const wait = (m) => Math.min(last[m.home] ?? -99, last[m.away] ?? -99);
      ok.sort((a, b) => a.round - b.round || (a.group === lastGroup) - (b.group === lastGroup) || wait(a) - wait(b) || pending.indexOf(a) - pending.indexOf(b));
      const m = ok[0];
      pending.splice(pending.indexOf(m), 1);
      busy.add(m.home); busy.add(m.away);
      last[m.home] = last[m.away] = slot;
      lastGroup = m.group;
      fixtures.push({ id: id(), division, time: timeOf(slot), pitch: pitches[p], ref: refFor(p), home: m.home, away: m.away, homeScore: null, awayScore: null, state: "scheduled" });
    }
    slot++;
  }
  // Knockouts: each round starts once the round before is over and its teams have rested.
  let qualifiers = null;
  if (o.format === "knockout") qualifiers = teams.map((t) => t.id);
  else if (o.format === "groups-knockout") {
    const g = o.groups ?? 2, a = o.advance ?? 2;
    qualifiers = [];
    for (let pos = 0; pos < a; pos++) for (let gi = 0; gi < g; gi++) qualifiers.push(g === 1 ? `${ORD[pos]} in table` : `${ORD[pos]} Group ${LETTERS[gi]}`);
  }
  if (qualifiers) {
    let cursor = fixtures.length ? slot + minRest : 0;
    bracket(qualifiers, !!o.thirdPlace).forEach((round) => {
      let p = 0, s = cursor;
      round.forEach((m) => {
        if (p === pitches.length) { p = 0; s++; }
        fixtures.push({ id: koId(m.stage), division, stage: m.stage, time: timeOf(s), pitch: pitches[p], ref: refFor(p), home: m.home, away: m.away, homeScore: null, awayScore: null, state: "scheduled" });
        p++;
      });
      cursor = s + 1 + minRest;
    });
  }

  const endSlot = fixtures.length ? Math.max(...fixtures.map((f) => slotOf(f.time, o.start, slotMins))) + 1 : 0;
  const counts = {};
  fixtures.filter((f) => !f.stage).forEach((f) => { counts[f.home] = (counts[f.home] || 0) + 1; counts[f.away] = (counts[f.away] || 0) + 1; });
  const per = Object.values(counts);
  return {
    ok: true,
    teams,
    fixtures,
    summary: {
      games: fixtures.length,
      groupGames: fixtures.filter((f) => !f.stage).length,
      knockoutGames: fixtures.filter((f) => f.stage).length,
      perTeam: per.length ? { min: Math.min(...per), max: Math.max(...per) } : { min: 0, max: 0 },
      ends: addMins(o.start, endSlot * slotMins - (o.gapMins ?? 0)),
    },
  };
}

// Short ids for knockout games: SF1, QF3, R16-2, R1-1, 3P, F.
function koId(stage) {
  if (stage === "Final") return "F";
  if (stage === "Third place") return "3P";
  return stage.replace(/^Semi-final /, "SF").replace(/^Quarter-final /, "QF").replace(/^Round of (\d+) /, "R$1-").replace(/^Round 1 game /, "R1-");
}

function slotOf(time, start, slotMins) {
  const [h, m] = time.split(":").map(Number), [sh, sm] = start.split(":").map(Number);
  return Math.round(((h * 60 + m - (sh * 60 + sm) + 1440) % 1440) / slotMins);
}
