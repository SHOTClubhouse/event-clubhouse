// Sign-in shared by the referee and coach pages: one big code box that tidies what is typed or
// pasted (upper case, with or without dashes), friendly errors, and the events this device
// already knows.

import { signIn } from "./api.js";
import { esc } from "./ui.js";

export const cleanCode = (raw) => String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
export const formatCode = (raw) => cleanCode(raw).replace(/(.{4})(?=.)/g, "$1-");

export function friendlyError(e) {
  if (e && e.status === 0) return "No signal. Check your connection and try again.";
  if (e && e.status === 429) return "Too many tries. Wait a few minutes, then try again.";
  if (e && e.status === 401) return "That code didn't work. Check it and try again. Codes use letters and the numbers 2 to 9.";
  return (e && e.message) || "Something went wrong. Try again.";
}

// Returns { session } or { error }.
export async function trySignIn(value) {
  const code = cleanCode(value);
  if (code.length < 12) return { error: `Codes have 12 characters. You have typed ${code.length}.` };
  try { return { session: await signIn(code) }; } catch (e) { return { error: friendlyError(e) }; }
}

const ROLE_TEXT = { referee: "Referee", judge: "Judge", coach: "Coach" };

// devices: [{ slug, role, label, event: { name } }], href(slug) builds the link for each.
export function signInHtml({ title, lede, value = "", error = "", busy = false, devices = [], href }) {
  const list = devices.length
    ? `<section class="ecr-devices" aria-labelledby="ecr-dev-h"><h2 id="ecr-dev-h" class="ec-label">On this phone</h2><ul class="ecr-devlist">${devices.map((d) => `<li><a class="ec-btn ec-btn--ghost ec-btn--block ecr-devlink" href="${esc(href(d.slug))}"><span>${esc(d.event ? d.event.name : d.slug)}</span><span class="ec-dim ec-small">${esc(ROLE_TEXT[d.role] || d.role)}</span></a></li>`).join("")}</ul></section>`
    : "";
  return `<div class="ecr-signin ec-narrow">
    <p class="ec-kicker">SHOT Event Clubhouse</p>
    <h1 class="ec-d2">${esc(title)}</h1>
    <p class="ec-lede">${esc(lede)}</p>
    <form class="ec-card ecr-form" data-form="signin" novalidate>
      <div class="ec-field">
        <label for="ecr-code">Your code</label>
        <input id="ecr-code" class="ec-input ecr-code" name="code" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go" placeholder="ABCD-EFGH-JKMN" value="${esc(formatCode(value))}" maxlength="16" aria-describedby="ecr-code-help${error ? " ecr-code-err" : ""}"${error ? ' aria-invalid="true"' : ""} data-f="code">
        <p id="ecr-code-help" class="ec-help">Type it or paste it. Dashes are optional. This phone remembers it.</p>
        ${error ? `<p id="ecr-code-err" class="ec-error" role="alert">${esc(error)}</p>` : ""}
      </div>
      <button class="ec-btn ec-btn--big ec-btn--block" type="submit"${busy ? " disabled" : ""} data-f="signin">${busy ? "Signing in…" : "Sign in"}</button>
    </form>
    ${list}
  </div>`;
}
