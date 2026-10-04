// Fan voting: what is on the device (13+ confirmation, my votes), the vote screens and the
// lock countdown. Rules and targets come from the API (core/votes.js); nothing is decided here.

import { esc, side, pitchName } from "/js/ui.js";
import { leaderboard, splitBar, isFootball } from "/js/event-views.js";

const read = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: lasts the page */ } };

export const over13 = () => read("ece.over13.v1", false) === true;
export const setOver13 = () => write("ece.over13.v1", true);
export const loadMine = (slug) => read(`ece.votes.${slug}`, {});
export const saveMine = (slug, m) => write(`ece.votes.${slug}`, m);
export const loadFollow = (slug) => read(`ece.follow.${slug}`, null);
export const saveFollow = (slug, id) => write(`ece.follow.${slug}`, id);
export const loadReg = (slug) => read(`ece.reg.${slug}`, null);
export const saveReg = (slug, s) => write(`ece.reg.${slug}`, s);

export const clock = (secs) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
export const lockText = (leftMs) => (leftMs > 0 ? `Locks in ${clock(Math.ceil(leftMs / 1000))}` : "Locked");

const REASON_TEXT = { style: "Style", pressure: "Pressure", defence: "Defence", power: "Power" };

function gameVote(t, S) {
  const ev = S.event, f = ev.fixtures.find((x) => x.id === t.id);
  const mine = S.mine[t.target] || null;
  const h = f ? side(ev, f, "home").text : t.sides[0] && t.sides[0].team, a = f ? side(ev, f, "away").text : t.sides[1] && t.sides[1].team;
  const score = f && f.homeScore != null ? `${f.homeScore}-${f.awayScore}` : "v";
  const pick = mine ? t.sides.flatMap((s) => s.players.map((p) => ({ ...p, team: s.team }))).find((p) => p.choice === mine.choice) : null;
  return `<article class="ece-vcard" data-target="${esc(t.target)}">
    <header class="ece-vcard__top"><span>${t.state === "live" ? `<span class="ec-badge ec-badge--live">Live</span>` : `<span class="ec-badge ec-badge--ft">Full time</span>`}</span>
      <b class="ece-vcard__t">${esc(h)} <em>${esc(score)}</em> ${esc(a)}</b>
      <small>${[t.stage, f && f.pitch && ev.pitches.length > 1 ? pitchName(ev, f.pitch) : "", t.division && ev.divisions.length > 1 ? t.division : ""].filter(Boolean).map(esc).join(" &middot; ")}</small>
      <span class="ece-lockbadge" data-lock="${esc(t.target)}"></span></header>
    ${t.sides.map((s) => `<div class="ece-vside"><h3 class="ece-h3">${esc(s.team)}</h3>${s.players.length ? `<div class="ece-chips" role="group" aria-label="${esc(s.team)} players">${s.players.map((p) => `<button type="button" class="ece-chip" data-k="vc-${esc(p.choice)}" data-vote="${esc(p.choice)}" data-target="${esc(t.target)}" aria-pressed="${!!mine && mine.choice === p.choice}">${esc(p.label)}</button>`).join("")}</div>` : `<p class="ece-note">No squad listed for this team.</p>`}</div>`).join("")}
    <p class="ece-vstat" aria-live="polite">${pick ? `Your vote: <b>${esc(pick.label)}</b> for ${esc(pick.team)}. Tap another player to change it.` : "Tap a player to vote. One vote per game, and you can change it until it locks."}</p>
  </article>`;
}

function roundVote(t, S) {
  const ev = S.event, b = ev.card.bouts.find((x) => x.id === t.bout);
  const mine = S.mine[t.target] || null;
  const reason = (mine && mine.reason) || (S.pendingReason && S.pendingReason[t.target]) || null;
  const stats = (S.votes && S.votes.rounds || []).find((r) => r.target === t.target);
  const btn = (k, f) => `<button type="button" class="ece-corner ece-corner--${k}" data-k="vr-${esc(t.target)}-${k}" data-vote="${k}" data-target="${esc(t.target)}" aria-pressed="${!!mine && mine.choice === k}"><small>${k === "red" ? "Red corner" : "Blue corner"}</small><b>${esc(f.name)}</b>${f.club ? `<span>${esc(f.club)}</span>` : ""}<i class="ece-corner__tick">Your pick</i></button>`;
  return `<article class="ece-vcard ece-vcard--round" data-target="${esc(t.target)}">
    <header class="ece-vcard__top"><span>${t.state === "live" ? `<span class="ec-badge ec-badge--live">Live</span>` : `<span class="ec-badge ece-badge--break">Round over</span>`}</span>
      <b class="ece-vcard__t">${esc(b ? b.title || `Bout ${b.order}` : "Bout")}, round ${esc(t.round)}${b ? ` of ${esc(b.rounds)}` : ""}</b>
      <span class="ece-lockbadge" data-lock="${esc(t.target)}"></span></header>
    <p class="ece-q" id="q-${esc(t.target.replace(/:/g, "-"))}">Who won this round?</p>
    <div class="ece-corners" role="group" aria-labelledby="q-${esc(t.target.replace(/:/g, "-"))}">${btn("red", t.red)}${btn("blue", t.blue)}</div>
    <div class="ece-reasons" role="group" aria-label="Why? Optional">${t.reasons.map((r) => `<button type="button" class="ece-chip" data-k="vy-${esc(t.target)}-${esc(r)}" data-reason="${esc(r)}" data-target="${esc(t.target)}" aria-pressed="${reason === r}">${esc(REASON_TEXT[r] || r)}</button>`).join("")}</div>
    <p class="ece-vstat" aria-live="polite">${mine ? `Your vote: <b>${esc(mine.choice === "red" ? t.red.name : t.blue.name)}</b>${mine.reason ? `, for ${esc(REASON_TEXT[mine.reason] || mine.reason).toLowerCase()}` : ""}. You can change it until it locks.` : "Pick a boxer. Add a reason if you like."}</p>
    ${mine && stats ? `<div class="ece-fans"><h3 class="ece-h3">Fans so far</h3>${splitBar(stats, { red: t.red.name, blue: t.blue.name })}</div>` : ""}
  </article>`;
}

export function voteView(S) {
  const v = S.votes, ev = S.event;
  const gate = !over13() ? `<section class="ece-card ece-gate" aria-labelledby="gate-h"><h2 id="gate-h" class="ece-h">Voting is for ages 13 and over</h2><p>Confirm once on this phone and you can vote all day.</p><button type="button" class="ec-btn ec-btn--big ec-btn--block" data-over13>I'm 13 or over</button></section>` : "";
  let body;
  if (!v) body = `<div class="ec-skel" style="height:140px;border-radius:14px"></div>`;
  else if (!ev.settings.vote.open && !(v.now && v.now.length)) body = `<div class="ece-empty"><b>Voting is closed</b><span>Here is how the fans voted.</span></div>`;
  else if (!v.now.length) body = `<div class="ece-empty"><b>${isFootball(ev) ? "Voting opens when a game kicks off" : "Voting opens when the next round starts"}</b><span>This page updates by itself. Keep it open.</span></div>`;
  else body = over13() ? v.now.map((t) => (t.kind === "game" ? gameVote(t, S) : roundVote(t, S))).join("") : "";
  const intro = `<section class="ece-sec"><h2 class="ece-h">${isFootball(ev) ? "Player of the game" : "Vote for the round"}</h2>${gate}${body}</section>`;
  return intro + leaderboard(S);
}
