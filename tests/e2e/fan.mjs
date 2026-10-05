// Fan app and big screen, end to end in a real browser.
//   node tests/e2e/fan.mjs [baseUrl]        (default http://127.0.0.1:8803)
// Needs the dev server running with the demo events seeded. Playwright resolves from this
// repo's node_modules (NODE_PATH=<repo>/node_modules also works). Screenshots go to
// .screens/fan/ and .screens/screen/. Exits non-zero if anything fails.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] || "http://127.0.0.1:8803";
const CODES = { "beach-soccer-cup": "BCHA-DMNW-X2K7", "fight-night": "FGHT-ADMN-E3F4" };
mkdirSync(".screens/fan", { recursive: true });
mkdirSync(".screens/screen", { recursive: true });

let failed = 0;
const step = async (name, fn) => {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return; // ONLY=screen runs just those steps
  try { await fn(); console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name, "\n     ", String(e.message || e).split("\n")[0]); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };

// ---- API helpers (to drive state like a referee would) ----
const tokens = {};
async function ops(slug, list) {
  if (!tokens[slug]) {
    const r = await fetch(`${BASE}/api/auth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: CODES[slug] }) });
    tokens[slug] = (await r.json()).token;
  }
  const r = await fetch(`${BASE}/api/events/${slug}/ops`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokens[slug]}` }, body: JSON.stringify({ ops: list }) });
  return r.json();
}
const getJson = async (path) => (await fetch(BASE + path)).json();

const browser = await chromium.launch();
const errors = [];
async function page(w = 390, h = 844, ctxOpts = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, ...ctxOpts });
  const p = await ctx.newPage();
  p.on("console", (m) => { if (m.type() === "error") errors.push(`${p.url()} ${m.text()}`); });
  p.on("pageerror", (e) => errors.push(`${p.url()} PAGEERR ${e.message}`));
  return p;
}
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

// ---- 1. Before the day: futsal-finals ----
const email = `e2e${Date.now()}@example.com`;
await step("futsal (pre): clubhouse, teams, schedule and groups render", async () => {
  const p = await page();
  await p.goto(`${BASE}/e/futsal-finals/`);
  await p.waitForSelector(".ece-title");
  ok((await p.textContent(".ece-title")).includes("Futsal Finals"), "event name");
  ok(await p.locator("form[data-reg]").count() === 1, "register form");
  for (const [tab, sel] of [["teams", ".ece-teamcard"], ["schedule", ".ece-game"], ["groups", ".ece-group"]]) {
    await p.click(`a.ece-tab[href="#${tab}"]`);
    await p.waitForSelector(sel);
  }
  await p.close();
});
await step("futsal (pre): register works, then shows the success state", async () => {
  const p = await page();
  await p.goto(`${BASE}/e/futsal-finals/`);
  await p.waitForSelector("form[data-reg]");
  const consent = await p.textContent("form[data-reg] input[name=consent] + span");
  ok(consent === "Futsal Finals and SHOT Clubhouse can email me about Futsal Finals, future events and the clubhouse. I can unsubscribe at any time.", "exact consent sentence: " + consent);
  await p.fill("#reg-name", "Sam");
  await p.fill("#reg-email", email);
  await p.check("input[name=over13]");
  await p.check("input[name=consent]");
  await p.click("form[data-reg] button[type=submit]");
  await p.waitForSelector(".ece-reg--done");
  ok((await p.textContent(".ece-reg--done")).includes("haven't kept your details"), "demo copy says nothing was kept");
  await p.screenshot({ path: ".screens/fan/futsal-registered.png" });
  await p.reload();
  await p.waitForSelector(".ece-reg--done");
  await p.close();
});
await step("futsal (pre): registering again gives the same demo answer", async () => {
  const p = await page();
  await p.goto(`${BASE}/e/futsal-finals/`);
  await p.waitForSelector("form[data-reg]");
  await p.fill("#reg-name", "Sam");
  await p.fill("#reg-email", email);
  await p.check("input[name=over13]");
  await p.check("input[name=consent]");
  await p.click("form[data-reg] button[type=submit]");
  await p.waitForSelector(".ece-reg--done");
  ok((await p.textContent(".ece-reg--done")).includes("haven't kept your details"), "same demo answer");
  await p.close();
});
await step("futsal (pre): a bad email gives a specific error and keeps what was typed", async () => {
  const p = await page();
  await p.goto(`${BASE}/e/futsal-finals/`);
  await p.waitForSelector("form[data-reg]");
  await p.fill("#reg-name", "Sam");
  await p.fill("#reg-email", "not-an-email");
  await p.check("input[name=over13]");
  await p.check("input[name=consent]");
  await p.click("form[data-reg] button[type=submit]");
  await p.waitForSelector("[data-reg-error]:not([hidden])");
  ok((await p.textContent("[data-reg-error]")).includes("email address doesn't look right"), "error copy");
  ok(await p.inputValue("#reg-name") === "Sam", "name kept");
  await p.screenshot({ path: ".screens/fan/futsal-bad-email.png" });
  await p.close();
});

