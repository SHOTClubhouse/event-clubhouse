// Prints how to give an organiser access: the curl command for POST /api/shot/organisers and
// what to do with the answer. It sends nothing itself.
//
//   node scripts/organiser.js "Organiser name" [--site https://events.shotclubhouse.com]

const argv = process.argv.slice(2);
const i = argv.indexOf("--site");
const site = (i >= 0 ? argv[i + 1] : process.env.SITE || "https://events.shotclubhouse.com").replace(/\/$/, "");
const name = argv.filter((a, n) => !a.startsWith("--") && argv[n - 1] !== "--site").join(" ").trim();

if (!name) { console.error('Add the organiser\'s name: node scripts/organiser.js "Organiser name"'); process.exit(1); }

const body = JSON.stringify({ name }).replace(/'/g, "'\\''");

console.log(`Run this with SHOT_ADMIN set to the Worker's SHOT_ADMIN secret:

  curl -s -X POST ${site}/api/shot/organisers \\
    -H "X-Shot-Admin: $SHOT_ADMIN" \\
    -H "Content-Type: application/json" \\
    -d '${body}'

The answer is { "id": "...", "key": "ABCD-EFGH-JKMN-PQRS" }. The key is shown once and only a
hash is stored, so send it to the organiser straight away.

The organiser signs in with the key (POST /api/auth/organiser) and creates events with
POST /api/events. Each new event comes back with its first admin code. New events are unlisted
(reached by their link only). To list one on the public events page:

  curl -s -X POST ${site}/api/shot/events/<slug>/listing \\
    -H "X-Shot-Admin: $SHOT_ADMIN" -H "Content-Type: application/json" -d '{"listed":true}'
`);
