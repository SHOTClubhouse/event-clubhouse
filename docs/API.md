# Event Clubhouse API (the contract)

One Cloudflare Worker (`src/worker.js`) serves the static site from `public/`, the JSON API
under `/api/`, and the data in D1 (`schema.sql`). Every page and the API share one origin, so
there is no CORS. The browser client is `public/js/api.js`; pages never call `fetch('/api…')`
themselves.

The event document is defined in `public/core/model.js`, changes are ops from
`public/core/ops.js`, and voting rules are `public/core/votes.js`. The Worker imports those
modules directly, so the browser and the server run the same rules.

Errors are always `{ "error": "Plain English for the person on the phone." }` with an HTTP
status code: 400 bad input, 401 not signed in or expired, 403 not allowed, 404 not found,
409 conflict (stale rev, closed vote, rule refused), 422 the result would be an invalid event,
429 too many attempts.

## Pages (served by the Worker)

| Path | Page | File |
|---|---|---|
| `/` | Product site: what the Event Clubhouse is | `public/index.html` |
| `/demo/` | Demo hub: try every dashboard on live demo events | `public/demo/index.html` |
| `/e/<slug>/` | Fan app for one event (before, on the day, after) | `public/event/index.html` |
| `/e/<slug>/screen/` | Big screen for one event | `public/screen/index.html` |
| `/admin/` | Organiser and admin dashboard | `public/admin/index.html` |
| `/ref/` | Referee, timekeeper and judge dashboard | `public/ref/index.html` |
| `/coach/` | Coach and team manager dashboard | `public/coach/index.html` |

`/e/*` is rewritten by the Worker to the fan app or screen asset; the page reads the slug from
`location.pathname`. Responses for an unlisted event carry `X-Robots-Tag: noindex`, and so does
every page under `/e/` that belongs to an unlisted event.

## Auth

