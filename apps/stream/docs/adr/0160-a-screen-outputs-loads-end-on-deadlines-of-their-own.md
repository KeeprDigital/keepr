# ADR-0160: A Screen Output's loads end on deadlines of their own

Accepted · 2026-11-20 · [#1380](https://github.com/KeeprDigital/stream-keepr/issues/1380) · Amends ADR-0053

### Decision

**A font load that has not settled within `FONT_LOAD_TIMEOUT_MS` (8 s) fails**, library and application alike (`withinFontLoadTimeout`, `useApplicationFontFaces.ts`). A library font's display, hidden while it loads, shows in its fallback face, and a rendering waiting on it is ready, under the ready timeout (10 s) rather than at it.

**An image preload that has not settled within `IMAGE_PRELOAD_TIMEOUT_MS` (8 s) counts as failed** (`preloadImage.ts`). What waits on one, a Deck List's staged swap, `useStagedScreenContent` and the Card Spotlight among them, goes ahead with its placeholder, and a Deck List reports itself degraded and rebuilds on its slow cadence, as for an image that failed.

**A Screen Mode Data Freshness read still in flight `SCREEN_MODE_REREAD_MS` (15 s) after it began, with a follow-up asked of it, is superseded then** (`freshness.ts`). Before, only a further message heard past that point superseded it.

**A retry of the Screen Output Asset Capability session after a refusal stays settled on what it holds** (`useScreenGraphicAssetContentUrls`). It asks the same question again, so the fonts resolved through it keep their state, a failed font's fallback face included.

### Why

Each of these waited on something with no end of its own. A Screen Output runs for hours on venue networks, where a request can hang rather than fail:

- ADR-0053 bounded a font load only by the frame's ready timeout. That timeout puts the rendering on program, but the display wrapper stays hidden for as long as its library font is loading, so a hung font load showed the background alone, indefinitely.
- A card image that never loaded held its Deck List's build forever, so a newly sent deck never swapped in.
- A message heard while a read was young asked for a follow-up once that read settled; a read that hung settled never, and the message was lost until the next one.
- Each retry of a refused capability session went unsettled while it was out, and a font that had already fallen back reloaded, hiding its display for the length of every retry.

### Consequences

- A font or image slower than 8 s on a cold cache shows its fallback or placeholder first. A Deck List rebuilds on its degraded cadence and swaps in the art once it loads; a font does not retry until what names it changes.
- 8 s sits under the 10 s ready timeout, so a rendering held only by a font goes on program with its display shown.
- A read that consistently takes more than 15 s with messages arriving is superseded each time; its answers never land while that lasts, and the rendering holds what it shows.
- `test/nuxt/components/Screen/RendererFrame.test.ts` pins the frame's readiness and font hiding, the composables' own suites the deadlines.

### Rejected alternatives

- **Superseding every read older than the re-read interval, message or not.** A slow but healthy read would never land; with nothing heard, what it holds is not known to be behind.
- **Aborting the hung request.** The deadline decides what the rendering shows; the request ending is the browser's, and nothing it answers late is applied.
