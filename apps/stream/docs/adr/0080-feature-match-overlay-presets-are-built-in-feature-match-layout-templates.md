# ADR-0080: Feature Match Overlay presets are built-in Feature Match Layout Templates

Accepted · 2026-11-11 · [#1097](https://github.com/KeeprDigital/stream-keepr/issues/1097) · Amends ADR-0030 and ADR-0063

The Feature Match Overlay editor replaced a layout two ways: a preset select with its own Reset, and placing a Feature Match Layout Template. A Screen also stored the `presetId` its layout started from, which nothing read but that select (#1060).

### Decision

**The three presets are built-in Feature Match Layout Templates, listed in the Templates library with the saved and installed ones.** A built-in is stored nowhere: the library module (`server/modules/feature-match-layout-template-library`) answers it from `shared/builtInFeatureMatchLayoutTemplates.ts`, under the identity `builtin:<id>`, which no generated identifier can equal. Its summary is marked `builtIn`, and the library shows it as built-in.

**A built-in is placed like any other template and nothing else.** Placement goes through the same route and the Screen's lease-fenced write (ADR-0030). Revising, removing and exporting one are refused with `409` before anything else the route does, and the library offers none of the three.

**The preset select and its Reset are removed, and `presetId` is a former field** of the Feature Match Overlay's config contract (ADR-0037): no reader sees it, a write naming it is accepted without storing it, and the next PATCH removes it. The Screen header's "Reset mode settings" is the only reset, and writes the default layout.

**The aspect-ratio warning is shown when a template is placed**, in the placement confirmation, when the template states an aspect ratio that differs from the Event Canvas's by more than 0.05. Only a built-in states one (16:9).

### Why

One action offered once: replacing a layout is placing a template. A preset was already a whole layout with nothing carried across, which is what a template is. `presetId` could only say which preset a layout once started from, and was wrong as soon as a template was placed or the layout edited.

### Consequences

- A built-in pins no Graphic Asset Revision, so it places on any installation and holds back no asset's retirement (ADR-0034). `test/unit/shared/builtInFeatureMatchLayoutTemplates.test.ts` holds that.
- A built-in is not in a Template Package: every installation has it. To take a changed copy elsewhere, place it, save the placed layout, and export that.
- A session observing another's lease may still send `presetId`; it is dropped, not refused, since it is no longer a field of the Edit workspace.
- A saved or installed template carries no canvas size, so it never warns. Giving one an aspect ratio is a later decision.
- Placing a built-in is undone like any placement, by the editor's checkpoint before it.
- Tests: `test/unit/server/api/featureMatchLayoutBuiltInTemplates.sqlite.test.ts` (listed, read, placed without a `presetId`, refused), `test/nuxt/components/Graphics/FeatureMatchLayoutTemplateLibrary.test.ts` (marking, actions, warning).

### Rejected alternatives

- **Seeding the built-ins as rows of the authored store.** They would be revisable and removable per installation, and an application update could not change one without a migration.
- **Keeping `presetId` as provenance.** A placed template records no origin either, and a field only sometimes true is worse than none.
- **Warning on every template.** Only a built-in states the canvas it was drawn for.
