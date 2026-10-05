// Clubhouse surfaces and two-ring boxing, end to end, with screenshots to look at.
//   node tests/e2e/club.mjs [baseUrl]        (default http://127.0.0.1:8850)
// Needs the dev server with the seeded demos and SHOT_ADMIN (environment or .dev.vars). It makes
// its own organiser and a two-ring boxing event. Screenshots go to .screens/club/.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, existsSync } from "node:fs";

const BASE = (process.argv[2] || "http://127.0.0.1:8850").replace(/\/$/, "");
const devVars = new URL("../../.dev.vars", import.meta.url);
const vars = existsSync(devVars) ? Object.fromEntries(readFileSync(devVars, "utf8").split(/\r?\n/).map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]])) : {};
const SHOT_ADMIN = process.env.SHOT_ADMIN || vars.SHOT_ADMIN || "dev-shot-admin";
const ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
const SHOTS = ".screens/club";
mkdirSync(SHOTS, { recursive: true });

let failed = 0;
const step = async (name, fn) => { try { await fn(); console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name, "\n     ", String(e.message || e).split("\n")[0]); } };
const ok = (c, m) => { if (!c) throw new Error(m); };
const call = async (method, path, body, headers = {}) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip, ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
const errors = [];
async function page(w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on("console", (m) => { if (m.type() === "error" && !/fonts\.(googleapis|gstatic)|Failed to load resource|ERR_/i.test(m.text())) errors.push(`${p.url()} ${m.text()}`); });
  p.on("pageerror", (e) => errors.push(`${p.url()} PAGEERR ${e.message}`));
  return p;
}
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

// ---- The Clubhouse tab in each phase, at phone and desktop widths ----
for (const [w, h] of [[390, 844], [1600, 900]]) {
  for (const [phase, slug] of [["pre", "futsal-finals"], ["live", "beach-soccer-cup"], ["post", "sixes-league-night"]]) {
    await step(`clubhouse tab, ${phase}, ${w}px: opens from #clubhouse, no overflow`, async () => {
      const p = await page(w, h);
      await p.goto(`${BASE}/e/${slug}/#clubhouse`);
      await p.waitForSelector(".ece-ch");
      await p.waitForTimeout(700);
      ok(await overflow(p) <= 0, "horizontal overflow");
      ok(await p.locator(".ece-ch h2").count() >= 4, "sections render");
      await p.screenshot({ path: `${SHOTS}/clubhouse-${phase}-${w}.png`, fullPage: true });
      await p.close();
    });
  }
}
for (const [w, h] of [[390, 844], [1600, 900]]) {
  await step(`member card, ${w}px: the registered first name shows`, async () => {
    const p = await page(w, h);
    await p.goto(`${BASE}/e/sixes-league-night/#clubhouse`);
    await p.waitForSelector("form[data-reg]");
    await p.fill("#reg-name", "Jordan");
    await p.fill("#reg-email", `club${Date.now()}@example.com`);
    await p.check("input[name=over13]");
    await p.check("input[name=consent]");
    await p.click("form[data-reg] button[type=submit]");
    await p.waitForSelector(".ece-mcard:not(.is-empty)");
    ok((await p.textContent("[data-member-name]")).trim() === "Jordan", "name on the card");
    await p.locator("[data-member-card]").screenshot({ path: `${SHOTS}/member-card-${w}.png` });
    await p.screenshot({ path: `${SHOTS}/member-after-${w}.png`, fullPage: true });
    await p.close();
  });
}

