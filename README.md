# SHOT Event Clubhouse

A multi-event platform for live sports events: football and its variants on any number of
pitches with any number of referees, and boxing fight cards with judges. An event runs on it
before the day (pre-registration, schedule, teams or fight card), on the day (live scores,
tables, knockouts that fill themselves in, round-by-round fight cards, fan voting, the big
screen) and after it (results, champions, fan-vote winners and updates from the organiser).

It is one Cloudflare Worker that serves the static site from `public/`, the JSON API under
`/api/` and the data in D1. There is no build step and no framework. The rules (the event
document, who may change what, voting) live in `public/core/` and run unchanged in the browser,
the Worker and the tests. Read `docs/BRIEF.md` for the product, `docs/API.md` for the contract
and `CLAUDE.md` for the working rules.

## Run it locally

```
npm install
npm run db:local       # creates the local D1 from schema.sql
npm run seed:local     # the four demo events and their public demo codes
npm run dev            # http://127.0.0.1:8787
```

Local secrets live in `.dev.vars` (`SECRET`, `SHOT_ADMIN`). It is gitignored. The demo codes are
listed at `/demo/` and from `GET /api/demo`.

The demo simulation runs from the cron trigger. In `npm run dev` it does not fire by itself; start
the server with `npx wrangler dev --local --persist-to .wrangler/state --test-scheduled`, then
trigger a tick whenever you like. For the browser test suites add `--var SIM_TICKS:1`, so a trigger
runs one tick and finishes, instead of three ticks 20 seconds apart that keep changing the demos
while the next suite runs:

```
curl "http://127.0.0.1:8787/cdn-cgi/handler/scheduled?cron=*+*+*+*+*"
```

Each trigger runs 3 steps 20 seconds apart. Add `--var SIM_TICKS:1` for a single step per trigger.

## Tests

```
npm test                              # unit tests: core rules and the Worker's pure parts
node tests/e2e/api.mjs                # API end to end against the running dev server
node tests/e2e/api.mjs http://127.0.0.1:8787
```

The end-to-end script needs the dev server running with a seeded database. It creates its own
organiser and events, resets the futsal demo, prints PASS, FAIL or SKIP for every step and exits
non-zero if anything fails. Run it more than a minute apart: it deliberately trips the
registration limit at the end.

## Deploy

Run these from this folder. Nothing here is automatic and there are no GitHub Actions.

1. Create the secrets (once). `SECRET` signs session tokens and peppers the code hashes, so
   changing it later signs everyone out and invalidates every stored code.
   ```
   npx wrangler secret put SECRET
   npx wrangler secret put SHOT_ADMIN
   ```
2. Create the tables: `npm run db:remote`.
3. Seed the demos. The seed script hashes the demo codes, so it needs the same `SECRET` as the
   Worker, in the environment (never in a file):
   ```
   SECRET='the same value as the Worker secret' npm run seed:remote
   ```
4. `npm run deploy` (runs the tests, then `wrangler deploy`). The cron trigger in `wrangler.toml`
   starts with the deploy.
5. Custom domain: in the Cloudflare dashboard, Workers & Pages, `event-clubhouse`, Settings,
   Domains & Routes, add `events.shotclubhouse.com` (or add a `routes` entry with
   `custom_domain = true` to `wrangler.toml`). The `SITE` variable already points there.

## Create an organiser

An organiser key lets someone create events. SHOT issues it:

```
node scripts/organiser.js "Organiser name"
```

That prints the `curl` command for `POST /api/shot/organisers`. Run it with `SHOT_ADMIN` set. The
key in the answer is shown once. The organiser signs in with it and creates events; each new event
comes back with its first admin code. New events are unlisted until SHOT lists them (the command
is printed too).

## Create a private prospect demo

A prospect demo is a copy of a demo event with their event name, partner name and accent colour,
at a link nobody can guess. It never appears in any list and carries `noindex`.

1. Copy `docs/prospects.example.json` to `private/prospects.json` and edit it. The `private/`
   folder is gitignored and must stay that way: no prospect names go in the repo.
2. `node scripts/prospect.js --local` for a trial, or
   `SECRET='...' node scripts/prospect.js --remote` for the live site.
3. The script prints, once, the fan link (`/e/p-xxxxxxxxxx/`), the big screen link and a fresh
   code for every role. Football and fight demos stay live on their own, like the public ones.

## Layout

- `src/worker.js` routes and handlers. `src/auth.js` tokens, hashes and rate limits.
  `src/events.js` storage with compare-and-swap. `src/votes.js` votes and the 2 second tally
  cache. `src/views.js` what each role sees. `src/http.js` responses, limits, security headers.
- `src/seeds/` the four demo events, built with the real generator. `src/sim.js` the always-live
  simulation. `src/demo.js` reset, simulation and nightly reset in the Worker.
- `scripts/` seed, prospect and organiser tools. `tests/worker.test.js` unit tests,
  `tests/e2e/api.mjs` API end to end.
