-- SHOT Event Clubhouse, Cloudflare D1. Apply with: npm run db:local  /  npm run db:remote
-- Safe to re-run: every statement is IF NOT EXISTS.

-- One row per event. doc is the whole event document (public/core/model.js), rev increments on
-- every save so clients can poll cheaply and two saves can never silently overwrite each other.
CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  organiser   TEXT,                       -- organisers.id that created it (NULL for seeded demos)
  demo        INTEGER NOT NULL DEFAULT 0, -- 1 = a demo event anyone can reset
  listed      INTEGER NOT NULL DEFAULT 1, -- 0 = unlisted (private prospect demos): never in /api/events
  doc         TEXT NOT NULL,
  rev         INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Who may create events. SHOT issues organiser keys; only the hash is stored.
CREATE TABLE IF NOT EXISTS organisers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  key_hash    TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL,
  revoked     INTEGER NOT NULL DEFAULT 0
);

-- Access codes for one event: admin, referee (per official), judge (per official), coach (per
-- team). A code is shown once when created; only its hash is stored. Signing in on a phone
-- stores a signed token, so the phone stays signed in ("saves the device").
CREATE TABLE IF NOT EXISTS codes (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL,
  code_hash   TEXT NOT NULL UNIQUE,
  role        TEXT NOT NULL,              -- admin | referee | judge | coach
  subject     TEXT,                       -- official id (referee/judge), team id (coach), NULL (admin)
  label       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  revoked     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS codes_event ON codes (event_id);

-- Fan votes: one row per phone (voter id) per target (a game or a boxing round), changeable
-- until that target locks.
CREATE TABLE IF NOT EXISTS votes (
  event_id    TEXT NOT NULL,
  voter       TEXT NOT NULL,
  target      TEXT NOT NULL,
  choice      TEXT NOT NULL,
  reason      TEXT,
  ip_hash     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (event_id, voter, target)
);
CREATE INDEX IF NOT EXISTS votes_target ON votes (event_id, target);
CREATE INDEX IF NOT EXISTS votes_ip ON votes (ip_hash, created_at);

-- Pre-registration (the clubhouse before the day). Personal data: first name and email only,
-- with the exact consent wording the person agreed to. Never public; admin export only.
CREATE TABLE IF NOT EXISTS registrations (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL,
  first_name  TEXT NOT NULL,
  email       TEXT NOT NULL,
  consent     TEXT NOT NULL,
  ip_hash     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  UNIQUE (event_id, email)
);

-- Sign-in attempts per connection, to slow down code guessing.
CREATE TABLE IF NOT EXISTS attempts (
  ip_hash     TEXT NOT NULL,
  at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS attempts_ip ON attempts (ip_hash, at);
