# ADR-0061: An Event has one Conversion Target, which every Metagame read counts against

Accepted · 2026-11-03 · [#908](https://github.com/KeeprDigital/stream-keepr/issues/908), settling [#783](https://github.com/KeeprDigital/stream-keepr/issues/783) Q13–Q16. Amends ADR-0022's list of what a Screen Output read derives. · Amended by ADR-0074: a One Piece Card Game Event's Metagame has no standings, so it shows no Conversion Target or Conversion Rate

### Decision

**The Conversion Target is an Event setting.** The `events` row holds `conversion_metric` (`topN` or `minPoints`) and `conversion_threshold`, Top 8 by default. The Metagame page, the Metagame Screen and Archetype Spotlight all count Conversion Rate against it. `conversionMetric` and `conversionThreshold` are former fields of both Screen Mode contracts (ADR-0037), so a stored per-Screen target is read without them.

**It is written whole, within its metric's bounds.** An Event PATCH names both fields or neither. Top N takes 1–999; a minimum-points target takes 0–999 (`shared/conversionTarget.ts`).

**The Metagame page writes it, and the write is announced.** The page's conversion control writes the operator's Event through the Event write, which announces `event:updated`. The page asks its archetype reads for the target the operator's Event holds, so it re-reads on the pending value and returns to the stored one if the write is refused. Another operator's page follows the announcement.

**A Screen Output reads it from its Event.** The Metagame and Archetype Spotlight reads take the target from the Event row, not the Screen's configuration (ADR-0022). The Event context a Screen Output holds carries the target, so an `event:updated` folded into it changes what its Screen Mode Data Freshness source asks, and the mode re-reads. A Metagame cards breakdown asks for no target and does not re-read.

**Screen Settings show the target read-only.** Both editors name the Event's target and link to the Metagame page; Metagame shows it while the Conversion Rate column shows or the archetypes sort by Conversion Rate, which Sort by now offers.

### Why

Three targets disagreed (#783): one per Metagame Screen, one per Archetype Spotlight, and the page's, held only in the browser and reset to Top 8 on reload. A Screen's Conversion Rate matched the page's only by coincidence, and a display reset sent a Screen back to Top 8. One target per Event makes every surface answer the same question, and a display reset cannot touch an Event setting.

### Consequences

- **A Screen whose stored target differed from Top 8 changes on upgrade**, to its Event's target, which starts at Top 8. An operator sets the Event's target once on the Metagame page.
- Two Screens of one Event can no longer show Conversion Rates against different targets.
- The page's metagame API still takes the target as query parameters, so the page can ask for its pending value; only a Screen Output's read takes it from the Event.
- A minimum-points target of 0 counts every Player in the scope as converted.
- A Screen rendering mounted in the writing operator's own client would re-read on the pending target, before the write commits, and skip its own announcement. None is: the control lives on the Metagame page, which mounts no Screen rendering, and a rendering mounted later reads the stored target.
- Each threshold step is an announced Event write, and every Metagame and Archetype Spotlight Screen Output re-reads once per step.

### Rejected alternatives

- **A per-Screen target with a "match the page" default**: keeps two answers to one question, and the page's target had nowhere durable to live.
- **Reading the target server-side for the page's reads too**: the page's optimistic write would be read back as the old target until the write commits.
