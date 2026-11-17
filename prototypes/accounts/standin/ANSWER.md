# Spike 1: Worker-to-Worker stand-in (#1256)

Throwaway. Kept as a primary source; not linted, run by CI, or merged.

## Answer: it works

An App under `nuxt dev` reaches a separately run stand-in accounts service over
a Cloudflare service binding, with no in-process fallback needed. So does the
same App's built Worker under `wrangler dev` (the preview and smoke path).

## Setup

- `prototypes/accounts/standin`: a plain Worker, `name: "keepr-accounts"`,
  run with `wrangler dev --port 8799`.
- `apps/score/wrangler.dev.jsonc`: `services: [{ binding: "ACCOUNTS", service: "keepr-accounts" }]`,
  named by `nitro.cloudflare.dev.configPath`. Nitro's `cloudflare-dev` plugin
  hands it to wrangler's `getPlatformProxy`, which resolves the service through
  wrangler's local dev registry.
- `apps/score/wrangler.jsonc`: the same binding; Nitro copies it into
  `.output/server/wrangler.json`.
- `apps/score/server/api/whoami.get.ts`: `event.context.cloudflare.env.ACCOUNTS.fetch(...)`,
  forwarding the request's `cookie` and appending every `set-cookie` it gets back.

## Measured (wrangler 4.161.0, miniflare 5.20261110.2-beta, Nitro 2.13.6, Nuxt 4.6.4)

| Case | Result |
|---|---|
| `nuxt dev`, stand-in up | 200; stand-in saw the forwarded `cookie`; its `set-cookie` reached the browser |
| `nuxt dev`, stand-in stopped | binding answers 503, body `Worker "keepr-accounts-standin" not found. Make sure it is running locally.` (no throw) |
| stand-in restarted, `nuxt dev` left running | 200 again: the registry reconnects without restarting the App |
| built Worker (`wrangler dev --config .output/server/wrangler.json`) | wrangler lists `env.ACCOUNTS (keepr-accounts) Worker local [connected]`; 200, cookie and `set-cookie` pass both ways |
| `wrangler.dev.jsonc` edited while `nuxt dev` runs | not picked up; restart the dev server |

## What the build should take from this

- Bind by the **production** service name (`keepr-accounts`) in every config.
  The stand-in registers under that same name, so running the real Keepr
  Accounts locally (story 69) is a drop-in: start it instead of the stand-in.
  No App config differs between "stand-in" and "real accounts" locally.
- The binding never throws when nothing is registered: it answers 503 with a
  text body. The shared identity function must treat a non-2xx or non-JSON
  answer as "unreachable" (fall back to a cached Identity Proof, else refuse).
- The URL host passed to `ACCOUNTS.fetch` is arbitrary and reaches the callee
  unchanged (`https://accounts.internal/...` above). Better Auth derives its
  base URL from the request host, so the host Apps call with must be one
  Keepr Accounts' `baseURL.allowedHosts` admits (or the call can use the
  production host, `https://accounts.keepr.digital/...`).
- Dev setup must start the stand-in before, or beside, the App; order does not
  matter for correctness, only for the first request.
- Fallback (in-process stand-in compiled out of production) is **not needed**.
