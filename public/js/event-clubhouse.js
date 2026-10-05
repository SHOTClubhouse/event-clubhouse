// The Clubhouse tab on the fan page (docs/CLUBHOUSE.md): member card, tiers, culture, community
// and patches. Pure views from state to HTML, plus the patch progress that lives on the fan's own
// device. Nothing here is sent to the server.

import { esc } from "/js/ui.js";
import { fmtDate, registerCard } from "/js/event-views.js";
import { spotifyEmbed } from "/core/model.js";
import { loadMine } from "/js/event-vote.js";

const read = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: lasts the page */ } };

export const clubhouseOn = (ev) => !!(ev && ev.clubhouse && ev.clubhouse.on === true);
const isJuniors = (ev) => !!(ev.settings && ev.settings.juniors);
export const isMember = (reg) => !!reg && (reg.state === "ok" || reg.state === "demo" || reg.state === "already");

// ---- Patches: progress on this device ----
// { done: { register: ms, vote: ms, attend: ms }, told: [reward ids already announced] }
export const loadPatches = (slug) => read(`ece.patches.v1.${slug}`, { done: {}, told: [] });
const savePatches = (slug, p) => write(`ece.patches.v1.${slug}`, p);
export const LOCKED_HOWS = ["streak", "share"];

// Works out what this device has earned, saves it, and returns the rewards to announce once.
export function syncPatches(S, slug) {
  const ev = S.event;
  if (!ev) return [];
  const p = S.patches || (S.patches = loadPatches(slug));
  const now = Date.now();
  let changed = false;
  const earn = (how, yes) => { if (yes && !p.done[how]) { p.done[how] = now; changed = true; } };
  earn("register", isMember(S.reg));
  earn("vote", Object.keys(loadMine(slug)).length > 0); // saved only after the server took the vote
  earn("attend", ev.phase === "live");
  const rewards = clubhouseOn(ev) ? ev.clubhouse.rewards || [] : [];
  const fresh = rewards.filter((r) => p.done[r.how] && !p.told.includes(r.id) && !(r.how === "vote" && isJuniors(ev)));
  if (fresh.length) { p.told = [...p.told, ...fresh.map((r) => r.id)]; changed = true; }
  if (changed) savePatches(slug, p);
  return fresh;
}

// ---- Pieces ----
const sec = (id, title, body, extra = "") => `<section class="ece-sec ece-ch" aria-labelledby="ch-${id}"${extra}><h2 id="ch-${id}" class="ece-h">${esc(title)}</h2>${body}</section>`;

function memberCard(S) {
  const ev = S.event, th = ev.theme || {}, reg = S.reg;
  const member = isMember(reg);
  const brand = th.logo ? `<img class="ece-mcard__logo" src="${esc(th.logo)}" alt="${esc(th.partner || ev.name)} logo" height="40">` : `<span class="ece-mcard__brand">${esc(th.partner || ev.name)}</span>`;
  const since = member && reg.at ? `<p class="ece-mcard__since">Member since ${esc(new Date(reg.at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }))}</p>` : "";
  return `<div class="ece-mcard${member ? "" : " is-empty"}" data-member-card role="group" aria-label="Member card${member && reg.name ? `, ${esc(reg.name)}` : ""}">
    <div class="ece-mcard__top">${brand}<span class="ece-mcard__tag">Member preview</span></div>
    <p class="ece-mcard__name" data-member-name>${member ? esc(reg.name || "Member") : "Not joined yet"}</p>
    ${member ? since : `<p class="ece-mcard__since">Join to get your card.</p>`}
    <p class="ece-mcard__ev">${esc(ev.name)}</p>
  </div>`;
}

function joinBlock(S) {
  const ev = S.event;
  if (isMember(S.reg)) return "";
  if (ev.phase === "pre") return `<button type="button" class="ec-btn ec-btn--big ec-btn--block ece-joinbtn" data-go="home">Join the clubhouse</button><p class="ece-note">It takes a first name and an email. The form is on the Home tab.</p>`;
  return registerCard(S, { title: "Join the clubhouse", lede: "Add your name and email to get your member card and hear about the next one." });
}

function joinSection(S) {
  const ch = S.event.clubhouse;
  const members = ch.members > 0 ? `<p class="ece-members"><b>${esc(Number(ch.members).toLocaleString("en-GB"))}</b> members</p>` : "";
  return sec("join", isMember(S.reg) ? "Your member card" : "Join the clubhouse", `${memberCard(S)}${members}${joinBlock(S)}`);
}

function lineupSection(ch) {
  const rows = [...((ch.culture || {}).lineup || [])].sort((a, b) => String(a.time || "99:99").localeCompare(String(b.time || "99:99")));
  if (!rows.length) return "";
  return sec("lineup", "The line-up", `<ol class="ece-lineup">${rows.map((x) => `<li><span class="ece-lineup__t">${x.time ? esc(x.time) : "On the day"}</span><b>${esc(x.name)}</b><span class="ece-chipline">${esc(x.role)}</span></li>`).join("")}</ol>`);
}

function playlistSection(S) {
  const ch = S.event.clubhouse, src = spotifyEmbed((ch.culture || {}).playlist);
  if (!src) return "";
  return sec("music", "The playlist", `<div class="ece-spot"><iframe src="${esc(src)}" title="${esc(`Spotify player for the ${S.event.name} playlist`)}" width="100%" height="352" loading="lazy" allow="encrypted-media"></iframe></div><p class="ece-note">Plays inside this page. Press play on the player.</p>`);
}

