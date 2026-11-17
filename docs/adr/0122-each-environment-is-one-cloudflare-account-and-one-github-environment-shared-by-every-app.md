# ADR-0122: Each Environment is one Cloudflare account and one GitHub environment, shared by every app

Accepted · 2026-11-18 · [#1264](https://github.com/KeeprDigital/keepr/issues/1264), part of [#1258](https://github.com/KeeprDigital/keepr/issues/1258)

### Decision

**Each Environment has a Cloudflare account of its own.** Production's Installations run in the production account, staging's (#525) in the staging account. Every app's Installation in an Environment runs in that Environment's account.

**A Deploy job runs in the GitHub environment named after its Environment** (`production`, `staging`), whichever app it deploys. That environment deploys only from `main` and holds its account's `CLOUDFLARE_ACCOUNT_ID` and one `CLOUDFLARE_API_TOKEN` that can deploy every app in that account. An app joins the Deploy workflow with its deploy descriptor alone.

**Concurrency stays per Installation.** Each job's concurrency group is `deploy-<app>-<environment>`, so two apps deploy at once and one app's deploys run one at a time. Concurrency needs no GitHub environment.

This departs from #1258's decision 13, which gave each app × Environment its own GitHub environment and a token scoped to that app.

### Why

- **The boundary that holds is the account.** A token, a mistake or a wipe in staging cannot reach production's Workers, D1 databases or buckets, because they are in another account.
- **Within an account, a token cannot be scoped to one app.** Cloudflare can scope a token to individual Workers, and a redeploy that leaves its Custom Domain unchanged needs no more. But a deploy also applies D1 migrations and deploys Containers (Stream Keepr's validator), and D1 Edit and Containers Edit are granted only across the account, not per database or per container. A token for Stream Keepr could therefore migrate Keepr Accounts' database: per-app tokens would isolate nothing that matters.
- **Every app in an Environment must share its account anyway.** An App calls Keepr Accounts through a service binding, which reaches only Workers in the same account.
- **One copy of each secret per Environment.** Per-app environments would hold copies of the same values, one per app × Environment, each to rotate.
- **A run's apps are approved together anyway** (#1258 decision 20).

### Consequences

- The existing `production` GitHub environment serves the Deploy workflow as it is.
- Staging (#525) adds one GitHub environment, `staging`, holding the staging account's ID and token, for every app.
- **A Custom Domain must be on a zone in the same account as its Worker**, and `keepr.digital` is in the production account. Delegating `staging.keepr.digital` to the staging account as a zone of its own is an Enterprise-only Cloudflare feature, so staging's hosts (#1258 decision 18, `*.staging.keepr.digital`) need a domain of their own on the staging account, or that plan. #525 decides which.
- Within an account, apps are told apart by name: Workers `<app>` and `<app>-<part>`, other resources `<app>-<purpose>`. People can be given per-Worker dashboard roles.
- **Revisit when Cloudflare scopes D1 and Containers per resource.** Then an app can have a GitHub environment and token of its own, Keepr Accounts first, since it holds identity. That change amends this decision.

### Rejected alternatives

- **A GitHub environment per app × Environment** (#1258 decision 13): a copy of every secret per app, and a per-app token still reaches every app's D1 database.
- **A Cloudflare account per app:** service bindings do not cross accounts, so Keepr Accounts and its Apps must share one.
- **A development account:** development runs locally (`wrangler dev`, local D1, R2 and KV, the Accounts Stand-in), and CI uses no Cloudflare account. What would need real resources outside staging can use the staging account.
