# ADR-0020: Chromium is the only supported engine for transparent video

Accepted · 2026-10-15 · #570

### Decision

**Screen Outputs and authoring are supported on Chromium only.** The video target-compatibility mechanism is removed. That covered:

- the user-agent classification;
- the capability session's `unplayableRevisions` forecast;
- the 409 `vp9-alpha-chromium-required` on Screen Output delivery;
- the reference index's `chromium-transparency` ⇒ Chromium-target clauses;
- the "Will not play on…" picker labels;
- the user agent in Screen Output presence.

A transparent (VP9-alpha) revision is published and delivered like any other. In a browser that can't keep its alpha, it renders flattened; nothing detects or refuses that browser.

### Why

Every output that matters is Chromium: broadcast software captures a browser source through an embedded Chromium, and that is what makes VP9 alpha usable at all. The mechanism protected browsers that are not the product's rendering target. It cost about 700 lines across server, shared and client code, about 25 test files, and a deploy-day gate (`safari-vp9-alpha`) that needed Safari remote automation set up on the operator's machine. The silent-video validator still proves, in headless Chromium, that a transparent revision really renders transparent before it is accepted.

### Consequences

- **Stored documents and v1 Template Packages are not migrated.** `videoCompatibility` on Media Graphic Items, media Graphic Input values and Background Layer sources is accepted and dropped on read, so nothing stored or exported before this change stops loading, and no package version bump is needed. `technical_facts.targetCompatibility` stays on revisions as a recorded fact.
- **The validator's rejection is renamed** `vp9-alpha-transparency-unproven`. Reports stored before keep the old code.
- **The picker no longer refuses a transparent revision lacking the validator's `chromiumTransparencyPlayback` proof.** That is safe because every path that accepts an alpha revision (ingestion, repair, package install) runs the validator and stamps the proof, so an unproven alpha revision cannot be reached.
- **Stable codes are retired, not removed.** The preflight warning `graphic-asset-compatibility-restricted` and the acceptance evidence codes `restricted-video-session-refused`, `restricted-video-refusal-unforecast`, `safari-vp9-alpha-not-blocked` and `safari-vp9-alpha-transparency-rendered` are no longer raised; they stay listed because those code sets are append-only.
- Deploy day runs six acceptance gates.
- Control surfaces are not blocked in other browsers, and keep the `-webkit-` CSS iPad needs. The Feature Match Overlay keeps its `-webkit-mask` prefixes, because the Chromium versions embedded in broadcast software are unconfirmed.

### Rejected alternatives

- **Keep the block, drop only the Safari gate** — cheaper. But it kept 700 lines guarding a non-target browser, and the rest of the suite would still have tested the block without ever proving a real Safari needed it.
- **Detect non-Chromium browsers and warn** — keeps the user-agent detection this removes, to tell an operator something they can't act on mid-show.
- **Migrate stored documents to remove the key** — five document tables and every exported package, for a key that is harmless once ignored.
