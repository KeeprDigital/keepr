# ADR-0033: A Feature Match Slot Promotion decides its outcome purely, then publishes once

Accepted · 2026-10-20 · [#594](https://github.com/KeeprDigital/stream-keepr/issues/594)

### Decision

**The outcome is a pure decision.** `decidePromotion` (`server/modules/feature-match-promotion/decision.ts`) takes what the promotion read before its batch and what it reads right after the commit. It answers `lost`, `failed`, or `standing`. Only a standing decision can build a publication. It takes later reads and answers `won` or `won-then-moved`, the messages to send, and the response. A lost promotion has no messages to publish, so "decide the outcome before publishing" (#577) holds by the module's shape.

**The publication is one change.** Every new Session's `SessionStarted`, the Assignment messages and every Slot's `featureMatch:updated` are published in that order. Graphic Input Bindings then re-resolve once, however many Slots were cleared. The promotion settles its Session transition with `announce: false` and publishes the Sessions among its own messages.

**The Reverse Sync runs between the decision and the publication's Slot reads.** It writes without announcing, and the Slots are read after it, so peers get the players' latest data. When the sync faults, the committed promotion is still published, and then the fault is answered.

**Contradicts ADR-0029's consequence that a Slot write opening a Session re-resolves bindings twice.** A promotion re-resolves once. It also goes against the epoch module's note that only an end nobody may be told about opts out of announcing. A promotion opts out because it announces the same Sessions itself, in the same order as before.

### Why

One function ran about ten steps in a fixed order. It published 3+N messages, and each message re-resolved bindings. Its unit test mocked seven modules. The race histories were proven only by an integration test that #577 had to run 401 times.

### Consequences

- Every outcome is unit-tested against the pure decision with no mocks (`featureMatchPromotionDecision.test.ts`). The fence, the publication and the refresh count are pinned against SQLite (`featureMatchPromotion.sqlite.test.ts`).
- The Sessions a commit opened are still read straight after the outcome is decided, before the Reverse Sync. So a `SessionStarted` still carries the Session as it opened, and the Slot messages carry it after the sync, as before.
- A promotion that stands but whose Slot is gone by the later reads, or whose later reads fail, publishes nothing and answers `500`. Before, it had already published its Sessions and Assignment. The Slot's deletion announces itself.
- A promotion moved off before the later reads still publishes the Assignment it committed. Its Slot messages and response show the move, as before (#575).
- The plan fence from #605 is unchanged. It still rides in the batch ahead of the Session transition.
- A Reverse Sync that has to open a missing Session announces it on its own, with its own refresh. That cannot happen to the Slots a promotion just opened Sessions for.

### Rejected alternatives

- **Decide and describe in one call from one set of reads.** Either the Reverse Sync runs before the decision, writing to the winner's Slots on a lost promotion where no one is told, or the publication carries data from before the sync.
- **Publish the Assignment before a fallible Reverse Sync, as before.** The single publication would split in two, with a refresh for each half.
