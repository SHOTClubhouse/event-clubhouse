// Browser end to end for fitness events: fan page, big screen, timekeeper, organiser.
//   node tests/e2e/fitness.mjs [baseUrl]        (default http://127.0.0.1:8860)
// Needs the dev server running with the seeded demos. It resets fitness-race and fitness-games
// first, so run it against a local database. Screenshots go to .screens/fitness/.

import { chromium } from "playwright";
import { mkdirSync, readFileSync, existsSync } from "node:fs";

const BASE = (process.argv[2] || "http://127.0.0.1:8860").replace(/\/$/, "");
mkdirSync(".screens/fitness", { recursive: true });
const devVars = existsSync(".dev.vars") ? Object.fromEntries(readFileSync(".dev.vars", "utf8").split(/\r?\n/).map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]])) : {};
const SHOT_ADMIN = process.env.SHOT_ADMIN || devVars.SHOT_ADMIN || "dev-shot-admin";

let failed = 0;
const ok = (cond, name, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra ? `  (${extra})` : ""}`); if (!cond) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body, token, headers = {}) {
  const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json", ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const login = async (code) => (await api("POST", "/api/auth", { code })).body.token;
const demo = (await api("GET", "/api/demo")).body.events;
const codes = (slug) => Object.fromEntries(demo.find((e) => e.slug === slug).codes.map((c) => [c.role, c.code]));
const RACE = codes("fitness-race"), GAMES = codes("fitness-games");

async function reset(slug, c) {
  const r = await api("POST", `/api/events/${slug}/reset`, {}, await login(c.admin));
  if (r.status !== 200) throw new Error(`reset ${slug}: ${r.status}`);
}
const ops = async (slug, token, list) => api("POST", `/api/events/${slug}/ops`, { ops: list }, token);
const full = async (slug, c) => (await api("GET", `/api/events/${slug}/full`, null, await login(c.admin))).body.event;

const browser = await chromium.launch({ channel: "chrome" });
const pages = [];
async function open(size) {
  const ctx = await browser.newContext({ viewport: size, hasTouch: size.width < 800, isMobile: size.width < 800 });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(401|409|404)|fonts\.(googleapis|gstatic)|ERR_(NAME|INTERNET|CONNECTION)/.test(m.text())) page.errors.push(m.text()); });
  page.on("pageerror", (e) => page.errors.push(String(e)));
  pages.push(page);
  return page;
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const shot = (page, name) => page.screenshot({ path: `.screens/fitness/${name}.png`, fullPage: true });
const text = (page) => page.evaluate(() => document.body.innerText);

try {
  await reset("fitness-race", RACE);
  await reset("fitness-games", GAMES);
  const rToken = await login(RACE.referee), gToken = await login(GAMES.referee);

  // Seed a live day through the same ops a timekeeper uses.
  const race0 = await full("fitness-race", RACE);
  const h1 = race0.comp.heats[0], inH1 = race0.comp.entries.filter((e) => e.heat === h1.id);
  const N = race0.comp.segments.length;
  const cum = (base) => Array.from({ length: N }, (_, i) => base * (i + 1));
  let r = await ops("fitness-race", rToken, [{ op: "heat.start", id: h1.id }, ...inH1.slice(0, 5).flatMap((e, k) => [0, 1, 2].map((s) => ({ op: "result.set", entry: e.id, segment: s, value: 240 * (s + 1) + k * 7 }))), { op: "entry.state", entry: inH1[8].id, state: "dnf" }]);
  ok(r.status === 200, "race: timekeeper ops start heat 1 and post splits", JSON.stringify(r.body));
  const fastest = inH1[0];
  r = await ops("fitness-race", rToken, cum(260).map((v, s) => ({ op: "result.set", entry: fastest.id, segment: s, value: v })).slice(3));
  ok(r.status === 200, "race: one athlete finishes", JSON.stringify(r.body));

  const games0 = await full("fitness-games", GAMES);
  const g1 = games0.comp.heats[0], gIn = games0.comp.entries.filter((e) => e.heat === g1.id);
  r = await ops("fitness-games", gToken, [{ op: "heat.start", id: g1.id }, ...gIn.slice(0, 4).flatMap((e, k) => [{ op: "result.set", entry: e.id, segment: 0, value: 80 + k * 5 }, { op: "result.set", entry: e.id, segment: 1, value: 300 - k * 10 }])]);
  ok(r.status === 200, "games: timekeeper ops start heat 1 and post scores", JSON.stringify(r.body));

  // ------------------------------------------------------------ fan page, race, 360px
  console.log("\n-- Fan page: timed race");
  const fan = await open({ width: 360, height: 740 });
  await fan.goto(`${BASE}/e/fitness-race/`);
  await fan.waitForSelector(".ecf-heat");
  const tabs = await fan.locator(".ece-tab").allInnerTexts();
  ok(["Now", "Heats", "Leaderboard", "Find me", "Vote"].every((t) => tabs.some((x) => x.startsWith(t))), "tabs: Now, Heats, Leaderboard, Find me, Vote", tabs.join("|"));
  ok((await fan.locator(".ece-h", { hasText: /On the arena/i }).count()) === 1, "Now: heading uses the event's word (arena)");
  ok((await fan.locator(".ecf-prog--fin").count()) >= 1 && /Finished/i.test(await fan.locator("#view").innerText()), "Now: a finished athlete says Finished");
  ok(/Did not finish/i.test(await fan.locator("#view").innerText()), "Now: a DNF says Did not finish");
  ok(/Segment 4 of 16/.test(await fan.locator("#view").innerText()) && /Last split/.test(await fan.locator("#view").innerText()), "Now: segment n of N and the latest split");
  ok((await fan.locator(".ece-disc").innerText()) === "Fitness race", "header shows the discipline");
  ok((await overflow(fan)) <= 0, "Now: no overflow at 360px");
  await shot(fan, "fan-race-now-360");

  await fan.getByRole("link", { name: "Heats", exact: true }).tap();
  await fan.waitForSelector(".ecf-cats");
  const allHeats = await fan.locator(".ecf-heat").count();
  await fan.locator(".ecf-cats button", { hasText: "Open Men" }).tap();
  const menHeats = await fan.locator(".ecf-heat").count();
  ok(allHeats === 16 && menHeats > 0 && menHeats < allHeats, "Heats: category filter narrows the schedule", `${allHeats} -> ${menHeats}`);
  await fan.locator(".ecf-toggle").first().tap();
  ok((await fan.locator(".ecf-names li").count()) > 0, "Heats: athletes can be shown");
  ok((await overflow(fan)) <= 0, "Heats: no overflow at 360px");
  await shot(fan, "fan-race-heats-360");

  await fan.getByRole("link", { name: "Leaderboard", exact: true }).tap();
  await fan.waitForSelector(".ecf-lb");
  ok(/1\s*#\d+ /.test((await fan.locator(".ecf-lb__item").first().innerText()).replace(/\n/g, " ")) || (await fan.locator(".ecf-lb__rank").first().innerText()) === "1", "Leaderboard: rank 1 first");
  ok(/\d+:\d\d/.test(await fan.locator(".ecf-lb__item").first().innerText()), "Leaderboard: finish time shown");
  await fan.locator(".ecf-lb__row").first().tap();
  ok((await fan.locator(".ecf-segs li").count()) === N, "Leaderboard: tap a row for the splits", `${await fan.locator(".ecf-segs li").count()}`);
  ok(/leg \d/.test(await fan.locator(".ecf-segs").innerText()), "Leaderboard: legs shown beside splits");
  await fan.locator(".ecf-cats button", { hasText: "Pro Men" }).tap();
  ok(/Pro Men/i.test(await fan.locator(".ece-h").first().innerText()), "Leaderboard: category switcher");
  await fan.locator(".ecf-cats button", { hasText: "Open Women" }).tap();
  ok((await overflow(fan)) <= 0, "Leaderboard: no overflow at 360px");
  await shot(fan, "fan-race-board-360");

  await fan.getByRole("link", { name: "Find me", exact: true }).tap();
  await fan.fill("#fit-bib", "999");
  await fan.getByRole("button", { name: "Find", exact: true }).tap();
  ok(/can't find bib 999/.test(await fan.locator("#fit-bib-err").innerText()), "Find me: an unknown bib says so");
  await fan.fill("#fit-bib", String(fastest.bib));
  await fan.getByRole("button", { name: "Find", exact: true }).tap();
  await fan.waitForSelector(".ecf-me");
  const card = await fan.locator(".ecf-me").innerText();
  ok(/1st of/.test(card) && /Wave 1/.test(card) && /Finished/i.test(card) && /\d+:\d\d:\d\d/.test(card), "Find me: card has rank, heat and finish time", card.replace(/\n/g, " | ").slice(0, 160));
  ok((await fan.locator(".ecf-segs li").count()) === N, "Find me: all splits shown");
  await fan.reload();
  await fan.getByRole("link", { name: "Find me", exact: true }).tap();
  await fan.waitForSelector(".ecf-me");
  ok(true, "Find me: the choice is remembered after a reload");
  ok((await overflow(fan)) <= 0, "Find me: no overflow at 360px");
  await shot(fan, "fan-race-me-360");

  await fan.getByRole("link", { name: /Vote/ }).tap();
  await fan.waitForSelector(".ece-gate");
  ok(/13 and over/i.test(await fan.locator(".ece-gate").innerText()), "Vote: asks for the 13 and over confirmation");
  await fan.getByRole("button", { name: "I'm 13 or over" }).tap();
  await fan.waitForSelector(".ece-vcard");
  const chip = fan.locator(".ece-vcard .ece-chip").first();
  await chip.tap();
  await fan.waitForFunction(() => document.querySelector(".ece-vcard .ece-chip[aria-pressed=true]"));
  ok(/Your vote/.test(await fan.locator(".ece-vstat").first().innerText()), "Vote: favourite of a live heat is recorded");
  const tally = (await api("GET", "/api/events/fitness-race/votes")).body;
  ok(tally.total >= 1 && tally.heats.length >= 1, "Vote: the server counted it", JSON.stringify(tally).slice(0, 120));
  ok((await overflow(fan)) <= 0, "Vote: no overflow at 360px");
  await shot(fan, "fan-race-vote-360");

  // No full surname on any public page.
  const names = race0.comp.entries.map((e) => e.name).concat(games0.comp.entries.map((e) => e.name));
  const surnames = [...new Set(names.flatMap((n) => n.split(" & ")).map((n) => n.trim().split(/\s+/)).filter((p) => p.length > 1).map((p) => p[p.length - 1]))];
  let leak = "";
  for (const slug of ["fitness-race", "fitness-games"]) {
    for (const tab of ["now", "heats", "board", "me", "vote"]) {
      await fan.goto(`${BASE}/e/${slug}/#${tab}`);
      await fan.waitForSelector(".ece-main > *");
      await sleep(300);
      const t = await text(fan);
      const hit = names.find((n) => n.includes(" ") && t.includes(n)) || surnames.find((s) => new RegExp(`\\b${s}\\b`).test(t) && !race0.comp.entries.concat(games0.comp.entries).some((e) => (e.club || "").includes(s)));
      if (hit) leak = `${slug}#${tab}: ${hit}`;
    }
  }
  ok(!leak, "public pages show no full surname", leak);
  ok(fan.errors.length === 0, "fan page: no console errors", fan.errors.join(" | "));

  // ------------------------------------------------------------ fan page, games, 390px
  console.log("\n-- Fan page: workout games");
  const gf = await open({ width: 390, height: 844 });
  await gf.goto(`${BASE}/e/fitness-games/`);
  await gf.waitForSelector(".ecf-heat");
  ok((await gf.locator(".ece-h", { hasText: /On the floor/i }).count()) === 1, "Now: games use the floor word");
  ok(/Strength 80 kg/.test(await gf.locator("#view").innerText()), "Now: scores so far in kg");
  await shot(gf, "fan-games-now-390");
  await gf.getByRole("link", { name: "Leaderboard", exact: true }).tap();
  await gf.waitForSelector(".ecf-lb");
  const top = (await gf.locator(".ecf-lb__item").first().innerText()).replace(/\n/g, " ");
  ok(/\d+ pts?/.test(top), "Leaderboard: points shown", top);
  await gf.locator(".ecf-lb__row").first().tap();
  const seg = await gf.locator(".ecf-segs").innerText();
  ok(/kg/.test(seg) && /1st|2nd|3rd|4th/.test(seg), "Leaderboard: scores and ranks per workout", seg.replace(/\n/g, " "));
  await shot(gf, "fan-games-board-390");
  await gf.getByRole("link", { name: "Find me", exact: true }).tap();
  await gf.fill("#fit-bib", String(gIn[0].bib));
  await gf.getByRole("button", { name: "Find", exact: true }).tap();
  await gf.waitForSelector(".ecf-me");
  ok(/Points/i.test(await gf.locator(".ecf-me").innerText()), "Find me: points for the games");
  await shot(gf, "fan-games-me-390");
  await gf.getByRole("link", { name: /Vote/ }).tap();
  await gf.waitForSelector(".ece-gate, .ece-vcard");
  await shot(gf, "fan-games-vote-390");
  ok(gf.errors.length === 0, "games fan page: no console errors", gf.errors.join(" | "));

  // ------------------------------------------------------------ big screen
  console.log("\n-- Big screen");
  const scr = await open({ width: 1600, height: 900 });
  await scr.goto(`${BASE}/e/fitness-race/screen/?every=1`);
  await scr.waitForSelector("#stage > *");
  const seen = new Set();
  for (let i = 0; i < 28; i++) { seen.add(await scr.locator("#stage").getAttribute("data-slide")); if (i === 2) await shot(scr, "screen-race-1"); await sleep(500); }
  const keys = [...seen];
  ok(keys.includes("fit:live"), "screen: live heats slide", keys.join(","));
  ok(keys.filter((k) => /^fit:lb:/.test(k)).length >= 1, "screen: leaderboard slides per category", keys.join(","));
  ok(keys.includes("fit:next"), "screen: next waves slide", keys.join(","));
  ok(/Scan|furl/.test("furl") && (await scr.locator("#furl").innerText()).includes("/e/fitness-race/"), "screen: footer shows the fan link");
  await scr.goto(`${BASE}/e/fitness-race/screen/?every=2`);
  await scr.waitForSelector("#stage > *");
  for (let i = 0; i < 20; i++) { if ((await scr.locator("#stage").getAttribute("data-slide")) === "fit:live") break; await sleep(500); }
  await shot(scr, "screen-race-live-1600");
  // The Finisher moment: finish another athlete while the screen is open.
  const second = inH1[1];
  r = await ops("fitness-race", rToken, [...Array(N).keys()].slice(3).map((s) => ({ op: "result.set", entry: second.id, segment: s, value: 270 * (s + 1) })));
  ok(r.status === 200, "screen: second athlete finishes", JSON.stringify(r.body));
  await scr.waitForSelector(".ecvf-fin:not([hidden])", { timeout: 15000 });
  ok(/Finisher/i.test(await scr.locator(".ecvf-fin").innerText()) && /\d+:\d\d:\d\d/.test(await scr.locator(".ecvf-fin").innerText()), "screen: Finisher moment shows the athlete and time");
  await shot(scr, "screen-race-finisher-1600");
  await scr.goto(`${BASE}/e/fitness-games/screen/?every=1`);
  await scr.waitForSelector("#stage > *");
  const gseen = new Set();
  for (let i = 0; i < 16; i++) { gseen.add(await scr.locator("#stage").getAttribute("data-slide")); await sleep(500); }
  ok([...gseen].includes("fit:live") && [...gseen].some((k) => /^fit:lb:/.test(k)), "screen: games show live heats and leaderboards", [...gseen].join(","));
  await shot(scr, "screen-games-1600");
  const phoneScr = await open({ width: 390, height: 700 });
  await phoneScr.goto(`${BASE}/e/fitness-race/screen/`);
  await phoneScr.waitForSelector("#stage > *");
  await shot(phoneScr, "screen-race-390");
  ok(scr.errors.length === 0 && phoneScr.errors.length === 0, "screen: no console errors", scr.errors.concat(phoneScr.errors).join(" | "));

  // ------------------------------------------------------------ timekeeper
  console.log("\n-- Timekeeper");
  const tk = await open({ width: 360, height: 740 });
  await tk.goto(`${BASE}/ref/?e=fitness-race`);
  await tk.fill("#ecr-code", RACE.referee);
  await tk.click("button[type=submit]");
  await tk.waitForSelector(".ecf-hcard");
  ok(/Timekeeper/.test(await tk.locator(".ecr-me").innerText()), "timekeeper: signed in as a timekeeper");
  const heads = await tk.locator(".ecr-h").allInnerTexts();
  ok(/now/i.test(heads[0]) && /Up next/i.test(heads[1]), "heat list: live first, then up next", heads.join("|"));
  await shot(tk, "ref-race-list-360");
  const h2card = tk.locator(".ecf-hcard", { hasText: "Wave 2" });
  await h2card.getByRole("button", { name: /Start heat/ }).tap();
  ok(/Start Wave 2\?/.test(await tk.locator(".ecf-confirm").innerText()), "Start heat asks first");
  await tk.getByRole("button", { name: "Not yet" }).tap();
  ok((await tk.locator(".ecf-confirm").count()) === 0, "Not yet cancels");
  await h2card.getByRole("button", { name: /Start heat/ }).tap();
  await tk.getByRole("button", { name: "Yes, start" }).tap();
  await tk.waitForFunction(() => /On the arena now/i.test(document.body.innerText) && document.querySelectorAll(".ecf-hcard.is-live").length >= 2);
  ok(true, "Start heat: Wave 2 goes live");
  await tk.waitForFunction(() => /On the website/.test(document.querySelector("#ecr-status")?.textContent || ""), null, { timeout: 15000 });
  const heat2 = (await full("fitness-race", RACE)).comp.heats[1];
  ok(heat2.state === "live" && heat2.startedAt > 0, "Start heat: the server has it", heat2.state);
  await tk.locator(".ecf-hcard", { hasText: "Wave 2" }).getByRole("button", { name: /enter results/i }).tap();
  await tk.waitForSelector(".ecf-bib");
  ok((await tk.locator(".ecf-bib").count()) === 10, "heat: every athlete by bib", `${await tk.locator(".ecf-bib").count()}`);
  const b1 = (await tk.locator(".ecf-bib").nth(0).innerText()).trim(), b2 = (await tk.locator(".ecf-bib").nth(1).innerText()).trim();
  const art = (b) => tk.locator("article.ecf-ath", { has: tk.locator(`.ecf-bib:text-is("${b}")`) });
  await sleep(2200);
  await art(b1).getByRole("button", { name: "Now" }).tap();
  const nowVal = await art(b1).locator(".ecf-in").inputValue();
  ok(/^\d+:\d\d$/.test(nowVal) && Number(nowVal.split(":")[1]) >= 2 || nowVal.startsWith("0:0"), "Now fills the time since the heat started", nowVal);
  await art(b1).getByRole("button", { name: /Save split/ }).tap();
  await tk.waitForFunction((b) => [...document.querySelectorAll("article.ecf-ath")].some((a) => a.querySelector(".ecf-bib")?.textContent.trim() === b && /Segment 2|Next: .* \(segment 2/.test(a.innerText)), b1);
  ok(true, "split saved: the next segment is now the one to enter");
  await art(b1).locator(".ecf-in").fill("0:01");
  await art(b1).getByRole("button", { name: /Save split/ }).tap();
  await tk.waitForSelector(".ecr-err");
  ok(/Splits only go up/.test(await art(b1).locator(".ecr-err").innerText()) && /earlier split/.test(await art(b1).locator(".ecr-err").innerText()), "a split earlier than the last is refused with the message shown", await art(b1).locator(".ecr-err").innerText());
  await art(b1).locator(".ecf-in").fill("nonsense");
  await art(b1).getByRole("button", { name: /Save split/ }).tap();
  ok(/m:ss or h:mm:ss/.test(await art(b1).locator(".ecr-err").innerText()), "a badly typed time says how to type it");
  await art(b1).locator(".ecf-in").fill("0:20");
  await art(b1).getByRole("button", { name: /Save split/ }).tap();
  await tk.waitForFunction(() => /On the website/.test(document.querySelector("#ecr-status")?.textContent || ""), null, { timeout: 15000 });
  const e1 = (await full("fitness-race", RACE)).comp.entries.find((e) => String(e.bib) === b1);
  ok(e1.results[0] != null && e1.results[1] === 20, "splits are on the server", JSON.stringify(e1.results.slice(0, 3)));
  await art(b2).getByRole("button", { name: "DNF" }).tap();
  await tk.waitForSelector(`article.ecf-ath--dnf`);
  ok(/Did not finish/i.test(await art(b2).innerText()), "DNF marks the athlete");
  await art(b2).getByRole("button", { name: /Put back/ }).tap();
  await tk.waitForSelector("article.ecf-ath--racing, article.ecf-ath--ready");
  ok((await tk.locator("article.ecf-ath--dnf").count()) === 0, "a DNF can be put back");
  await tk.fill("#ecf-q", b2);
  await tk.waitForSelector("[aria-label='Search results']");
  ok((await tk.locator("article.ecf-ath").count()) >= 1 && (await tk.locator(".ecf-bib").first().innerText()).startsWith(b2.slice(0, 1)), "bib search finds the athlete");
  ok((await overflow(tk)) <= 0, "timekeeper: no overflow at 360px");
  await shot(tk, "ref-race-search-360");
  await tk.fill("#ecf-q", "");
  await tk.waitForSelector(".ecf-back");
  await shot(tk, "ref-race-heat-360");
  const endBtn = tk.getByRole("button", { name: /End heat/ }).first();
  await endBtn.tap();
  ok(/End Wave 2\?/.test(await tk.locator(".ecf-confirm").innerText()), "End heat asks first");
  await tk.getByRole("button", { name: "Keep going" }).tap();
  ok(tk.errors.length === 0, "timekeeper: no console errors", tk.errors.join(" | "));

  const tg = await open({ width: 390, height: 844 });
  await tg.goto(`${BASE}/ref/?e=fitness-games`);
  await tg.fill("#ecr-code", GAMES.referee);
  await tg.click("button[type=submit]");
  await tg.waitForSelector(".ecf-hcard");
  await tg.locator(".ecf-hcard", { hasText: "On now|Live" }).count();
  await tg.locator(".ecf-hcard.is-live").first().getByRole("button", { name: /enter results/i }).tap();
  await tg.waitForSelector(".ecf-bib");
  const gb = (await tg.locator(".ecf-bib").nth(5).innerText()).trim();
  const gart = tg.locator("article.ecf-ath", { has: tg.locator(`.ecf-bib:text-is("${gb}")`) });
  ok(/Strength/i.test(await gart.locator("label").first().innerText()) && /kg/i.test(await gart.locator("label").first().innerText()), "games: the next result is the workout, in kg");
  ok((await gart.getByRole("button", { name: "Now" }).count()) === 0, "games: no Now button for a score");
  await gart.locator(".ecf-in").fill("92");
  await gart.getByRole("button", { name: /Save score/ }).tap();
  await tg.waitForFunction(() => /On the website/.test(document.querySelector("#ecr-status")?.textContent || ""), null, { timeout: 15000 });
  const ge = (await full("fitness-games", GAMES)).comp.entries.find((e) => String(e.bib) === gb);
  ok(ge.results[0] === 92, "games: score saved as a whole number", JSON.stringify(ge.results));
  await gart.locator(".ecf-in").fill("4:07");
  await gart.getByRole("button", { name: /Save score/ }).tap();
  await tg.waitForFunction(() => /On the website/.test(document.querySelector("#ecr-status")?.textContent || ""), null, { timeout: 15000 });
  const ge2 = (await full("fitness-games", GAMES)).comp.entries.find((e) => String(e.bib) === gb);
  ok(ge2.results[1] === 247, "games: a time workout takes m:ss", JSON.stringify(ge2.results));
  await shot(tg, "ref-games-heat-390");
  ok((await overflow(tg)) <= 0 && tg.errors.length === 0, "games timekeeper: no overflow, no console errors", tg.errors.join(" | "));

  const coach = await open({ width: 360, height: 740 });
  await coach.goto(`${BASE}/coach/?e=fitness-race`);
  await coach.waitForFunction(() => /no coach pages/i.test(document.body.innerText));
  ok(true, "coach page says this event has no coach pages");
  await shot(coach, "coach-nocoach-360");

  // ------------------------------------------------------------ organiser
  console.log("\n-- Organiser");
  const stamp = Date.now().toString(36);
  const org = await api("POST", "/api/shot/organisers", { name: `Fitness E2E ${stamp}` }, null, { "X-Shot-Admin": SHOT_ADMIN, "CF-Connecting-IP": `203.0.113.${Math.floor(Math.random() * 250) + 1}` });
  ok(org.status === 200, "organiser key issued", JSON.stringify(org.body));
  const ad = await open({ width: 1280, height: 900 });
  await ad.goto(`${BASE}/admin/`);
  await ad.getByLabel("Organiser key", { exact: true }).fill(org.body.key);
  await ad.getByRole("button", { name: "Sign in as organiser" }).click();
  await ad.getByRole("heading", { name: "Create an event" }).waitFor();
  const sports = await ad.getByLabel("Sport").locator("option").allInnerTexts();
  ok(sports.some((s) => /Fitness/.test(s)), "create form offers Fitness", sports.join("|"));
  await ad.getByLabel("Event name").fill(`Fitness Day ${stamp}`);
  await ad.getByLabel("Sport").selectOption("fitness");
  await ad.getByRole("button", { name: "Create event" }).click();
  await ad.locator(".ecx-code").waitFor();
  const adminCode = (await ad.locator(".ecx-code").innerText()).trim();
  await ad.locator(".ecx-reveal").getByRole("button", { name: "Open the dashboard" }).click();
  await ad.waitForSelector("#panel-title");
  const slug = new URL(ad.url()).searchParams.get("e");
  const sections = await ad.locator(".ecx-tab").allInnerTexts();
  ok(["Overview", "Details", "Set-up", "Athletes", "Heats", "Timekeepers", "Access codes", "On the day", "After"].every((s) => sections.includes(s)), "admin sections for fitness", sections.join("|"));
  const tab = async (name) => { await ad.locator(".ecx-tab", { hasText: new RegExp(`^${name}$`) }).click(); await ad.waitForFunction((n) => document.querySelector("#panel-title")?.textContent === n, name); };
  const toast = (t) => ad.locator(".ec-toast", { hasText: t }).waitFor({ state: "visible", timeout: 8000 });

  await tab("Set-up");
  await ad.getByLabel("Start from").selectOption({ index: 1 });
  await ad.getByRole("button", { name: "Load this shape" }).click();
  ok((await ad.locator('[aria-label="Segments"] > li').count()) === 16, "set-up: the race shape loads 16 segments");
  await ad.getByRole("button", { name: "Save set-up" }).click();
  await toast("Set-up saved");
  let doc = await full(slug, { admin: adminCode });
  ok(doc.comp.ranking === "time" && doc.comp.segments.length === 16 && doc.comp.categories.length === 2, "set-up: saved on the server", JSON.stringify(doc.comp.categories));
  ok(doc.comp.segments[0].name === "Run 1" && doc.comp.segments[1].name === "Station 1", "set-up: generic names, no brands");
  await ad.getByRole("button", { name: "Add a category" }).click();
  await ad.getByLabel("Name of category 3").fill("Teams of four");
  await ad.getByLabel("Athletes per entry in category 3").selectOption("4");
  await ad.getByRole("button", { name: "Save set-up" }).click();
  await toast("Set-up saved");
  await shot(ad, "admin-setup-1280");

  await tab("Athletes");
  await ad.getByLabel("Paste your athletes").fill("101, Sam Smith, Riverside Club, Open\nabc, Bad Bib, , Open\n103, Alex Jones, , Nowhere\n104, , , Open\n101, Dup Bib, , Open");
  await ad.getByRole("button", { name: "Add these athletes" }).click();
  const errs = await ad.locator(".ecx-errors").innerText();
  ok(/Line 2: the bib "abc"/.test(errs) && /Line 3: the category "Nowhere"/.test(errs) && /Line 4: add a name/.test(errs) && /Line 5: bib 101 is already used on line 1/.test(errs), "athletes: clear errors for every bad line", errs.replace(/\n/g, " | "));
  const lines = [];
  for (let i = 0; i < 12; i++) lines.push(`${101 + i}, Runner${i} Fastsurname${i}, ${i % 2 ? "Hilltop Club" : "Riverside Club"}, ${i < 8 ? "Open" : "Pairs"}`);
  await ad.getByLabel("Paste your athletes").fill(lines.join("\n"));
  await ad.getByRole("button", { name: "Add these athletes" }).click();
  await toast("12 athletes added");
  doc = await full(slug, { admin: adminCode });
  ok(doc.comp.entries.length === 12, "athletes: pasted list saved", `${doc.comp.entries.length}`);
  await ad.getByLabel("Club for Runner0 Fastsurname0").fill("Edited Club");
  await ad.getByLabel("Club for Runner0 Fastsurname0").press("Tab");
  await toast("Club saved");
  await ad.getByRole("button", { name: /Remove Runner11/ }).click();
  await ad.getByRole("button", { name: "Yes, remove" }).click();
  await toast("Athlete removed");
  doc = await full(slug, { admin: adminCode });
  ok(doc.comp.entries.length === 11 && doc.comp.entries.find((e) => e.bib === 101).club === "Edited Club", "athletes: edit and remove save");
  await shot(ad, "admin-athletes-1280");

  await tab("Heats");
  await ad.getByLabel("First heat starts").fill("10:00");
  await ad.getByLabel("Minutes between heats").fill("15");
  await ad.getByLabel("Athletes per heat").fill("4");
  await ad.getByRole("button", { name: "Make the heats" }).click();
  await toast("heats made");
  doc = await full(slug, { admin: adminCode });
  ok(doc.comp.heats.length === 3 && doc.comp.heats.map((h) => h.time).join() === "10:00,10:15,10:30", "heats: made from a start time and gap", doc.comp.heats.map((h) => h.time).join());
  const byHeat = doc.comp.heats.map((h) => doc.comp.entries.filter((e) => e.heat === h.id).map((e) => e.bib));
  ok(byHeat[0].join() === "101,102,103,104" && byHeat[1].join() === "105,106,107,108" && byHeat[2].join() === "109,110,111", "heats: athletes in bib order, by category", JSON.stringify(byHeat));
  await ad.getByLabel("Start time for Heat 1").fill("09:45");
  await ad.getByLabel("Start time for Heat 1").press("Tab");
  await toast("Time saved");
  await ad.getByLabel("Start time", { exact: true }).fill("11:00");
  await ad.getByLabel("Name", { exact: true }).last().fill("Spare");
  await ad.getByRole("button", { name: "Add heat" }).click();
  await toast("Heat added");
  await ad.getByRole("button", { name: /Remove Spare/ }).click();
  await ad.getByRole("button", { name: "Yes, remove" }).click();
  await toast("Heat removed");
  await shot(ad, "admin-heats-1280");
  await tab("On the day");
  ok((await ad.locator(".ecx-lg").count()) >= 1 && (await ad.getByRole("link", { name: /timekeeper page/i }).count()) >= 1, "on the day: heat states and a link to the timekeeper page");
  await shot(ad, "admin-onday-1280");
  await ad.getByRole("button", { name: /Up next/ }).click();
  await ad.getByRole("button", { name: /Start heat: / }).first().click();
  await toast("Heat started");
  await tab("Overview");
  await ad.locator(".ecx-phase__opt", { hasText: "Live" }).click();
  await toast("Event is now live");
  await shot(ad, "admin-overview-1280");

  const fan2 = await open({ width: 360, height: 740 });
  await fan2.goto(`${BASE}/e/${slug}/`);
  await fan2.waitForSelector(".ecf-heat");
  const t2 = await fan2.locator("#view").innerText();
  ok(/Heat 1/.test(t2) && /#101/.test(t2) && !/Smith/.test(t2), "the new event's fan page shows the heats and the athletes by bib");
  await fan2.getByRole("link", { name: "Heats", exact: true }).tap();
  ok((await fan2.locator(".ecf-heat").count()) === 3, "fan Heats tab lists the generated heats");
  ok((await overflow(fan2)) <= 0 && fan2.errors.length === 0, "new event fan page: no overflow, no console errors", fan2.errors.join(" | "));
  ok(ad.errors.length === 0, "admin: no console errors", ad.errors.join(" | "));
  const noVote = await fan2.locator(".ece-tab", { hasText: "Vote" }).count();
  ok(noVote === 0, "Vote tab hidden while voting is off");
  await ops(slug, await login(adminCode), [{ op: "settings.set", juniors: true }, { op: "vote.open", open: true }]);
  await fan2.reload();
  await fan2.waitForSelector(".ecf-heat");
  ok((await fan2.locator(".ece-tab", { hasText: "Vote" }).count()) === 0, "Vote tab hidden for a juniors event even when voting is on");

  // ------------------------------------------------------------ demo hub and site
  console.log("\n-- Demo hub and site");
  const hub = await open({ width: 390, height: 844 });
  await hub.goto(`${BASE}/demo/`);
  await hub.waitForSelector(".ecs-event");
  const hubText = await text(hub);
  ok(/Fitness Race/i.test(hubText) && /Workout Games/i.test(hubText) && hubText.includes(RACE.admin) && hubText.includes(RACE.referee) && hubText.includes(GAMES.admin) && hubText.includes(GAMES.referee), "demo hub lists both fitness demos with organiser and timekeeper codes");
  ok((await hub.locator('.ecs-event[data-sport="fitness"]').count()) === 2 && (await overflow(hub)) <= 0, "demo hub: two fitness cards, no overflow");
  await shot(hub, "demo-hub-390");
  const site = await open({ width: 390, height: 844 });
  await site.goto(`${BASE}/`);
  ok(/fitness races and workout games/i.test(await text(site)) && (await overflow(site)) <= 0, "product site lists fitness races and workout games");
  await shot(site, "site-390");
  await site.setViewportSize({ width: 1600, height: 900 });
  await shot(site, "site-1600");
  ok(site.errors.length === 0 && hub.errors.length === 0, "site and hub: no console errors", site.errors.concat(hub.errors).join(" | "));

  // 1600px captures of the fan page and timekeeper
  const wide = await open({ width: 1600, height: 900 });
  for (const t of ["now", "board", "heats"]) { await wide.goto(`${BASE}/e/fitness-race/#${t}`); await wide.waitForSelector(".ece-main > *"); await sleep(500); await shot(wide, `fan-race-${t}-1600`); }
  await wide.goto(`${BASE}/e/fitness-games/#board`); await sleep(800); await shot(wide, "fan-games-board-1600");
  for (const a of pages) if (a.errors.length) { ok(false, "page had console errors", a.errors.join(" | ")); break; }
} catch (e) {
  console.log("FAIL  crashed:", e && e.stack ? e.stack.split("\n").slice(0, 4).join(" / ") : e);
  failed++;
  for (const p of pages.slice(-1)) await p.screenshot({ path: ".screens/fitness/crash.png", fullPage: true }).catch(() => {});
}
await browser.close();
console.log(failed ? `\n${failed} FAILED` : "\nAll fitness checks passed");
process.exit(failed ? 1 : 0);
