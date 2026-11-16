# ADR-0005: `static-font-v1`'s server-side checks are a floor; the browser is the gate

Accepted · 2026-08-02 · [#153](https://github.com/KeeprDigital/stream-keepr/issues/153)

### Decision

1. **`static-font-v1` rejects a cmap subtable declaring a non-zero `language` on any platform other than Macintosh**, with code `font-cmap-language-invalid`. It reads the parsed cmap, so it holds for TTF, OTF, WOFF and WOFF2 alike. On the Macintosh platform OpenType defines `language` as the Mac language ID plus one, so non-zero is correct there; the exemption is pinned twice — a unit test builds a Mac-language-only variant and requires acceptance, and the browser acceptance harness (`scripts/run-font-browser-acceptance.mjs`) serves that variant as a face that must load and render.
2. **The server-side checks are a floor, not the gate.** Acceptance requires browser evidence — `FontFace.load()` plus representative glyph rendering at server-selected code points, bound to the source and challenge digests — and `reportWithBrowserDecodeEvidence` refuses to publish a font without it.

### Why

A bundled application font, `mplantin.ttf`, passed every server-side check yet Chromium's sanitiser refused it, because its Microsoft-platform subtable declares `language` 1. That font is gone; `public/fonts/mana-cmap-language.ttf` reproduces the defect. The platform split was settled by experiment, restating each subtable independently and loading all four combinations in real Chromium: only a zero Microsoft-platform language loads, and the wrong `rangeShift` the sanitiser also logs does not matter.

A font sanitiser is a large, versioned, adversarially maintained program whose refusals track browser releases; reimplementing it means maintaining a second copy of someone else's moving contract and being wrong silently. The actual requirement is "this face loads and renders in the browser that shows it on air", and only a browser answers that — the same shape as silent-video validation (#38): where proof needs a runtime the validator is not, the validator bounds and describes the bytes and the runtime's evidence decides publication.

Server rules still earn a place because they fail earlier and more legibly: without one, the profile reports the font accepted and hands the author a glyph challenge their browser cannot answer. Each future rule needs a real observed defect, a cheap deterministic check and a stable code, and must be settled against a browser before it ships — the first version of this one read the sanitiser log's three severities as one rule and rejected fonts that load.

### Consequences

- `mana.ttf`'s cmap records all share one subtable, so a per-platform language cannot be set on it directly. Both fixtures therefore start from `withSeparateCmapSubtables(mana.ttf)`, which gives each record its own subtable. `public/fonts/mana-cmap-language.ttf` is the negative fixture: that split font with every non-Unicode cmap `language` restated to 1 by `refusedCmapLanguage`, committed and pinned byte-for-byte to that derivation by a unit test. The Macintosh-exemption variant is the same split font run through `macintoshCmapLanguage`. A unit test reads each variant's cmap records and requires the language each platform is meant to carry, so a variant that degenerates fails loudly. Accepted-TTF fixtures use `mana.ttf`. (The original defect was a TTF listed as an unreachable fallback in a font's `@font-face`, which could only ever have produced the silent substitution #28 forbids.)
- The harness proves both directions: `refusedFaces` in `public/_acceptance/static-font-v1.json` lists faces the profile rejects, and the run fails with `font-refused-face-loaded` if the browser loads one.
- The unreferenced legacy `.eot`/`.svg` formats of both fonts were deleted with the fixtures' move to Mana.
