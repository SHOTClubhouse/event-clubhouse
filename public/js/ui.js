// Small shared UI helpers. Everything that turns data into HTML escapes it with esc().

import { streamInfo } from "../core/model.js";
import { label as sideLabel } from "../core/standings.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// A short message over the bottom of the screen. kind: ok | warn | error
let toastTimer = null;
export function toast(msg, kind = "ok", ms = 2600) {
  let el = $(".ec-toast");
  if (!el) { el = document.createElement("div"); el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite"); document.body.appendChild(el); }
  el.className = `ec-toast ec-toast--${kind}`;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

// Applies an event's accent colour (and readable text on it) to the page.
export function applyTheme(event) {
  const a = event && event.theme && /^#[0-9a-f]{6}$/i.test(event.theme.accent) ? event.theme.accent : "#1abc9c";
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const light = (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
  document.documentElement.style.setProperty("--accent", a);
  document.documentElement.style.setProperty("--on-accent", light ? "#0a0c0e" : "#ffffff");
}

// A team or placeholder for one side of a game: { id, text, tbc }.
export function side(event, fixture, which) {
  const div = event.divisions.find((d) => d.id === fixture.division);
  if (!div) return { id: null, text: fixture[which], tbc: true };
  return sideLabel(div, event.fixtures, fixture[which], event.settings.points);
}

export const pitchName = (event, id) => ((event.pitches || []).find((p) => p.id === id) || {}).name || "";
export const officialName = (event, id) => ((event.officials || []).find((o) => o.id === id) || {}).name || "";

export function scoreText(f) {
  if (f.homeScore == null) return "v";
  return `${f.homeScore}-${f.awayScore}${f.pens ? " (p)" : ""}`;
}

// The player for a stream link: YouTube or Twitch embed, our own video player, or a button.
export function streamHtml(stream) {
  const s = streamInfo(stream);
  if (!s) return "";
  const title = esc(s.label || "Live stream");
  if (s.kind === "youtube") return `<div class="ec-video"><iframe src="https://www.youtube-nocookie.com/embed/${esc(s.id)}?autoplay=1&mute=1&playsinline=1" title="${title}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`;
  if (s.kind === "twitch") return `<div class="ec-video"><iframe src="https://player.twitch.tv/?channel=${esc(s.channel)}&parent=${esc(location.hostname)}&muted=true" title="${title}" allowfullscreen></iframe></div>`;
  if (s.kind === "video") return `<div class="ec-video"><video data-src="${esc(s.url)}" data-hls="${s.format === "hls" ? "1" : ""}" controls playsinline muted autoplay title="${title}"></video></div>`;
  return `<a class="ec-btn ec-btn--ghost" href="${esc(s.url)}" target="_blank" rel="noopener">Watch on ${esc(s.host)} &rarr;</a>`;
}

// Call after inserting streamHtml: starts direct video, loading hls.js only when a browser needs it.
export function startVideos(root = document) {
  $$("video[data-src]", root).forEach((v) => {
    const url = v.dataset.src;
    v.removeAttribute("data-src");
    if (v.dataset.hls && !v.canPlayType("application/vnd.apple.mpegurl")) {
      const go = () => { if (window.Hls && window.Hls.isSupported()) { const h = new window.Hls(); h.loadSource(url); h.attachMedia(v); } else v.src = url; };
      if (window.Hls) return go();
      const sc = document.createElement("script");
      sc.src = "https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.20/hls.min.js";
      sc.integrity = "sha384-V5ruNBgmYcC3SJRUQeNykAAAgde5gOFq/Hu0CZj7bygDP0yRIhkvX8+w0u/7mRvr"; sc.crossOrigin = "anonymous";
      sc.onload = go; sc.onerror = () => (v.src = url);
      document.head.appendChild(sc);
    } else v.src = url;
  });
}

// "13:10" in the event's local day, or a relative "in 5 min" when it's soon.
export function when(event, hhmm) { return hhmm || ""; }

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
