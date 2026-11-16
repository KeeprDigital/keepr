# ADR-0015: Live overlay show/hide rides feature-match session state

Accepted · 2026-08-24, amended under #621 · [#486](https://github.com/KeeprDigital/stream-keepr/issues/486) (decided under spec #485 / #479, #480, #481) · Amended by ADR-0087: a Seat Indicator Graphic Item plays its enter and exit through the same host-local trigger, so a Sideboard reveal is no longer the one exception

### Decision

Revealing or hiding a player's sideboard on the Feature Match Overlay is **live match data**: a per-player `sideboardRevealed` boolean in `FeatureMatchState`, set by a `SetSideboardRevealed` session command, read by the deck-list Graphic Item through `GraphicsFeatureMatchContext` exactly as `player-life` reads life totals.

### Why

An operator needs a sub-second toggle from the control surface between games. Writing the item's `visible` through graphics config is compositor-only UI, ~600 ms of stacked debounce plus announce-then-refetch, and would turn an authoring field into an operator gesture. The live flag preserves the Graphic Item invariant that items are not taken on or off air independently of their composition: the item stays on air and a hidden sideboard renders nothing, like an absent life total or empty sideboard. The Feature Match Overlay's Host Contract declares no Graphic Inputs, so Broadcast Graphics Live Control was not a carrier.

### Consequences

- The authored `visible` field ANDs with the live flag; the flag cannot resurrect an item its author hid.
- Show/hide motion reuses the item's authored `enter`/`exit` Graphic Animation Recipes; the flag edge is a small, reusable per-item phase trigger in the overlay host.
- That trigger is timed host-locally, the one exception to every output projecting a phase from one authoritative effective start time: each output starts the recipe on its own clock when it observes the edge, so outputs agree within realtime skew, and one disconnected across the flip plays it late on Reconnect Resync. The recipes are sub-second and the Host Contract carries no animation timing (#480), so this was accepted rather than designed around; changing it is product work.
- A host without the Feature Match context (Broadcast Graphics) treats the item as revealed; visibility there stays an authoring concern.

### Rejected alternatives

- **Graphics config `visible`** — see _Why_.
- **Broadcast Graphics Live Control, or a new bespoke live-control channel** — the overlay's Host Contract deliberately declares no Graphic Inputs, and session state already carries the match data the item reads.
