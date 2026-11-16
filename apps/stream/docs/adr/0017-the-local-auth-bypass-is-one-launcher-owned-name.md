# ADR-0017: The local auth bypass is one launcher-owned name

Accepted · 2026-08-25 · [#519](https://github.com/KeeprDigital/stream-keepr/issues/519). Replaces the former ADR-0013; launcher list extended by ADR-0018.

### Decision

**`STREAM_KEEPR_LOCAL_AUTH_BYPASS=true` activates the Local Developer Session, and nothing else does.** It is set only on the command line of the `package.json` scripts ending in `:bypass` (`dev:bypass`, `dev:local:bypass`, `preview:bypass`); `.env` does not carry it and `.env.example` does not name it. It is deliberately not `NUXT_`-prefixed: no `runtimeConfig` key answers to it, and the prefix would advertise membership of the family `.env` holds — the one file it must never be in.

- **No build-time refusal.** A build has no opinion about local authentication.
- **The generated-configuration scan stays**: `pnpm worker:dry-run` (`build/localAuthDeployment.ts`) refuses generated Wrangler configuration containing the name anywhere, including named environment branches. It reads deployment output, not the environment a command ran in, so it cannot refuse a build, a suite or a bypassed launcher.

### Why

Activation used to take two values: `NUXT_LOCAL_AUTH_BYPASS` in `.env` plus `STREAM_KEEPR_LOCAL_RUNTIME` from supported launchers, so that a leaked, copied or bulk-uploaded `.env` was inert alone. It cost more than it protected: the build refused any non-dev build seeing the armed `.env` name, so a developer using the bypass could not run `pnpm build` and therefore not `pnpm verify`; the refusal had already needed a carve-out for `nuxt prepare` (#504); `pnpm preview` blanked the name to get past it; and two names kept implying one had to be set for a build or suite to pass.

1. **One name in no file is safer than the pair.** The second value existed to keep a file's value inert; a value never written to a file has nothing to carry between worktrees, into a secret store, or into a commit. Structural, not a policy to remember.
2. **The build refusal guarded nothing the artifact could carry.** Measured: the generated `.output/server/wrangler.json` declares no `vars`; the bundle reads the name from the Worker environment at request time; and `pnpm deploy` runs `pnpm build`, which wipes `.output`, before uploading, so nothing a preview stages survives into a deploy. Every smoke run re-measures it: the production artifact answers 401 by default (the `api-boundary` probe) and admits the Local Developer Session only when the name is in its environment.
3. **Its cost fell entirely on correct use** — it never fired on an attack or accident, only on developers running the mandated pre-push gate.

### Residual

Setting the name on a deployed Worker activates the bypass, and no runtime signal guards against it. Accepted as capability equivalence, not a likelihood bet: editing Worker vars or secrets needs the same Workers Scripts edit permission as deploying code, and either ships a new Worker version, so anyone able to stage this can already deploy an arbitrary Worker. The dry-run scan is the defence against the _accidental_ case and must not be weakened on the strength of this.

If Cloudflare access is ever split so that var/secret editing no longer implies deploy rights, or such a role goes to anyone untrusted with deploys, this ground collapses and the decision must be revisited.

### Rejected alternatives

- **A build-time constant disabling the bypass in production builds** — `pnpm worker:smoke` authenticates its probes by setting the name on the production `.output/` bundle under local workerd; hard-disabling it would break those probes or push smoke onto a special build, surrendering the "test the exact upload artifact" guarantee (the #302 class).
- **Refusing the bypass when a production-only binding is present** — contradicts the principle in `shared/utils/localDeveloperAuth.ts` that environment shape is never inferred from bindings, and the same access that sets the name can remove the sentinel.
- **Keeping the two-value scheme** — see _Why_.
