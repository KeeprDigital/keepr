# ADR-0136: `deploy:verify` waits out an unresolved name at its zone's nameservers

Accepted · 2026-11-19 · [#1320](https://github.com/KeeprDigital/keepr/issues/1320)

### Decision

**A target whose name does not resolve (ENOTFOUND) is waited for, apart from the retry budget**: up to two minutes from the first ENOTFOUND, asking again after 2, 4, 8, 16, then every 30 seconds. Every other failure keeps the budget it had: four tries, five seconds apart.

**After the first ENOTFOUND, every probe resolves the name at its zone's authoritative nameservers**, never through the system's resolver. The zone is the nearest name at or above the hostname with NS records; it and its nameservers' addresses come from the system's resolver, since they exist. The probe then connects to the address the nameservers give, under the hostname, so TLS and `Host` are unchanged.

### Why

- Keepr Accounts' first deploy (run 44434375425) probed its new custom domain 0.1 s after Wrangler attached it, in staging and in production, and got ENOTFOUND on all four tries. Re-run on a fresh runner a minute later, it passed.
- The runner's resolver (systemd-resolved, and the upstream it forwards to) caches that NXDOMAIN for the zone's negative TTL: the SOA minimum, 1800 s on both Keepr zones. A probe that waited two minutes through the same resolver would read the same cached answer. The authoritative nameservers cache nothing: they answer as soon as the record is in the zone.
- A public resolver (1.1.1.1, 8.8.8.8) caches negatives too. Asked first while the record is missing, it would hold the NXDOMAIN as the runner's does.

### Consequences

- `authoritative-dns.mjs` sends the probe's GET through `node:http(s)`, which accepts a `lookup`: Node's `fetch` takes none without the `undici` package, which the tooling does not depend on.
- If the nameservers cannot be reached (a firewall that allows only the system's resolver), the probe fails as a transport failure within the ordinary budget, not as a two-minute wait.

### Rejected alternatives

- **Wait longer through the system's resolver.** The cached NXDOMAIN outlasts any wait a deploy should make.
- **Have the deploy procedure wait for the name before verifying.** It would need the same uncached resolution, and only `deploy:verify` knows the target, which `KEEPR_DEPLOY_URL` can change.
