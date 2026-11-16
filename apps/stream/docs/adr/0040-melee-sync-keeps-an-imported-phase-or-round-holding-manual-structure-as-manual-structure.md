# ADR-0040: Melee Sync keeps an imported Phase or Round holding manual structure, as manual structure

Accepted · 2026-10-21 · [#701](https://github.com/KeeprDigital/stream-keepr/issues/701)

### Decision

**Removing imported structure never removes manual structure beneath it.** The schema cascades a Phase delete through its Rounds and a Round delete through its Matches, and an operator may add a manual Round under an imported Phase or a manual Match under an imported Round. So deleting a stale imported ancestor outright took the manual structure with it. Now every removal of imported Phases and Rounds goes through one builder, `buildRemoveImportedStructureQueries` (`server/services/importedStructure.ts`), in one batch:

1. the scope's imported Matches and Round Standings are deleted, as removing the Round would have done;
2. a scoped Round that still holds a Match (by now only a manual one) is **kept, with its Provenance cleared**: `externalSource` becomes `manual`, and `externalId` and `lastSyncedAt` become null;
3. the other scoped Rounds are deleted;
4. a scoped Phase that still holds a Round (a manual one, or one kept in step 2) is kept the same way, and the other scoped Phases are deleted. A kept Phase keeps its `formatExternalId`, because that is still the format it was played in and Deck Lists are matched to its Matches by it;
5. every Screen reference to a deleted Phase or Round is unset (ADR-0060).

**Two paths use it.** Event structure sync scopes it to the stale imported Phases and Rounds. The Melee data reset (disabling the integration, or changing its Melee.gg tournament) scopes it to every imported Phase and Round in the Event. Round Match sync already deletes only imported Matches, so it needs nothing.

**The operator is told which structure was kept, through the warnings each answer already carries.** One sentence per kept Phase or Round names it, and a Round's sentence names its Phase too. A sync's warnings appear in its result toast as before. The configuration answer gains the same optional `warnings`, which the Melee configuration card shows in a warning toast. The reset's confirmation says beforehand that manual Rounds and Matches stay. The structure sync's `melee:structureSynced` change set lists a kept Phase or Round as updated.

### Why

Melee Sync promises to preserve manual structure, and the cascade broke that promise wherever the manual record sat under an imported one.

**Keeping the record is better than refusing the removal.** A refusal would fail or stall the whole structure sync, or the reset, until the operator moved or deleted their manual Rounds, and the reset is a deliberate operator action that should finish. Keeping the record finishes the sync or reset, keeps every identity and relationship (Round ids, Match ids, Feature Match Assignments and their Notes), and needs nothing from the operator.

**It is kept as manual structure, not as a stale imported record.** A kept record that still carried Provenance would still count as Melee-managed (`isMeleeManagedRound`). Update would then try to sync Matches for a Round Melee.gg no longer has, and after a reset there would be Melee-owned structure with no integration behind it. Clearing Provenance needs no schema change, and a repeated sync leaves the record alone: it is manual now, and it is reported only once, when it is kept.

### Consequences

- If Melee.gg later brings back a Phase or Round with the same identity, Melee Sync imports a new one beside the kept manual record rather than adopting it. Upstream identities are not normally reused, and the duplicate is visible and can be deleted.
- The reset now also deletes an imported Round an operator moved under a manual Phase, unless it holds a manual Match. Before, such a Round survived the reset still carrying Provenance.
- A kept Round loses its Melee-synced Round Standings along with its imported Matches, as removing the Round would have done.
- Each step's predicate is evaluated when the batch runs, so a manual Round or Match added after the caller read the structure is still kept.
- `test/unit/server/modules/meleeStructurePreservation.sqlite.test.ts` proves all of this on SQLite with the real migrations and foreign keys enabled: a stale Phase holding a manual Round, a stale Round holding a manual Match and its Assignment, imported-only stale structure still removed, a repeated sync changing nothing and warning nothing, and the reset. `test/unit/server/api/events/[id]/melee-config.put.sqlite.test.ts` holds the reset's answer: the sentences the configuration route returns for what it kept.

### Rejected alternatives

- **Refuse the removal while manual descendants exist.** See Why: it blocks a sync or reset on operator clean-up.
- **Keep the stale record with its Provenance, and skip it in Round Match sync.** Every reader of `isMeleeManagedRound` would need to know about it, and a reset would leave Melee-owned structure with no integration. A sync would also repeat the warning every time until the operator cleaned up.
- **Change the foreign keys from `cascade` to `restrict`.** Deleting a Phase or Round by hand would then need its children deleted first, and the sync would fail instead of finishing.
