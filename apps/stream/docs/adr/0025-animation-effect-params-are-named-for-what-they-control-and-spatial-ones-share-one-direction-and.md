# ADR-0025: Animation Effect params are named for what they control, and spatial ones share one direction and neutral value

Accepted · 2026-10-15 · [#503](https://github.com/KeeprDigital/stream-keepr/issues/503) · extended 2026-10-21 · [#583](https://github.com/KeeprDigital/stream-keepr/issues/583)

### Decision

**One operator-facing concept gets one param name.** Spatial knobs in the Animation Effect catalogue split by what the operator sees:

- **`scale`** sizes a repeating field's features (cells, facets, threads, fog, waves), so their count changes inversely. Its label is "<Feature> scale".
- **`size`** sizes discrete elements whose count is fixed or set by another param (`density`, `points`). Its label is "<Element> size".
- **`spacing`** sets the gap between elements without resizing them.

A larger value always draws larger on screen, and a `scale` of 1 is the effect's designed look. The existing effects are retrofitted:

- `zoom` becomes `scale` on caustics, fog, inkmap, and waves.
- `size` becomes `scale` on cells and shards.
- Weave's `scale` is inverted.
- Halo's "Size" becomes "Halo size".

Each new range is the old range mapped through the change, so the extremes the proof scenarios already passed are the ones offered. The rule is stated beside the catalogue in `shared/animationEffects.ts`, and a catalogue unit test refuses `zoom` and any qualified variant (`cellSize`, `waveScale`).

**Every other param is named the same way: for what the operator sees change, under the shared name when the concept is shared** (#583):

- **`speed`** is the effect's whole motion rate and is never qualified. A rate for one motion inside an effect that also has `speed` is `<motion>Speed`.
- **`intensity`** is brightness or glow strength, and nothing else.
- **`centerX`/`centerY`** move the pattern's centre.
- **A colour is `<role>Color`**, named for what it paints and labelled "<Role> color". `backgroundColor` is the colour behind everything; a tonal ramp uses `highlightColor`/`lowlightColor`.
- **A toggle is `show<Thing>`**, naming the thing its label shows.
- **No shader quantities**: no `*Factor` multipliers, numbered keys, or bare `color`.

The ported fork names that broke it are renamed, each new key keeping the old range and default:

- cells: `color1`, `color2` → `lowlightColor`, `highlightColor`.
- dots: `color`, `color2` ("Accent color") → `dotColor`, `lineColor` ("Line color").
- fog: `blurFactor`, `baseColor` → `softness`, `backgroundColor`.
- globe: `color`, `color2`, `maxDistance`, `showDots` → `lineColor`, `accentColor`, `connectionDistance`, `showPoints`.
- halo: `amplitudeFactor` ("Intensity"), `baseColor`, `xOffset`/`yOffset` → `petalDepth` ("Petal depth"), `tintColor`, `centerX`/`centerY`.
- net: `color`, `maxDistance`, `showDots` → `lineColor`, `connectionDistance`, `showPoints`.
- ripple: `amplitudeFactor` ("Intensity"), `ringFactor` ("Ripple scale"), `rotationFactor` ("Rotation"), `color1`, `color2` → `size` ("Ring size"), `swingSpeed` ("Swing speed"), `drift` ("Ring drift"), `highlightColor`, `lowlightColor`.
- waves: `color`, `waveSpeed` → `waveColor`, `speed`.
- ridgelines (not a port, but its key disagreed with its own label): `fillColor` ("Ridge color") → `ridgeColor`.

A catalogue unit test refuses `*Factor`, digits, offsets, a colour key that is not `<role>Color` or whose label is not "<Role> color" for that role, a `<motion>Speed` beside no `speed`, and a toggle that is not `show<Thing>` naming the thing its label does. Whether a label describes what the knob does stays a reviewer's check against the shader.

### Why

The catalogue had three names for one concept (`size`, `scale`, `zoom`) and two directions under one label. Caustics', fog's, and inkmap's "Zoom" drew smaller features as the value rose, while waves' "Zoom" drew larger ones. #503 first proposed applying a standard only to future effects, because renaming shipped params resets stored configs (ADR-0014). Nothing has shipped (ADR-0019), so a retrofit costs no real data now. After first ship, every rename would cost a reset.

### Consequences

- **Stored params and Template Packages naming the old keys stop parsing**: the strict schemas refuse them and the renderer falls back to defaults. That is acceptable before ship only. No format-version bump, for the reason ADR-0014 gives.
- Ripple's `ringFactor` ("Ripple scale") was a motion knob, not a spatial one, so #503 left it alone; #583 made it `swingSpeed`: it sets how fast each ring's lights swing back and forth round it.
- Halo's and ripple's `amplitudeFactor` were both labelled "Intensity" but neither changes brightness: halo's deepens the petals of its flower edge, ripple's sets each ring's radius. So ripple's becomes `size` under the spatial standard (its twenty rings are fixed), and halo's becomes `petalDepth`.
- Shader uniforms carry the catalogue's names, so a reader follows one name from the editor to the GLSL.
- The #583 renames carry no stored-config migration, for the same reason as #503's: the first consequence above accepts the reset before ship, ADR-0014 needs no format-version bump for it, nothing is live (ADR-0019), and no shipped preset, seed, or proof scenario keeps an old key. After first ship, a rename like these needs a migration or a reset accepted in its own ADR.
- Cells' and waves' ranges are renormalised so 1 reproduces their old defaults (size 3, zoom 0.85), which leaves their bounds at uneven values (cells 0.1–1.65).

### Rejected alternatives

- **Standard for future effects only** — leaves the direction conflict on air permanently, to save a rename that costs nothing before ship.
- **`zoom` for sample-domain scale, `size` for element scale** (#503's example) — splits on shader maths rather than what the operator sees, and "zoom" suggests a camera that only waves has.
- **One name for every spatial knob** — ember needs both a density and a size, so "how big" and "how many" must stay distinct.
- **Pixel-level direction tests** — the renderer harness could prove direction, but the cost outweighs a rule a reviewer checks against the docblock.
- **`amplitudeFactor` → `intensity` everywhere** (#583's first example) — puts a second meaning under `intensity`, which caustics, ember, and shards use for brightness.
- **Keep the fork's names on the ported effects** — every one would need renaming after ship at the cost of a reset; before ship it costs nothing.
