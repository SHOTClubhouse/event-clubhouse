// What each role is shown. The document holds everything; these functions decide what leaves the
// server. doc.private belongs to the server (demo bookkeeping, simulation state) and never
// leaves at all.

import { publicView, firstName } from "../public/core/model.js";

export const withoutPrivate = (doc) => { const d = { ...doc }; delete d.private; return d; };

const findTeam = (doc, id) => {
  for (const v of doc.divisions) {
    const t = v.teams.find((x) => x.id === id);
    if (t) return { team: t, division: v.id };
  }
  return null;
};

// actor = { role, subject, label }. counts only for admin.
export function roleView(doc, rev, actor, counts) {
  if (actor.role === "admin") return { rev, event: withoutPrivate(doc), ...(counts ? { counts } : {}) };
  const event = publicView(doc);

  if (actor.role === "referee" || actor.role === "judge") {
    const official = doc.officials.find((o) => o.id === actor.subject);
    const me = { id: actor.subject, name: official ? official.name : actor.label, role: actor.role, pitch: official ? official.pitch ?? null : null };
    if (actor.role === "judge") {
      // a judge always sees the cards they have scored, even before the bout is decided
      Object.entries(doc.scorecards || {}).forEach(([bout, byJudge]) => {
        if (byJudge && byJudge[actor.subject]) event.scorecards[bout] = { ...(event.scorecards[bout] || {}), [actor.subject]: byJudge[actor.subject] };
      });
    }
    // Which rounds each judge has scored (never the scores), so the referee can see who is
    // still to score before announcing a points decision.
    const judging = {};
    (doc.card.bouts || []).filter((b) => b.scoring === 'judges').forEach((b) => {
      judging[b.id] = b.judges.map((j) => ({ judge: j, name: firstName((doc.officials.find((o) => o.id === j) || {}).name) || j, rounds: Object.keys(((doc.scorecards || {})[b.id] || {})[j] || {}).map(Number).sort((x, y) => x - y) }));
    });
    return { rev, event, me, judging };
  }

  // coach
  const found = findTeam(doc, actor.subject);
  return {
    rev,
    event,
    me: { teamId: actor.subject, division: found ? found.division : null },
    squad: found ? (found.team.players || []).map((p) => ({ id: p.id, number: p.number ?? null, name: p.name || "" })) : [],
  };
}
