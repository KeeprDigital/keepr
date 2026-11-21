# ADR-0164: Server time says when its offset is in doubt

Accepted · 2026-11-20 · [#1380](https://github.com/KeeprDigital/stream-keepr/issues/1380) · Amends ADR-0088

### Decision

**A round trip is timed on the monotonic clock** (`performance.now()`), so a change to the device's clock mid-request does not skew it, and one that reads negative or not finite is no sample (`useServerTime`).

**Server time re-syncs when its page is restored from the back/forward cache** (`pageshow` with `persisted`), as it does when the page becomes visible or comes back online.

**An offset held but not trusted is doubted** (`doubt`): one taken from a round trip over a second (`slow-network`), or one the device's clock has moved away from since it was taken (`device-clock-changed`). A sync answering within a second clears it. `ServerTimeStatus` reads "Server Time Uncertain", never synced, while it is doubted. Clock Projections keep running on it: a doubted offset is still the best one held.

**A Clock Projection's next change that is not finite arms no timer, and one due now or past is asked again after `OVERDUE_RECHECK_MS` (250 ms)** (`useClockProjection`), never at once.

### Why

The round trip was timed on `Date.now()`, so a clock change mid-request produced a wrong or negative round trip, and a negative one won as the shortest sample. A page restored from the back/forward cache kept its stopped sync. A status read synced on an offset known to be wrong, after the device's clock changed or from a sample slower than its own error. A projection answering a change due now armed a zero-delay timer that could answer the same again without end.

### Consequences

- A tab whose every sync is slow reads uncertain until a fast one lands, though its clocks still run.
- A projection stuck answering an overdue change re-evaluates four times a second rather than spinning; one that answers a real change at a boundary catches it within a quarter second.