Codes look like `ABCD-EFGH-JKLM` (12 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`).
Codes are case-insensitive and dashes and spaces are ignored. Only `SHA-256(SECRET + ":" +
CODE)` is stored. A token is `base64url(payload).base64url(HMAC-SHA256(SECRET, payload))` with
payload `{ e: eventId, r: role, s: subject, c: codeId, x: expiresAtMs }`, valid 30 days. Every
staff request re-checks that the code is not revoked. Send it as
`Authorization: Bearer <token>`.

Roles: `admin` (the organiser's team, everything), `referee` (scores games, runs bouts,
streams), `judge` (scores rounds for bouts they judge), `coach` (their own squad).

Sign-in attempts are limited to 10 per connection per 10 minutes (429 after that).

### POST /api/auth
`{ code }` → `{ token, role, subject, label, event: { slug, name, sport } }`.
The code alone identifies the event. A wrong code gives 401 "That code didn't work. Check it
and try again."

### POST /api/auth/organiser
`{ key }` → `{ token, organiser: { id, name } }`. Organiser keys let someone create events.
Token payload `{ o: organiserId, x }`.

### POST /api/shot/organisers
Header `X-Shot-Admin: <SHOT_ADMIN secret>`. `{ name }` → `{ id, key }`. The key is shown once.
SHOT uses this to give an organiser access.

## Public

### GET /api/events
Listed events only: `{ events: [{ slug, name, sport, date, venue, phase, demo, theme }] }`,
demo events first, then by date.

### GET /api/events/:slug[?rev=N]
`{ rev, event }` where `event = publicView(doc)`. With `?rev=N` equal to the current rev the
answer is `204` with no body, which is what polling uses. `Cache-Control: no-store`.

### GET /api/events/:slug/votes
`tally(counts, doc, now)` from `core/votes.js`: `{ open, total, now: [...targets open now],
leaders }` for football or `{ open, total, now, rounds, fighters }` for boxing. Cached for 2
seconds per event.

### POST /api/events/:slug/votes
`{ voter, target, choice, reason?, over13: true, website? }`. Checked by `checkVote()`. One row
per (event, voter, target); voting again in the same target changes the vote. A connection may
cast at most 60 new votes a minute (429). Answer: `{ ok: true, mine: { target, choice,
reason }, tally }`.

### POST /api/events/:slug/register
Pre-registration for the event and its clubhouse.
`{ firstName, email, over13: true, consent: true, website? }` → `{ ok: true }` (also when the
email is already registered: `{ ok: true, already: true }`). Stores first name, lower-cased
email and the exact consent sentence:
`"<Organiser or event name> and SHOT Clubhouse can email me about <event name>, future events and the clubhouse. I can unsubscribe at any time."`
Limited to 10 a minute per connection. First name 1 to 40 characters, a plausible email,
13 or over required.

## Staff (token required)

### GET /api/events/:slug/full[?rev=N]
- admin: `{ rev, event, demo }` with the full document (private names included), plus
  `{ counts: { registrations, votes } }`. `demo` is true for demo and prospect demo events.
- referee, judge: `{ rev, event: publicView(doc), me: { id, name, role, pitch } }`. Judges also
  get their own cards: `event.scorecards` holds every card **they** have scored, even before the
  bout is done.
- coach: `{ rev, event: publicView(doc), me: { teamId, division }, squad: [full players of
  their own team] }`.
Supports `?rev=N` → 204 like the public endpoint.

### POST /api/events/:slug/ops
`{ ops: [ { op: "fixture.score", id, home, away }, ... ] }` → `{ ok: true, rev, event }` (the
same view as `/full` for that role). Applied with `applyOps(doc, ops, actor, now)` on the latest
stored document inside a compare-and-swap on `rev` (retried up to 5 times), so two referees
saving at once never overwrite each other. The actor is `{ role, id: subject }` from the token.
A refused batch changes nothing.

### PUT /api/events/:slug/doc
Admin only. `{ doc, rev }` replaces the whole document (import or restore). 409 if `rev` is not
current. The document must pass `validate()` and keep its slug.

### Codes (admin)
- `GET /api/events/:slug/codes` → `{ codes: [{ id, role, subject, label, created_at, revoked }] }`
- `POST /api/events/:slug/codes` `{ role, subject?, label }` → `{ id, code }`. The plain code is
  returned once only. referee and judge need an official id, coach a team id.
- `POST /api/events/:slug/codes/:id/revoke` → `{ ok: true }`. An event always keeps at least one
  admin code.

### GET /api/events/:slug/registrations[?format=csv]
Admin only. `{ count, rows: [{ first_name, email, consent, created_at }] }`, or a CSV download.

### POST /api/events/:slug/reset
Admin of a **demo** event only (403 otherwise): puts the demo back to its seed.

## Organiser

- `GET /api/organiser/events` → the organiser's events.
- `POST /api/organiser/events/:slug/session` → the same answer as `POST /api/auth`, an admin session for one of the organiser's own events (tied to the event's oldest live admin code). 404 if it isn't theirs.
- `POST /api/events` `{ name, sport, date?, slug? }` → `{ slug, adminCode, event }`. Creates the
  event from `blankEvent()`, an admin code, and links it to the organiser. Slug defaults to the
  name, lower-cased and dashed, with a short suffix if taken.

## Demo events

Seeded by `scripts/seed.js` from `src/seeds/*.js`: `beach-soccer-cup` (football, live),
`futsal-finals` (football, before the day), `sixes-league-night` (football, after the day) and
`fight-night` (boxing, live). Each has published demo codes for every role. A cron trigger keeps
the beach soccer cup and the fight night "always live": it plays games and rounds forward, adds
goals and fan votes, and resets them when they finish, so a prospect opening the demo at any time
sees a live day. Every demo also resets nightly at 04:00 London time. Demo codes cannot be revoked
(403); `POST /api/events/:slug/reset` puts a demo back.

### GET /api/demo
`{ events: [{ slug, name, sport, phase, live, blurb, codes: [{ role, label, code }] }] }`, in the
order beach soccer cup, futsal finals, sixes league night, fight night. Only seeded, listed demo
events appear. `live` is true for the two simulated demos and for any demo in phase `live`. The
plain codes are public on purpose (they only open demo events).

## Additions and details beyond the contract above

- **New events are unlisted.** `POST /api/events` creates the event with `listed = 0`, so it is
  reached by its link only (and carries `X-Robots-Tag: noindex`) until SHOT lists it:
  `POST /api/shot/events/:slug/listing` with header `X-Shot-Admin` and `{ "listed": true }` →
  `{ ok: true, listed }`.
- **Sign-in limit** counts failed attempts only (10 per connection per 10 minutes), so a venue
  full of referees behind one Wi-Fi address can all sign in. Organiser sign-in and the SHOT admin
  header share the same limit. Registration is limited to 10 attempts a minute per connection
  and votes to 60 new votes a minute.
- **Ops errors** carry `index` (the position of the op that was refused). A batch is all or
  nothing.
- **`POST /ops`** answers `{ ok: true, ...<the /full body for that role> }`.
- **Body limits:** 256 KB for every request, 1 MB for `PUT /doc`. Over the limit is 413.
- **`PUT /doc`** keeps the server's own `private` section (demo and simulation bookkeeping),
  which never appears in any response.
- **`GET /api/events/:slug`** and `/full` answer 204 when `?rev=` equals the current rev;
  `/full` still needs a valid token first.
- **Registrations CSV** guards against spreadsheet formulas (a leading `=`, `+`, `-` or `@` is
  prefixed with an apostrophe).
- **Pages:** `/e/<slug>` redirects to `/e/<slug>/`. Any other path under `/e/<slug>/` serves the
  fan app, except `/e/<slug>/screen/...` which serves the big screen. An unknown slug is a 404
  page. Pages get `X-Content-Type-Options`, `Referrer-Policy` and a Content-Security-Policy from
  the Worker (the Worker runs first for HTML pages, see `run_worker_first` in `wrangler.toml`).
