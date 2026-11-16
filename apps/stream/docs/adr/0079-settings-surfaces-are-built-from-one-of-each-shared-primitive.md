# ADR-0079: Settings surfaces are built from one of each shared primitive

Accepted · 2026-11-11 · [#1060](https://github.com/KeeprDigital/stream-keepr/issues/1060), [#1074](https://github.com/KeeprDigital/stream-keepr/issues/1074) · Amended 2026-11-11: the graphics inspector and the Theme editor share one field control for each kind of value · [#1102](https://github.com/KeeprDigital/stream-keepr/issues/1102)

A Screen settings page, a graphics inspector and the Feature Match Overlay's Frame and Source Item panels each had their own collapsible (`ScreenSettingsCard`, `GraphicsInspectorSection`, `FeatureMatchOverlayControlSection`), and shared settings components wrote the field row's layout classes, number inputs, subheadings and hints by hand, so the same control lined up differently from card to card.

### Decision

**There is one of each settings primitive, under `app/components/Screen/Settings*.vue`, and a settings surface is composed from them.**

- **`ScreenSettingsSection`** is the one collapsible section, in two densities. `card` (the default) is a card of a settings page: it starts open and unmounts a closed body. `row` is a row of a property panel: it starts closed, its whole header toggles it, and a closed body stays mounted, hidden. With an `id` it remembers its open state per browser, each density under its own storage key, so what browsers already remember carries over.
- **`ScreenSettingsField`** is the one field row: label and description beside the control, or `stacked` above it for a narrow panel or a wide control.
- **`ScreenSettingsNumberField`** is the one number input. It owns the display scale (shown in displayed units, emitted in stored ones) and emits `null` when emptied. `GraphicsNumberField` wraps it to add the label drag.
- **`ScreenSettingsToggle`** is the one toggle row, **`ScreenSettingsSubheading`** the one subheading (the generic renderer names each group's section by it, `role="group"`; `ScreenSettingsGroup`, which did that by hand, is deleted with its last caller, #1096), and **`ScreenSettingsHint`** the one hint.

**The graphics inspector and the Theme editor share one field control for each kind of value** (#1102), under `app/components/Graphics/`. A Theme token's input is an adapter: it maps the token to the shared control's fields and back.

- **`GraphicsTypographyFields`** is the one typography editor, by `variant`: a Graphic Item's base typography, a Graphic Placeholder Style, and a typography token, which has no size or style, spaces its letters in em and keeps its own bounds (`THEME_TYPOGRAPHY_BOUNDS`).
- **`GraphicsCompositorSurfaceStyleFields`** is the one surface editor, for a Graphic Surface Style and a surface-style token. A host with its own colour picker fills its `color` slot.
- **`GraphicsShapeGeometryFields`** is the one corner editor, for a Graphic Item's Shape Geometry, a shape-geometry token and a Source Item. In its `radii` form every corner is rounded, 0 being square, with no preset or slant: `SourceFramingStyleFields` reads a Source Item's stored radii as that geometry and writes each corner's own radius back, so what a Source Item stores does not change. It replaces the overlay's `BorderRadiusControl`.
- **`GraphicsOpacityField`** is the one opacity control, 0 to 1 in steps of 0.05, wherever an inspector, a Theme token or the settings beside them edit an opacity. It replaces `UIOpacityInput` and the `OPACITY_INPUT` bounds each caller bound.
- **`GraphicsNumberField`** is every other number they edit, a Theme dimension included.

### Why

Every select, number field and toggle lines up the same way only if one component lays each out. One section also means a card and an inspector row cannot drift apart in how they summarise, toggle or remember.

### Consequences

- A component under `app/components/Screen/` that is part of a settings surface writes no raw `UFormField`, no bare `UInputNumber` and no hand-written subheading or hint classes.
- A new density or layout is a prop on the primitive, never a second component.
- The `ScreenSettings*` layout primitives have no tests of their own beyond the open-and-remember rule of the section (`test/nuxt/components/Screen/SettingsSection.test.ts`); the seams that mount them, such as the generic renderer's and `ScreenConfigField`'s tests, cover them.
- Event configuration pages and modals are outside this decision.
- A new inspector or Theme field takes the shared number field, not a bare `UInputNumber` (a lint rule refused one under `app/components/Graphics/` or `app/components/Theme/` until ADR-0089).
- A Theme dimension now steps and drags like every other number, so the Theme editor writes it once its edits pause, as it does a composite token, and an entry beyond its bounds is held at the bound rather than undone. A typography token's weight is a number stepping by 100 rather than a list.
- A Source Item's corners are no longer set through the shared `borderRadius`: "All corners" writes each corner's own radius. A stored `borderRadius` still reads as the radius of every corner that names none.
- A shared field control under `app/components/Graphics/` is tested at its home for the rules it owns, such as a typography's bounds and cleared field, a number field's drag, or a fill's stops (`test/nuxt/components/Graphics/*Fields.test.ts`, `NumberField.test.ts`). The Theme editor's page test and the inspector's, Source Item's and settings' tests each wire it once, through the adapter that maps their values to its fields, and do not retest its rules.

### Rejected alternatives

- **Keeping three collapsibles behind one shared composable.** They already shared `useRememberedOpenState` and still differed in header, summary and defaults.
- **One storage key for both densities.** It would forget every browser's remembered state, and a card and a row could collide on an id.
