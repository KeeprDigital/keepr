# ADR-0041: A Screen write owns only its fields, finishes for its own Event, and sends a cleared field as a deletion

Accepted · 2026-10-21 · [#703](https://github.com/KeeprDigital/stream-keepr/issues/703)

### Decision

**The client shows a Screen as its newest server revision with every unsettled write's fields laid over it** (Field Ownership, in `app/modules/screen/runtime.ts`). Each write owns the fields it names: an ordinary Screen update its top-level fields, a mode-configuration write the config fields it patches, and a Screen Theme Override write the tokens it names. A revision from any door — a write's answer, a conflict refresh, an announced reload, a load — replaces only the revision underneath, and only when it is not older than the one held, so nothing moves a Screen's `stateVersion` backwards. A write that settles drops only its own fields. A failed write therefore rolls back to what the server holds now, keeping a remote change that landed meanwhile, and never over a newer local edit. A write answers its caller with the newer of its answer and the server revision held, never with another write's unsettled fields. A Screen deleted while a write to it was out stays deleted, whichever way the write ends.

**Every write of one Screen runs in one queue**, whichever part of the Screen it names, and is sent at the revision the write before it was answered with. Independent settings edited at once no longer race each other into a conflict.

**A Screen write keeps what it needs to finish for its own Event after that Event Lifetime ends.** The lifetime records the newest revision of each Screen it held or a write in it was answered with, and a write still queued when the operator moves on is sent, and its conflict retried, at that revision. Its store effects stay gated by the lifetime, as ADR-0024 decided: an answer, rollback or error from a finished lifetime touches nothing of the next one's. The caller is still answered, and a refusal still rejects it. This amends ADR-0024, whose "anything it starts afterwards" read as covering the write and its conflict refresh too: those now run for the ended lifetime, against its own record of revisions, and only their effects are gated.

**A settings surface hands off every queued edit when it ends**, whether or not its debounce has fired and whether or not a save is in flight (`useConfigUpdate`). An edit made during a save used to wait for that save's continuation, which ran after the reset had emptied the store, so it was lost.

**A field an edit names with `undefined` is sent as the `null` that deletes it** (`toModeConfigPatch`). JSON omits `undefined`, and the server reads an omitted field as unchanged (ADR-0037), so clearing an Archetype filter, custom header or Player List kept the old value. An authored stack named with `undefined` is left out instead, so a clear never empties one. Omission still means unchanged. The edit type (`ScreenModeConfigPatch`) takes `null` for every field without changing the complete config type, and the settings editors write `null` when an optional field is cleared. A cleared field reads as its contract default at once, so it does not snap back.

### Why

A write's v2 answer replaced a v3 the client already held. A failed write restored a whole snapshot from before it, erasing whatever had landed since. Resetting the Event stores during a save dropped the edit queued behind it, and a write retried after the reset was sent at version 0. A cleared optional field reached the server as nothing.

### Consequences

- Every write of a Screen waits its turn, so a mode-configuration and a Screen Theme Override write to one Screen no longer run concurrently. Writes to different Screens still do.
- A loader's revision is laid under unsettled edits too, so a page load cannot take back an edit still out.
- A display reset now clears a default that is `undefined`, such as a custom header, where it used to leave the stored one.
- An edit queued behind a save is sent once, by the hand-off, rather than by that save's continuation.
- `test/nuxt/stores/screenWriteOwnership.test.ts` orders every answer by hand against the store; `test/nuxt/composables/screen/screenSettingsSaves.test.ts` drives the configuration composable through an Event reset and a server that answers through JSON with the real PATCH schema and merge; `test/nuxt/components/Screen/Modes/clearingOptionalSettings.test.ts` clears each optional field in the Metagame, Most Played Cards, Standings, Player History, Pairings, Top Cut Bracket, Archetype Spotlight and Head-to-Head editors.

### Rejected alternatives

- **Gate write answers on the write's own per-key Flight**, as before. It refused an answer when a newer edit of the same key began, and a newer revision from anywhere else never stopped it.
- **Drain every write before the reset completes.** Navigation would wait on the network, and a write queued behind another would still need its revision from somewhere.
- **Treat `undefined` as omission and fix only the editors.** The display reset sends the contract's `undefined` defaults, and any other caller could repeat the mistake; the type system cannot refuse `undefined` without `exactOptionalPropertyTypes`.
