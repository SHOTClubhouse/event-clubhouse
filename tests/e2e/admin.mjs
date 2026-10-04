// Browser end-to-end for the organiser dashboard (/admin/).
//
//   npx wrangler dev --local --persist-to .wrangler/state-admin --port 8801 --inspector-port 9301 --test-scheduled
//   node tests/e2e/admin.mjs [http://127.0.0.1:8801]
//
// Needs the playwright package (project node_modules, or NODE_PATH) and SHOT_ADMIN (env or
// .dev.vars; defaults to dev-shot-admin). Creates its own organiser and events. Screenshots go to
// .screens/admin/. Prints PASS or FAIL per step and exits 1 on any failure.

import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const base = (process.argv[2] || "http://127.0.0.1:8801").replace(/\/$/, "");
const devVars = new URL("../../.dev.vars", import.meta.url);
const vars = existsSync(devVars) ? Object.fromEntries(readFileSync(devVars, "utf8").split(/\r?\n/).map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]])) : {};
const SHOT_ADMIN = process.env.SHOT_ADMIN || vars.SHOT_ADMIN || "dev-shot-admin";
const stamp = Date.now().toString(36);
const ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
const SHOTS = fileURLToPath(new URL("../../.screens/admin/", import.meta.url));
mkdirSync(SHOTS, { recursive: true });

