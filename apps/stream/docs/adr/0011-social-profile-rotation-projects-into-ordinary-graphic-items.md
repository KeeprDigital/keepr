# ADR-0011: Social Profile Rotation projects into ordinary Graphic Items

Accepted · 2026-08-18 · [#416](https://github.com/KeeprDigital/stream-keepr/issues/416)

### Decision

A rotating Talent identity is a named **Social Profile Projection**, not an opaque all-in-one Graphic Item or a collection-valued Graphic Input. The projection references a Talent Graphic Source Selection, atomically supplies read-only network and profile values, and transitions one explicitly associated Social Profile Presentation Group, whose ordinary Text, Social Network Icon and decorative Graphic Items keep the compositor's layout, styling, animation and Theme binding capabilities.

Rotation is a pure projection of authoritative Broadcast Graphics Live Session state, the accepted populated profile set, and synchronised server time (as ADR-0009). Operator actions write the projection's selection, automatic mode and rotation anchor; Screen Outputs never write as it advances. A rendering without trustworthy synchronised time holds its last accepted or anchored profile rather than blanking or writing. An accepted profile-set change preserves and re-anchors the current network when it still exists, so adding a profile cannot make program jump because catalogue indexes moved. The Feature Match Overlay is out of scope.

### Rejected alternatives

- **An opaque Social Profile Graphic Item** — duplicates a weaker subset of Text Item, Graphic Group and styling controls in a bespoke widget.
- **A collection-valued Graphic Input** — puts collection and clock behaviour into the scalar binding catalogue, which deliberately excludes it, and still yields no independently styled icon and text consumers.
- **Timer-driven accepted-value updates** — a write per profile change, competing outputs or a writer election, and the loss of ADR-0009's output purity.
