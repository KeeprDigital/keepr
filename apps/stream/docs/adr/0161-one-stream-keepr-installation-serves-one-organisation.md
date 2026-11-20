# ADR-0161: One Stream Keepr Installation serves one Organisation

Accepted · 2026-11-20 · [#1388](https://github.com/KeeprDigital/keepr/issues/1388) · Amends ADR-0141

Stream Keepr read only the App role from an Identity Proof (ADR-0141). No row it holds carries an Organisation, and the proof's Organisation was read nowhere. Keepr Accounts lets any Organisation's owner grant its members any App role, so the owner of a second Organisation could make themselves a Graphics Administrator and reach every Event, Screen and Graphic Asset of the Installation. The root glossary says an App role gives no access to an Organisation's data inside an App, and no decision said otherwise. Found by the 2026-11-20 codebase review.

### Decision

**One Installation serves one Organisation.** Each Installation names it in `NUXT_INSTALLATION_ORGANISATION_ID`, the id Keepr Accounts gives that Organisation. `server/utils/session.ts`, the one place that reads who a request belongs to, admits a User only while the Identity Proof's Organisation, the one they are working in, is that one. A User working in another Organisation, or in none, is refused exactly as a User with no App access is: 403 `NO_APP_ACCESS` on every route behind the Session boundary, an admin route included; `null` where a Screen Output route asks `optionalIdentity`; and a refused realtime socket. Whatever App role another Organisation gave them changes nothing. The page gate shows them `/no-access`, which sends them to Keepr Accounts, where they may switch to the Installation's Organisation.

**Unset, nobody is admitted.** An Installation that names no Organisation answers every request that requires a Session 503, naming the setting, before Keepr Accounts is asked; it never admits every Organisation. A Screen Output route reads that as no Session, as it reads an unreachable Keepr Accounts, so a Screen Output with its capability is unaffected. The setting is a Worker secret, though it is no secret: it differs per Installation, is recorded in 1Password and set by `pnpm secrets:sync` with the rest, and `deploy.jsonc` lists it in `worker.secrets`, so a deploy refuses an Installation that lacks it (ADR-0128).

**Locally the Installation's Organisation is the Accounts Stand-in's**, `keepr-local`, which every persona works in unless its cookie names another (`organisation=<id>`, or `none`). `nuxt dev`, and with it every integration server, names it through Nuxt's `$development` configuration; `pnpm preview` passes it to the built Worker as a Wrangler var; `pnpm worker:smoke` stages it with its other generated values. A build names none. This adds no way in without an Identity Proof (ADR-0141): it only narrows whose proofs are admitted.

### Why not scope every row by Organisation

Scoping each Event, Screen, Theme and Graphic Asset by Organisation would let one Installation serve several. Nothing needs that yet: Stream Keepr has one Organisation using it in each Environment. It would touch every table, every query and the installation-wide Graphics Asset Library and its quota, and each route would have to prove it filters. Refusing a foreign Organisation at the one place a request is read closes the hole now, with one check. Scoping is deferred until a second Organisation needs the same Installation; that decision would supersede this one.

### Consequences

- Deploying this needs an operator step: record each Installation's Organisation id in 1Password (`stream-staging`, `stream-production`, field `NUXT_INSTALLATION_ORGANISATION_ID`) and run `pnpm secrets:sync` for each Environment before Deploy. Until then the deploy refuses.
- The Staging acceptance operator must work in Staging's Installation Organisation, or the deployed gates are refused.
- A User who belongs to the Installation's Organisation and another must be working in the Installation's at Keepr Accounts to use Stream Keepr.
- A value of only digits reads as a number, as any `NUXT_*` value does, and is refused as configuration rather than compared.
