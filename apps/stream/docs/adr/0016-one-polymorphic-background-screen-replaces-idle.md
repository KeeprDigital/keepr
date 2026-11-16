# ADR-0016: One polymorphic Background Screen replaces Idle

Accepted · 2026-08-24 · [#473](https://github.com/KeeprDigital/stream-keepr/issues/473) · Amended 2026-11-11: a Screen's stack starts as a copy of its Theme's · [#1086](https://github.com/KeeprDigital/stream-keepr/issues/1086) · Amended by ADR-0050: a Theme's media layers may take a Graphics Asset Library reference (#828)

### Decision

The Idle Screen Mode, which carried one optional video background, is renamed **`background`** and configured as an ordered layer stack: `layers: BackgroundLayer[]`, painter's order (first is bottom), operator-reorderable, with five layer types — `color`, `gradient`, `image`, `video`, `animation` — each owning its own enabled state and opacity.

### Why

What a show wants behind everything else is a composition — a colour wash over an Animation Effect, a plate under a gradient — not a choice of exactly one background kind.

### Consequences

- The mode key renamed end to end: `SCREEN_MODE_VALUES`, registries, component directories, the D1 `screens.current_mode` default, and stored rows (a pre-ship data migration, squashed by ADR-0019). OBS URLs address Screens by slug, so nothing external broke.
- The old `mediaBackground` configuration reset rather than mapping onto a video layer (small install base, as ADR-0014). New Background Screens start empty: black until configured. Since #825 an empty stack, the Background Screen's or a plain mode's, paints the Theme's `background` Foundation Token instead, itself a Background Layer stack; the Default Theme's is empty, so the black stays. A Theme's media layers take a Remote Media URL only until a Theme can own a Graphic Asset Reference (#828).
- **A Screen's stack starts as a copy of its Theme's** (#1086). While the Screen holds none, its card (a plain mode's Background & Placement, the Background Screen's Background Layers) shows the Theme's stack read-only, as it resolves, under "Customise for this Screen", which writes a copy of it, layer ids and Graphic Asset Revisions kept, as the Screen's own; the copy is then edited like any stack, and the Screen stops following the Theme's. While it holds one, "Reset to Theme" writes the empty stack, on the Background Screen too, where `layers` is an Authored Stack: an explicit edit, which the display reset still never makes. A copied revision becomes the Screen's own mode reference, so the write refuses one no longer selectable as any Screen write does. With no layer in either stack, the card offers the editor alone.
- **At most one animation layer per Screen**, enforced on the `layers` field in the schema: each is its own WebGL context and an OBS browser source is memory-tight. Liftable.
- Opacity belongs to the layer, never to the stack or the renderer behind it.
- **A gradient layer holds a Graphic Fill gradient** (#1073): an angle and two to four stops with literal colours, in a Screen's stack and the Theme's `background` alike, edited with the one fill control held to the gradient kind and painted by the fill-to-CSS helper the Feature Match Overlay's surfaces use (`graphicFillCss`). A CSS gradient string stored before this is still accepted, because an editor re-sends the whole stack, and paints as stored; the editor shows it read-only and replaces it with a Graphic Fill gradient, so nobody types CSS.
- Image and video layers take a Screen Media Source — a Graphics Asset Library reference or a Remote Media URL — whose reach ADR-0021 sets. Asset-sourced layers join Graphic Asset Reference indexing under the `layers.` owner-slot namespace; a plain overlay mode's own stack indexes under `<mode>.backgroundLayers.` (#580).
- Which modes carry their own stack is declared once, on the Screen Mode Definition (`backgroundLayers: true`). The config field and its validation, reset preservation, the editor card, the painting, and reference indexing all derive from that declaration. Every plain overlay mode declares it, Most Played Cards included.

### Rejected alternatives

- **The Screen's own stack drawn over the Theme's, or an editor seeded with the Theme's but unsaved** (#1086) — two stacks painting at once leave the operator nothing to read the result from, and an unsaved seed shows a stack the Screen does not paint. One source at a time, named on the card, is what paints.
- **Per-type Screen Modes, or `animation` joining a background type union** — exactly one kind shows at a time, so a translucent colour over an animation is unreachable, and every new kind is a new mode or union arm with its own editor.
