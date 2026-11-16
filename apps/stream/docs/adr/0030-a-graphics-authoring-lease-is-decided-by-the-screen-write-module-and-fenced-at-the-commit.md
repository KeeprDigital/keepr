# ADR-0030: A Graphics Authoring Lease is decided by the Screen write module and fenced at the commit

Accepted · 2026-10-20 · [#607](https://github.com/KeeprDigital/stream-keepr/issues/607) · Amended 2026-11-03: the Feature Match Layout is leased and fenced too · [#738](https://github.com/KeeprDigital/stream-keepr/issues/738) · Amended 2026-11-11: both editors drop unsaved edits on losing the lease the same way · [#1100](https://github.com/KeeprDigital/stream-keepr/issues/1100)

### Decision

**The Screen write module decides which writes edit a Screen's graphics Edit workspace.** Every Screen write that can reach it passes through `screenWriteModule()`, and each such update operation takes the asking browser Session as a required `authoringSessionId`. A route only says who is asking. The protected fields are the Broadcast Graphics stack and the Feature Match Layout, which is a Feature Match Overlay's `layout`; `presetId`, which named the preset a layout started from, is a former field (ADR-0080). One lease covers both, because they are one Screen's one Edit workspace (#738); there is no per-mode lease. The mode configuration write protects the stack on every Broadcast Graphics write, and the layout on every Feature Match Overlay write that carries `layout`. The generic Screen write protects either when it would change it. A Feature Match Overlay's Feature Match Slot (`featureMatchId`) is what the Screen points at, so it is never leased. The canvas is the Event's Event Canvas (ADR-0051), an Event Presentation Settings write that takes no lease, so no Screen field is a canvas the lease guards. A Screen holds no look of its own (ADR-0051), and the Screen Theme Override write is not lease-gated.

**The generic Screen write is gated by change, not by presence.** It replaces `modeConfigs` whole, and the Edit Screen dialog sends it back as it read it. A rename that carries the protected fields back unchanged stays open to every Session. The comparison ignores object key order.

**The lease is checked again inside the statement that commits.** A write is admitted up front, then commits only while no other Session holds a live lease on the artifact. That condition sits in the same `WHERE` clause as the `stateVersion` guard. It is one Drizzle expression, `graphicsAuthoringLeaseFenceCondition`, and the raw D1 mode configuration write renders the same expression. A write the fence refuses answers the lease's own 409, which the client does not retry as a race.

**Live Control stays outside the lease.** Live Session commands, live state reset, Screen commands, Card writes, Screen mode changes, and choosing a Feature Match Overlay's Feature Match Slot are not admitted by it.

**Both Screen editors take the lease on opening their Edit workspace.** The Broadcast Graphics editor asks while its Edit workspace is open. The Feature Match Overlay editor is all Edit workspace, so it asks as soon as it opens. Without the lease each editor is read-only and offers a take-over. Both are the shared graphics editor (ADR-0081), whose one write funnel writes nothing without the lease, and losing the lease clears its undo history.

### Why

The lease was only checked at two routes. The generic Screen write reached the same stack, and then the Screen's own canvas, with no lease check at all, so a second Session's write succeeded with a current `stateVersion`. A check at the door also left a window. A takeover between admission and commit let the displaced author's save land over the new holder.

### Consequences

- A route that edits the workspace cannot forget the lease. Leaving out `authoringSessionId` is a compile error.
- The fence uses the server's clock at commit. A lease that lapses between admission and commit admits the write, which matches the lease's own rule.
- Two takeovers in the same instant still both report success (see the lease module); the fence orders whichever holder the table records.
- Broadcast Graphic Template and Feature Match Layout Template placement are both admitted inside the mode configuration write, after the template is read, and fenced at its commit. A non-holder placing a missing template now gets its 404 before the lease's 409. Nothing is written either way. Feature Match Layout placement lost its separate check at the route (#738).
- A display reset of a Feature Match Overlay Screen writes the default `layout`, so it is lease-gated. It is the only reset the Screen has (ADR-0080). The Screen page disables Reset mode settings for a Session observing another's lease, and the server refuses it anyway. A Broadcast Graphics reset never touches the stack, which is an authored stack, and is gated as before.
- Nothing else writes a Feature Match Layout. A Theme or Screen Theme Override write changes look, never a Screen's mode configuration, so neither is refused (ADR-0049). Creating a Screen is not an update, and saving a layout as a Feature Match Layout Template only reads it. The Feature Match Layout Template library's own writes are library writes, not Screen writes. The editor offers them only to the Screen's holder, as the Broadcast Graphics editor does with its library.
- A save that was pending when its author lost the lease to another Session is refused at the fence with the lease's 409. Both editors react to losing the lease, to another Session or to its deadline, the same way (#1100): the Feature Match Overlay editor drops its unsaved layout, the Broadcast Graphics editor its unsaved stack, Graphic Channels and Broadcast Graphics Background (#1026), and each clears its undo history, so the next holder's changes show and cannot be undone over. `useGraphicsAuthoringLease`'s `lost` is that signal.
- An editor keeps its unsaved edits while the lease is merely not held, as after the Broadcast Graphics Edit workspace closes, because the fence refuses nothing then and a pending save still lands.
- A lease request that gets no answer is not a lost lease (#1026). The server keeps the holder's lease until its deadline, so the holder's editor stays writable until then and asks again every few seconds. It turns read-only, and both editors drop their unsaved edits and undo history, only once the deadline passes unanswered or the server answers that another Session holds the lease. A lapsed lease drops them even though the fence might still admit the save, since nothing tells the editor that no other Session took it in between (#1100). The editor counts the deadline on its own clock from when it sent the granted request, so it never outlasts the server's whatever the two clocks say. The fence still refuses a write if another Session took over in between.
- A lease granted to an editor that has since closed, stopped authoring or opened another artifact is released at once rather than left to lapse (#1026). An editor applies only the answer to its newest request, and asks nothing behind a takeover that is still awaiting its answer.
- The Feature Match Overlay canvas size is not leased, though #738 decided it should be in Feature Match Overlay mode (E2). Since ADR-0051 there is no per-Screen canvas, and the Event Canvas stays unleased in every mode, so nothing is leased for it. That decision applies again only if a per-Screen canvas comes back.
- Deleting a Screen is not lease-gated. It removes the Screen rather than editing its workspace, and its lease lapses at the holder's next missed heartbeat.
- Deleting a Player writes its Screens outside the Screen write module (ADR-0032). It clears only a Deck Source, which no lease protects.
- Deleting a Phase, Round or Archetype writes its Screens outside the Screen write module too (ADR-0060). It only unsets Event References, which no lease protects.

### Rejected alternatives

- **Refuse the protected fields on the generic Screen write outright.** That would break the Edit Screen dialog, which sends `modeConfigs` back on every rename.
- **Keep the admission check alone and state the race.** The fence costs one `NOT EXISTS` on a uniquely indexed row, and it closes the race outright.
