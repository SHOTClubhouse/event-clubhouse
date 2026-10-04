# SHOT Event Clubhouse

Read `docs/BRIEF.md` (what and why), `docs/API.md` (the contract) and the modules in
`public/core/` before changing anything.

## Layout

- `public/core/` shared rules, run by the browser, the Worker and the tests: `model.js` (event
  document, validation, what fans may see), `ops.js` (every change and who may make it),
  `generator.js` (fixtures), `standings.js` (tables, knockouts), `boxing.js` (scorecards,
  decisions, bout states), `votes.js` (fan voting).
- `public/js/api.js` browser client (sessions, polling); `public/js/ui.js` helpers;
  `public/css/app.css` shared styles (`ec-` classes).
- Pages: `public/index.html` (product site), `demo/`, `event/` (fan app at `/e/<slug>/`),
  `screen/` (big screen at `/e/<slug>/screen/`), `admin/`, `ref/`, `coach/`.
- `src/` the Worker (API, auth, demo simulation). `schema.sql` D1. `scripts/` seeding.
- `tests/*.test.js` unit tests (`npm test`); `tests/e2e/` browser runs.

## Rules

- Change rules in `public/core/` only with a test that fails first. Never weaken validation to
  make a save pass.
- Every change to an event goes through an op in `ops.js`; never write the document any other way
  except the admin import (`PUT /doc`).
- No secrets in the repo (`SECRET`, `SHOT_ADMIN` are Worker secrets; `.dev.vars` locally).
  The repo is public: no prospect names, no personal data, nothing in `private/`.
- No build step and no framework: plain ES modules, so the core runs everywhere unchanged.
- Every user-facing surface: works at 360px wide, 44px touch targets, loading, empty, error and
  success states, keyboard and screen-reader usable, no horizontal scroll.
- Copy in Liam's voice (see the brief). British English, no em dashes.
- Deploy with `npm run deploy` (tests, then `wrangler deploy`). No GitHub Actions.
