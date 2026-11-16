# ADR-0059: A Feature Match Layout's Graphic Animation Preview plays the whole layout or one Graphic Item alone

Accepted · 2026-11-03 · [#749](https://github.com/KeeprDigital/stream-keepr/issues/749). Records E31 and E32 from [#783](https://github.com/KeeprDigital/stream-keepr/issues/783).

### Decision

**The Feature Match Overlay editor offers the Graphic Animation Preview Broadcast Graphics has, over two subjects: the whole Feature Match Layout, or the selected Graphic Item alone (E31).** Phase or lifecycle, speed, loop, Play and Stop are the same controls (`GraphicsAnimationPreviewControls`); the run is the same plan with an optional `itemId`; the frame runs the same clock (`useGraphicAnimationPreviewClock`) and times the run with the same function (`resolveGraphicAnimationPreview`). A Feature Match Overlay pushes a whole mode configuration rather than a preview state, so its run travels on its own shared message, `graphics-compositor:preview-animation`, as the compositor selection already does.

**One item alone means its motion is isolated, and nothing else changes.** Every other owner — the composition, its siblings, and the Graphic Group it sits in — is held at its Graphic Resting State, with its animation Theme bindings dropped so the render model cannot paint them back. The item starts at the run's start, free of any container's stagger. A selected Graphic Group keeps its children's recipes and its own stagger over them, since that is the group's motion. The run then composes through the projection a live output uses.

**A layout's lifecycle is enter, on-screen and exit.** A Feature Match Layout declares no Graphic Inputs, so it never updates: its controls offer no update phase, and a lifecycle run goes straight from on-screen to exit rather than pausing where an update would be.

**The Frame's Animation Effect keeps running during a run (E32).** A run moves Graphic Items only; the Frame and Source Items are host-owned and untouched.

**Only a preview frame listens, and nothing writes.** A live Screen Output installs no listener for the run. The controls send a plan to the embedded frame and write no Screen configuration, so they need no Graphics Authoring Lease and work for a read-only observer.

**The controls sit behind one control in the preview toolbar, closed on every visit ([#1070](https://github.com/KeeprDigital/stream-keepr/issues/1070)).** The one preview shell both editors mount (`GraphicsEditorPreview`, [#1101](https://github.com/KeeprDigital/stream-keepr/issues/1101)) puts them in the shared preview panel's `animation` slot; the Feature Match Overlay adds its subject buttons beside them. Hiding them does not stop a run: they stay mounted, a loop keeps playing, and the one control is marked as playing so a moving preview is explained.

### Why

The two editors author the same Graphic Item recipes, and a Feature Match Layout has no lifecycle on air of its own, so the composition run is the only place an author sees an enter, on-screen and exit together. The item run answers "what does this recipe do?" without the rest of the layout moving.

### Consequences

- Broadcast Graphics still previews a whole Broadcast Graphic; its frame ignores an `itemId`.
- During a one-item run in a preview backed by a real Feature Match Slot, a sideboard reveal on another Deck List Graphic Item snaps rather than plays, because its recipes are isolated away. A live output is unaffected.
- A frame that reloads mid-run (an output or guide switch) is handed the same run and plays it from the start.
- `test/unit/app/modules/graphicsAnimationPreview.test.ts` holds the timing and isolation rules; the Feature Match Overlay Display and preview aside tests hold the wiring; the preview panel test holds the one control.

### Rejected alternatives

- **An owner filter in the shared render model.** It would add a preview-only input to the model every live output composes through. Isolating motion in the composition leaves that model unchanged.
- **Projecting the item through the per-item animation input** (the sideboard reveal's). That input applies no stagger, so a selected Graphic Group's children would play together rather than in their authored order.
