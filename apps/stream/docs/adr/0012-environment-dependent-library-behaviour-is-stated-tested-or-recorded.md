# ADR-0012: Environment-dependent library behaviour is stated, tested, or recorded

Accepted · 2026-08-20, census refreshed for 1.7.7 under #621 · [#438](https://github.com/KeeprDigital/stream-keepr/issues/438); secure-cookie prefix amended under [#451](https://github.com/KeeprDigital/stream-keepr/issues/451); rate limiter amended under [#697](https://github.com/KeeprDigital/stream-keepr/issues/697)

### Decision

Every test runs against libraries told they are under test: Vitest sets `NODE_ENV ??= 'test'`, `@nuxt/test-utils` never forces `production` here, and `@better-auth/core` captures `NODE_ENV` into a module constant at import, so nothing in-process can un-see it. Better Auth's origin check being off under test let a defect only a built Worker refused ship (#410, #397). For each site where the environment decides behaviour, in order of preference:

1. **State the option** when one value is right in every environment, taking the decision away from `NODE_ENV`.
2. **Construct the library under an environment the test controls** when no option exists — given the frozen constant, a child process.
3. **Record the blindness with its reason** when neither is worth its cost.

**The suite's `NODE_ENV` is not globally overridden.** It would change everything at once in a suite that has never run under another setting; stating options is reversible per site.

### The census

A grep of the pinned `better-auth`, `@better-auth/core` and `@better-auth/telemetry` dists for `isTest`, `isDevelopment`, `isProduction` and `NODE_ENV`. First taken at 1.6.29; re-run on 2026-10-21 at 1.7.7, the version `package.json` pins, which found the same sites plus the client store row. It did not audit Nitro, h3, Nuxt, Drizzle, Ably or anything else — a floor, not a ceiling. Stated options live in `server/utils/authOptions.ts`, each with its reason.

