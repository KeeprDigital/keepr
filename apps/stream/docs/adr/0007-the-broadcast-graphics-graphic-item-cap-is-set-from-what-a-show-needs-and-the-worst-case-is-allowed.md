# ADR-0007: The Broadcast Graphics Graphic Item cap is set from what a show needs, and the worst case is allowed not to fit

Accepted · 2026-08-01 · [#99](https://github.com/KeeprDigital/stream-keepr/issues/99) · Amended 2026-10-28: the worst case is re-measured without Style Set references · [#830](https://github.com/KeeprDigital/stream-keepr/issues/830)

### Decision

**`MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN = 300`** — Graphic Items on one Broadcast Graphics Screen in total, Graphic Group children included — **and the worst case is allowed not to fit** the 512 KiB `modeConfigs` budget shared by every Screen Mode. The cap exists because the per-list caps multiply to 50 Broadcast Graphics × 100 Graphic Items × 50 Graphic Group children = 255,000 items. It had been repriced three times by three tickets, each measuring only its own vocabulary; it is now set once, here, from one composed measurement, and no feature ticket picks the number.

**300 = `MAX_BROADCAST_GRAPHICS_PER_SCREEN` (50) × 6**, the Graphic Items in the richest reconstruction of the fidelity acceptance set. The prototype document that set came from is no longer in the repository; this table is its surviving record:

| reconstruction                              | Graphic Items                                                 |
| ------------------------------------------- | ------------------------------------------------------------- |
| Split angular commentator lower-third       | 6 (two shape beds, two accent rules, two text items)          |
| Full-width animated commentator lower-third | ~6 (media bed, rules/decorations, two text items, brand item) |
| Full-screen branded slate                   | 4 (three image items, one text item)                          |
| Derived persistent brand bug                | 2–3 (shape bed, brand image, optional text)                   |

A realistic Screen filled to the cap measures 248,734 bytes, 47% of the shared budget.

Three axes that were unbounded relative to their own meaning were narrowed, at no cost to realistic authoring:

1. **A Graphic Animation Stagger** names no more ids than its container has direct items (it was 100 regardless) — about 2 MB off the worst case, which no item cap could reach. Stale ids stay legal (the count is bounded, membership is not); `deleteGraphicItem` and the template copy path remove deleted ids.
2. **`MAX_GRAPHIC_ITEM_ID_LENGTH = 64`** (was 100; the app writes 36-character uuids), also for stagger ids.
3. **A Feature Match Layout's** item cap now bounds its total including group children, not only its top-level list (which admitted 5,100 items into the same budget).

### Why

The worst case populates every construct `broadcastGraphicsModeConfigSchema` admits at its own maximum — all seven Graphic Item types including groups, maximal-length ids, a Theme binding in every slot, animation and staggers on items, groups and shells, every Graphic Input, binding, Graphic Source Selection and Graphic Channel slot. It cost **11,876 bytes per Graphic Item on 288,564 bytes of fixed shell cost**, reaching 3,851,414 bytes at 300, while Graphic Style Sets existed. #830 removed them, and with them a Style Set reference in every slot and a link on every Broadcast Graphic: 6,130 bytes per maximal Graphic Item and 1,734 per Broadcast Graphic. #831 added a `media` binding slot: 15 bytes per maximal Graphic Item. The worst case is now 1,930,214 bytes at 300, with no construct left unpopulated: the Style Set link's unbounded `revision` was the one exception the measurement had to name. (#829 added a Theme binding in every slot: 433 bytes per maximal Graphic Item and 120 per Broadcast Graphic. The lowering-the-cap figures below were not re-measured for it, nor for #830 or #831, so they understate the cap that now fits.) (#539 widened a Graphic Placeholder Style's font weight to 1–1000 and populated every font weight at 1000, which base typography and its override already admitted: 6 bytes more per maximal Text Graphic Item. The lowering-the-cap figures below predate that and were not re-measured; at 6 bytes an item they move by at most 132, which leaves 21 as the cap that fits.)

- **Lowering the cap until it fits** gives 21 (521,272 bytes; 22 is 532,755). That clears the 19-item acceptance set, but the objection is volume: it would leave most of a Screen's 50 Broadcast Graphics unable to carry a single item, while the spec asks for commentator and player lower thirds, slates and brand bugs concurrently.
- **Narrowing further cannot close it.** At 300 the budget left after fixed cost is 241,724 bytes, 806 per item, and `MAX_GRAPHIC_TEXT_LENGTH` is 1,000 — a maximal text template alone overshoots before anything else is counted. Removing the largest axis, a Style Set reference in every slot, took 6,130 bytes an item (#830) and was not enough. Only cutting vocabulary the spec settles would be.
- **The overshoot is safe** because the byte total is enforced on the editors' write path (#85), refusing an oversized configuration legibly at authoring time, and because realtime no longer publishes mode configurations (#95), so anything storable is notifiable. The live-session message is keyed by graphic and input, never by item, so this cap does not touch it (ADR-0004).

What is given up is "the named cap binds first", only for configurations nobody authors: they read a byte count instead of a limit name. One non-pathological shape crosses the line — a Screen at the cap where every item carries a 1,000-character template (300,000 characters) is refused by byte count.

### Consequences

- The measurement is pinned with `toBe` in `broadcastGraphicsModeConfigWorstCase.test.ts` in two arrangements — grouped (1,930,214, `MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN_WORST_CASE_BYTES`) and flat (1,927,576) — so "which worst case" stays a checked choice.
- A ticket that adds vocabulary extends that builder and moves a visible constant. Moving the cap means re-deriving it here, not in a docblock.
- `MAX_GRAPHIC_ITEM_ID_LENGTH` is also an import constraint: a Template Package document is proved against the Screen write-path schema, so ids over 64 characters are refused on install. Accepted — one bound on both paths keeps "a document that installs is one the write path accepts", and copy paths mint fresh uuids anyway.
- `MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN` (60) binds first for any package whose graphics declare Live Control (two inputs each covers 30 of 50 graphics). Move that before this cap, and re-measure when you do.
- Making the worst case fit means cutting `MAX_GRAPHIC_TEXT_LENGTH` — a question about what an author may express, not a budget question.
