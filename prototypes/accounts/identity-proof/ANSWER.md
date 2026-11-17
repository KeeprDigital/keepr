# Spike 2: cookie to Identity Proof (#1256)

Throwaway. Kept on this branch as a primary source; never merged, not part of
any gate. Findings, not decisions: the build's decisions are its ADRs.

## Answer: it works

Better Auth 1.7.25's `jwt` plugin mints a signed Identity Proof from a session
cookie at `GET /api/auth/token` ("cookie in, token out"). A second Worker calls
it over a service binding and verifies the Identity Proof with `jose` against
`GET /api/auth/jwks`, with a fixed issuer and audience. Expired, wrong-issuer,
wrong-audience, unknown-key and tampered Identity Proofs are each refused.

## Setup

- `accounts/`: Worker `keepr-accounts`, standing in for Keepr Accounts:
  `betterAuth` with `emailAndPassword` (sign-up closed), `admin()`,
  `organization()`, `jwt({...})`, a `session.create.before` hook; memory
  adapter (Better Auth on D1 through Drizzle is already proven by Stream
  Keepr). `/spike/seed` and `/spike/forge` exist only for the spike.
- `app/`: Worker `spike-app`, `services: ACCOUNTS -> keepr-accounts`. It forwards
  the browser's `cookie` to `https://accounts.keepr.digital/api/auth/token`,
  fetches the JWKS the same way, and verifies with `jose.jwtVerify`
  (`algorithms: ['EdDSA']`). Keys are cached, and fetched again once on an
  unknown `kid`.
- Run, each in its own directory:
  `wrangler dev --port 8801` (accounts) and `wrangler dev --port 8802` (app).
  Then `GET :8801/spike/seed`, sign in at `:8801/api/auth/sign-in/email`
  (with an `origin` header), and `GET :8802/whoami` with the cookie.

## Configuration found to work

```ts
jwt({
  jwt: {
    issuer: 'https://accounts.keepr.digital',
    audience: 'https://keepr.digital',
    expirationTime: '5m',
    definePayload: async ({ user, session }) => ({ /* claims below */ }),
  },
  // Suggested: stops a signed token being made on every get-session
  // (`set-auth-jwt` header), which nothing reads.
  disableSettingJwtHeader: true,
}),
databaseHooks: { session: { create: { before: /* set activeOrganizationId */ } } },
```

- **Issuer and audience must be set.** With `baseURL` as an `allowedHosts`
  object (Stream Keepr's form), the plugin's default `iss`/`aud` is `""`. It
  falls back to `baseURL` only when that is a string.
- **One audience for every App.** `/token` takes no audience parameter, so
  every App gets the same `aud`. A per-App audience would need an endpoint of
  our own over `auth.api.signJWT` (server-only). One fixed audience meets the
  spec's "fixed values, not derived from the request's host".
- **The active Organisation must be set at sign-in.** The organization plugin
  leaves a new Session's `activeOrganizationId` null, so `org`, `orgRole` and
  `apps` would be empty until the User picks one. A `session.create.before`
  hook setting it to the User's first membership fixes that (measured: the
  claims are complete straight after sign-in). A switcher changes it later
  through `organization/set-active`.
- Keys: default `EdDSA` / `Ed25519`. The private key is stored encrypted with
  the auth secret in the `jwks` table, and created lazily by the first `/token`
  or `/jwks` call.

## Claims (measured)

| Claim | Value | Source |
|---|---|---|
| `sub` | User id | plugin default (`session.user.id`) |
| `sid` | Session id | `definePayload` |
| `email`, `name` | the User's | `definePayload` |
| `org` | active Organisation id, or `null` | `session.activeOrganizationId` |
| `orgRole` | `owner` / `admin` / `member`, or `null` | `member` row, read with `(await auth.$context).adapter` |
| `apps` | e.g. `{ stream: 'admin' }`: App to App role, only Apps with access | App access (a plain array in the spike; a table in the build) |
| `keeprAdmin` | `true` / `false` | `user.role` split on `,` includes `admin` (the admin plugin allows several roles) |
| `iat`, `exp` | `exp - iat = 300` | plugin |
| `iss`, `aud` | the fixed values above | plugin options |

`definePayload` gets only `{ user, session }`, not the endpoint context. Rows it
needs come through the module-scoped instance: `await auth.$context`, then its
`adapter`. In the build that is two reads per mint, member and App access. The
spike read App access from an array, so only the member read went through the
adapter.

## Measured

| Case | Result |
|---|---|
| valid cookie, straight after sign-in | 200, Identity Proof verified, claims as above |
| `updateAge` passed, then `/token` | the refreshed session cookie comes back as `set-cookie` on `/token`'s response, and the App passed it on (`renewedCookies: 1`) |
| no cookie | `/token` 401 `UNAUTHORIZED` |
| after sign-out, old cookie | `/token` 401 at once (no cookie cache) |
| `exp` in the past | `ERR_JWT_EXPIRED` |
| issuer `https://evil.example` | `ERR_JWT_CLAIM_VALIDATION_FAILED` (`iss`) |
| audience `https://other.example` | `ERR_JWT_CLAIM_VALIDATION_FAILED` (`aud`) |
| signed by an unpublished key | keys fetched again (`jwksFetches` 1 → 2), then `ERR_JWKS_NO_MATCHING_KEY` |
| payload swapped, signature kept | `ERR_JWS_SIGNATURE_VERIFICATION_FAILED` |

## Notes for the build

- Call host: the App called `https://accounts.keepr.digital/...` over the
  binding. A host outside `baseURL.allowedHosts` resolves to `fallback`
  (`utils/url.mjs`), so with a `fallback` set any host works. Calling with the
  production host keeps it obvious.
- `/token` is a GET, with no origin check to pass. `/jwks` is unauthenticated.
  Both are safe to be public, as the spec says.
- The renewed cookie has the same value and a fresh `Max-Age`. An App must copy
  every `set-cookie` from `/token` onto its own response.
- Key cache: an App holding keys for good breaks at the first rotation. It
  should fetch them again on an unknown `kid`, as above, with a rate limit in
  the build.
- The first key is created by a GET, which is a write. Two concurrent first
  calls on D1 could each create a key. Both would be published and valid, so
  this is harmless, but a deploy step that calls `/jwks` once avoids it.
