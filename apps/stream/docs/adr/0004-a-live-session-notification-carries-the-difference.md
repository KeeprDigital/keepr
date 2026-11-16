# ADR-0004: A Live Session notification carries the difference

Accepted · 2026-08-02 · [#168](https://github.com/KeeprDigital/stream-keepr/issues/168)

### Decision

`broadcastGraphicsLiveSession:commandApplied` carries **what the command changed**: the entries of `playout`, `inputs` and `sources` that differ, keyed by Broadcast Graphic id, `null` for a removal, measured against the live state the command was reduced onto. `BroadcastGraphicsLiveStateChange` is that description; `changedBroadcastGraphicsLiveState` applies it.

**When the difference does not fit, it is dropped and the peer reloads.** A payload over `MAX_REALTIME_MESSAGE_BYTES` (64 KiB) is published without its change, and a client given no change fetches the authoritative snapshot, as it already does for a sequence gap. The same applies to a notification the publisher cannot describe: a recognised command replay (answered with a snapshot possibly newer than the command) and a live state carrying a field this build does not recognise. That fallback bounds the message by construction — the part that scales with the show is the part that can be left out.

`MAX_GRAPHIC_INPUT_VALUE_LENGTH` is 1,200. It only has to exceed the 1,000-byte authored cap so an over-long value is storable and therefore showable as unavailable; the old 2,000 bought nothing and cost 96,000 bytes of worst case.

### Why

- **Not the whole live state**: at the sizes the authoring caps admit it reached 463,053 bytes, seven times the per-message limit, and failed silently because publication logs and swallows.
- **Not notification-plus-reload** (how #95 fixed `screen:updated`, per spec #60's "realtime is notification, snapshots are authority"): a Screen changes when an author saves, but live state changes on every accepted command, so that is a snapshot fetch per command per client. Worse, every output projects an animation phase from one authoritative start time, monotone in the current instant — an output that spends a round trip fetching joins the entrance part-played (a 500 ms enter fetched in 80 ms starts 16% in).
- **Not a whole Broadcast Graphic per change**: an Out changes a playout record of a few hundred bytes, but pairing it with the graphic's Graphic Input state made the worst-case Out fall back to a reload. Naming entries keeps it at 280 bytes.
- **Not finer than an entry**: naming values inside a Graphic Input state would buy one case (an edit to a graphic holding more than eleven fully loaded Graphic Inputs) at the cost of a second description with its own removal rules. Map entries are the granularity live state is keyed at, so no reducer can drift from it.

### Measured cost

Pinned in `test/unit/server/mappers/broadcastGraphicsCommandAppliedMeasurements.test.ts` against worst cases driven through the real reducer:

| case                                                             | whole live state | change      |
| ---------------------------------------------------------------- | ---------------- | ----------- |
| Out, worst case the caps admit                                   | 367,053 B        | **280 B**   |
| Set Input, realistic show (6 graphics, 8 inputs, 60-char values) | 7,906 B          | **1,355 B** |
| Out, realistic show                                              | 7,906 B          | **189 B**   |

Where the round trip is paid depends on the command. A **Graphic Input edit** carries the graphic's whole Graphic Input record: eleven fully loaded inputs fit (62,260 B), the twelfth falls back. A **Take** carries a playout record and that record: fourteen fit (64,670 B), the fifteenth falls back. An **Out** never falls back. So "zero round trips on the on-air path" holds for realistic shows, not every legal one — a Take on a graphic with fifteen fully loaded inputs (legal; the per-graphic cap is 24; roughly 80 KB of text) joins its entrance part-played. The dearest whole state (inputs spread across all fifty graphics) and the dearest single change (inputs concentrated on one) are different Screens, so the test asserts both arrangements.

### Consequences

- 64 KiB is the account's **confirmed** limit: the package is Free (#189, recorded beside the constant in `shared/types/messages.ts`). It was first adopted as the documented floor, on the reasoning that measuring against a floor can only cost an unneeded reload while an unestablished ceiling could cost a lost notification — re-apply that if the package changes.
- `realtime_publish_oversized` cannot fire for this message type.
- The sequenced live-state port's `publish` receives a publication context carrying the aggregate the command was reduced onto (absent on a recognised replay). Only that module knows which aggregate a merge retry re-reduced onto, and a difference measured against the wrong one would silently leave peers holding a state the store does not have.
- A client falls behind in two ways — a missed sequence, or a notification with no difference — and both resolve by reloading.
- Recovery validates `sources` as well as `playout` and `inputs`. `null` means "removed" in a change, which is sound only while no entry can itself be null; the description checks that rule rather than assuming it.
