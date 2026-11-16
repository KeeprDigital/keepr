# ADR-0027: The Key Output keys every glow at its own opacity

Accepted · 2026-10-17 · [#599](https://github.com/KeeprDigital/stream-keepr/issues/599) · Amended 2026-11-04: a colour's own alpha is keyed, and graphics colour pickers write it · [#967](https://github.com/KeeprDigital/stream-keepr/issues/967)

### Decision

**A glow is composed opacity, so the Key Output paints it like any other paint: white at the glow's own opacity.** That holds for every glow host — a Graphic Item's Graphic Surface Style, a Source Item's framing, and the Feature Match Overlay Frame's border. One module, `app/modules/screen/outputPaint.ts`, owns the Fill-versus-Key paint rules both render models use: a colour at an opacity and a glow on each output. Since #831 the Frame and Source Items take their glow from a surface Mode Token, so the flat hosts' glow defaults are gone. The Frame's paint is decided in the pure Feature Match Overlay render model, not its display. `pnpm accept key-matte` rasterises each host in Chromium and requires the Key matte to equal the Overlay alpha.

### Why

Graphic Item glow already reached the Key Output, but Source Item and Frame glow were withheld from it, so the Fill Output showed a glow the Key matte cut away: on air, a glow keyed against black. A glow is a drop shadow composited source-over, so white at its opacity accumulates into the matte by the same identity as every other element.

### Consequences

- A half-opaque glow is grey in the matte.
- A Frame border with no colour paints nothing in the Key Output either, as in the Fill Output.
- A colour that carries its own alpha (`rgba()`, eight-digit hex, `transparent`) keys at that alpha times the authored opacity (ADR-0049), so the matte matches a translucent colour the picker writes (#967).
- The Frame has no raw CSS gradient since #831. Its fill is its `frame-surface` Mode Token's Graphic Fill, which the Key Output keys at each colour's own alpha. It keys the Frame through opaque white only while the Frame paints media or an Animation Effect, whose colours it has none of.

### Rejected alternatives

- **Keep withholding host glow from the Key Output** — the Fill/Key mismatch is the defect.
- **Key every glow opaque white** — overstates a partial glow, so the matte would no longer match the Fill Output.
