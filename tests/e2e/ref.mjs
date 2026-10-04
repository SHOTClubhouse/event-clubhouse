// Browser end to end for the referee, judge and coach pages (/ref/ and /coach/).
//   node tests/e2e/ref.mjs [baseUrl]        (default http://127.0.0.1:8802)
// Needs the dev server running with the seeded demos. It resets futsal-finals and fight-night
// first, so run it against a local database. Screenshots go to .screens/ref and .screens/coach.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = (process.argv[2] || "http://127.0.0.1:8802").replace(/\/$/, "");
mkdirSync(".screens/ref", { recursive: true });
mkdirSync(".screens/coach", { recursive: true });

let failed = 0;
const ok = (cond, name, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra ? `  (${extra})` : ""}`); if (!cond) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CODES = {
  admin: "FUTSADMNY4P6", ref1: "FUTR-EFA2-G7HC", ref2: "FUTREFB3J8KD", coach: "FUTC-HAA5-Q2RF",
  fAdmin: "FGHTADMNE3F4", fRef: "FGHR-EFA5-Q3R4", j1: "FGHJ-UDA2-H5J6", j2: "FGHJ-UDB3-K7M8", j3: "FGHJ-UDC4-N9P2",
};

async function api(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const login = async (code) => (await api("POST", "/api/auth", { code })).body.token;
const pub = async (slug) => (await api("GET", `/api/events/${slug}`)).body.event;

async function reset(slug, adminCode) {
  const t = await login(adminCode);
  const r = await api("POST", `/api/events/${slug}/reset`, {}, t);
  if (r.status !== 200) throw new Error(`reset ${slug}: ${r.status} ${JSON.stringify(r.body)}`);
}

const browser = await chromium.launch();
const pages = [];
async function phone(size = { width: 360, height: 740 }) {
  const ctx = await browser.newContext({ viewport: size, hasTouch: true, isMobile: true, acceptDownloads: false });
  const page = await ctx.newPage();
  page.errors = [];
  // 401 and 409 are the deliberate wrong-code and refused-result checks; the browser logs them as errors.
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(401|409)/.test(m.text())) page.errors.push(m.text()); });
  page.on("pageerror", (e) => page.errors.push(String(e)));
  pages.push(page);
  return { ctx, page };
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const signIn = async (page, path, code) => {
  await page.goto(BASE + path);
  await page.fill("#ecr-code", code);
  await page.click("button[type=submit]");
};
const status = (page) => page.locator("#ecr-status");
const saved = (page) => page.waitForFunction(() => /On the website/.test(document.querySelector("#ecr-status")?.textContent || ""), null, { timeout: 15000 });
const tap = async (loc, n = 1) => { for (let i = 0; i < n; i++) await loc.tap(); };

try {
  await reset("futsal-finals", CODES.admin);
  await reset("fight-night", CODES.fAdmin);

  // ------------------------------------------------------------ sign in
  console.log("\n-- Sign in");
  {
    const { page } = await phone();
    await page.goto(BASE + "/ref/");
    await page.screenshot({ path: ".screens/ref/01-signin.png" });
    await page.fill("#ecr-code", "nonsense");
    await page.click("button[type=submit]");
    ok(await page.locator(".ec-error").isVisible(), "short code gets a friendly error");
    await page.fill("#ecr-code", "ZZZZ-ZZZZ-ZZZZ");
    await page.click("button[type=submit]");
    await page.waitForSelector(".ec-error:has-text(\"didn't work\")");
    ok(true, "wrong code gets the server's plain message");
    await page.fill("#ecr-code", "futr-efa2-g7hc");
    ok((await page.inputValue("#ecr-code")) === "FUTR-EFA2-G7HC", "code auto-uppercases and adds dashes");
    await page.click("button[type=submit]");
    await page.waitForSelector(".ecr-game");
    ok(page.url().includes("e=futsal-finals"), "sign-in lands on the event");
    await page.reload();
    await page.waitForSelector(".ecr-game");
    ok(true, "device remembers the sign-in after a reload");
    await page.goto(BASE + "/ref/");
    ok(await page.locator(".ecr-devlink:has-text('Futsal Finals')").isVisible(), "without ?e= the page lists signed-in events");
  }
  {
    const { page } = await phone();
    await signIn(page, "/ref/?e=futsal-finals", CODES.ref2); // no dashes
    await page.waitForSelector(".ecr-game");
    ok(/Priti/.test(await page.locator(".ecr-me").innerText()), "code without dashes signs in (Priti, Court 2)");
    await page.close();
  }

  // ------------------------------------------------------------ football referee
  console.log("\n-- Football referee");
  const { ctx: refCtx, page: ref } = await phone();
  await signIn(ref, "/ref/", CODES.ref1);
  await ref.waitForSelector(".ecr-game");
  ok((await ref.locator(".ecr-game").count()) >= 1, "my first game is open");
  const firstId = await ref.locator(".ecr-plus").first().getAttribute("data-id");
  const plusH = ref.locator(`.ecr-plus[data-id="${firstId}"][data-side="home"]`);
  const plusA = ref.locator(`.ecr-plus[data-id="${firstId}"][data-side="away"]`);
  const box = await plusH.boundingBox();
  ok(box.height >= 64 && box.width >= 64, "plus button is at least 64px", `${box.width}x${box.height}`);
  const minus = await ref.locator(`.ecr-minus[data-id="${firstId}"]`).first().boundingBox();
  ok(minus.height >= 64, "minus button is at least 64px", String(minus.height));
  await ref.screenshot({ path: ".screens/ref/02-football-game.png" });

  await ref.locator(`[data-act=state][data-id="${firstId}"][data-state=live]`).tap();
  await tap(plusH, 2);
  await tap(plusA, 1);
  await ref.locator(`[data-act=state][data-id="${firstId}"][data-state=ft]`).tap();
  await saved(ref);
  ok(/On the website/.test(await status(ref).innerText()), "shows 'On the website' with a time");
  let f = (await pub("futsal-finals")).fixtures.find((x) => x.id === firstId);
  ok(f.homeScore === 2 && f.awayScore === 1 && f.state === "ft", "public API shows 2-1 FT", JSON.stringify(f));
  await ref.screenshot({ path: ".screens/ref/03-football-saved.png" });
  ok((await overflow(ref)) <= 0, "no horizontal overflow at 360px");

  // undo
  const next = ref.locator(".ecr-game.is-scheduled").first();
  const nextId = await next.locator(".ecr-plus").first().getAttribute("data-id");
  await ref.locator(`.ecr-plus[data-id="${nextId}"][data-side="home"]`).tap();
  await saved(ref);
  let g = (await pub("futsal-finals")).fixtures.find((x) => x.id === nextId);
  ok(g.homeScore === 1 && g.state === "live", "a + tap makes the game live with 1-0");
  await ref.locator('[data-act=undo]').tap();
  await ref.waitForFunction(() => /On the website/.test(document.querySelector("#ecr-status")?.textContent || "") && !document.querySelector(".ecr-game.is-live"), null, { timeout: 15000 });
  g = (await pub("futsal-finals")).fixtures.find((x) => x.id === nextId);
  ok(g.state === "scheduled" && g.homeScore == null, "undo puts the game back", JSON.stringify(g));

  // offline
  console.log("\n-- Offline");
  const offId = nextId;
  await refCtx.setOffline(true);
  await ref.evaluate(() => window.dispatchEvent(new Event("offline")));
  const offPlus = ref.locator(`.ecr-plus[data-id="${offId}"][data-side="away"]`);
  await tap(offPlus, 2);
  await ref.waitForSelector(".ecr-banner--warn");
  const banner = await ref.locator(".ecr-banner--warn").innerText();
  ok(/2 taps/.test(banner), "offline banner counts the taps", banner);
  ok((await ref.locator(".ecr-game.is-live .ecr-score").nth(1).innerText()) === "2", "score shows locally while offline");
  g = (await pub("futsal-finals")).fixtures.find((x) => x.id === offId);
  ok(g.state === "scheduled", "nothing reached the website yet");
  await ref.screenshot({ path: ".screens/ref/04-offline.png" });
  await refCtx.setOffline(false);
  await ref.evaluate(() => window.dispatchEvent(new Event("online")));
  await ref.waitForFunction(() => !document.querySelector(".ecr-banner--warn") && /On the website/.test(document.querySelector("#ecr-status")?.textContent || ""), null, { timeout: 20000 });
  g = (await pub("futsal-finals")).fixtures.find((x) => x.id === offId);
  ok(g.awayScore === 2 && g.homeScore === 0 && g.state === "live", "both offline taps landed exactly once (0-2)", JSON.stringify(g));
  await sleep(6500);
  g = (await pub("futsal-finals")).fixtures.find((x) => x.id === offId);
  ok(g.awayScore === 2, "still 0-2 after the next poll (no double apply)", JSON.stringify(g));

  // knockout level at FT needs penalties
  console.log("\n-- Knockout penalties");
  await ref.locator(`[data-act=state][data-id="${offId}"][data-state=ft]`).tap(); // finish that game first
  await saved(ref);
  const qf = ref.locator('[data-act=open][data-id="QF1"]');
  await qf.scrollIntoViewIfNeeded();
  await qf.tap();
  await ref.waitForSelector('.ecr-plus[data-id="QF1"]');
  await ref.locator('[data-act=state][data-id="QF1"][data-state=live]').tap();
  await ref.locator('.ecr-plus[data-id="QF1"][data-side="home"]').tap();
  await ref.locator('.ecr-plus[data-id="QF1"][data-side="away"]').tap();
  ok((await ref.locator('.ecr-pens').count()) === 0, "no penalty picker while the game is live");
  await ref.locator('[data-act=state][data-id="QF1"][data-state=ft]').tap();
  await ref.waitForSelector(".ecr-pens");
  ok(await ref.locator(".ecr-pens").isVisible(), "level knockout at FT offers the penalty winner");
  await ref.locator('[data-act=pens][data-id="QF1"][data-side=away]').tap();
  await saved(ref);
  await ref.screenshot({ path: ".screens/ref/05-penalties.png" });
  g = (await pub("futsal-finals")).fixtures.find((x) => x.id === "QF1");
  ok(g.pens === "away" && g.state === "ft", "penalty winner saved", JSON.stringify(g));
  ok((await ref.locator(`.ecr-pens`).count()) === 1, "picker stays so it can be changed");

  // scope and pitch filter
  console.log("\n-- Filters and stream");
  await ref.locator("[data-act=scope][data-v=all]").first().tap();
  await ref.waitForTimeout(200);
  const allCount = await ref.locator(".ecr-game, .ecr-mini").count();
  await ref.locator("[data-act=scope][data-v=mine]").first().tap();
  const mineCount = await ref.locator(".ecr-game, .ecr-mini").count();
  ok(allCount > mineCount, "All games shows more than My games", `${allCount} v ${mineCount}`);
  // stream
  await ref.fill("#ecr-stream-url", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  ok(/YouTube/.test(await ref.locator("#ecr-stream-verdict").innerText()), "stream verdict recognises YouTube");
  await ref.locator("[data-act=stream][data-on=true]").tap();
  await saved(ref);
  const pit = (await pub("futsal-finals")).pitches.find((p) => p.id === "P1");
  ok(pit.stream.on === true && /dQw4/.test(pit.stream.url), "stream saved on my pitch and switched on", JSON.stringify(pit.stream));
  await ref.locator("[data-act=stream][data-on=false]").tap();
  await saved(ref);
  await ref.evaluate(() => window.scrollTo(0, 0));
  await ref.screenshot({ path: ".screens/ref/06-football-top.png" });
  ok((await overflow(ref)) <= 0, "no overflow after filters and stream");
  ok(ref.errors.length === 0, "no console errors (football referee)", ref.errors.join(" | "));

  // 390 wide
  {
    const { page } = await phone({ width: 390, height: 844 });
    await signIn(page, "/ref/", CODES.ref1);
    await page.waitForSelector(".ecr-game");
    ok((await overflow(page)) <= 0, "no overflow at 390px (referee)");
    await page.screenshot({ path: ".screens/ref/07-football-390.png" });
  }

  // ------------------------------------------------------------ boxing
  console.log("\n-- Boxing");
  const R = await phone();
  const J = [await phone(), await phone(), await phone()];
  await signIn(R.page, "/ref/", CODES.fRef);
  await R.page.waitForSelector(".ecr-bout");
  ok(/Round|Not started/.test(await R.page.locator(".ecr-bout__state").innerText()), "referee sees the current bout");
  await R.page.screenshot({ path: ".screens/ref/08-boxing-ready.png" });
  const jcodes = [CODES.j1, CODES.j2, CODES.j3];
  for (let i = 0; i < 3; i++) { await signIn(J[i].page, "/ref/", jcodes[i]); await J[i].page.waitForSelector(".ecr-bout"); }
  ok(/Judge/.test(await J[0].page.locator(".ecr-me").innerText()), "judge page says Judge");

  await R.page.locator("[data-act=bout-start]").tap();
  await R.page.waitForSelector(".ecr-clock");
  await saved(R.page);
  const t1 = await R.page.locator("[data-clock-time]").innerText();
  ok(/^\d:\d\d$/.test(t1) && t1 !== "--:--", "round clock counts down", t1);
  await sleep(1300);
  ok((await R.page.locator("[data-clock-time]").innerText()) !== t1, "clock ticks");
  await R.page.screenshot({ path: ".screens/ref/09-boxing-live.png" });
  ok((await overflow(R.page)) <= 0, "no overflow (boxing referee)");

  // judges cannot score round 1 yet
  await J[0].page.waitForFunction(() => /Round 1 is live/.test(document.body.innerText), null, { timeout: 15000 });
  ok((await J[0].page.locator("[data-act=score-round]").count()) === 0, "judge UI has no score buttons for a round that has not ended");
  await J[0].page.screenshot({ path: ".screens/ref/10-judge-waiting.png" });
  const jTok = await login(CODES.j1);
  const early = await api("POST", "/api/events/fight-night/ops", { ops: [{ op: "score.round", bout: "B1", round: 1, red: 10, blue: 9 }] }, jTok);
  ok(early.status === 409 && /ended/i.test(early.body.error || ""), "server refuses a round that has not ended", JSON.stringify(early.body));

  async function endRound(n) {
    await R.page.locator("[data-act=bout-end]").tap();
    await R.page.waitForSelector("[data-act=bout-end].is-armed");
    ok(/Tap again/.test(await R.page.locator("[data-act=bout-end]").innerText()), `end round ${n} asks for a second tap`);
    await R.page.locator("[data-act=bout-end]").tap();
    await R.page.waitForSelector(".ecr-clock:has-text('Break')", { timeout: 15000 }).catch(() => {});
    await saved(R.page);
  }
  async function judgesScore(n, picks) {
    for (let i = 0; i < 3; i++) {
      const pg = J[i].page;
      await pg.waitForSelector("[data-act=score-round]", { timeout: 20000 });
      await pg.locator(`[data-act=score-round][data-red="${picks[i][0]}"][data-blue="${picks[i][1]}"]`).first().tap();
      await saved(pg);
    }
  }
  await endRound(1);
  ok(/Break/.test(await R.page.locator(".ecr-clock").innerText()), "break clock shows after End round");
  await R.page.screenshot({ path: ".screens/ref/11-boxing-break.png" });
  await judgesScore(1, [[10, 9], [10, 9], [10, 9]]);
  await J[0].page.screenshot({ path: ".screens/ref/12-judge-scoring.png" });
  const sc1 = (await api("GET", "/api/events/fight-night/full", null, jTok)).body.event.scorecards;
  ok(sc1.B1 && sc1.B1.J1 && sc1.B1.J1["1"].join() === "10,9", "judge 1 round 1 card saved", JSON.stringify(sc1));

  // judge changes round 1
  await J[0].page.locator("[data-act=score-edit][data-round='1']").tap();
  await J[0].page.locator("[data-act=score-round][data-red='9'][data-blue='10']").first().tap();
  await saved(J[0].page);
  const sc1b = (await api("GET", "/api/events/fight-night/full", null, jTok)).body.event.scorecards;
  ok(sc1b.B1.J1["1"].join() === "9,10", "judge can change a round before the bout is decided", JSON.stringify(sc1b.B1.J1));
  // referee view hides cards
  const rTok = await login(CODES.fRef);
  const rv = (await api("GET", "/api/events/fight-night/full", null, rTok)).body.event;
  ok(!rv.scorecards.B1, "referee does not see cards before the bout is done");

  await R.page.locator("[data-act=bout-next]").tap();
  await saved(R.page);
  await R.page.waitForSelector(".ecr-clock:not(:has-text('Break'))");
  await endRound(2);
  await judgesScore(2, [[10, 9], [10, 9], [10, 9]]);
  await R.page.locator("[data-act=bout-next]").tap();
  await saved(R.page);
  await endRound(3);
  ok(await R.page.locator("[data-act=bout-next]").isDisabled(), "Next round is off after the last round");

  // points decision refused until all judges are done, then accepted
  await R.page.locator("[data-act=result-open]").tap();
  await R.page.locator("[data-act=res-method][data-v=PTS]").tap();
  await R.page.locator("[data-act=res-confirm]").tap();
  await R.page.locator("[data-act=res-go]").tap();
  await R.page.waitForSelector(".ecr-err");
  ok(/Every judge/.test(await R.page.locator(".ecr-err").innerText()), "points result before cards are complete shows the server's message");
  await R.page.screenshot({ path: ".screens/ref/13-boxing-result-error.png" });
  await judgesScore(3, [[10, 9], [10, 9], [10, 9]]);
  await R.page.locator("[data-act=res-confirm]").tap();
  await R.page.locator("[data-act=res-go]").tap();
  await R.page.waitForFunction(() => /wins on points/.test(document.querySelector(".ecr-bout__state")?.textContent || ""), null, { timeout: 15000 });
  let b1 = (await pub("fight-night")).card.bouts.find((b) => b.id === "B1");
  ok(b1.state === "done" && b1.result.method === "PTS" && b1.result.winner === "red", "points decision recorded (red)", JSON.stringify(b1.result));
  const late = await api("POST", "/api/events/fight-night/ops", { ops: [{ op: "score.round", bout: "B1", round: 1, red: 10, blue: 9 }] }, jTok);
  ok(late.status === 409, "judge cannot change a card once the bout is decided");
  await R.page.screenshot({ path: ".screens/ref/14-boxing-done.png" });

  // TKO bout
  const b2row = R.page.locator("[data-act=pick-bout][data-id=B2]");
  await b2row.scrollIntoViewIfNeeded();
  await b2row.tap();
  await R.page.locator("[data-act=bout-start]").tap();
  await saved(R.page);
  await R.page.locator("[data-act=result-open]").tap();
  await R.page.locator("[data-act=res-method][data-v=TKO]").tap();
  await R.page.locator("[data-act=res-winner][data-v=blue]").tap();
  await R.page.locator("#ecr-res-round").selectOption("1");
  await R.page.screenshot({ path: ".screens/ref/15-boxing-result.png" });
  await R.page.locator("[data-act=res-confirm]").tap();
  await R.page.locator("[data-act=res-go]").tap();
  await saved(R.page);
  const b2 = (await pub("fight-night")).card.bouts.find((b) => b.id === "B2");
  ok(b2.state === "done" && b2.result.method === "TKO" && b2.result.winner === "blue" && b2.result.round === 1, "TKO recorded (blue, round 1)", JSON.stringify(b2.result));
  ok((await overflow(R.page)) <= 0, "no overflow after results (boxing referee)");
  ok((await overflow(J[0].page)) <= 0, "no overflow (judge)");
  ok(R.page.errors.length === 0, "no console errors (boxing referee)", R.page.errors.join(" | "));
  ok(J.every((x) => x.page.errors.length === 0), "no console errors (judges)", J.map((x) => x.page.errors.join(" | ")).join(" / "));

  // ------------------------------------------------------------ coach
  console.log("\n-- Coach");
  const C = await phone();
  await signIn(C.page, "/coach/", CODES.coach);
  await C.page.waitForSelector(".ecc-squad");
  ok(/hardwood/i.test(await C.page.locator("h1").innerText()), "coach sees their team");
  ok(await C.page.locator(".ecc-next").isVisible(), "next game banner shows");
  ok((await C.page.locator(".ecc-game").count()) >= 2, "coach sees their fixtures");
  ok(await C.page.locator("tr.is-me").isVisible(), "my row is highlighted in the group table");
  ok(/Quarter-final/.test(await C.page.locator("#ecc-ko-h").locator("xpath=..").innerText()), "knockouts I could be in are listed");
  await C.page.screenshot({ path: ".screens/coach/01-top.png" });
  // another team's full names stay private
  const adminTok = await login(CODES.admin);
  const full = (await api("GET", "/api/events/futsal-finals/full", null, adminTok)).body.event;
  const others = full.divisions.flatMap((d) => d.teams.filter((t) => t.id !== "T1").flatMap((t) => (t.players || []).map((p) => p.name))).filter(Boolean);
  const body = await C.page.evaluate(() => document.body.innerText + [...document.querySelectorAll("input,textarea")].map((i) => i.value).join(" "));
  ok(others.length > 0 && !others.some((n) => body.includes(n)), "no other team's full player names on the coach page", others.find((n) => body.includes(n)) || "");
  const cTok = await login(CODES.coach);
  const cv = (await api("GET", "/api/events/futsal-finals/full", null, cTok)).body;
  ok(!JSON.stringify(cv.event).includes(others[0]), "coach API view has no other team's names");

  // edit squad
  const before = cv.squad.length;
  await C.page.locator("[data-act=add]").tap();
  await C.page.fill(`#ecc-n${before}`, "99");
  await C.page.fill(`#ecc-m${before}`, "Test Player");
  await C.page.locator("[data-act=save]").tap();
  await C.page.waitForFunction(() => /Saved/.test(document.querySelector(".ecc-save .ec-help")?.textContent || ""), null, { timeout: 15000 });
  const after = (await api("GET", "/api/events/futsal-finals/full", null, cTok)).body.squad;
  ok(after.length === before + 1 && after.some((p) => p.number === 99 && p.name === "Test Player"), "squad edit saved", JSON.stringify(after.slice(-2)));
  // duplicate number
  await C.page.locator("[data-act=add]").tap();
  await C.page.fill(`#ecc-n${before + 1}`, "99");
  await C.page.fill(`#ecc-m${before + 1}`, "Clash");
  await C.page.locator("[data-act=save]").tap();
  await C.page.waitForSelector(".ec-error");
  ok(/used twice/.test(await C.page.locator(".ec-error").innerText()), "duplicate shirt number gives a specific error");
  // remove the clash row and bulk paste
  await C.page.locator(`[data-act=remove][data-i="${before + 1}"]`).tap();
  await C.page.locator(".ecc-bulk summary").tap();
  await C.page.fill("#ecc-bulk", "77 Bulk One\n78, Bulk Two\nNo Number");
  await C.page.locator("[data-act=bulk]").tap();
  await C.page.locator("[data-act=save]").tap();
  await C.page.waitForFunction(() => /Saved/.test(document.querySelector(".ecc-save .ec-help")?.textContent || ""), null, { timeout: 15000 });
  const after2 = (await api("GET", "/api/events/futsal-finals/full", null, cTok)).body.squad;
  ok(after2.some((p) => p.number === 77 && p.name === "Bulk One") && after2.some((p) => p.number == null && p.name === "No Number"), "bulk paste adds players", JSON.stringify(after2.slice(-3)));
  await C.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await C.page.screenshot({ path: ".screens/coach/02-squad.png" });
  const denied = await api("POST", "/api/events/futsal-finals/ops", { ops: [{ op: "team.players", division: "main", id: "T2", players: [] }] }, cTok);
  ok(denied.status === 409 || denied.status === 403, "coach cannot edit another team's squad", String(denied.status));
  ok((await overflow(C.page)) <= 0, "no overflow at 360px (coach)");
  ok(C.page.errors.length === 0, "no console errors (coach)", C.page.errors.join(" | "));
  {
    const { page } = await phone({ width: 390, height: 844 });
    await signIn(page, "/coach/", CODES.coach);
    await page.waitForSelector(".ecc-squad");
    ok((await overflow(page)) <= 0, "no overflow at 390px (coach)");
    await page.screenshot({ path: ".screens/coach/03-390.png" });
  }
  // an admin code on the coach page is pointed to the right place
  {
    const { page } = await phone();
    await signIn(page, "/coach/", CODES.ref1);
    await page.waitForSelector(".ec-error");
    ok(/referee/.test(await page.locator(".ec-error").innerText()), "a referee code on the coach page points to the right page");
  }
  ok(pages.every((p) => p.errors.length === 0), "no console errors on any page", pages.map((p) => p.errors.join(" | ")).filter(Boolean).join(" / "));
} catch (e) {
  console.log("FAIL  script error:", e.stack || e);
  failed++;
} finally {
  try { await reset("futsal-finals", CODES.admin); await reset("fight-night", CODES.fAdmin); } catch (e) { /* leave as is */ }
  await browser.close();
}

console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
