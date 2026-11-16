# ADR-0014: Animation Effects are rebuilt in-house on three.js

Accepted · 2026-08-23, amended under #621 · [#473](https://github.com/KeeprDigital/stream-keepr/issues/473)

### Decision

Animation Effects are built in-house behind a typed, **host-agnostic** contract (`create/setParams/resize/render(t)/dispose`) with per-effect configuration, in `app/utils/animation-effects/`. The nine effects of the vendored, `@ts-nocheck` Vanta.js fork were ported under their existing names and the fork is gone; the vocabulary is `ANIMATION_EFFECT_VALUES` in `shared/animationEffects.ts`. Rendering stays on three.js: five of the original nine are mesh-based (waves, rings, dots, net, globe) and three.js was already a dependency. Shader-only effects use a fullscreen `ShaderMaterial` base; a Canvas2D backend remains possible under the same contract. Effects animate autonomously from elapsed time — the fork's synthetic mouse drift, needed to move on a headless browser source, is retired.

Three hosts use the renderer: the Feature Match Overlay Frame, an Animation Effect Background Layer (in the Background Screen's stack, ADR-0016, and every plain overlay mode's), and the Broadcast Graphics Background, so the renderer must not assume any of them.

### Consequences

- Effect names are a closed vocabulary pinned by the Feature Match Layout format version, so Template Packages and stored configs keep resolving. Per-effect config changed what a `frame.animation` capability payload carries without a format-version bump — no payload half-parses under the wrong shape: a new-shape payload fails an older installation's strict schema; a pre-rebuild bag (recognised by its `mouseDrift*` fields) resets to no animation; and a package declaring an effect this installation does not ship is refused at capability preflight. A bump would also have refused older packages carrying no animation at all; the reasoning sits beside `FEATURE_MATCH_LAYOUT_FORMAT_VERSION`.
- Saved frame-animation settings from before the rebuild reset rather than migrate (small install base).
- Since #831 a layout's `frame.animation` holds only whether the effect shows and at what opacity. The effect and its params are the Theme's `feature-match-overlay.frame-animation-effect` Mode Token, so a stored or packaged effect is dropped when read and a layout declares no effect capability. The effect identities stay recognised.

### Rejected alternatives

- **Extend the Vanta fork** — untyped, mouse-driven motion, and a flat config whose parameter ranges already diverged across three copies (Zod, runtime clamp, editor).
- **A hand-rolled WebGL2 fragment harness** — cannot host the mesh-based effects, forcing a second GL stack beside three.js.
- **An offline WebCodecs → looping-video pipeline** — effects render live in the OBS browser source with no replay, so loop-seamlessness and determinism machinery buys nothing.
