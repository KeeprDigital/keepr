# ADR-0067: A Talent's photo is a Graphic Asset Reference that holds Retire back

Accepted · 2026-11-04 · [#918](https://github.com/KeeprDigital/stream-keepr/issues/918). Records T4 b from [#783](https://github.com/KeeprDigital/stream-keepr/issues/783).

### Decision

**A Talent may hold a photo: an ordinary Graphic Asset Reference to one exact image revision, or none.** Image only; a silent video is refused. The Talent row stores `{ assetId, revisionId }` in `event_talents.photo`, and the Talent's existing `talent:created` and `talent:updated` messages carry it.

**It is indexed under a new owner kind, `talent`,** with the Talent's id, slot `photo`, and the Talent's Event as the reference's `event_id`. A write naming the photo is held to ADR-0034's rule: the route asks the library first, so a refusal names the slot, and the statement that commits the Talent row asks again (`REQUIRED_GRAPHIC_ASSET_REFERENCES_RESOLVE`). Setting the photo replaces the slot in that commit; `null` clears it and releases the reference. A write that omits `photo` leaves both alone. Deleting the Talent releases it in the same commit, and deleting the Event drops it through the reference's `event_id` cascade.

**Retire is refused while a Talent references the asset,** as for a Theme (ADR-0050). Trash was already refused for any reference. The usage names the Talent and its Event's name, and the Library Workspace's refusal says both.

**The Screen Output Asset Capability was left unchanged here.** The photo showed in the operator app only, read through the authenticated revision content route. ADR-0070 (#782) extends the capability so a Talent Screen showing photos admits the photo revision of each Talent it shows.

### Why

The Talent Screen Mode (#782) and productions need a photo per Talent, and all broadcast media comes from the Graphics Asset Library. Without the Retire guard a Talent could keep a photo the library had hidden from discovery, and any write re-stating it would be refused, as ADR-0034 found for templates.

### Consequences

- A Talent cannot hold a retired photo, so a photo write needs no retained-reference allowance.
- Binding a Talent's photo to a Broadcast Graphics media Graphic Input is not covered; it needs its own ticket.
- `event_talents.graphic_asset_reference_version` is the one-shot token a photo write stamps, as a Theme's is, so the index rows are written only beside the Talent row the batch committed. A create learns its new Talent's id through it.

### Rejected alternatives

- **Let Retire proceed, as a Screen's own mode reference does.** The Talent would keep a retired photo that #782 would put on air; the maintainer chose the Theme's rule (#918).
- **Admit the photo in the capability now.** No Screen Mode shows a Talent's photo yet; #782 owns that change, made by ADR-0070.