const results = [];
async function step(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (e) { await page.screenshot({ path: `${SHOTS}fail-${results.length}.png`, fullPage: true }).catch(() => {}); const note = String(e && e.message ? e.message : e).split("\n")[0].slice(0, 260); results.push({ name, ok: false, note }); console.log(`FAIL ${name}: ${note}`); }
}
const api = async (method, path, body, headers = {}) => {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip, ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const adminToken = async (code) => `Bearer ${(await api("POST", "/api/auth", { code })).data.token}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error" && !/fonts\.(googleapis|gstatic)|ERR_(NAME|INTERNET|CONNECTION)|Failed to load resource/i.test(m.text())) consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

const mobile = () => page.viewportSize().width < 900;
const noOverflow = async (label) => {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(o.sw <= o.iw + 1, `${label}: horizontal overflow (${o.sw} > ${o.iw})`);
};
const shot = (name) => page.screenshot({ path: `${SHOTS}${name}.png`, fullPage: true });
async function tab(name) {
  if (mobile()) await page.locator(".ecx-menu-btn").click();
  await page.locator(".ecx-tab", { hasText: new RegExp(`^${name}$`) }).click();
  await page.waitForFunction((n) => document.querySelector("#panel-title")?.textContent === n, name);
}
const toast = async (text) => {
  await page.locator(".ec-toast", { hasText: text }).waitFor({ state: "visible", timeout: 8000 });
  await page.waitForFunction(() => !document.querySelector('#main[aria-busy="true"]'), null, { timeout: 8000 }); // the save has been drawn
};
const SECTIONS = {
  football: ["Overview", "Details", "Teams", "Pitches and officials", "Fixtures", "Access codes", "Live control", "After"],
  boxing: ["Overview", "Details", "Fight card", "Judges and referees", "Access codes", "Live control", "After"],
};
const slugOf = () => new URL(page.url()).searchParams.get("e");
async function sweep(prefix, sport) {
  for (const s of SECTIONS[sport]) {
    await tab(s);
    await page.waitForTimeout(400);
    await noOverflow(`${prefix} ${s} at ${page.viewportSize().width}`);
    await shot(`${prefix}-${s.toLowerCase().replace(/[^a-z]+/g, "-")}`);
  }
}

let key, adminCode, refCode, coachCode, football, boxing, fanEmail;

await step("organiser key is issued", async () => {
  const r = await api("POST", "/api/shot/organisers", { name: `E2E Organiser ${stamp}` }, { "X-Shot-Admin": SHOT_ADMIN });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  key = r.data.key;
});

await step("sign-in screen: a wrong code says so", async () => {
  await page.goto(`${base}/admin/`);
  await page.waitForSelector("#page-title");
  await noOverflow("sign-in");
  await shot("signin-desktop");
  await page.getByLabel("Event admin code").fill("AAAA-BBBB-CCCC");
  await page.getByRole("button", { name: "Open the dashboard" }).click();
  await page.locator(".ecx-msg:not([hidden])").first().waitFor();
  assert.match(await page.locator(".ecx-msg:not([hidden])").first().innerText(), /didn't work/i);
});

await step("organiser signs in and creates a football event; admin code shown once", async () => {
  await page.getByLabel("Organiser key", { exact: true }).fill(key);
  await page.getByRole("button", { name: "Sign in as organiser" }).click();
  await page.getByRole("heading", { name: "Create an event" }).waitFor();
  await page.getByLabel("Event name").fill(`E2E Cup ${stamp}`);
  await page.getByLabel("Sport").selectOption("football");
  await page.getByLabel(/^Date/).fill("2026-11-14");
  await page.getByRole("button", { name: "Create event" }).click();
  await page.locator(".ecx-code").waitFor();
  adminCode = (await page.locator(".ecx-code").innerText()).trim();
  assert.match(adminCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.match(await page.locator(".ecx-warn").innerText(), /only show it once/i);
  await shot("created-code");
  await page.locator(".ecx-reveal").getByRole("button", { name: "Open the dashboard" }).click();
  await page.waitForSelector("#panel-title");
  football = slugOf();
  assert.ok(football);
});

await step("my events lists the new event", async () => {
  await page.goto(`${base}/admin/`);
  await page.getByRole("heading", { name: "My events" }).waitFor();
  await page.evaluate(() => localStorage.removeItem("ec.sessions.v1")); // no admin code on this device
  await page.reload();
  const row = page.locator(".ecx-list__row", { hasText: `E2E Cup ${stamp}` }).first();
  await row.waitFor();
  await row.getByRole("button", { name: /^Open/ }).click(); // one tap, no code
  await page.waitForSelector("#panel-title");
  assert.equal(slugOf(), (await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("ec.sessions.v1"))))).find((k) => k.startsWith("e2e-cup")));
  await page.goto(`${base}/admin/?e=${football}`);
  await page.waitForSelector("#panel-title");
});

await step("details: set venue, about, partner, colour; preview updates; saved on the server", async () => {
  await tab("Details");
  await page.getByLabel("Venue").fill("Riverside Sports Ground");
  await page.getByLabel("About").fill("Eight teams, two pitches, one trophy.");
  await page.getByLabel("Partner name").fill("Riverside Council");
  await page.locator("#accent-hex").fill("#ff5500");
  assert.match(await page.locator(".ecx-preview").innerText(), /Riverside Council × SHOT/i);
  assert.equal(await page.locator(".ecx-preview").evaluate((e) => e.style.getPropertyValue("--accent")), "#ff5500");
  await page.getByLabel("Vote lock (seconds)").fill("90");
  await page.getByRole("button", { name: "Save details" }).click();
  await toast("Details saved");
  const full = (await api("GET", `/api/events/${football}/full`, null, { Authorization: await adminToken(adminCode) })).data;
  assert.equal(full.event.venue, "Riverside Sports Ground");
  assert.equal(full.event.theme.accent, "#ff5500");
  assert.equal(full.event.settings.lockSecs, 90);
  await shot("details-desktop");
});

await step("details: a bad value gives a specific message", async () => {
  await tab("Details");
  await page.getByLabel("Logo link (https)").fill("http://not-secure.example/logo.png");
  await page.getByRole("button", { name: "Save details" }).click();
  await page.locator(".ecx-msg:not([hidden])").waitFor();
  assert.match(await page.locator(".ecx-msg:not([hidden])").innerText(), /Logo link: an https link/);
  await page.getByRole("button", { name: "Undo changes" }).click();
});

await step("teams: paste 8 teams, add a squad by paste", async () => {
  await tab("Teams");
  await page.getByLabel(/^Add teams to/).fill(["Ely Rovers", "Town Juniors", "Park United", "Mill Lane", "Cathedral City", "Fen Rangers", "Isle Athletic", "Soham Stars"].join("\n"));
  await page.getByRole("button", { name: "Add teams" }).click();
  await toast("8 teams added");
  assert.equal(await page.locator('input[aria-label^="Name of team"]').count(), 8);
  await page.getByRole("button", { name: /^Open the squad for Ely Rovers/ }).click();
  await page.getByLabel("Paste players for Ely Rovers").fill("7 Sam Smith\n9 Alex Jones\n#10 Priya Patel\nJamie Cole");
  await page.getByRole("button", { name: "Add these players" }).click();
  await toast("4 players added to Ely Rovers");
  await page.getByRole("button", { name: /Close the squad for Ely Rovers, 4 players/ }).waitFor();
  assert.equal(await page.locator(".ecx-squad__row").count(), 4);
});

await step("teams: a repeated shirt number is refused in plain words", async () => {
  await page.getByLabel("Paste players for Ely Rovers").fill("7 Someone Else");
  await page.getByRole("button", { name: "Add these players" }).click();
  await page.locator(".ecx-squad .ecx-msg:not([hidden])").waitFor();
  assert.match(await page.locator(".ecx-squad .ecx-msg:not([hidden])").innerText(), /Shirt number 7 is used twice/);
  await shot("teams-desktop");
});

await step("pitches and officials: 2 pitches, 2 referees with a pitch each", async () => {
  await tab("Pitches and officials");
  await page.getByLabel("Add pitches").fill("Pitch 2");
  await page.getByRole("button", { name: "Add pitches" }).click();
  await toast("1 pitch added");
  await page.getByLabel("Add referees").fill("Jordan Hale\nMina Okafor");
  await page.getByRole("button", { name: "Add referees" }).click();
  await toast("2 referees added");
  await page.getByLabel("Pitch for Jordan Hale").selectOption({ label: "Pitch 1" });
  await toast("Pitch saved");
  await page.getByLabel("Pitch for Mina Okafor").selectOption({ label: "Pitch 2" });
  await toast("Pitch saved");
  assert.equal(await page.locator('input[aria-label^="Name of Pitch"]').count(), 2);
  await shot("officials-desktop");
});

await step("fixtures: generator explains errors, then groups into knockouts applies", async () => {
  await tab("Fixtures");
  await page.getByLabel("Groups", { exact: true }).fill("3");
  await page.locator(".ecx-errors").waitFor();
  assert.match(await page.locator(".ecx-errors").innerText(), /3 groups with 2 through makes 6 teams/);
  await page.getByLabel("Groups", { exact: true }).fill("2");
  await page.locator(".ecx-tt").waitFor();
  assert.ok((await page.locator(".ecx-tt__game").count()) >= 15);
  assert.match(await page.locator(".ecx-sumrow").innerText(), /15\s*games/i);
  await shot("fixtures-generator-desktop");
  await page.getByRole("button", { name: /^Use this schedule/ }).click();
  await toast("Schedule saved: 15 games");
  await page.waitForSelector(".ecx-game");
  assert.equal(await page.locator(".ecx-game").count(), 15);
  await shot("fixtures-games-desktop");
});

await step("fixtures: edit a game inline and override a score", async () => {
  await page.locator(".ecx-game").first().locator('select[aria-label^="Pitch for game"]').selectOption({ label: "Pitch 2" });
  await toast("Pitch saved");
  const f = page.locator(".ecx-game").first();
  await f.locator('input[aria-label^="Home score"]').fill("3");
  await f.locator('input[aria-label^="Away score"]').fill("1");
  await f.locator('select[aria-label^="Status"]').selectOption("ft");
  await f.getByRole("button", { name: "Save score" }).click();
  await toast("Score saved");
  assert.match(await page.locator(".ecx-game").first().innerText(), /Full time/);
});

await step("fixtures: replacing the schedule after games started is refused, and says so", async () => {
  await page.getByRole("button", { name: /^Make a schedule/ }).click();
  await page.getByText("Games in this division have started").waitFor();
  assert.ok(await page.getByRole("button", { name: /^Use this schedule/ }).isDisabled());
});

await step("access codes: referee and coach codes are shown once with a message", async () => {
  await tab("Access codes");
  await page.getByLabel("Role").selectOption("referee");
  await page.getByRole("button", { name: "Issue code" }).click();
  await page.locator(".ecx-reveal .ecx-code").waitFor();
  refCode = (await page.locator(".ecx-reveal .ecx-code").first().innerText()).trim();
  assert.match(refCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.match(await page.locator(".ecx-msgtext").first().innerText(), /Your Event Clubhouse code for E2E Cup .*: [A-Z2-9-]+\. Open https:\/\/events\.shotclubhouse\.com\/ref\/ and enter it\. Keep it to yourself\./);
  await page.getByRole("button", { name: "I have saved these" }).click();
  await page.getByLabel("Role").selectOption("coach");
  await page.getByRole("button", { name: "Issue code" }).click();
  await page.locator(".ecx-reveal .ecx-code").waitFor();
  coachCode = (await page.locator(".ecx-reveal .ecx-code").first().innerText()).trim();
  assert.match(await page.locator(".ecx-msgtext").first().innerText(), /\/coach\//);
  await shot("codes-desktop");
  assert.ok((await page.locator(".ecx-code-row").count()) >= 3);
  assert.equal((await api("POST", "/api/auth", { code: refCode })).data.role, "referee");
  assert.equal((await api("POST", "/api/auth", { code: coachCode })).data.role, "coach");
});

await step("access codes: revoke asks first, then the code stops working", async () => {
  await page.getByRole("button", { name: "I have saved these" }).click();
  await page.getByRole("button", { name: /^Revoke the code for Jordan Hale/ }).click();
  await page.locator("dialog[open]").waitFor();
  await page.getByRole("button", { name: "Keep it" }).click();
  assert.equal((await api("POST", "/api/auth", { code: refCode })).status, 200);
  await page.getByRole("button", { name: /^Revoke the code for Jordan Hale/ }).click();
  await page.getByRole("button", { name: "Yes, revoke it" }).click();
  await toast("Code revoked");
  assert.equal((await api("POST", "/api/auth", { code: refCode })).status, 401);
});

await step("overview: switch to Live; checklist turns green; fan link and QR show", async () => {
  await tab("Overview");
  await page.locator(".ecx-phase").getByRole("button", { name: /^Live/ }).click();
  await toast("Event is now live");
  assert.equal(await page.locator(".ecx-phase").getByRole("button", { name: /^Live/ }).getAttribute("aria-pressed"), "true");
  await page.locator(".ecx-qr__img").waitFor({ timeout: 15000 });
  assert.ok((await page.locator(".ecx-check-item.is-done").count()) >= 4);
  await shot("overview-desktop");
});

await step("live control: vote on, stream verdicts, stream on, quick score", async () => {
  await tab("Live control");
  await page.getByRole("switch").click();
  await toast("Voting is on");
  await page.getByText("Fan voting is ON").waitFor();
  await page.getByLabel("Stream link").first().fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.match(await page.locator(".ecx-verdict").first().innerText(), /YouTube found, plays in the page/);
  await page.getByRole("button", { name: "Turn on" }).first().click();
  await toast("Stream turned on");
  await page.getByLabel("Stream link").nth(1).fill("https://app.veo.co/matches/abc123/");
  assert.match(await page.locator(".ecx-verdict").nth(1).innerText(), /Veo match page: shows as a button/);
  await page.getByRole("button", { name: /^All \(/ }).click();
  await page.getByRole("button", { name: /^Start:/ }).first().click();
  await toast("Game started");
  await page.locator(".ecx-lg.is-live").getByRole("button", { name: /^Add a goal for/ }).first().click();
  await toast("Score updated");
  await shot("live-desktop");
  const full = (await api("GET", `/api/events/${football}/full`, null, { Authorization: await adminToken(adminCode) })).data;
  assert.equal(full.event.settings.vote.open, true);
  assert.equal(full.event.stream.on, true);
  assert.ok(full.event.fixtures.some((f) => f.state === "live" && f.homeScore + f.awayScore === 1));
});

await step("after: registrations, update posted and removed, CSV export", async () => {
  fanEmail = `fan-${stamp}@example.com`;
  const r = await api("POST", `/api/events/${football}/register`, { firstName: "Casey", email: fanEmail, over13: true, consent: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  await tab("After");
  await page.getByLabel("Title").fill("Thanks for coming");
  await page.getByLabel("Message").fill("Results are up. See you at the next one.");
  await page.getByRole("button", { name: "Post update" }).click();
  await toast("Update posted");
  await page.getByRole("button", { name: "Refresh results and votes" }).click();
  await page.locator(".ecx-regs tbody tr").first().waitFor({ timeout: 10000 });
  assert.match(await page.locator(".ecx-regs").innerText(), /Casey/);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download CSV" }).click()]);
  assert.match(dl.suggestedFilename(), /registrations\.csv$/);
  assert.match(readFileSync(await dl.path(), "utf8"), new RegExp(fanEmail.replace(/[.+]/g, "\\$&")));
  await shot("after-desktop");
  await page.getByRole("button", { name: /^Remove the update Thanks/ }).click();
  await page.getByRole("button", { name: "Yes, remove" }).click();
  await toast("Update removed");
});

await step("a referee's score shows on the admin board within the poll", async () => {
  const adm = await adminToken(adminCode);
  const made = (await api("POST", `/api/events/${football}/codes`, { role: "referee", subject: "R2", label: "Late ref" }, { Authorization: adm })).data;
  const ref = (await api("POST", "/api/auth", { code: made.code })).data;
  const full = (await api("GET", `/api/events/${football}/full`, null, { Authorization: `Bearer ${ref.token}` })).data;
  const g = full.event.fixtures.find((f) => f.state === "scheduled");
  const r = await api("POST", `/api/events/${football}/ops`, { ops: [{ op: "fixture.score", id: g.id, home: 4, away: 4 }] }, { Authorization: `Bearer ${ref.token}` });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  await tab("Live control");
  await page.getByRole("button", { name: /^All \(/ }).click();
  await page.waitForFunction((t) => document.querySelector(".ecx-board")?.innerText.includes(t), "4–4", { timeout: 15000 });
});

await step("mobile 390x844: every football section fits, with the menu", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/admin/?e=${football}#overview`);
  await page.waitForSelector("#panel-title");
  assert.ok(await page.locator(".ecx-menu-btn").isVisible());
  assert.ok(!(await page.locator(".ecx-tabs").isVisible()));
  await sweep("m-football", "football");
  await tab("Fixtures");
  await page.getByRole("button", { name: /^Make a schedule/ }).click();
  await shot("m-football-fixtures-generator");
});

