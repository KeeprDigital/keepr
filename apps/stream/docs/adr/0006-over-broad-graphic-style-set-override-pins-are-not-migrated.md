# ADR-0006: Over-broad Graphic Style Set override pins are not migrated

Accepted · 2026-08-05, amended under #229 and #240 · [#199](https://github.com/KeeprDigital/stream-keepr/issues/199) (decided under #167) · Superseded 2026-10-28 by ADR-0049 · [#830](https://github.com/KeeprDigital/stream-keepr/issues/830)

**Fully superseded.** Graphic Style Sets are gone (#830), and with them the review flow, the recorded overrides and the pins this decision governed. A Graphic Item property now binds a whole Foundation Token or holds a literal, with no override record (ADR-0049). What changed: `heldGraphicStyleOverrides`, `recaptureGraphicStyleOverrides` and the bind and unbind edits were deleted. A stored or packaged document still carrying a `styleRefs` override record reads, and the record is dropped (ADR-0049).
