# Product brief: SHOT Event Clubhouse

## What it is

An event runs on SHOT before, during and after the day. The proposition, as in the decks, is
**"Build your Cultural Clubhouse"**: the event isn't a one-day ticket, it's a clubhouse people
join before, live in on the day, and stay in afterwards.

| Stage | Where it lives today | What people do |
|---|---|---|
| Before: pre-registration and access | The event's clubhouse page (web now, SHOT Clubhouse app later) | Register interest, get tickets (organiser's own ticketing link), see teams, fixtures, fight card, line-ups |
| On the day: the live event | The web (`/e/<slug>/`), no app download | Live scores across every pitch, tables, knockouts that fill themselves in, fight card and round results, fan voting (player of the game or fighter of the round), streams, the big screen |
| After: the community | The event's clubhouse page, then the SHOT Clubhouse | Results, champions, fan-vote winners, updates and content from the organiser, join the clubhouse for the next one |

Pre-access and post-access are the clubhouse; the day itself is the web, until it moves into the
app.

## Who uses it (the four dashboards)

- **Admin (organiser):** create the event, add teams or fighters, pitches, referees and judges,
  generate fixtures (like Tournify), issue access codes, run the day (vote switch, streams,
  announcements), post updates after, export registrations.
- **Referee (and timekeeper for boxing):** sign in once on a phone, see their games (or the
  bout), tap Live, + and -, FT. For boxing: start the bout, end each round, next round, record
  the result (points, KO, TKO, RSC, RTD, DQ, draw, no contest).
- **Judge (boxing):** score each round 10-9, 10-8 or 10-10 on their own card. Cards are private
  until the bout is decided.
- **Coach (team manager):** their squad (shirt numbers and names), their fixtures, pitch, ref,
  results and table position.
- **Fan:** everything above from the fan's side, plus voting and pre-registration.

## Sports and formats

- Football and variants (small-sided, futsal, beach soccer, street football, 7s): league,
  groups into knockouts, straight knockout; any number of pitches and referees; penalties for
  level knockout games; points per result configurable.
- Boxing (white-collar, amateur, prize-fight series): a fight card of bouts with rounds,
  judges' scorecards under the 10-point must system, stoppages, and a fan vote per round with a
  reason (style, pressure, defence, power) that adds up to a fans' fighter of the night.
- Fan voting by **shirt or athlete number** (default, safest), first name, or both. Full names
  never leave the server.

## Proof we can use (anonymised)

From a London street-football event, 3 October 2026, run on the engine this product is built
from: 38 games, 313 goals, about 400 referee updates, 188 fan votes from 71 phones, scores on
phones in 4 to 8 seconds and on the big screen in 6 to 14 seconds. Name no client, partner or
prospect in public copy; say "a London street-football event". Never claim a feature has been
used live unless it has (streaming has not yet been used live: say it is set up and tested with
the organiser before their event).

## Prospects (private only)

Per-prospect demos are unlisted events created from a private file that is never committed
(`private/`). The public site and the public repo never name a prospect. Public demo events are
generic: a beach soccer cup, a futsal finals day, a small-sided league night, a fight night.

## Copy rules

Liam's voice: British English, no em dashes, answer first, short sentences with verbs, no
AI-isms (moat, leverage, seamless, robust, innovative, game-changer, transformative, ecosystem,
journey, best-in-class, bespoke), no lists of fragments, no invented numbers. Selling copy shows
what works and what comes next; it never lists what didn't work. Public contact is
contact@shotclubhouse.com, never a personal address. Pricing is not on the site.

## Brand

SHOT brand: Anton display (upper case), Inter body, background #020304, panel #0a0c0e, teal
#1abc9c, gold #f7b613. The product site links https://shotclubhouse.com/shot.css and adds
namespaced classes; the app pages use `public/css/app.css` (same tokens, `ec-` classes). An
event may set its own accent colour and logo; SHOT stays as "Powered by SHOT". No gradients, no
stock photos, no invented fonts.
