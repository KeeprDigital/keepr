# ADR-0002: Concurrent Graphic Animation phases compose by nesting

Accepted · 2026-08-01 · [#110](https://github.com/KeeprDigital/stream-keepr/issues/110)

### Decision

A Broadcast Graphic projects an **ordered set of concurrent lifecycle phases** (`broadcastGraphicPhaseProjections`, `[]` when none), and the compositor composes their projected values rather than choosing one. The set is bounded at two and the pairing is structural: at most one _content_ phase (an update crossing its pair, or a cycling excursion), innermost, moving the rendering; and at most one _enter/exit_ phase, outermost, moving the result.

Each channel composes the way it means:

- **Fades multiply** — an element at `a` inside a parent at `b` contributes `a * b`.
- **Slides add** — both are canvas-space offsets applied outside the authored Graphic Rotation.
- **Scales apply in turn** — each keeps its own `translate(shift) scale(s)` pair in one transform list, outermost first. Two scales about different Graphic Animation Origins are a scale plus a translation, and folding them into one factor degenerates when the factors cancel.
- **Reveals intersect, on separate elements** — CSS allows one mask per element, so a second wipe gets an element of its own, sized to the owner's box so the gradient still resolves across the bounds it was authored across.

An enclosing element appears only for a second wipe, or for a phase that moves every rendering while an update moves them separately. A graphic in one phase resolves to exactly the descriptor it did before concurrency existed.

`cyclingStartedAt` is stored, and only on an intent that actually interrupted cycling in progress. Cycling's origin is otherwise derived (entrance settled, or last update completed), and an Out overwrites the record it is derived from — so an exit could not locate the cycle it runs over and would start from the Graphic Resting State, which is the snap. Like `reversalCompletesAt` and `updateStartedAt` it is an origin, read forwards and monotone in the reader's instant; nothing validates or clears it and it names no phase, so recovery still settles every graphic at its Graphic Resting State.

### Why

Exit interrupting an update, or interrupting on-screen cycling, is not a position on the enter/exit axis, so #70's reversal cannot express it — both are a second phase at the same instant. A single-phase projection forced the compositor to pick one, and every pick snapped.

The Key Output survives: its rule is that every painted element is pure white at its own alpha with no blend modes, and no filter but a glow's plain source-over drop shadow (ADR-0027). Composition uses no property beyond the `opacity`, `transform` and `mask-image` animation already used — nested opacity multiplies alpha, nested masks multiply alpha, a transform moves paint without changing it — so nothing new paints. The guard in `graphicsRenderModel.test.ts` walks the new elements.

### Consequences

- Every reader — both Screen Output hosts, Live Control, the Program Monitor, the Graphic Animation Preview — speaks the set.
- The bound of two is load-bearing: it lets the compositor commit to one enclosing element. It is stated and tested in `broadcastGraphicPhaseProjections`; a third concurrent phase would need a third element first.
- An intent that takes over a phase in flight carries **both** concurrent schedules: a Take reversing an exit keeps the update crossing and the cycle, since dropping either snaps that channel to rest in the very frame the enter/exit channel was made smooth. An Out is the exception only for the update — it may carry a transition that never began, so the exit path decides whether an exit has one to run underneath. Cycling needs no adjudication (an origin in the future projects the resting state), so that path refreshes it and never strips it.
- A graphic leaving with a pending visual update discarded holds the rendering the interrupted update was travelling towards until it leaves. Snapping to the accepted set would be the discarded update happening anyway; the accepted values are what the next Take enters with.

### Rejected alternatives

- **A reveal as a second `clip-path`** — a Graphic Group already spends its one clip path on Shape Geometry clipping.
- **`mask-image` layers with `mask-composite: intersect`** — not uniformly available in the browsers outputs are captured in, and the default composite is a union, which fails open.
- **Folding two reveals into one gradient** — perpendicular wipes intersect to a rectangle no single `linear-gradient` expresses.
- **Applying the enclosing phase to each rendering** — an exit fade on each half of a cross-dissolve composites differently from the same fade on the pair.
- **A second compositor pass, or per-owner animation state** — either ends the property that makes late-loading outputs agree: every frame is a pure projection of one authoritative instant, with nothing accumulated between frames.
