# ADR-0157: The Identity Proof signing key is rotated by an operator, not on a schedule

Accepted · 2026-11-20 · #1385

### Decision

**Keepr Accounts does not rotate the key it signs Identity Proofs with on a schedule.** The jwt add-on's `rotationInterval` stays unset: the key made on the first Identity Proof signs every later one until an operator rotates it.

**An operator rotates it by expiring it.** Setting the current row's `expires_at` in the `jwks` table of the identity database to now makes the add-on mint a new key for the next Identity Proof. The expired key stays published at `GET /api/auth/jwks` for the add-on's grace period of thirty days, so an Identity Proof it signed, which lasts five minutes, keeps verifying; an App that meets the new key's id refetches the published keys once (`requestIdentity.ts`). Changing `NUXT_BETTER_AUTH_SECRET` instead makes every stored key unreadable and signs every User out (`README.md`), so it is never the way to rotate.

### Why

- **The add-on's rotation would not reach the key in use.** It sets an end only on a key it mints after rotation is switched on; the key each Installation already signs with has none and would sign for ever. Switching it on would rotate nothing until an operator expired that key by hand regardless.
- **The key never leaves the identity database.** It is stored encrypted with the sign-in secret, and only Keepr Accounts opens that database (ADR-0112). What rotation guards against, a key read without the operator knowing, needs that database and that secret together; the step that answers it is the operator's, made when they learn of it.
- **Each Identity Proof lasts five minutes.** A rotation needs no coordination with the Apps beyond the refetch they already make.

### Rejected alternatives

- **`rotationInterval` set, with the existing key expired by a migration.** Workable, but two isolates meeting an expired key at once each mint a successor, and every Installation's key then changes on a timer nobody watches. Revisit if a compliance regime asks for a fixed rotation period.
- **Rotating by changing the sign-in secret.** It signs every User out and orphans the stored keys.