// ---- Big screen: the join slide ----
for (const [w, h] of [[1600, 900], [390, 844]]) {
  await step(`big screen ${w}px: the Join the clubhouse slide, with a QR that opens #clubhouse`, async () => {
    const p = await page(w, h);
    await p.goto(`${BASE}/e/beach-soccer-cup/screen/?every=1.2`);
    await p.waitForSelector("#stage > *");
    await p.waitForSelector('#stage[data-slide="club"]', { timeout: 40000 });
    await p.waitForTimeout(500);
    const m = await p.evaluate(() => { const s = document.querySelector("#stage"), e = s.firstElementChild; return { over: e.offsetHeight - s.clientHeight, wide: e.scrollWidth - s.clientWidth, qr: !!document.querySelector(".ecv-club .ecv-qr svg"), host: document.querySelector(".ecv-club .ecv-qrbox small").textContent, patches: document.querySelectorAll(".ecv-patch").length, text: e.innerText }; });
    if (w >= 1280) ok(m.over <= 1 && m.wide <= 1, `slide overflows (${m.over}px high, ${m.wide}px wide)`); // a TV, not a phone
    ok(m.qr, "QR drawn");
    ok(m.host.endsWith("/e/beach-soccer-cup/#clubhouse"), "the code says where it goes: " + m.host);
    ok(m.patches >= (w >= 1280 ? 3 : 1) && /Join the clubhouse/i.test(m.text), "patches and the heading show");
    await p.screenshot({ path: `${SHOTS}/screen-join-${w}.png` });
    await p.close();
  });
}

