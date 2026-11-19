---
'@keepr/stream': major
---

Stream Keepr's pages hear realtime through their Event's Durable Object, and Ably is removed (ADR-0137, ADR-0140, ADR-0143). A page opens one socket for the Event it is on, at `/realtime/socket` on the Installation's own host: an operator's page as its Session, and a Screen Output with a ticket it is given for its Screen Output Asset Capability at `POST /api/realtime/ticket`. Ably's SDK, `GET /api/realtime/token` and every reader of `NUXT_ABLY_API_KEY` are gone, and a deploy no longer requires that secret. A page that is refused says "Live Updates Unauthorized" as soon as it is refused, where a token that could not be had took about 8 s to show. It ships in one Release with the server's publish to the object and with who a socket's caller is: without the second, every socket is refused.

Operator steps, for each Environment (staging, then production):

1. **Once this Release is live in an Installation**, reload every operator page and every Screen Output left open across the deploy, an OBS browser source included. A page loaded before it still listens on Ably, where nothing is published any more, and does not reload by itself.
2. **Once this Release is live in an Installation and you will not roll it back**, delete the Worker secret: `pnpm exec wrangler secret delete NUXT_ABLY_API_KEY --config .output/server/wrangler.json` (add `--env staging` for staging). Then remove the `NUXT_ABLY_API_KEY` field from the 1Password items `stream-staging` and `stream-production`.
3. **Then close the Ably apps** those two keys belonged to, and the Ably account if nothing else uses it.

Do not delete the secret before this Release is live. The Release it replaces signs every page's realtime token with it, so without it no page has live updates, and a deploy of that Release, a rollback included, refuses an Installation that lacks it. From this Release on nothing reads it: nothing breaks while it remains, and nothing breaks when it goes.
