# ADR-0068: An Installed Graphics Template may be removed, releasing its references, and a retried installation reinstalls it

Accepted · 2026-11-04 · [#622](https://github.com/KeeprDigital/stream-keepr/issues/622) · Amends ADR-0034

### Decision

**Any signed-in User may remove an Installed Graphics Template.** It is the library's own Delete, for an imported entry as for an authored one. #411 will narrow who may. Removal releases the Template's Graphic Asset References and takes it out of the library in one transaction (`removeInstalledGraphicsTemplate` in the Graphics Asset Library). Copies placed from it are independent and unaffected. Editing an Installed Graphics Template stays out of scope: it is still never renamed or revised, and is changed by placing it and saving the placed copy.

**The row stays, as provenance.** A removed Template keeps its document, source identity and installing operation, marked with `removed_at` and `removed_by`. It is in no listing, reads as not found, and holds no reference, so nothing in the library counts it. The Graphics Ingestion Operation that installed it keeps its idempotency key and its `packageInstallation` receipt unchanged.

**Retrying the installation reinstalls the same Template.** Posting the installation of a completed operation answers with that operation, as before. When the Template it published has been removed, the post first reinstalls it under the same identity. The staged package is long released, but nothing needs it: the stored document already names local revisions, so reinstalling re-indexes those (`installedTemplateDocumentReferences`). As installation required of a reused revision, each must exist on an active Graphic Asset. If one is retired, trashed or gone, the retry is refused with `409` and nothing changes; restoring the asset, or importing the Template Package again, is the way back. Importing again creates a new Installed Graphics Template, as it always has.

**Removal follows the Retire and Trash rules.** A Graphic Asset is refused Trash while anything references it, and Retire while a template does. An Installed Graphics Template's references now hold Retire back like an authored template's (amending ADR-0034), and removing the Template is what releases them. Retire and Trash would also refuse to remove a Template something still referenced. Nothing references an Installed Graphics Template by identity today, because placing one copies it, so no removal is refused on that ground yet.

### Why

An Installed Graphics Template could not be deleted, so the revisions its references pinned could never be Trashed, pruned or purged, even after nothing else used them (#622). ADR-0034 let Retire ignore those references only because nothing could release them. With removal, they can be treated like any other template's.

### Consequences

- A revision only a removed Template pinned is unreferenced at once: Trash may take its asset, and a superseded one becomes a Revision Pruning candidate at the next Graphics Retention Sweep. A revision another artifact still references stays held by that reference.
- **A Graphic Asset an Installed Graphics Template references can no longer be Retired** until that Template is removed. This applies to every installation already made, with no backfill: their references were always indexed under `installed-graphics-template`. An asset already retired under an Installed Graphics Template stays retired, and that Template stays unplaceable until the asset is restored.
- Only the User who started an installation can retry it, as for every Graphics Ingestion Operation, while any signed-in User may remove what it installed. A retry reinstalls only while that operation's record exists; the retention contract plans to clean one up a year after it ends. Either way, importing the Template Package again still works, as a new Installed Graphics Template. The library's Delete prompt says so.
- Removal records no Evidence: it is not a Graphic Asset lifecycle transition. The removed row's `removed_by` and `removed_at` record who removed it and when.
- The two columns are nullable. A row with neither set reads as installed.

### Rejected alternatives

- **Delete the row.** A retried installation would then have nothing to reinstall from, because its staged bytes are released at completion, and the receipt would name a Template no record explains.
- **Refuse a retry after removal as already handled.** The maintainer chose to reinstall (#622).
- **Two-stage removal, like Trash, with a restore window.** Retrying the installation already restores a removed Template, for as long as its assets can take references.