await step("boxing: create an event, add judges, build a 3-bout card, run a round", async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/admin/`);
  await page.getByRole("heading", { name: "My events" }).waitFor();
  await page.getByLabel("Event name").fill(`E2E Fight Night ${stamp}`);
  await page.getByLabel("Sport").selectOption("boxing");
  await page.getByRole("button", { name: "Create event" }).click();
  await page.locator(".ecx-code").waitFor();
  await page.locator(".ecx-reveal").getByRole("button", { name: "Open the dashboard" }).click();
  await page.waitForSelector("#panel-title");
  boxing = slugOf();
  assert.deepEqual(await page.locator(".ecx-tab").allInnerTexts(), SECTIONS.boxing);
  await tab("Judges and referees");
  await page.getByLabel("Add judges").fill("Judge Ahmed\nJudge Brooks\nJudge Clarke");
  await page.getByRole("button", { name: "Add judges" }).click();
  await toast("3 judges added");
  await page.getByLabel("Add referees").fill("Ref Dawson");
  await page.getByRole("button", { name: "Add referees" }).click();
  await toast("1 referee added");
  await tab("Fight card");
  const bouts = [["Danny Fox", "Ely BC", "Marcus Lane", "Fen Gym", "Welterweight"], ["Priya Shah", "Cam BC", "Leah Stone", "Town ABC", "Lightweight"], ["Tom Reid", "Soham BC", "Joe Park", "Isle ABC", "Heavyweight"]];
  for (const [i, b] of bouts.entries()) {
    const form = page.locator('section[aria-labelledby="h-addbout"]');
    await form.locator(".ecx-corner--red input").nth(0).fill(b[0]);
    await form.locator(".ecx-corner--red input").nth(1).fill(b[1]);
    await form.locator(".ecx-corner--blue input").nth(0).fill(b[2]);
    await form.locator(".ecx-corner--blue input").nth(1).fill(b[3]);
    await form.getByLabel("Weight").fill(b[4]);
    await form.getByRole("checkbox").nth(0).check();
    await form.getByRole("checkbox").nth(1).check();
    await form.getByRole("button", { name: "Add bout" }).click();
    await toast("Bout added");
    await page.waitForFunction((n) => document.querySelectorAll(".ecx-bout").length === n, i + 1);
  }
  assert.equal(await page.locator(".ecx-bout").count(), 3);
  await page.getByRole("button", { name: /^Move Priya Shah v Leah Stone up/ }).click();
  await toast("Order changed");
  await page.waitForFunction(() => /Priya Shah/.test(document.querySelector(".ecx-bout")?.textContent || ""));
  await page.locator(".ecx-bout").first().locator("details.ecx-day > summary").click();
  await page.getByRole("button", { name: /^Start bout/ }).first().click();
  await toast("Bout started");
  await page.getByRole("button", { name: /^End round 1/ }).first().click();
  await toast("Round 1 ended");
  await page.waitForFunction(() => /Break after round 1/.test(document.querySelector(".ecx-bout")?.textContent || ""));
  await shot("card-desktop");
});

await step("boxing at 390x844 and 1440x900: every section fits", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/admin/?e=${boxing}#overview`);
  await page.waitForSelector("#panel-title");
  await sweep("m-boxing", "boxing");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/admin/?e=${boxing}#overview`);
  await page.waitForSelector("#panel-title");
  await sweep("d-boxing", "boxing");
});

