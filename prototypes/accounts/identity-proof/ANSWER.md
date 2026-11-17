# Spike 2: cookie to Identity Proof (#1256)

Throwaway. Kept as a primary source; not linted, run by CI, or merged.

## Answer: it works

Better Auth 1.7.25's `jwt` plugin mints a signed token from a session cookie at
`GET /api/auth/token`, and a second Worker, calling it over a service binding,
verifies it with `jose` against `GET /api/auth/jwks` with a fixed issuer and
audience. Expired, wrong-issuer, wrong-audience, unknown-key and tampered
tokens are each refused.

## Setup

- `accounts/`: Worker `keepr-accounts`: `betterAuth` with `emailAndPassword`
  (sign-up closed), `admin()`, `organization()`, `jwt({...})`; memory adapter
  (Better Auth on D1 through Drizzle is already proven by Stream Keepr).
  `/spike/seed` and `/spike/forge` are spike-only.
- `app/`: Worker `spike-app`, `services: ACCOUNTS -> keepr-accounts`. Forwards
  the browser's `cookie` to `https://accounts.keepr.digital/api/auth/token`,
  fetches the JWKS the same way, verifies with `jose.jwtVerify`.
- Run: `wrangler dev` in each directory (ports 8801, 8802).

## Configuration Keepr Accounts will use

```ts
jwt({
  jwt: {
    issuer: 'https://accounts.keepr.digital',
    audience: 'https://keepr.digital',
    expirationTime: '5m',
    definePayload: async ({ user, session }) => ({ /* claims below */ }),
  },
  // Recommended for the build: stops a token being signed on every
  // get-session (`set-auth-jwt` header), which nothing reads.
  disableSettingJwtHeader: true,
})
```

- **Issuer and audience must be set.** With `baseURL` as an
  `allowedHosts` object (Stream Keepr's form), the plugin's default `iss`/`aud`
  is `""`: it falls back to `baseURL` only when that is a string.
- **One audience for every App.** `/token` takes no audience parameter, so
  every App gets the same `aud`. A per-App audience would need an endpoint of
  our own over `auth.api.signJWT` (server-only). One fixed audience meets the
  spec's "fixed values, not derived from the request's host".
- Keys: default `EdDSA` / `Ed25519`; the private key is stored encrypted with
  the auth secret in the `jwks` table; created lazily by the first `/token` or
  `/jwks` call. Apps should pin `algorithms: ['EdDSA']`.

## Claims (measured token)

| Claim | Value | Source |
|---|---|---|
| `sub` | User id | plugin default (`session.user.id`) |
| `sid` | Session id | `definePayload` |
| `email`, `name` | User's | `definePayload` |
| `org` | active Organisation id or `null` | `session.activeOrganizationId` (organization plugin) |
| `orgRole` | `owner` / `admin` / `member` or `null` | `member` row, read via `(await auth.$context).adapter` |
| `apps` | `{ stream: 'admin' }`: App to App role, only Apps with access | our App access table |
| `keeprAdmin` | `true` / `false` | `user.role === 'admin'` (admin plugin) |
| `iat`, `exp` | `exp - iat = 300` | plugin |
| `iss`, `aud` | fixed values above | plugin options |

`definePayload` is handed only `{ user, session }`, not the endpoint context.
Rows it needs come from `await auth.$context` (the module-scoped instance) and
its `adapter`: two reads per mint (member, App access).

## Measured

| Case | Result |
|---|---|
| valid cookie | 200, token verified, claims as above |
| `updateAge` passed, then `/token` | the refreshed session cookie comes back as `set-cookie` on `/token`'s response; the App passed it on (`renewedCookies: 1`) |
| no cookie | `/token` 401 `UNAUTHORIZED` |
| after sign-out, old cookie | `/token` 401 at once (no cookie cache) |
| `exp` in the past | `ERR_JWT_EXPIRED` |
| issuer `https://evil.example` | `ERR_JWT_CLAIM_VALIDATION_FAILED` (`iss`) |
| audience `https://other.example` | `ERR_JWT_CLAIM_VALIDATION_FAILED` (`aud`) |
| signed by an unpublished key | `ERR_JWKS_NO_MATCHING_KEY` |
| payload swapped, signature kept | `ERR_JWS_SIGNATURE_VERIFICATION_FAILED` |

## Notes for the build

- The call host must be one `baseURL.allowedHosts` admits; the App called
  `https://accounts.keepr.digital/...` over the binding, which is listed.
- `/token` is a GET with no origin check to pass, and `/jwks` is unauthenticated:
  both safe to be public, as the spec says.
- The renewed cookie has the same value with a fresh `Max-Age`; an App must
  copy every `set-cookie` from `/token` onto its own response.
- The lazy first key creation is a write on a GET. Two concurrent first calls
  on D1 could each create a key; both would be published and valid. Harmless,
  but a deploy step that calls `/jwks` once avoids it.
