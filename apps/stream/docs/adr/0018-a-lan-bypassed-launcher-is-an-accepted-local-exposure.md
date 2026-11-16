# ADR-0018: A LAN bypassed launcher is an accepted local exposure

Accepted · 2026-09-23

### Decision

**`pnpm dev:local:bypass` exists, and is `dev:local` (bound to `0.0.0.0`) plus the bypass assignment.** A `:bypass` suffix is the single mark of a launcher that arms the bypass and never changes where a launcher binds; this is the only bypassed launcher that leaves loopback. Everything in ADR-0017 holds.

### Why

Better Auth admits only the hostnames in `AUTH_ALLOWED_HOSTS` — the production domain and loopback — so a device reaching the dev server by LAN address cannot sign in, and without this launcher LAN testing had no route to operator pages (only Screen Outputs, which carry a capability, worked).

### Consequences

- While it runs, every machine that can reach this one has the Local Developer User's access. The exposure is bounded by the developer's network and the process lifetime; nothing ships, and deployed installations are unaffected.
- The README warns at the launcher's row rather than banning it.
- `test/unit/scripts/workerSmoke.test.ts` pins the launcher to its twin's `--host 0.0.0.0` and refuses the name in every unsuffixed script.

### Rejected alternatives

- **Add LAN hostnames to `AUTH_ALLOWED_HOSTS` and sign in for real** — a LAN address or `.local` name is per-machine, so it becomes a production-allowlist wildcard or a per-developer edit to committed code, and cross-host sign-in over plain http is its own cookie problem — all to buy a boundary on a network the developer already trusts.
- **Forward `--host` through `dev:bypass`** — fewer scripts, but LAN exposure becomes an unnamed flag instead of a launcher the README and test can point at.
