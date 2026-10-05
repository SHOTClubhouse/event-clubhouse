# The event's clubhouse (doc.clubhouse)

The day runs on the web. Before and after it, people live in the event's clubhouse: membership, culture and music, the community, and rewards for turning up. In the demos this is a preview of what the SHOT Clubhouse gives an organiser, and it is labelled as a preview.

## Document

```js
doc.clubhouse = {
  on: true,                       // show the Clubhouse tab
  intro: "One line on what the clubhouse is for this event",          // up to 300
  members: 0,                     // a count shown as social proof (demo figure), 0 hides it
  tiers: [                        // 0 to 4
    { id: "M1", name: "Member", benefits: ["Early access to tickets", "..."], price: null }   // price: null shows "Price set by you"; else up to 30 chars
  ],
  culture: {
    playlist: null | "https://open.spotify.com/playlist/<id>",     // also album, artist, show
    lineup: [ { time: "HH:MM" | null, name: "DJ ...", role: "DJ" | "Live" | "MC" | "Host" | "Artist" | "Guest" } ],   // 0 to 12; "Guest" shows as a special guest card
    drops: [ { id: "K1", title: "Matchday shirt", body: "...", when: "Out now", exclusive?: true | false } ],  // 0 to 6, merch, content, kit; exclusive shows "Members only"
  },
  community: {
    posts: [ { id: "W1", who: "First name or team", text: "...", kind: "post" | "photo" | "shoutout", ago: "2h" } ],   // 0 to 12, invented in demos
    next: [ { date: "YYYY-MM-DD", title: "...", where: "..." } ],                                                   // 0 to 6
  },
  rewards: [                      // 0 to 8, patches: reward acts, not scores
    { id: "B1", name: "Founding fan", how: "register" | "vote" | "attend" | "streak" | "share", text: "Registered before the day" }
  ],
}
```

Limits: names up to 60 characters, text up to 300, benefits up to 8 per tier at 80 characters each, ids by the model's ID rule. `playlist` must match `^https://open\.spotify\.com/(playlist|album|artist|show)/[A-Za-z0-9]{10,40}`. The page embeds it as `https://open.spotify.com/embed/<type>/<id>`, and the CSP allows `frame-src https://open.spotify.com`.

- **No prices in demos.** `price: null` everywhere, and the page says "Price set by you".
- **Juniors events.** The page never shows posts that name under-18s. Demo posts for juniors events come from teams and the organiser only.
- **`publicView`.** The clubhouse passes through unchanged. Nothing in it is private.
- **Ops.** `clubhouse.set { clubhouse }` (admin) replaces the whole object, which is validated.

## Rewards on the fan's device

The demo tracks progress on the fan's own device (localStorage). Nothing is sent or stored on the server.

- `register` unlocks when the fan pre-registers.
- `vote` unlocks after their first vote.
- `attend` unlocks when they open the page while the event is live.
- `streak` and `share` show as locked, with "Unlocks in the Clubhouse app".

The member card shows the first name the fan registered with (kept on their device), the event's accent and logo, and "Member preview". The Clubhouse tab sits on the fan page in every phase. Before the day it leads with joining and the line-up. On the day it leads with rewards and the playlist. After the day it leads with the community and the next dates.