function dropsSection(ch) {
  const rows = (ch.culture || {}).drops || [];
  if (!rows.length) return "";
  return sec("drops", "Drops", `<ul class="ece-drops">${rows.map((d) => `<li class="ece-card"><h3 class="ece-h3">${esc(d.when || "Soon")}</h3><b>${esc(d.title)}</b>${d.body ? `<p>${esc(d.body)}</p>` : ""}</li>`).join("")}</ul>`);
}

function tiersSection(ch) {
  const rows = ch.tiers || [];
  if (!rows.length) return "";
  return sec("tiers", "Membership", `<ul class="ece-tiers">${rows.map((t) => `<li class="ece-card ece-tier"><h3 class="ece-tier__n">${esc(t.name)}</h3><p class="ece-tier__p">${t.price ? esc(t.price) : "Price set by you"}</p>${(t.benefits || []).length ? `<ul class="ece-tier__b">${t.benefits.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}</li>`).join("")}</ul>`);
}

function rewardsSection(S) {
  const ev = S.event, p = S.patches || { done: {} };
  const rows = (ev.clubhouse.rewards || []).filter((r) => !(r.how === "vote" && isJuniors(ev)));
  if (!rows.length) return "";
  const badge = (r) => {
    const locked = LOCKED_HOWS.includes(r.how), on = !locked && !!p.done[r.how];
    const state = locked ? "Unlocks in the Clubhouse app" : on ? "Unlocked" : "Not yet";
    return `<li class="ece-patch ${on ? "is-on" : "is-off"}${locked ? " is-locked" : ""}" data-patch="${esc(r.id)}"><span class="ece-patch__art" aria-hidden="true"><svg viewBox="0 0 48 52" width="44" height="48" focusable="false"><path d="M24 2 44 12v18c0 11-8 18-20 20C12 48 4 41 4 30V12z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>${on ? '<path d="m15 27 7 7 12-14" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>' : '<path d="M17 24h14v10H17zM20 24v-4a4 4 0 0 1 8 0v4" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>'}</svg></span><span class="ece-patch__t"><b>${esc(r.name)}</b>${r.text ? `<span>${esc(r.text)}</span>` : ""}<em>${esc(state)}</em></span></li>`;
  };
  return sec("patches", "Patches", `<p class="ece-note">Patches are rewards for turning up. They are kept on this phone.</p><ul class="ece-patches">${rows.map(badge).join("")}</ul>`);
}

const KIND = { post: "Post", photo: "Photo", shoutout: "Shout-out" };
function postsSection(ch, phase) {
  const rows = (ch.community || {}).posts || [];
  const body = rows.length
    ? `<ul class="ece-posts">${rows.map((x) => `<li class="ece-card ece-post"><p class="ece-post__m"><b>${esc(x.who)}</b><span class="ece-chipline">${esc(KIND[x.kind] || "Post")}</span>${x.ago ? `<span class="ece-post__ago">${esc(x.ago)} ago</span>` : ""}</p><p class="ece-post__t">${esc(x.text)}</p></li>`).join("")}</ul>`
    : `<div class="ece-empty"><b>No posts yet</b><span>${phase === "post" ? "Posts from the community will show here." : "Posts will show here once the day is done."}</span></div>`;
  return sec("community", "The community", body);
}

function nextSection(ch, phase) {
  const rows = [...((ch.community || {}).next || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (!rows.length) return phase === "post" ? sec("next", "Next dates", `<div class="ece-empty"><b>No dates yet</b><span>The next one will show here when it is announced.</span></div>`) : "";
  return sec("next", "Next dates", `<ul class="ece-next">${rows.map((x) => `<li class="ece-card"><time datetime="${esc(x.date)}">${esc(fmtDate(x.date))}</time><b>${esc(x.title)}</b>${x.where ? `<span>${esc(x.where)}</span>` : ""}</li>`).join("")}</ul>`);
}

// Order by phase: before the day, join and the line-up first; on the day, patches and the
// playlist first; after the day, the community and the next dates first.
export const ORDER = {
  pre: ["join", "lineup", "tiers", "music", "drops", "patches", "community", "next"],
  live: ["patches", "music", "join", "lineup", "drops", "tiers", "community", "next"],
  post: ["community", "next", "join", "music", "patches", "drops", "tiers", "lineup"],
};

export function clubhouseView(S) {
  const ev = S.event, ch = ev.clubhouse;
  if (!clubhouseOn(ev)) return `<div class="ece-empty"><b>The clubhouse is not open yet</b><span>The organiser has not switched it on.</span></div>`;
  const parts = {
    join: () => joinSection(S), lineup: () => lineupSection(ch), tiers: () => tiersSection(ch), music: () => playlistSection(S),
    drops: () => dropsSection(ch), patches: () => rewardsSection(S), community: () => postsSection(ch, ev.phase), next: () => nextSection(ch, ev.phase),
  };
  const order = ORDER[ev.phase] || ORDER.pre;
  return `<section class="ece-sec ece-chhead"><p class="ec-kicker">${ev.phase === "pre" ? "Before the day" : ev.phase === "live" ? "On the day" : "After the day"}</p>${ch.intro ? `<p class="ece-about">${esc(ch.intro)}</p>` : ""}</section>
    ${order.map((k) => parts[k]()).join("")}
    <p class="ece-note ece-center ece-chfoot">A preview of your event's clubhouse in the SHOT Clubhouse app.</p>`;
}
