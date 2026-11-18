---
'@keepr/stream': major
---

The Graphics Administrator is a signed-in User holding the `admin` role, not whoever holds the shared `NUXT_GRAPHICS_ADMIN_TOKEN` (ADR-0131). `/admin/**` opens for that User's Session and no longer asks for a token; a User without the role is refused 403. The Evidence Ledger records which Graphics Administrator acted.

Operator steps, on each Installation (staging and production):

1. **Before deploying**, give each person who used the token an `admin` User. Every account the first-admin bootstrap made already holds it. For anyone else, run the bootstrap ceremony with their email (README § First admin account): it grants the role and sets the password you send, so have them change it with a reset link from `/admin/users`. Accounts made at `/admin/users` hold no role.
2. **After deploying**, delete the token: `pnpm exec wrangler secret delete NUXT_GRAPHICS_ADMIN_TOKEN --config .output/server/wrangler.json` (add `--env staging` for staging).
