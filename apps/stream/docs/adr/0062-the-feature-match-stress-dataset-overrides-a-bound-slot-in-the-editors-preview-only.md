# ADR-0062: The Feature Match Stress Dataset overrides a bound Slot, in the editor's preview only

Accepted · 2026-11-04 · [#743](https://github.com/KeeprDigital/stream-keepr/issues/743).

### Decision

**A second named dataset, not a wider Sample Dataset.** The Feature Match Stress Dataset (`shared/featureMatchStressDataset.ts`) sits beside the Feature Match Sample Dataset: one per Card Game, each the longest plausible value of every Feature Match token, and of the live state the context-gated Graphic Items read. The clock is `formatClockTime`'s widest form, or for an Untimed Match an Untimed Label at the Event schema's maximum; the active Session's clock type decides which, or else the Event's Match Format. A One Piece side has no record, life or Sideboard, as in the sample (ADR-0057), and is named and coloured by the catalogue's longest two-colour Leaders.

**The editor asks for it on the preview's URL, and it overrides live data there.** The Feature Match Overlay editor's preview toggle adds `stress=1` to its frame's URL. The display session reads it only with `embed=preview`, exactly as it reads the guide flags, so no Screen Output and no Program Monitor shows it. While it is on, the preview resolves against it even with a Feature Match Slot bound. The toggle is never written, so it is offered whether or not the session holds the Graphics Authoring Lease.

### Why

The sample is typical, so overflow shows up on show day rather than while authoring. A fixed set keeps the stress preview the same for every author, as the sample's canonical values do. Overriding a bound Slot lets an author stress a layout already bound for the show, and nothing about it can reach air.

### Consequences

- A hand-built `embed=preview&stress=1` URL shows stress values; it is the same accepted residual as the guide flags (`app/modules/screen/displaySession.ts`).
- Toggling reloads the preview frame, which the editor answers with a full push, as for the guide switches.
- A Theme preview has no toggle; it shows the sample.

### Rejected alternatives

- **Amend the Sample Dataset to be the worst case.** A preview of only worst cases stops looking like a show, and the sample is shared with the Screen Mode Sample Dataset.
- **Push the toggle by message instead of the URL.** It avoids a reload, but a frame listening for it must also be shown to refuse it on a live output; the URL flag reuses the guide flags' proven gate.
