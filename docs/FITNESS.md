# Fitness competitions (sport "fitness")

The third event type, next to football and boxing. One model covers two shapes of event:

- **Timed race** (`ranking: "time"`): athletes start in waves and work through a fixed sequence of runs and stations. Each split is the time since the wave started. The fastest finish wins its category.
- **Workout games** (`ranking: "placings"`): athletes or pairs do the same workouts in heats. Each workout is scored (a time, reps or a load) and ranked within the category. The lowest total of placings wins.

Everything below is the contract between the core (public/core/fitness.js, model.js, ops.js, votes.js), the Worker views, the simulation and the pages.

## Document

```js
doc.sport = "fitness"
doc.pitches = []            // not used
doc.divisions = []          // not used
doc.fixtures = []           // not used
doc.card = { bouts: [] }    // not used
doc.comp = {
  ranking: "time" | "placings",
  segments: [               // 1 to 20, in the order they are done
    { id: "S1", name: "Run 1", measure: "time" | "reps" | "kg" }
  ],
  categories: [             // 1 to 16
    { id: "C1", name: "Open Women", size: 1 | 2 | 4 }   // athletes per entry: single, pairs, relay
  ],
  heats: [                  // 0 to 120
    { id: "H1", time: "HH:MM", name: "Wave 1", category: "C1" | null, state: "scheduled" | "live" | "done", startedAt: null | ms }
  ],
  entries: [                // 0 to 800
    { id: "A1", bib: 101, name: "Full Name" | "Name One & Name Two", club: "", category: "C1", heat: "H1" | null,
      results: [null | number, ...],   // one per segment, same length as segments
      state: "ready" | "racing" | "finished" | "dnf" | "dns" }
  ],
}
```

- `ranking: "time"`: every segment has `measure: "time"`. `results[i]` is the whole seconds from the wave start to the end of segment i, so the values are cumulative and must not go down. The finish time is the last segment's result.
- `ranking: "placings"`: `results[i]` is that workout's score. A `time` measure is lower-is-better; `reps` and `kg` are higher-is-better. Numbers run from 0 to 100000, and times are in whole seconds.
- A bib is a whole number from 1 to 99999, unique in the event.
- Ids match the model's `ID` rule and are unique within their list. An entry's category must exist. Its heat, if one is set, must exist, and a heat's category, if one is set, must match the entry's.
- `settings.voteBy` decides how athletes appear in public: `number` shows "#101", `name` shows first names, and `both` shows "#101 Sam". For pairs, each name is cut to its first name: "Sam & Alex".
- `settings.terms.discipline` is free text, e.g. "Fitness race". `settings.terms.place` may be "arena" (the default for fitness) or "floor". Add "floor" to PLACES.

## Leaderboard (public/core/fitness.js)

`leaderboard(doc, categoryId)` returns rows `{ id, bib, label, rank, state, done, total, points, last }`, best first.

- **time**: finished entries come first, by finish time. Racing entries follow, by segments done (most first) and then by their latest split. dnf entries come next and dns entries come last, and neither group is ranked. `total` is the finish seconds or null, `done` is the segments completed, and `last` is the latest split.
- **placings**: for each segment, rank the category's entries that have a score (ties share a rank). An entry with no score for a segment takes rank = the number of entries in the category. `points` is the sum of ranks and lowest wins. A tie on points goes to the better rank on the last segment, then to the lower bib.

Helpers: `fmtTime(secs)` gives "1:05:32", or "4:07" when under an hour. `onCourse(doc)` gives the live heats, each with its entries and their current segment. `nextHeats(doc, n)`. `entryLabel(entry, voteBy)`.

## Ops (public/core/ops.js)

Roles: `admin` can do everything. `referee` is a fitness judge or timekeeper and can do the race-day ops for any heat. Coaches and judges have no fitness ops.

| op | role | effect |
|---|---|---|
| `heat.start {id}` | admin, referee | state live, startedAt now, and its ready entries become racing |
| `heat.end {id}` | admin, referee | state done. Racing entries with every result become finished, the rest dnf |
| `heat.reopen {id}` | admin | back to live |
| `result.set {entry, segment, value}` | admin, referee | sets results[segment] (null clears it). For time ranking it refuses a value lower than an earlier split. An entry with every result becomes finished |
| `entry.state {entry, state}` | admin, referee | ready, racing, finished, dnf or dns |
| `comp.set {ranking?, segments?, categories?}` | admin | refused once any result exists, unless force |
| `heat.add/edit/remove` | admin | edit fields: time, name, category |
| `entry.add/edit/remove` | admin | edit fields: bib, name, club, category, heat |
| `entries.replace {entries}` | admin | the whole list (bulk import). Refused once any result exists, unless force |

## Votes (public/core/votes.js)

The fan favourite for each heat has target `h:<heatId>`, and the choice is an entry id in that heat. It is open while the heat is live and for `lockSecs` after it ends, when `settings.vote.open` is on. `tally` gives each target's leaders, the same as football games.

## Views

`publicView` keeps `comp` and runs entry names through the voteBy rule (the full names stay server-side, as with football players). The referee and admin views carry the full names.

## Simulation (src/sim.js)

- **Time races:** each entry gets a planned pace. A run takes about 4 to 6 minutes and a station 3 to 8 minutes, so a finish lands around 55 to 100 minutes. The demo runs about 5 times faster than real time, so a wave is over in about 15 to 20 minutes, while the splits shown are the realistic race times. A new wave starts about every 4 minutes. Waves are re-timed to the London clock like football games.
- **Placings games:** a heat's workouts finish one after another every few minutes, each entry gets a score, and the heat ends after the last workout.
- **Fan votes:** each live heat collects a few, as football games do. When every heat is done it waits and resets, like the other demos.

## Seeds

- `fitness-race`: live, time ranking, 8 runs plus 8 stations under generic names, categories Open Women, Open Men, Pro Women, Pro Men, Doubles Mixed. 16 waves of 10, bibs from 101, and invented names only.
- `fitness-games`: live, placings ranking, three workouts (Strength in kg, Engine as a time, Metcon in reps), categories for individuals and pairs, 8 heats of 8.
- Both are `kind: "fitness"` with `recipes: true`. Recipe keys: name, venue, about, ranking, segments, categories, heats (count), perHeat, gapMins, terms.