// ---- Two rings ----
const S = {};
await step("two-ring boxing: set up through the API", async () => {
  const org = await call("POST", "/api/shot/organisers", { name: `Club E2E ${Date.now()}` }, { "X-Shot-Admin": SHOT_ADMIN });
  ok(org.status === 200, "organiser " + org.status);
  const sess = await call("POST", "/api/auth/organiser", { key: org.data.key });
  const made = await call("POST", "/api/events", { name: `Ring Night ${Date.now().toString(36)}`, sport: "boxing", date: "2026-11-21" }, { Authorization: `Bearer ${sess.data.token}` });
  ok(made.status === 200, "event " + made.status);
  S.slug = made.data.slug;
  const admin = (await call("POST", "/api/auth", { code: made.data.adminCode })).data.token;
  S.admin = admin;
  const send = (list, token = admin) => call("POST", `/api/events/${S.slug}/ops`, { ops: list }, { Authorization: `Bearer ${token}` });
  const bout = (id, title, red, blue, pitch) => ({ op: "bout.add", id, title, pitch, rounds: 3, roundMins: 2, scoring: "none", red: { name: red, club: "Fen BC" }, blue: { name: blue, club: "Cam ABC" } });
  const r = await send([
    { op: "pitch.add", id: "P1", name: "Ring A" }, { op: "pitch.add", id: "P2", name: "Ring B" },
    { op: "official.add", id: "R1", name: "Ref One", role: "referee", pitch: "P1" }, { op: "official.add", id: "R2", name: "Ref Two", role: "referee", pitch: "P2" },
    bout("B1", "Opening bout", "Danny Fox", "Marcus Lane", "P1"), bout("B2", "Bout 2", "Priya Shah", "Leah Stone", "P2"),
    bout("B3", "Bout 3", "Tom Reid", "Joe Park", "P1"), bout("B4", "Bout 4", "Amy Cole", "Zoe Hart", "P2"),
    { op: "vote.open", open: true }, { op: "phase.set", phase: "live" },
  ]);
  ok(r.status === 200, "setup " + r.status + JSON.stringify(r.data).slice(0, 200));
  const started = await send([{ op: "bout.action", id: "B1", action: "start" }, { op: "bout.action", id: "B2", action: "start" }]);
  ok(started.status === 200, "start " + started.status + JSON.stringify(started.data).slice(0, 200));
  const code = await call("POST", `/api/events/${S.slug}/codes`, { role: "referee", subject: "R1", label: "Ref One" }, { Authorization: `Bearer ${admin}` });
  ok(code.status === 200, "code " + code.status);
  S.refCode = code.data.code;
});
for (const [w, h] of [[390, 844], [1600, 900]]) {
  await step(`two rings, fan Now at ${w}px: one bout per ring, ring names shown`, async () => {
    const p = await page(w, h);
    await p.goto(`${BASE}/e/${S.slug}/#now`);
    await p.waitForSelector(".ece-ring");
    ok(await p.locator(".ece-ring").count() === 2, "two ring cards");
    const names = await p.locator(".ece-ringname").allTextContents();
    ok(names.join() === "Ring A,Ring B", "ring names " + names);
    const [a, b] = await Promise.all([p.locator(".ece-ring").nth(0).boundingBox(), p.locator(".ece-ring").nth(1).boundingBox()]);
    if (w >= 720) ok(Math.abs(a.y - b.y) < 4 && b.x > a.x, "side by side on a wide screen");
    ok(await overflow(p) <= 0, "no horizontal overflow");
    await p.screenshot({ path: `${SHOTS}/rings-fan-${w}.png`, fullPage: true });
    await p.click('a.ece-tab[href="#card"]');
    await p.waitForSelector(".ece-bout");
    ok((await p.locator(".ece-bout").first().textContent()).includes("Ring A"), "bout cards name their ring");
    await p.close();
  });
  await step(`two rings, big screen at ${w}px: both rings side by side, fits`, async () => {
    const p = await page(w, h);
    await p.goto(`${BASE}/e/${S.slug}/screen/?every=1.2`);
    await p.waitForSelector('#stage[data-slide="bout"]', { timeout: 30000 });
    await p.waitForTimeout(500);
    const m = await p.evaluate(() => { const s = document.querySelector("#stage"), e = s.firstElementChild; const r = [...document.querySelectorAll(".ecv-ring")].map((x) => x.getBoundingClientRect()); return { over: e.offsetHeight - s.clientHeight, wide: e.scrollWidth - s.clientWidth, n: r.length, same: r.length > 1 && Math.abs(r[0].top - r[1].top) < 4, names: [...document.querySelectorAll(".ecv-ring__n")].map((x) => x.textContent) }; });
    ok(m.n === 2 && m.names.join() === "Ring A,Ring B", "two rings: " + m.names);
    ok(m.same, "side by side");
    ok(m.over <= 1 && m.wide <= 1, `overflows (${m.over}px high, ${m.wide}px wide)`);
    await p.screenshot({ path: `${SHOTS}/rings-screen-${w}.png` });
    await p.close();
  });
}
for (const [w, h] of [[390, 844], [1600, 900]]) {
  await step(`two rings, referee page at ${w}px: own ring first, the other under a filter`, async () => {
    const p = await page(w, h);
    await p.goto(`${BASE}/ref/?e=${S.slug}`);
    await p.fill("#ecr-code", S.refCode);
    await p.click("button[type=submit]");
    await p.waitForSelector(".ecr-bout");
    ok((await p.locator(".ecr-bout").textContent()).includes("Ring A"), "the bout shows its ring");
    ok(await p.locator('[data-act="pick-bout"]').count() === 2, "only Ring A bouts listed first");
    ok(!(await p.locator(".ecr-card-list").textContent()).includes("Priya Shah"), "no Ring B bout in the list");
    await p.screenshot({ path: `${SHOTS}/rings-ref-${w}.png`, fullPage: true });
    await p.click('[data-act="ring-all"]');
    await p.waitForFunction(() => document.querySelectorAll('[data-act="pick-bout"]').length === 4);
    ok((await p.locator(".ecr-card-list").textContent()).includes("Ring B"), "Ring B bouts reachable");
    ok(await overflow(p) <= 0, "no horizontal overflow");
    await p.screenshot({ path: `${SHOTS}/rings-ref-all-${w}.png`, fullPage: true });
    await p.close();
  });
}

await step("no console errors anywhere", async () => { ok(errors.length === 0, errors.slice(0, 5).join(" | ")); });
await browser.close();
console.log(failed ? `\n${failed} FAILED` : "\nAll passed");
process.exit(failed ? 1 : 0);
