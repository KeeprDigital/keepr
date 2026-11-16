# ADR-0073: The Graphics Asset Library keeps one facade, and an operation family moves behind its own smaller interface only where its invariants get a home

Accepted · 2026-11-04 · [#623](https://github.com/KeeprDigital/stream-keepr/issues/623) · Follow-ups [#989](https://github.com/KeeprDigital/stream-keepr/issues/989), [#992](https://github.com/KeeprDigital/stream-keepr/issues/992); [#990](https://github.com/KeeprDigital/stream-keepr/issues/990) was closed as not planned, pending the #989 trial; [#991](https://github.com/KeeprDigital/stream-keepr/issues/991) was closed as not planned, and what remained of it is [#1140](https://github.com/KeeprDigital/stream-keepr/issues/1140) · Amended 2026-11-12 by [#1122](https://github.com/KeeprDigital/stream-keepr/issues/1122), which deletes the in-memory catalogue adapter, by #1140, which requires retention of the catalogue port, and by #989, which moves ingestion on its invariants alone.

### Evaluation

The evidence is from `main` at `82c22f49`, after #949 (Talent photo) and #950 (Installed Graphics Template removal).

**The current interface.** Every reader and writer sees one facade, `GraphicsAssetLibrary`: 53 methods (`server/modules/graphics-asset-library/index.ts:659–1077`), all built by one 4,600-line factory, `createGraphicsAssetLibrary` (`index.ts:1259–5878`). The factory takes one catalogue port, `GraphicsAssetCatalogue`, which has 42 methods plus `checkHealth` (`index.ts:362–657`), and a staging and a canonical byte store (`index.ts:1112–1131`). The port has two adapters: D1 (`catalogue.ts:486`) and in-memory (`in-memory-catalogue.ts:51`). The D1 adapter also spreads three further catalogues, for retention, reconciliation and the cockpit (`catalogue.ts:492–495`).

**The real operation families,** found by tracing which facade methods call which catalogue methods and which invariants change together:

| Family                  | Facade                                       | Catalogue                                                                      | Where it lives                                                                         | Verdict                                                 |
| ----------------------- | -------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Delivery                | 5 reads (`index.ts:5446–5553`)               | `findRevisionContent(s)`, `findThumbnailContent` (`index.ts:607–657`)          | Closures in the factory (`index.ts:1693–1710`, `1802–1882`)                            | **Moved here**                                          |
| Ingestion               | 15 (`index.ts:4210–4249`, `4473–5275`)       | 19, among them publish, reuse, claim, multipart and staged bytes               | `continueGraphicsIngestion` (`index.ts:3707`), helpers (`1891–2631`)                   | Going ahead on its invariants alone, as the trial: #989 |
| Template Packages       | 8 (`index.ts:4250–4472`, export `5554–5717`) | 12, plus `findRevisionContent` (`index.ts:3339`, `5580`)                       | `index.ts:2692–3706`                                                                   | #990 closed as not planned, pending the #989 trial      |
| Discovery and lifecycle | 6 (`index.ts:5276–5445`)                     | 6; Retire-blocking SQL (`catalogue.ts:265`)                                    | Facade plus Evidence hooks (`index.ts:1717–1775`)                                      | #991 closed as not planned; what remained of it: #1140  |
| Retention               | 6 (`index.ts:5718–5779`, `5801–5818`)        | `GraphicsAssetRetentionCatalogue`, 32 (`retention.ts:160`)                     | `createGraphicsRetention` (`retention.ts:426`)                                         | Already split; no ticket                                |
| Reconciliation          | 7 (`index.ts:5819–5876`)                     | `GraphicsAssetReconciliationCatalogue`, 30 (`reconciliation.ts:151`)           | `createGraphicsReconciliation` (`reconciliation.ts:356`), media port (`index.ts:1433`) | Already split; no ticket                                |
| Operational reads       | 4 (`index.ts:4174`, `5780–5800`)             | Cockpit 9 (`operations-cockpit.ts:91`), queues 14 (`operational-queues.ts:64`) | Their own modules                                                                      | Already split; no ticket                                |
| Health and capacity     | 3                                            | `checkHealth`, `getCapacity`, `updateCapacityLimits`                           | Facade                                                                                 | A split would only pass through; no ticket              |

Ingestion and Template Packages share the Graphics Ingestion Operation lifecycle: `get/updateIngestionOperation`, `claimGraphicsIngestion`, `recordCanonicalWrites` and `getCapacity`. That shared lifecycle is one sub-interface, `GraphicsIngestionOperationCatalogue` (`operation.ts`), and #989 landed it first. `initiateGraphicsIngestion` joined it as its sixth method, because both families start an operation through it.

The two families share more than that interface (read at `57351fea`). A Template Package starts through `initiateGraphicsIngestion`, and is uploaded, cancelled and retried by the ingestion facade methods. `continueGraphicsIngestion` hands a Template Package operation to `continueTemplatePackagePreflight`. Both pipelines fail an operation, release its staged input and write canonical bytes through the same closures in the factory. So the ingestion module cannot be cut out by moving ingestion's code alone.

**Behaviour contracts across both catalogue adapters:**

- **Delivery's reads match.** Its seam test (`test/unit/server/modules/graphicsAssetDelivery.sqlite.test.ts`) runs against both adapters.
- **Retire, Trash, Restore and usage match in type but not in behaviour.** The in-memory `retireGraphicAsset` holds Retire back for template owners only (`in-memory-catalogue.ts:1250–1255`). D1 also counts Themes, Screen Theme Overrides and Talents. #991 proposed making that a shared contract. It was closed as not planned once D1 was the only adapter, and what remained of it is #1140.
- **Publication, claim and Template Package installation** exist in both adapters and are contract candidates in #989 and #990.
- **Retention, reconciliation, cockpit and queue catalogues** have only the D1 adapter, so they stay on the SQLite harness.

### Decision

**`GraphicsAssetLibrary` stays the one facade routes and modules build.** Families move behind smaller internal interfaces inside it, not into separate services a caller has to choose between.

**A family moves only when it gains something.** Its invariants must be nameable and testable at its own seam, and something must vary across that seam: both catalogue adapters, or a caller needing only that family. No generic repository or table abstraction is introduced to fold together SQL that merely looks alike.

**The catalogue port has one adapter, D1 (#1122).** The in-memory adapter the evaluation counts was built only by tests, and is deleted: every library test runs on the SQLite harness. So a second adapter no longer earns a family its seam; a caller needing only that family still does. The cross-adapter contracts the evaluation lists, and the one #991 proposed, have nothing left to compare.

**Retention is required of the catalogue port (#1140).** `GraphicsAssetCatalogue` extends `GraphicsAssetRetentionCatalogue`, so the facade no longer asks at run time whether its catalogue has retention: a Retire, Trash, Restore or supersession always has a catalogue to write its Evidence to, and the type holds that. Evidence stays best-effort against a transition that already committed. The reconciliation, cockpit and queue catalogues are still probed for; the same argument may apply to them, and it has not been decided.

**Ingestion moves on its invariants alone, as a trial (#989).** Contradicts this ADR's rule that "something must vary across that seam": with one adapter and no caller needing only ingestion, nothing varies across ingestion's. Worth reopening because ingestion's four invariants can be named, and today a test reaches them only through the whole library:

- One active attempt per Graphics Ingestion Operation (claim and lease).
- Staged bytes count against the Graphics Staging Allowance until their deletes are proven.
- Publication is complete or nothing, and idempotent.
- Exact content is reused, and replacing a file with its own content is a no-op.

The maintainer decided on 2026-11-12 that ingestion goes ahead as the trial of whether nameable invariants are reason enough. The rule above stands for every other family until the trial is judged: Template Packages (#990) is closed as not planned and is reopened if the trial proves the pattern worthwhile, and #991 is closed. Ingestion lands in four steps, because Template Packages run through it:

1. The Graphics Ingestion Operation lifecycle, as the catalogue sub-interface `GraphicsAssetCatalogue` extends.
2. The steps both pipelines take (starting, changing and failing an operation, releasing its staged input, writing canonical bytes, and the pinned silent-video validation), moved unchanged into `operation-lifecycle.ts`, which the facade builds once.
3. The ingestion module and its own catalogue sub-interface, handing a Template Package operation back to the facade.
4. Each invariant's home test at that seam, on the D1 catalogue. Decided on 2026-11-13, once the module was on `main`: the ingestion suites moved to the seam, and the facade keeps one wiring case per entry-point family.

**Delivery is the first.** `server/modules/graphics-asset-library/delivery.ts` holds it:

- **Interface:** `GraphicsAssetDelivery` has the five reads, unchanged: `inspectGraphicAssetRevision(s)`, `inspectGraphicAssetRevisionContent`, `resolveGraphicAssetRevision` and `resolveGraphicAssetThumbnail`.
- **Catalogue:** `GraphicsAssetDeliveryCatalogue` has the three catalogue reads.
- **Built from:** `createGraphicsAssetDelivery({ catalogue, canonical, reportDisagreement? })`.

It owns three rules:

- Bytes are served only while the canonical store agrees with the catalogue, by reconciliation's own definition of agreement.
- A revision the catalogue lacks is `missing`, and bytes the store cannot produce are retryably `unavailable`.
- A contradiction the store answered with is reported, and the report never changes or fails the read.

How the existing types fit around it:

- `GraphicsAssetCatalogue` extends the delivery catalogue, and `GraphicsAssetLibrary` extends `GraphicsAssetDelivery`.
- Every reader wires `reportDisagreement` to `createGraphicsDisagreementReporter` (`reconciliation.ts`). It is built from the catalogue's observation reads and writes and the canonical store alone, never staging or media. The scheduled reconciliation pass compares an expectation through the same code, so a reader and the pass open the same Graphics Discrepancy and announce it once (#992).
- `catalogueRequest` moved to `catalogue-request.ts`, unchanged, so every family shares one way of failing as unavailable.

**Ingestion is the second (#989).** `server/modules/graphics-asset-library/ingestion.ts` holds it:

- **Interface:** `GraphicsAssetIngestion` has the 14 methods that start a Graphics Ingestion Operation, feed it bytes, confirm, cancel and retry it, unchanged. `GraphicsAssetLibrary` extends it and the facade spreads its methods in.
- **Catalogue:** `GraphicsAssetIngestionCatalogue` has 14 methods of its own (staged-byte accounting, the multipart checkpoint, reuse and publication) and extends the six-method lifecycle. `GraphicsAssetCatalogue` extends both.
- **Built from:** `createGraphicsAssetIngestion({ catalogue, staging, canonical, lifecycle, remoteSource?, now, generateIdentity, recordSupersession, continueTemplatePackage })`. `lifecycle` is the one instance the facade built from `operation-lifecycle.ts`.
- **Tested at:** its own interface, in `test/unit/server/modules/graphicsAssetIngestion*.sqlite.test.ts`, on the D1 catalogue over the SQLite harness. `createTestGraphicsIngestion` (`test/helpers/graphicsLibrary.ts`) builds it with the two factories the facade calls, `createGraphicsIngestionOperationLifecycle` and `createGraphicsAssetIngestion`. The facade's own halves are ports there: `recordSupersession` is recorded and `continueTemplatePackage` throws. A case reads its outcome from the catalogue's rows and the canonical store, not through discovery or delivery. The facade keeps one wiring case for each of upload, multipart, remote copy, font evidence, replacement, cancel and retry, in the suites those cases came from. Template Package continuation, delivery, retention and the Graphics Asset Library Capacity's own reads stay tested through the facade.

**One callback hands a Template Package operation back to the facade.** `continueTemplatePackage(operation)` is called at one place, the first statement of `continueGraphicsIngestion`, and ingestion returns its answer untouched. By then the archive is staged and counted and, on a retry, the operation is claimed. The callback must not call back into ingestion for that operation, and it records a pipeline failure on the operation rather than throwing. Template Packages reach nothing else in the module: they start, fail and release an operation through the lifecycle, and their archive is uploaded by ingestion's `uploadGraphicAsset` before the callback fires.

**Template Package export keeps the shared agreement rule.** It reads through delivery's `readCanonicalContent` and `observeCanonicalContent`. #990 would have moved it, and is closed pending the #989 trial.

### Why

**Before,** a reader learned the 53-method facade and built it from the 43-method catalogue port plus a staging store. The Screen Output Asset Capability, which only ever reads bytes, built the whole library over a stub staging store to reach two methods (`screen-output-assets/runtime.ts:60–97`). Delivery's rules were spread across closures in the factory, and were tested only through the full library.

**After,** a reader learns five methods and builds them from three catalogue reads and the canonical store. The rules sit in one module, which is tested at its own interface on the D1 catalogue. The deletion test agrees: delete `delivery.ts` and the agreement, missing-versus-unavailable and reporting rules reappear in the facade and in every reader that wants delivery alone.

### Consequences

- **Routes and write modules:** nothing changes. Their `Pick<GraphicsAssetLibrary, 'inspectGraphicAssetRevisions'>` (`screen-write/index.ts:104`, `talent-write/index.ts:10`, `theme-library/index.ts:99`, `server/utils/graphicsTemplateReferences.ts:66`) still compiles. A new caller can depend on `GraphicsAssetDelivery` directly.
- **The Screen Output Asset Capability** now builds delivery with no stub staging store, through `createScreenOutputGraphicsDelivery` (`screen-output-assets/graphics-delivery.ts`).
- **On-air reads now feed reconciliation (#992).** Before, reaching reconciliation needed the staging store the stub lacked, and that failure was swallowed. So RULES.md's rule that every reader observing a contradiction feeds Graphics Reconciliation did not hold for Screen Outputs. Now a Screen Output reports through the reporter, so content whose canonical object is missing opens its Graphics Discrepancy on the first read, not at the next scheduled pass. A store that could not answer still reports nothing.
- **An on-air report never holds the read.** The Screen Output hands each report to the Worker's `waitUntil`, the same deferral its edge-cache write uses. The read answers first, and a failed report is dropped, because the scheduled pass re-observes it. Without an execution context (local Node), the read awaits its report. Operator-facing reads through the facade still await theirs. Concurrent reports of one content still open one discrepancy, because opening is idempotent on the open subject. Only the announcement is once: each read of missing content still costs a deferred metadata read and a few idempotent D1 writes, as operator reads always have.
- **A catalogue double needs only the three reads** to back delivery.
- **The estimated cost** of each split:
  - Delivery: small, done (5 facade methods, 3 catalogue reads, 1 caller rewired).
  - Ingestion: large (#989). The lifecycle sub-interface is small and done.
  - Template Packages: medium to large (#990, closed as not planned pending the #989 trial).
  - Discovery and lifecycle: not split (#991 closed as not planned). What remained of it, requiring retention of the catalogue port, was small (#1140).

### Rejected alternatives

- **One application-facing service per family.** Every route would have to learn which one to build. #623 asked for a stable facade.
- **A generic repository or table-name SQL abstraction.** #623 rules it out: SQL that looks alike does not share invariants.
- **Splitting the retention, reconciliation, cockpit or queue catalogues further.** Each already has its own module and port. Another layer would only delegate.
- **Its own interface for health and capacity.** Three pass-through methods; the deletion test removes it.
- **Give delivery reconciliation itself rather than a reporter.** Building reconciliation needs the staging store, which would put staging back into every delivery. A reporter keeps delivery buildable from the catalogue and the canonical store alone.
- **Let the reconciliation factory take staging lazily, so a Screen Output could build all of it (#992).** The output would still need the media port, built from the facade's validators, and every repair action would type-check against a staging store that might not be there. The reporter needs neither.
- **Move export onto delivery now.** Export belongs to the Template Package family (#990).
- **Ingestion importing the Template Package pipeline (#989).** That pipeline is closures in the facade. Importing it means moving it, which is #990.
- **An event for a staged Template Package (#989).** Upload and retry return the continued operation to the route, so an event would need a reply channel: a callback with more parts.
- **The facade dispatching Template Package operations itself (#989).** It would wrap the five methods that continue an operation, and would no longer expose ingestion's methods unchanged.
