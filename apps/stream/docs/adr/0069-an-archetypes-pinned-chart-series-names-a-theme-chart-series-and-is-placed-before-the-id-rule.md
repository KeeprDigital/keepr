# ADR-0069: An Archetype's Pinned Chart Series names a Theme chart series, and is placed before the id rule

Accepted · 2026-11-04 · [#909](https://github.com/KeeprDigital/stream-keepr/issues/909), settling [#783](https://github.com/KeeprDigital/stream-keepr/issues/783) Q17. Builds on ADR-0049 and ADR-0051.

### Decision

**The pin is a series slot, 1 to 8, stored on the Archetype.** The `archetypes` row holds a nullable `chart_series`. It names one of the chart series Foundation Tokens `series-1` to `series-8`, which the Metagame chart reads directly (ADR-0049); the Theme still decides what each series looks like, and a Screen holds no look of its own (ADR-0051).

**An operator sets and clears it through the Archetype write.** The Archetype PATCH takes `chartSeries` (an integer 1–8, or null); the write announces `archetype:updated`, which every Metagame Screen already re-reads on. Creating an Archetype takes no pin, and Melee Sync writes no Archetype field, so it never writes one. The Archetype's Metagame page edits it, naming any other Archetype pinning the same series and warning when the chosen one is taken.

**The chart places pins first.** `assignColorSlots` (`shared/utils/metagameChart.ts`) gives each shown pinned Archetype its series, lowest id first; one whose series a lower id already holds is placed as if unpinned. The unpinned then take the remaining slots by the existing preferred-slot rule. The breakdown carries each Archetype's `chartSeries`, so every chart reading it colours alike.

### Why

The id-derived slot moves an Archetype whenever another preferring the same slot enters or leaves the chart, so an operator could not hold one Archetype in one colour for a show. #783 tied the pin to the shared Screen style (#781), which Themes superseded; pinning a literal colour would have given a Screen a look of its own and bypassed the Theme.

### Consequences

- A pinned Archetype keeps its series whichever others enter or leave the chart, unless a lower-id Archetype pinning the same series is shown too.
- Pins are not unique: two Archetypes may pin one series, and only the chart decides between them, by id, which is creation order.
- Changing the Theme's chart series recolours every pinned Archetype with it.

### Rejected alternatives

- **Pin a literal colour.** It would bypass the Theme and Screen Theme Overrides, contradicting ADR-0049 and ADR-0051.
- **Refuse a pin another Archetype holds.** Only Archetypes shown together clash, and which are shown depends on scope and limit; a warning leaves the operator to decide.