| Site                                                 | Under test                                                                  | Decision                                                                                                                                                                |
| ---------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Origin check defaults off                            | CSRF defence disabled                                                       | **Stated**: `advanced.disableOriginCheck: false` (#410)                                                                                                                 |
| `validateSecret` returns early                       | Weak or default secrets admitted silently                                   | **Tested**: `test/unit/server/utils/authSecretValidation.test.ts` constructs the library in a child process with `NODE_ENV=production`                                  |
| `rateLimit.enabled ?? isProduction`                  | Rate limiter off; so was the built Worker's (#697)                          | **Stated**: `rateLimit: { enabled: import.meta.dev !== true, storage: 'database' }` — on, counted in D1, on every built server; off on `nuxt dev` (#697)                |
| Client IP: header walk, then loopback under test/dev | Caller-writable `x-forwarded-for` read; header-less callers all `127.0.0.1` | **Split**: header stated as `advanced.ipAddress.ipAddressHeaders: ['cf-connecting-ip']`, pinned by `test/unit/server/utils/authClientIp.test.ts`; loopback **accepted** |
| Secure-cookie prefix falls back to `isProduction`    | Cookies unprefixed; so was the built Worker's, without `Secure` (#621)      | **Stated**: `advanced.useSecureCookies: import.meta.dev !== true` — `Secure` and `__Secure-` on every built server, neither on `nuxt dev` (#451)                        |
| Telemetry publishes only when `!isTest()`            | Suppressed                                                                  | **Stated**: `telemetry.enabled: false`                                                                                                                                  |
| `/error` page blanked in production                  | Suite sees a dev page                                                       | **Accepted blindness** — response shape only                                                                                                                            |
| Dev-only log lines                                   | Log output differs                                                          | **No action**                                                                                                                                                           |
| Vue client store readonly and devtools-registered    | Client session state is a readonly ref outside production                   | **No action** — client-side only                                                                                                                                        |

### Why the blindnesses are accepted

- **Loopback for header-less callers** is inside the library past every option; nothing keyed on client IP is distinguishable locally. The last case in `authClientIp.test.ts` pins the residual and fails if a bump changes it.
- **Blanked error page**: cosmetic; nothing about admission rides on it.

### Why the secure-cookie prefix is stated after all

It was accepted as a blindness on the premise that the fallback gave production `__Secure-` cookies. It did not: `isProduction` is `NODE_ENV` read at module load, nothing sets `NODE_ENV` in the Worker, and the built Worker under local workerd set an unprefixed `better-auth.session_token` without `Secure` (measured on #621). Stating it restores the premise; it is not a new cookie policy.

- **The value follows the kind of server, not the request.** No option means "secure exactly when the request is https", and the instance is built once. `import.meta.dev` is the build's own answer: Nitro replaces it with a literal (`false` in a build), so the uploaded artifact's value is a constant in its code. Anything not a Nitro dev build, the unit suite included, gets production's cookie.
- **This contradicts the earlier reasoning that `useSecureCookies` would be wrong on one side.** That held for a constant. `nuxt dev`, where people sign in over `http://localhost` every day, keeps the unprefixed, non-`Secure` cookie it always had, so a browser that does not count loopback as secure for cookies (WebKit has not, historically) still signs in there. What ships is the built artifact, so it alone is held to production's cookie, `pnpm preview` included; Chromium keeps a `Secure` cookie on loopback (measured with the acceptance browser).
- **Rejected**: `NODE_ENV=production` in the Worker build flips every `isProduction` site in the census at once, the rate limiter among them, to fix one. A Worker var is a deploy setting that a forgotten value silently undoes.
- **Observed**: `pnpm worker:smoke` refuses a built Worker whose session cookie is not `__Secure-`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`; `test/unit/server/utils/authSessionCookie.test.ts` holds the server's options to it over `http://`; `test/integration/auth.test.ts` pins the dev server's unprefixed cookie. The deployed origin sets that cookie, host-only: observed on 2026-10-21 against v1.5.0 (#451). Session renewal there is still #451's to observe, 24 hours after a sign-in on the 1.6.0 deploy.
- **On deploy, signed-in browsers sign in once more.** Better Auth's session read uses only the name it is configured with, so a leftover unprefixed cookie admits nothing and refuses nothing; its D1 Session lapses under the ordinary 7-day expiry.

### Why the rate limiter is stated after all

It was accepted as a blindness on the premise that production's limiter was on. It was not: `enabled` falls back to `isProduction`, and nothing sets `NODE_ENV` in the Worker. The pinned library, constructed with these options and no `NODE_ENV`, reported `enabled: false`, and the built Worker under local workerd answered a client's fourth sign-in within ten seconds 401 rather than 429 (measured on #697).

- **The same split as the cookie, for the same reason.** On in every built server, `pnpm preview` included, and in the unit suite; off under `nuxt dev`. The old objection to `true` still holds for the dev server: every header-less caller there is one loopback client, and the integration and local-auth suites, like anyone signing in by hand, would share one three-attempt bucket. The unit suite takes production's limiter without that flake because each throwaway instance has its own database, so its buckets are per test.
- **Counted in D1 (`storage: 'database'`), not memory.** The default store is a module-level map, which on Workers is per isolate: a client whose requests land on several isolates gets each one's allowance, and an evicted isolate forgets. D1 has one primary, so a client has one count for the installation. The cost is a `rateLimit` table (migration `0001_since_v1_5_0`) and a read and a conditional write on every request to Better Auth's HTTP handler: sign-in, sign-out and the browser app's `get-session`. The server-side `getSession` every `/api/**` request makes does not pass through the limiter, so ordinary API traffic pays nothing. For a small team that is cheap.
- **The limits are the library's**: sign-in three per client per 10 seconds, reset requests three per 60, everything else 100 per 10. The options do not restate them; the tests below assume the sign-in rule and fail if a bump changes it.
- **Rejected**: the memory store (above); KV `secondaryStorage`, which is eventually consistent and caps writes to one key at about one per second (ADR-0010's reason against KV sessions); the Workers Rate Limiting binding as `customStorage`, which counts per location and fixes one limit and period per binding, so each of the library's rules would need its own. Revisit the binding if the D1 queries show up in cost or latency.
- **Observed**: `pnpm worker:smoke` sends three wrong-password sign-ins from one generated `cf-connecting-ip`, each with a different `x-forwarded-for`, and requires a 429 with `X-Retry-After` on the fourth. A sign-in from a second generated address must then succeed, and the probes after it, which send no client header, must still sign in. `test/unit/server/utils/authRateLimit.test.ts` pins the same in process, and that the count is shared through one database and not across two. `test/integration/auth.test.ts` pins that the dev server does not limit.
- **Residual**: a built Worker reached with no `cf-connecting-ip` puts every such caller in one bucket. A deployment always has the header, because Cloudflare sets it. Locally that is `pnpm preview`, where a fourth sign-in within ten seconds is refused.

### Consequences

- A Better Auth bump has four tripwires: `authSecretValidation.test.ts`, `authClientIp.test.ts`, `authSessionCookie.test.ts` and `authRateLimit.test.ts`. Re-run the census (same grep) when an audited package moves majorly; the table is version-pinned, not evergreen.
- Sessions record the Cloudflare-vouched client IP, not whatever `x-forwarded-for` said, and the limiter's key survives a caller sending their own forwarding header.
- Anyone noticing the loopback collapse should land here before building a workaround.