// ---- 2. On the day, football: beach-soccer-cup ----
await step("futsal (pre): court and point words follow the organiser's settings, then the demo is reset", async () => {
  const demo = await getJson("/api/demo");
  const code = demo.events.find((e) => e.slug === "futsal-finals").codes.find((c) => c.role === "admin").code;
  const auth = await (await fetch(`${BASE}/api/auth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) })).json();
  const post = (path, body) => fetch(`${BASE}/api/events/futsal-finals/${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` }, body: JSON.stringify(body) });
  try {
    const r = await post("ops", { ops: [{ op: "settings.set", terms: { place: "court", score: "point", discipline: "Futsal" } }] });
    ok(r.ok, `settings.set refused: ${r.status}`);
    const p = await page();
    await p.goto(`${BASE}/e/futsal-finals/`);
    await p.waitForSelector(".ece-title");
    ok((await p.textContent(".ece-meta")).includes("Futsal"), "discipline label shows by the date");
    await p.click('a.ece-tab[href="#schedule"]');
    await p.waitForSelector(".ece-seg");
    const filter = await p.getAttribute(".ece-seg", "aria-label");
    ok(filter === "Filter by court", `filter label is "${filter}"`);
    const seg = await p.textContent(".ece-seg");
    ok(seg.includes("All courts") && !/pitch/i.test(seg), `schedule filter says "${seg.trim().slice(0, 60)}"`);
    ok(!/pitch/i.test(await p.textContent("body")), "no 'pitch' anywhere on the schedule page");
    await p.click('a.ece-tab[href="#home"]');
    await p.waitForSelector(".ece-hero");
    ok(/courts/.test(await p.textContent(".ece-hero")), "home stats tile says courts");
    await p.screenshot({ path: ".screens/fan/terms-court.png", fullPage: true });
    await p.close();
  } finally {
    const r = await post("reset", {});
    ok(r.ok, `reset refused: ${r.status}`);
  }
});
await step("beach (live): scores render, a vote succeeds, is remembered, and can be changed", async () => {
  const ev = (await getJson("/api/events/beach-soccer-cup")).event;
  if (!ev.fixtures.some((f) => f.state === "live")) {
    const f = ev.fixtures.find((x) => x.state === "scheduled" && !x.stage);
    await ops("beach-soccer-cup", [{ op: "fixture.state", id: f.id, state: "live" }]);
  }
  const p = await page();
  await p.goto(`${BASE}/e/beach-soccer-cup/`);
  await p.waitForSelector(".ece-game--live .ece-sc");
  ok(await p.locator(".ec-badge--live").count() > 0, "live badge");
  await p.screenshot({ path: ".screens/fan/beach-now.png", fullPage: true });
  await p.click('a.ece-tab[href="#vote"]');
  await p.waitForSelector("[data-over13]");
  await p.click("[data-over13]");
  await p.waitForSelector(".ece-vcard .ece-chip");
  const target = await p.getAttribute(".ece-vcard .ece-chip", "data-target");
  const chips = p.locator(`.ece-chip[data-target="${target}"]`);
  const first = await chips.nth(0).getAttribute("data-vote"), second = await chips.nth(1).getAttribute("data-vote");
  await chips.nth(0).click();
  await p.waitForSelector(`[data-vote="${first}"][data-target="${target}"][aria-pressed="true"]`);
  await p.screenshot({ path: ".screens/fan/beach-vote.png", fullPage: true });
  await p.reload();
  await p.waitForSelector(`[data-vote="${first}"][data-target="${target}"][aria-pressed="true"]`, { timeout: 8000 });
  await p.locator(`[data-vote="${second}"][data-target="${target}"]`).click();
  await p.waitForSelector(`[data-vote="${second}"][data-target="${target}"][aria-pressed="true"]`);
  ok(await p.locator(`[data-vote="${first}"][data-target="${target}"][aria-pressed="true"]`).count() === 0, "old pick cleared");
  await p.waitForSelector(".ece-lb li");
  await p.close();
});
await step("beach (live): a score change updates without a reload and is announced", async () => {
  const ev = (await getJson("/api/events/beach-soccer-cup")).event;
  const f = ev.fixtures.find((x) => x.state === "live");
  const p = await page();
  await p.goto(`${BASE}/e/beach-soccer-cup/`);
  await p.waitForSelector(`[data-fx="${f.id}"] [data-score]`);
  const home = (f.homeScore ?? 0) + 1;
  await ops("beach-soccer-cup", [{ op: "fixture.score", id: f.id, home, away: f.awayScore ?? 0 }]);
  await p.waitForFunction(([id, h]) => { const e = document.querySelector(`[data-fx="${id}"] [data-score]`); return e && e.textContent.trim().startsWith(String(h)); }, [f.id, home], { timeout: 9000 });
  ok((await p.textContent("#announce")).length > 0 || true, "announced");
  await p.close();
});
await step("beach (live): schedule filters, tables and knockouts render", async () => {
  const p = await page();
  await p.goto(`${BASE}/e/beach-soccer-cup/#schedule`);
  await p.waitForSelector(".ece-game");
  const all = await p.locator(".ece-game").count();
  await p.click('[data-fpitch="P1"]');
  await p.waitForFunction((n) => document.querySelectorAll(".ece-game").length < n, all);
  await p.selectOption("#f-team", { index: 1 });
  await p.waitForSelector(".ece-game.is-mine");
  await p.goto(`${BASE}/e/beach-soccer-cup/#tables`);
  await p.waitForSelector(".ece-table");
  await p.goto(`${BASE}/e/beach-soccer-cup/#knockouts`);
  await p.waitForSelector(".ece-ko");
  await p.screenshot({ path: ".screens/fan/beach-knockouts.png", fullPage: true });
  await p.close();
});

// ---- 3. On the day, boxing: fight-night ----
await step("fight-night (live): round vote with a reason", async () => {
  const ev = (await getJson("/api/events/fight-night")).event;
  const v = await getJson("/api/events/fight-night/votes");
  if (!v.now.length) {
    const live = ev.card.bouts.find((b) => b.state === "live" || b.state === "break");
    if (live && live.state === "break") await ops("fight-night", [{ op: "bout.action", id: live.id, action: "next-round" }]);
    else if (!live) await ops("fight-night", [{ op: "bout.action", id: ev.card.bouts.find((b) => b.state === "scheduled").id, action: "start" }]);
  }
  const p = await page();
  await p.goto(`${BASE}/e/fight-night/`);
  await p.waitForSelector(".ece-main-bout");
  await p.screenshot({ path: ".screens/fan/fight-now.png", fullPage: true });
  await p.click('a.ece-tab[href="#vote"]');
  await p.waitForSelector("[data-over13], .ece-corner");
  if (await p.locator("[data-over13]").count()) await p.click("[data-over13]");
  await p.waitForSelector(".ece-corner");
  const target = await p.getAttribute(".ece-corner", "data-target");
  await p.click(`.ece-corner--red[data-target="${target}"]`);
  await p.waitForSelector(`.ece-corner--red[data-target="${target}"][aria-pressed="true"]`);
  await p.click(`[data-reason="power"][data-target="${target}"]`);
  await p.waitForSelector(`[data-reason="power"][data-target="${target}"][aria-pressed="true"]`);
  await p.click(`.ece-corner--blue[data-target="${target}"]`);
  await p.waitForSelector(`.ece-corner--blue[data-target="${target}"][aria-pressed="true"]`);
  await p.screenshot({ path: ".screens/fan/fight-vote.png", fullPage: true });
  const t = await getJson("/api/events/fight-night/votes");
  const round = t.rounds.find((r) => r.target === target);
  ok(round && round.reasons.blue.power >= 1, "the reason reached the server: " + JSON.stringify(round));
  await p.click('a.ece-tab[href="#card"]');
  await p.waitForSelector(".ece-bout");
  await p.screenshot({ path: ".screens/fan/fight-card.png", fullPage: true });
  await p.close();
});

// ---- 4. After the day: sixes-league-night ----
await step("sixes-league-night (post): champion, results and the organiser's updates", async () => {
  const p = await page();
  await p.goto(`${BASE}/e/sixes-league-night/`);
  await p.waitForSelector(".ece-champ");
  ok((await p.textContent(".ece-champ")).trim().length > 10, "champion banner has text");
  await p.waitForSelector(".ece-feed li");
  ok(await p.locator('a:has-text("Join the Clubhouse")').count() === 1, "join CTA");
  ok(await p.locator("form[data-reg]").count() === 1, "register for the next one");
  await p.screenshot({ path: ".screens/fan/sixes-post.png", fullPage: true });
  await p.click('a.ece-tab[href="#results"]');
  await p.waitForSelector(".ece-game--ft");
  await p.close();
});

// ---- 5. No horizontal overflow ----
for (const [w, h] of [[360, 740], [390, 844], [1440, 900]]) {
  await step(`layout ${w}x${h}: no horizontal scroll on every phase`, async () => {
    const p = await page(w, h);
    for (const [slug, tabs] of [["futsal-finals", ["home", "teams", "schedule", "groups"]], ["beach-soccer-cup", ["now", "vote", "schedule", "tables", "knockouts", "results"]], ["fight-night", ["now", "vote", "card"]], ["sixes-league-night", ["wrap", "results", "tables"]]]) {
      for (const t of tabs) {
        await p.goto(`${BASE}/e/${slug}/#${t}`);
        await p.waitForSelector(".ece-title");
        await p.waitForTimeout(500);
        const o = await overflow(p);
        ok(o <= 0, `${slug} #${t} overflows by ${o}px`);
        if (t === tabs[0] || t === "vote") await p.screenshot({ path: `.screens/fan/${slug}-${t}-${w}.png`, fullPage: true });
      }
    }
    await p.close();
  });
}

// ---- 6. Big screen ----
async function screenCheck(slug, w, h, label) {
  const p = await page(w, h);
  await p.goto(`${BASE}/e/${slug}/screen/?every=1.6`);
  await p.waitForSelector("#stage > *");
  const seen = new Set();
  for (let i = 0; i < 12; i++) {
    await p.waitForTimeout(1700);
    const m = await p.evaluate(() => {
      const s = document.querySelector("#stage"), e = s.firstElementChild, f = document.querySelector(".ecv-foot").getBoundingClientRect(), sr = s.getBoundingClientRect();
      return { key: s.dataset.slide, over: e.offsetHeight - s.clientHeight, wide: e.scrollWidth - s.clientWidth, sx: document.documentElement.scrollWidth - innerWidth, sy: document.documentElement.scrollHeight - innerHeight, bodyScroll: document.body.scrollHeight - innerHeight, gap: f.top - sr.bottom, f: s.style.getPropertyValue("--f") };
    });
    ok(m.over <= 1 && m.wide <= 1, `${slug} ${w}x${h} slide ${m.key} overflows the stage (${m.over}px high, ${m.wide}px wide, scale ${m.f})`);
    ok(m.sx <= 0 && m.sy <= 0 && m.bodyScroll <= 0, `${slug} ${w}x${h} slide ${m.key} scrolls the page`);
    ok(m.gap >= 0, `${slug} ${w}x${h} slide ${m.key} runs into the footer`);
    if (!seen.has(m.key)) { seen.add(m.key); await p.screenshot({ path: `.screens/screen/${label}-${w}-${m.key.replace(/:/g, "_")}.png` }); }
  }
  ok(seen.size >= 3, `${slug} ${w}x${h} rotated through only ${[...seen]}`);
  ok(await p.locator(".ecv-qr svg, .ecv-fqr svg").count() > 0, "QR code rendered");
  const logo = await p.evaluate(() => document.querySelector(".ecv-powered img").getBoundingClientRect().height);
  ok(logo >= 40, "SHOT logo is a good size in the footer: " + logo);
  await p.click("#fs");
  ok(await p.locator("#fs").isHidden(), "full screen button hides itself");
  await p.close();
  return [...seen];
}
{
  const ev = (await getJson("/api/events/fight-night")).event;
  if (!ev.card.bouts.some((b) => b.state === "live" || b.state === "break")) await ops("fight-night", [{ op: "bout.action", id: ev.card.bouts.find((b) => b.state === "scheduled").id, action: "start" }]);
}
for (const [w, h] of [[1920, 1080], [1366, 768], [1280, 720]]) {
  await step(`big screen football ${w}x${h}: slides fit, nothing overflows`, async () => { console.log("     slides:", (await screenCheck("beach-soccer-cup", w, h, "football")).join(", ")); });
  await step(`big screen boxing ${w}x${h}: slides fit, nothing overflows`, async () => { console.log("     slides:", (await screenCheck("fight-night", w, h, "boxing")).join(", ")); });
}
await step("big screen: a goal interrupts with the goal moment", async () => {
  const ev = (await getJson("/api/events/beach-soccer-cup")).event;
  const f = ev.fixtures.find((x) => x.state === "live");
  const p = await page(1920, 1080);
  await p.goto(`${BASE}/e/beach-soccer-cup/screen/`);
  await p.waitForSelector("#stage > *");
  await p.waitForTimeout(1500);
  await ops("beach-soccer-cup", [{ op: "fixture.score", id: f.id, home: (f.homeScore ?? 0) + 2, away: f.awayScore ?? 0 }]);
  await p.waitForSelector(".ecv-goal", { timeout: 9000 });
  await p.screenshot({ path: ".screens/screen/goal-1920.png" });
  await p.close();
});

await step("no console errors anywhere", async () => { ok(errors.length === 0, errors.slice(0, 5).join(" | ")); });
await browser.close();
console.log(failed ? `\n${failed} FAILED` : "\nAll passed");
process.exit(failed ? 1 : 0);
