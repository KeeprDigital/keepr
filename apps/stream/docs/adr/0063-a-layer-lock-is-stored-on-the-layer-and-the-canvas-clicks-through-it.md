# ADR-0063: A Layer Lock is stored on the layer, and the canvas clicks through it

Accepted · 2026-11-04 · [#747](https://github.com/KeeprDigital/stream-keepr/issues/747) · Amended 2026-11-04: the lock moved from this browser's storage onto the layer · [#943](https://github.com/KeeprDigital/stream-keepr/issues/943) · Amended 2026-11-11: a Broadcast Graphic may hold one · [#1075](https://github.com/KeeprDigital/stream-keepr/issues/1075), and its editor honours it · [#1100](https://github.com/KeeprDigital/stream-keepr/issues/1100). Records E27 and E28 from [#783](https://github.com/KeeprDigital/stream-keepr/issues/783).

### Decision

**A Layer Lock keeps a layer from canvas edits, and nothing else.** A locked layer is not moved, resized or rotated on the canvas and arrow nudges skip it; with several selected, the canvas moves only the unlocked ones. It stays selectable from the layer list, where it shows no canvas handles but a lock badge on its row and its canvas outline, and its property panel still edits it (E27). Delete, duplicate, hide, reorder (a drag in the layer list included), copy and paste, group and ungroup, and align and distribute are not canvas edits and still act on it.

**A click on a locked layer in the preview falls through to the layer beneath it, or to the canvas (E27).** The preview frame reads the locks from the working layout or stack the editor already pushes it, and draws their guides without offering them; a lock names its item within its own composition, since a Broadcast Graphic's item ids are unique per graphic only (#1101).

**Locking a Graphic Group locks its children; a Source Item locks too (E28).** A child locked through its group cannot be unlocked on its own.

**A Layer Lock is the layer's own optional `locked` field, in the Feature Match Layout (#943) or the Broadcast Graphic (#1075).** A Graphic Item, a Graphic Group child and a Source Item each carry one; unlocking drops the field, and a layer stored without it is unlocked, so no stored layout, Broadcast Graphic or Template Package needs migrating. Locking is a layout edit through the editor's one write funnel: one undo step, written only by the Graphics Authoring Lease holder (ADR-0030), and seen by every session of the Screen. The field is shared Graphic Item vocabulary and both graphics hosts store it. A Broadcast Graphic refused one until #1075, while no Broadcast Graphics editor showed or lifted a lock; the shared graphics editor (ADR-0081) shows, sets and lifts it in both since #1100.

**A lock travels with the layout or the graphic and stays with the original.** Saving a Feature Match Layout Template keeps it, and placing one or installing its Template Package (`.sklayout`) keeps it; a Broadcast Graphic Template and its Template Package (`.skgraphic`) keep it the same way. A duplicate or a pasted copy arrives unlocked, a Graphic Group's children too, since a copy lands somewhere new to be placed. Ungrouping a locked Graphic Group bakes its lock into each child, as it bakes in the group's hiding (ADR-0065); grouping leaves each member's own lock, and the new group starts unlocked.

### Why

Frame bars and backgrounds sit under everything and were dragged by accident. Clicking through a locked layer lets the author reach what lies beneath it on the canvas, which is the point of locking it. #747 kept the lock in browser storage, which reached no other operator or machine, no template, and no undo; once operators share a Screen's editing, a lock one of them sets has to hold for the others (#943).

### Consequences

- Every operator of the Screen sees the same locks, and an observer sees them but cannot change them.
- Undoing a delete brings the layer back with its lock, since the lock is part of the layer.
- Placing a built-in Feature Match Layout Template clears every lock, as the built-ins carry none.
- A locked child of an unlocked Graphic Group still moves with its group, since the group places it; lock the group to hold both.
- One unlocked layer selected among locked ones only moves, as several do; select it alone to resize or rotate it.
- A row or column child, or a rotated group's child, has no box of its own on the canvas, so locked it is badged on its row only.
- A `.sklayout` package carrying a lock is refused by an installation built before #943, on its strict schema; the Feature Match Layout format version is unchanged, since no term changed meaning. A `.skgraphic` package carrying one is refused the same way by an installation built before #1075, which refuses a Layer Lock on a Broadcast Graphic.
- Locks set in browser storage under #747 (`editor-featureMatchLayoutLocks:<screenId>`) are not imported and no longer read. #747 was never released, a browser's private lock should not silently become every operator's, and an import would make a write on opening that the author did not ask for.
- `app/modules/graphics/editor/layerLocks.ts` holds the lock rules, for every host of the shared graphics editor (ADR-0081). `withoutLayerLock` in `shared/modules/graphics/authoring.ts` is how every copy drops one: `cloneGraphicItem` for Graphic Items, and a Source Item's duplicate and paste. `ungroupGraphicGroup` bakes a group's lock in, and `editorLayersFrame` leaves locked layers out of what the canvas moves.

### Rejected alternatives

- **Keep the lock in browser storage, per browser per Screen (#747).** Another operator, another machine and a template would not see it, and it could not be undone.
- **One `locks` list of layer ids on the layout.** Every copy of a layer would have to be kept off the list by hand, and the lock would not sit with the layer it holds.
- **A pasted or duplicated layer keeps its lock.** It would land offset and locked, so the canvas would refuse the drag that places it and a click would fall through it.
