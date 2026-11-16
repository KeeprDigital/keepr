# ADR-0042: A Screen Card's states are ordered by its Card Revision

Accepted · 2026-10-22 · [#734](https://github.com/KeeprDigital/stream-keepr/issues/734)

### Decision

**Every Card state a holder is handed carries its Card Revision, and a holder applies only one at least as new as what it holds.** The server already advanced `activeCardVersion` on each save and Clear. A save and a Clear now answer the revision they committed (`{ success, revision }`), `card:updated` and `card:cleared` carry it, and the operator and Screen Output Card reads answer `{ card, revision }`: the Card, or `null` for none or for one past its Card Timeout, beside the revision of the row they loaded. The Card store (`app/modules/card-screen/activeCard.ts`) holds the selected Screen's revision and refuses a save answer, Clear answer, read or announcement older than it. A refused write still answers its caller. A refused read has not landed (ADR-0028).

**The revision held belongs to the Screen selection.** A selection and the end of the Event Lifetime forget it, as they forget the Card, so the next Screen's first state applies whatever its revision. The Flights stay: #704's read Flight, and the selection and lifetime Flights of #726 (ADR-0024). The revision orders states within a selection. The Flights decide whether a continuation may touch the store at all.

**A display control shows its toggle without mutating the held Card, and a failed save puts back only that field.** `controlActiveCard` replaces the held Card with a copy carrying the toggled field and saves that copy. If the save fails, that field goes back to the Card last accepted, unless newer Card state was accepted since, the Screen selection changed, or a later control of the same field is still out, which owns the field now. Another control's field, still out, is left as it is.

### Why

Card messages and answers carried no revision, so the store applied whatever arrived last. A save or Clear answered after another operator's newer `card:updated` replaced it locally, and so did a late announcement of an older write. The read Flight (#704) ordered reads against everything else, but nothing ordered writes against announcements. `controlActiveCard` flipped `displayData` in place on the held Card and never restored it, so a refused save left the operator page showing a display the server did not hold.

### Consequences

- `card:updated` and `card:cleared` gained `revision` (`shared/types/messages.ts`). A Card read's answer changed shape from the bare Card to `{ card, revision }`.
- A Screen read still carries no Card and no revision (ADR-0022); only the Card read and the Card's own writes and messages do.
- The operator who saved hears no echo of their own write (self-origin), so the save's answer is what moves their held revision.
- A read that answers the revision held lands, so an expired Card read back as `null` at its own revision is accepted, which is what the clock already showed.
- A field goes back to what was last accepted, not to what its control found. A control can find another control's unsaved toggle, which the server never held.
- A read landing at the revision held while a control's save is out replaces the toggle until the save answers. That is a brief flicker towards accepted state, never a wrong final state.
- A control saved while another is still out is built on the first's toggle. If the first fails after the second saved, the second's save has been accepted, so nothing is put back, and the store shows what the server holds.
- ADR-0022 rejected a revision guard on the operator's expiry `DELETE` partly because no client held a revision. One does now. That rejection still stands: expiry writes nothing, so there is nothing to guard.
- `test/nuxt/stores/card.test.ts` orders every answer by hand against the real store ("card revision ordering", "controlActiveCard display controls"); `test/unit/server/api/cardExpiry.sqlite.test.ts` pins the revisions the real routes answer and announce over SQLite.

### Rejected alternatives

- **Order Card states by `savedAt`.** It is the writing Worker's clock, a Clear has none, and two saves in one millisecond tie.
- **Supersede every write on any later message, as reads are.** A save is the operator's and is sent whatever arrives meanwhile (#726). A Flight cannot tell whether the message it lost to was older or newer than the write.
- **Roll a failed display control back to the whole Card it began with.** That would undo another control still out, and any newer state accepted meanwhile.
