# ADR-0001: Graphic Style Sets reference application fonts only

Accepted · 2026-08-01 · [#143](https://github.com/KeeprDigital/stream-keepr/issues/143) · Superseded 2026-10-28 by ADR-0049 and ADR-0050 · [#830](https://github.com/KeeprDigital/stream-keepr/issues/830)

**Fully superseded.** Graphic Style Sets and the `.skstyle` package are gone (#830), so nothing remains for this decision to govern. It kept a Style Set's typography entries to application fonts so `.skstyle` could stay data-only, with no asset pipeline. Themes replace Style Sets (ADR-0049), and a Theme's typography may name a library font (ADR-0050). A Graphic Item's own typography takes either arm of `GraphicFontSelection`, as before. What changed: the Style Set typography entry, its `GraphicApplicationFontSelection`-only wire schema and the `.skstyle` font refusals were deleted with Style Sets.
