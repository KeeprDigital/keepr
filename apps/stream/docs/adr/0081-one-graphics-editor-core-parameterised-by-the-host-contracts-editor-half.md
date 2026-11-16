# ADR-0081: One graphics editor core, parameterised by the Host Contract's editor half

Accepted · 2026-11-11 · [#1098](https://github.com/KeeprDigital/stream-keepr/issues/1098), part of [#1060](https://github.com/KeeprDigital/stream-keepr/issues/1060) · Amended 2026-11-11: Broadcast Graphics adopts it · [#1100](https://github.com/KeeprDigital/stream-keepr/issues/1100) · Amended 2026-11-11: one preview shell, with canvas handles in Broadcast Graphics · [#1101](https://github.com/KeeprDigital/stream-keepr/issues/1101)

The Feature Match Overlay editor alone had undo, several selected, Layer Locks, grouping, alignment, the clipboard verbs and the keyboard, typed throughout on the Feature Match Layout. Broadcast Graphics is to adopt the same editor (#1100), not a copy of it.

### Decision

**The editor core is shared graphics code: `useGraphicsEditor` (`app/composables/useGraphicsEditor.ts`), its pure rules under `app/modules/graphics/editor/` (edit history, layer selection, layer frame, locks, grouping, alignment, drag), and `useGraphicsEditorKeyboard` with `GRAPHICS_EDITOR_SHORTCUTS`.** A host supplies a `GraphicsEditorHostContract` (`app/modules/graphics/editor/host.ts`), the editor half of the Host Contract, in three parts:

- **Item tree contents** (`tree`): the layers in list order, a stable key per layer, every composition it holds, which composition a Graphic Item layer sits in, where a new or pasted item goes, what each layer snaps to, the clipboard's copy and paste under the host's caps, and the writes of any layer kind the host owns (`owned`: the Feature Match Overlay's Source Items). The editor writes Graphic Items itself through the shared authoring operations, so a host never re-implements them.
- **Document written** (`document`): `read` and `write` of one document, and optionally what an undo carries over from the current one (`restore`). One undo step is one whole document.
- **Forbidden edits** (`forbidden`): `writable` (the Graphics Authoring Lease, ADR-0030), `held` (the host is rewriting the document, as a template placement does), and `composition` (a composition no write may change now, for Broadcast Graphics a graphic on air).

**The editor half lives app-side, beside the shared half rather than on it.** It carries functions and reads Vue state; `shared/modules/graphics/hostContract.ts` stays the plain declaration the compositor and the server read, and the editor reads `tree.host` from it.

**The Feature Match Overlay is the first host** (`app/modules/feature-match-overlay/editorHost.ts`), with behaviour unchanged: its document is the layout, its owned layers are the Source Items, and nothing in it is forbidden beyond the lease and a placement in flight.

### Why

The verbs and their rules (one undo step per verb, several selected moving together, locks the canvas leaves alone, a group never selected with its own child) are the same for both hosts; only what the tree holds and where it is written differ. Asking the host for those, rather than branching on the host inside the editor, keeps a third host to one contract.

### Consequences

- The Broadcast Graphics host (`app/modules/broadcast-graphics/editorHost.ts`, #1100) supplies its own tree (several compositions, each Broadcast Graphic a top-level row of the shared layer list with its items nested), document (`graphics`) and `forbidden.composition` from on-air ids. Its Edit workspace's StackTree and reorder controls are gone; the layer list (`app/components/Graphics/LayerList.vue`) and the several-layers panel (`app/components/Graphics/MultiLayerInspector.vue`) serve both hosts.
- **A Broadcast Graphic on air is not edited (#1100).** The editor refuses any write that changes or removes a forbidden composition, or reorders the forbidden ones among themselves, since graphics on air composite in stack order, whichever verb or panel makes it. Undo and redo restore everything but it, leave the forbidden ones in their order, and keep a step that would restore nothing else, so it still undoes once the graphic is off air. A paste into one answers a refusal. While playout cannot be known (the realtime connection is down), every Broadcast Graphic counts as on air. This reverses the earlier allowance, under which an Edit-workspace change to an on-air graphic reached program at once: an operator now takes it off air, or edits a copy. The server refuses the same write (`refuseOnAirGraphicEdit` in the Screen write module, a 409), so the rule holds for a stale client, a second tab, and a save a Take overtook; it reads what is on air from the Screen's open Live Session on its own clock. A graphic's Graphic Channel is set beside the stack and stays writable on air, and Live Control stays outside the rule. It was first client-side only.
- **Undo covers the item tree only (#1100).** A Broadcast Graphic's Graphic Channel and the Broadcast Graphics Background are set beside the stack, outside undo; a restored stack keeps each graphic's channel as it is now (`document.restore`).
- Several selected layers always sit in one composition, so align, group and paste act within one Broadcast Graphic.
- A host may keep a layer from being removed on its own (`tree.removal`): a Social Profile Projection's Presentation Group goes only with its projection, from the inspector.
- `useGraphicsEditor`'s `commit` takes a host's own write for a property panel edit that reaches the document by another path (the Feature Match Overlay's Frame and Source Item panels), and records it as one undoable step like any verb.
- The test table `test/nuxt/composables/useGraphicsEditor.test.ts` runs every case against each host in `test/nuxt/helpers/graphicsEditorHosts.ts`; a new host adds a column there.
- No realtime path changes. Both editors drop unsaved edits on losing the Graphics Authoring Lease the same way (ADR-0030).
- **One preview shell serves both editors (#1101):** `GraphicsEditorPreview` (`app/components/Graphics/EditorPreview.vue`) owns the shared preview panel, the Screen Output frame, the ready handshake and sender-checked reports, focus release, the canvas handles and the Graphic Animation Preview control. A host supplies the messages its frame reads, any report in its own vocabulary (the Feature Match Overlay's Frame and Source Item selections), its run, its handles' selection and its toolbar controls. Broadcast Graphics gains canvas handles: none for an observer, during a placement, or over a graphic that may be on air. Its frame learns a ⌘-click toggle and the stack's Layer Locks in its authoring-preview branch only; several selected reach it as their Broadcast Graphic, and the handles outline each member. A live Screen Output's render path is unchanged: it draws no guide layer, so neither locks nor selections reach it.

### Rejected alternatives

- **Putting the editor fields on `GraphicsHostContract` in `shared/`.** They are closures over Vue state and the client clipboard, which the server never reads.
- **A per-host editor wrapping a shared one.** Each verb would gain a host branch, and a third host would edit every verb.
