# ADR-0043: A Screen Mode key renamed after release is migrated in storage and accepted in its former spelling on a write

Accepted · 2026-10-22 · [#773](https://github.com/KeeprDigital/stream-keepr/issues/773)

### Decision

**Top Cut Bracket's key is `top-cut`, not `topCut`**, the one camelCase Screen Mode key; its Screen Output read was already `top-cut`. Its label and five others changed with it (Card Spotlight, Deck List, Top Cut Bracket, Feature Match Controls, Most Played Cards, Head-to-Head). A label is the Screen Mode Definition's alone and changes freely. A key is stored, so renaming one takes a migration; only `topCut` was renamed.

**A migration moved every stored use of the key**, until the second squash removed it along with every database that stored one (ADR-0083). It covered a Screen's `current_mode`, the `topCut` key of its `mode_configs` (in whatever mode the Screen is now), and the `topCut.` root of the owner slots its Top Cut Bracket Background Layers index under in `graphic_asset_references`. A Screen holding both keys kept the `top-cut` config, as a write does. Unlike ADR-0016's rename, this was a forward migration on released data, since ADR-0019's baseline was closed. A key renamed after the next release takes one again.

**A Screen write accepts the former key and stores the current one.** `FORMER_SCREEN_MODE_KEYS` (`shared/types/enums.ts`) maps each renamed key to its key now. The mode configuration PATCH route's `:mode`, and `currentMode` and the `modeConfigs` keys on Screen create and full update, read a former key as the current one. A `modeConfigs` carrying both keeps the current key's config. Every other unknown key is still refused, and nothing reads or answers a former key.

### Why

Deployed installations store `topCut` in all three places, and a key left behind in any of them is a Screen that no longer renders its mode, a config lost to a strict schema, or a Background Layer its output cannot resolve. A tab or Screen Output still running a build from before the deploy still sends `topCut`. Accepting it follows ADR-0037's former fields: a client that read a Screen before the change and writes it back is not refused over a spelling. Refusing would fail an operator's rename in the Edit Screen dialog, whose full write sends `modeConfigs` back as it read them, and the work in it would be lost.

### Consequences

- Nothing realtime or packaged carries a Screen Mode key that needed handling. `screen:updated` names only the Screen. Template Packages and Feature Match Layout Templates name only a graphics host (`broadcast-graphics`, `feature-match-overlay`), whose keys did not change.
- A tab or Screen Output on a build from before the deploy can still write, but it cannot render a Screen in `top-cut` mode, because its registry does not know the key. Reloading it, for example with the Screen `refresh` command, fixes it.
- Such a migration rewrites `mode_configs`, so the Deck Source update guard runs on each Screen it touches and re-proves that Screen's Deck Source, as on any write. A Screen whose Deck Source no longer resolves would stop the migration; the guards and ADR-0032 prevent one.
- `test/unit/server/schemas/formerScreenModeKeys.test.ts` covers the write paths. The migration's held-back test, which stored the former key in all three places and applied it, went with the migration (ADR-0083).

### Rejected alternatives

- **Rename the other keys to match their new labels** (`card`, `deck`, `top-cards`, `feature-match`). Each would take a migration of its own for no gain to an operator, who sees only the label.
- **Refuse a former key with a clear error.** It costs as much code as accepting it, and a stale tab's full write would fail rather than land.
- **Rewrite the baseline.** ADR-0019's squash was a one-time transition, and installations had applied `0000_baseline`. ADR-0083 rewrote it later, once production's database was to be wiped.
