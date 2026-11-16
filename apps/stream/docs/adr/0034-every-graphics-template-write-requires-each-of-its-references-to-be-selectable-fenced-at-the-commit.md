# ADR-0034: Every graphics Template write requires each of its references to be selectable, fenced at the commit

Accepted · 2026-10-21 · [#614](https://github.com/KeeprDigital/stream-keepr/issues/614) · Amended 2026-10-28: the Graphic Style Set operations it also covered are gone · [#830](https://github.com/KeeprDigital/stream-keepr/issues/830) · Amended 2026-11-04 by ADR-0068: an Installed Graphics Template's references hold Retire back too · [#622](https://github.com/KeeprDigital/stream-keepr/issues/622)

### Decision

**A template has no retained-reference path.** Every write of a Broadcast Graphic Template or a Feature Match Layout Template requires each Graphic Asset Reference its stored document holds to name an existing revision, with available content, of an active Graphic Asset whose kind fits its item, input, or typography slot. That covers save, revision and rename. A write that keeps a reference it already held is held to the same rule as one that introduces it. Anything else is refused with `409`.

**The route asks first and names every refused slot.** `assertGraphicsTemplateReferencesSelectable` (`server/utils/graphicsTemplateReferences.ts`) asks the library once for the whole document and lists each slot with its reason: does not exist, content unavailable, retired, trashed, or the wrong kind.

**The store asks again in the statement that commits.** The template row's `INSERT` or `UPDATE` carries `REQUIRED_GRAPHIC_ASSET_REFERENCES_RESOLVE`, the rule the Screen write already uses, with no reference allowed to be retired. The reference-index insert reads the same bound array under the same rule. So a template commits only with every reference resolving, and then every reference is indexed. The rule now lives in `server/modules/graphic-asset-reference-resolution.ts`, shared by the Screen and both template stores. A commit the rule refuses answers its own `409`, told apart from a stale `revision` by the revision still standing.

**Retire is refused while a saved template references the asset.** Retiring a Graphic Asset is refused while any Broadcast Graphic Template, Feature Match Layout Template or Installed Graphics Template (since ADR-0068) references any of its revisions. It answers `in-use` with those templates' usage, as Trash answers a referenced asset, and the Library Workspace names them. The condition sits in the catalogue's retiring `UPDATE`, so a template saved concurrently either commits first and holds the asset back, or finds the asset retired and is refused. A Screen's reference does not hold Retire back: a Screen keeps an unchanged retired reference resolving, as before. This matches a selected Broadcast Deck List, which cannot be deleted. A Theme's reference, a Screen Theme Override's and a Talent's photo do hold it back (ADR-0050, ADR-0067).

**Content availability is checked at the route only.** It is the byte store's state, which no D1 statement can see.

### Why

Both template stores checked only that a revision existed. An image Media Graphic Item could pin a font, and retired or unavailable content was accepted. The check ran only at the route, and the index insert silently skipped a revision it could not find, so a template could be stored with a reference the index never recorded. No template documents with old references exist yet, so there is nothing to keep a retained-reference exemption for.

Without the Retire guard, the rule would turn retiring an asset into making every template that uses it unrevisable, a rename included.

### Consequences

- A template's references cannot become retired, trashed, pruned, or purged under it. Trash, Revision Pruning, and purge each prove no reference points at a revision, and Retire now proves no template does.
- Unavailable content can still appear under a saved template. It refuses that template's writes until Exact-Byte Repair restores the bytes.
- An Installed Graphics Template holds Retire back like an authored template (amended by ADR-0068). It is never revised, so this once made its assets unretirable for good; removing it now releases them. An asset retired before that amendment can still sit under one, leaving it unplaceable until restored.
- A template already holding a retired reference (written before this rule, or by a direct database change) is refused on every write until the reference is replaced in that write or the asset restored.
- A rename on a stale `revision` skips the route's check and gets the revision conflict, so an author is not told about a document they have not read. A revision carrying a new document is checked first, as before.
- A Template Package Installation writes Installed Graphics Templates through the library's own store, which already maps every reference to one exact local revision.

### Rejected alternatives

- **Exempt a reference the template already held, as a Screen does.** The maintainer chose no distinction (#614): there are no older template documents to protect, and the exemption is what let wrong-kind and retired references through.
- **Guard only the route.** A retirement between the route's question and the commit would land.
- **Let Retire proceed and leave the template unrevisable.** That was this ADR's first version. The maintainer chose to refuse Retire instead (#614).
- **Hold Retire back for Screens too.** It would change existing behaviour nothing here needs to change: a Screen keeps an unchanged retired reference resolving, so a retirement leaves it editable.