await step("demo: sign in to the beach soccer cup and see live games from the simulation", async () => {
  await page.evaluate(() => localStorage.removeItem("ec.sessions.v1"));
  await page.goto(`${base}/admin/`);
  await page.getByLabel("Event admin code").fill("BCHA-DMNW-X2K7");
  await page.getByRole("button", { name: "Open the dashboard" }).click();
  await page.waitForSelector("#panel-title");
  assert.equal(slugOf(), "beach-soccer-cup");
  fetch(`${base}/cdn-cgi/handler/scheduled?cron=*+*+*+*+*`).catch(() => {}); // wake the simulation
  await tab("Live control");
  await page.waitForFunction(() => /Live now \(([1-9]\d*)\)/.test(document.querySelector(".ec-seg")?.innerText || ""), null, { timeout: 90000 });
  assert.ok((await page.locator(".ecx-lg.is-live").count()) >= 1);
  await shot("demo-live-desktop");
  await tab("Access codes");
  assert.match(await page.locator(".ecx-notice").first().innerText(), /can't be revoked/);
  await tab("After");
  assert.ok(await page.getByRole("button", { name: "Reset demo" }).isVisible());
});

await step("sign out returns to sign-in and drops the session", async () => {
  await page.getByRole("button", { name: /^Sign out of/ }).click();
  await page.waitForSelector("#page-title");
  assert.ok(!(await page.evaluate(() => (JSON.parse(localStorage.getItem("ec.sessions.v1") || "{}"))["beach-soccer-cup"])));
});

await step("no console errors in the whole run", async () => { assert.deepEqual(consoleErrors, []); });

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed. Screenshots: .screens/admin/`);
process.exit(failed.length ? 1 : 0);
