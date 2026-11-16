# ADR-0021: A Screen Media Source is for a Screen's own media; graphics content stays library-only

Accepted · 2026-10-15, amended under #582 · [#484](https://github.com/KeeprDigital/stream-keepr/issues/484)

### Decision

**A Screen Media Source — one exact Graphic Asset Revision or a Remote Media URL — is offered only where a Screen supplies its own media:** image and video Background Layers (on the Background Screen and every plain overlay mode) and the Feature Match Overlay Frame's image and video. Media Graphic Items, media Graphic Input defaults, and Broadcast Graphics Live Session media values stay Graphics Asset Library references only. Fonts are out of scope.

In code it is `ScreenMediaSource` (`{ kind: 'asset', assetId, revisionId } | { kind: 'url', url }`), never `MediaSource`, which would shadow the browser global. The Frame takes it as-is: `backgroundImage` becomes a `ScreenMediaSource`, and `mediaBackground` becomes `{ enabled, source, fit, opacity, playbackRate, loop }` with no `type`, its library arm limited to silent video. One shared picker component serves every host.

A Remote Media URL is HTTPS or root-relative, and the empty string means unset. A root-relative path must name media the application serves: it is taken only under an allowlist of app-served media prefixes, today `/video/` alone (`APP_SERVED_MEDIA_PATH_PREFIXES`, `shared/utils/remoteMediaUrl.ts`). Every other same-origin path is refused, as is any path that could leave the prefix once resolved or percent-decoded: a dot segment however spelled or encoded, a backslash, whitespace or a control character, or a second encoding layer. An HTTPS URL must carry its `//` authority, because `https:/api/…` resolves against the Screen's own origin. The schema and the editor share the rule and its wording.

### Why

Background Layers are where an operator drops in whatever a show needs, including media hosted elsewhere, so they need both sources. Graphic Items and Inputs are graphics content: templates, packages, and live values are built on every persisted graphics reference pinning an exact revision and on approved remote ingestion never creating a remote dependency (RULES.md invariants). A URL there would make every such Template unexportable. The ticket's "everywhere" went no further once that cost was clear.

Plain `http://` is refused because an HTTPS-served Screen blocks it as mixed content, which would show a blank output with no error.

A root-relative path was first accepted wherever it pointed, so an author could paste a library content route (`/api/graphics-assets/…/content`) as a Remote Media URL. It previews, because Preview fetches with the author's session, and is blank on air, because a Screen Output holds only its Screen Output Asset Capability. It also bypasses the exact-revision reference, so the revision counts as unused and can be retired under a live Screen (#582). An allowlist rather than a `/api/` denylist means a new route cannot reopen that gap. `/video/` is the one directory under `public/` holding Screen media; `/fonts/` (fonts are out of scope), `/_acceptance/` (environment probe pages) and `/favicon.ico` are not backgrounds.

### Consequences

- **No old shape is accepted.** Stored Frames holding a bare `{ assetId, revisionId }` `backgroundImage` or a `mediaBackground.url` fail the schema, as do v1 `sklayout` payloads in that shape. `FEATURE_MATCH_LAYOUT_FORMAT_VERSION` and the package schema version stay 1. That is safe because nothing has shipped and ADR-0019 wipes production; local D1s holding such Frames need a reset.
- **A Feature Match Layout with an HTTPS Remote Media URL still cannot be exported or installed** (`remote-resource-dependency`). The issue names the slot and points to the library's approved HTTPS copy. A root-relative path is not refused: it travels as data and resolves against the receiving installation, so a file that installation does not serve renders blank. Accepted, as that already held for the Frame video and the failure is a blank, not lost data. Asset-sourced Frame media exports through the existing reference walker.
- **The allowlist reaches every Screen Media Source host through the one schema:** Background Layers on every mode, the Frame's image and video, Feature Match Layout Template writes, and `.sklayout` installs, which refuse a package naming any other root-relative path and name the field. Stored configurations are read without the schema, so a stored path outside the allowlist still renders as before, and the next write that re-sends its stack or layout is refused until the author changes it; the editor shows the refusal on the field. An installed layout holding one drops out of the library, as any unreadable installed document does. Nothing is migrated: nothing has shipped (ADR-0019).
- Asset-sourced Frame media keeps its place in Graphic Asset Reference indexing (`layout.frame.*`); URL sources fabricate no reference. Plain-mode Background Layers are indexed too, each under its own `<mode>.backgroundLayers.` namespace, because every plain mode names its stack alike (#580).

### Rejected alternatives

- **URL everywhere, as #484 first asked** — breaks the exact-revision and no-hotlink invariants for graphics content, and makes Templates unexportable.
- **Let a URL travel in a Template Package as data** — a package would then depend on a remote host the receiver never vetted, which is what `remote-resource-dependency` exists to refuse.
- **Turn the Frame's media into a Background Layer stack** — graphics hosts own their backgrounds (ADR-0016); that is its own decision.
- **Normalise old Frame shapes on read** — costs little, but nothing in the old shape has shipped.
- **Refuse only `/api/` root-relative paths** (#582) — every route added later would need remembering, and other same-origin paths are not media either.
- **Refuse root-relative paths entirely** (#582) — bundled media would have to become library assets or a named built-in, a bigger change for no extra safety once the allowlist holds.
- **Only warn in the editor when a URL looks like a library path** (#582) — stored values and imported packages would pass unchecked.
