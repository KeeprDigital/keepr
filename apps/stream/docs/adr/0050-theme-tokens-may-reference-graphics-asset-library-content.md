# ADR-0050: Theme Tokens may reference Graphics Asset Library content

Accepted · 2026-10-27 · [#812](https://github.com/KeeprDigital/stream-keepr/issues/812) · Reverses ADR-0001 · Amended 2026-10-27 ([#828](https://github.com/KeeprDigital/stream-keepr/issues/828)): what is indexed, what holds Retire back, and what the capability admits · Amended 2026-11-11 ([#1085](https://github.com/KeeprDigital/stream-keepr/issues/1085)): the capability admits the Theme's Foundation Tokens and the Screen's own Mode Token overrides

### Decision

**An asset-typed Theme Token, or a Screen Theme Override of one, holds an ordinary Graphic Asset Reference** to an exact revision of an image, silent video or font. Library fonts are included. The reference protects the asset from retire and trash as a template's does (ADR-0034), and the refusal names the Theme or Screen. A Screen Output's asset capability covers the revisions its resolved Theme supplies.

Three token shapes reach library content (#828):

- **An `asset` token** holds `{ kind, assetId, revisionId }` or `null` for none. Its definition names the kinds it admits; the `logo` Foundation Token admits an image or silent video, and ships `null`.
- **A typography token's font** is an application font or one exact font revision, as a Graphic Item's is.
- **A Background Layer stack's image and video layers** take library media as a Screen's own do. A Screen's stack and the `background` token validate through one schema (`shared/modules/theme/background.ts`).

**How each is indexed.**

- **A Theme's references** have owner kind `theme`, the Theme's id, and slots rooted at the token: `logo`, `heading/font`, `background/<layer id>/source`. No token name holds the `/`, so the `background` token's slots never read as a `background.` Mode Token's. A token write replaces only that token's slots, in the statement that commits the value. Each reference must resolve there, and the route first asks the library, so a refusal names the slot. Clearing the token, or setting it to none, releases them. Deleting the Theme drops them.
- **A Screen's overrides** index under its own `themeOverrides.` namespace, beside its modes'. Each override write replaces that whole namespace.

**Retire is refused** while a Theme or an override references the asset, as for a template. A Screen's own mode references still do not hold it back (ADR-0034). Trash was already refused for any reference. The usage names the Theme by its name.

**The capability admits exactly what the Screen's resolved tokens supply.** That is every Foundation Token, which any Screen may consume and a Graphic Item may bind, from the Theme, else the default, plus the Mode Tokens of the mode the Screen shows, from the Screen's override, else the default (#1085). A Theme value an override shadows, a dormant override of another mode's Mode Token or of a Foundation Token, and a Theme the Event does not use supply nothing. The revision must also be indexed by that Theme or by the Screen's override namespace. Screen Outputs load the library fonts their `heading` and `body` Foundation Tokens, and any typography Mode Token, resolve to as `FontFace`s, and hide the mode's display, not its background, while the fonts load. The Screen renderer's frame (`Screen/RendererFrame.vue`) hides it, in place, through a wrapper of its own around the display that generates no box (`display: contents`), so the hide holds whatever a display renders at its root. A font that fails shows the display in its fallback face.

### Why

A Theme is meant to carry the production's logo, backdrop and typefaces. ADR-0001 kept Style Sets data-only so that `.skstyle` needed no asset pipeline. Themes have no export yet, so that cost is deferred rather than avoided.

### Consequences

- Theme export/import, when built, must carry asset bytes through the Template Package asset pipeline: staging, quota, revalidation and Graphic Asset Origin. It cannot be data-only.
- ADR-0001 is fully superseded: #830 removed Graphic Style Sets.
- A Theme or override cannot hold a retired asset, because Retire is refused while one references it. A token write therefore never needs ADR-0034's retained-reference allowance; an override still grants it to a revision it already held at the same slot.
- A Screen overrides only its mode's Mode Tokens and a plain mode's `inset` and `alignment` (ADR-0049, #1085), so no Screen overrides `logo`, a font or the `background` stack; a Screen's background comes from its own Background Layer stack, else the Theme's. The Feature Match Overlay's asset Mode Token `frame-media` is the one library content a Screen overrides. A Foundation Token override stored before #1085 keeps its Graphic Asset References indexed, holding Retire back, though the capability no longer admits them; the production database is wiped rather than pruned (#1060).
- The capability admits the Theme's logo on every Screen of the Event, whether or not that Screen's mode paints it. The Event context already carries the whole Theme, so this reveals nothing new, and a graphics host binding the logo needs no change to the capability.
- Every display sits one element below its host container in the on-air DOM, while it is still laid out, sized and aligned as the container's own child. The frame used to pass the hide to the display as a style, which reached only a display with a root element: one built on `ScreenModeBase` has none, so most modes showed their fallback face while a font loaded.
- A display that transitions `all` at its root would hold the hide back for the transition's duration, so it leaves `visibility` out, as the Card Spotlight does.
- The hide lasts as long as the load: a library font whose load never settles keeps its display hidden, as it does a graphics host's canvas, and the ready timeout (ADR-0053) puts such a rendering on program with its background alone.
