# ADR-0064: Copied layers and styles stay in this browser, paste within their host, and paste whole or not at all

Accepted · 2026-11-04 · [#746](https://github.com/KeeprDigital/stream-keepr/issues/746) · Amended 2026-11-04: a copy arrives unlocked · [#943](https://github.com/KeeprDigital/stream-keepr/issues/943). Records E23–E26 from [#783](https://github.com/KeeprDigital/stream-keepr/issues/783), and #746's Theme-bindings note.

### Decision

**The clipboard is this browser's storage, not the system clipboard (E23).** ⌘C copies the selected layers and ⌘⌥C one Graphic Item's style, in the Feature Match Overlay and Broadcast Graphics editors alike (several layers in both since #1100, all of one Broadcast Graphic), so ⌘V and ⌘⌥V paste them on another Screen of another Event in the same browser. The rules live in `app/modules/graphics/clipboard.ts`. Copying is not a write, so an observer may copy; pasting is a write through each editor's lease-gated funnel (ADR-0030).

**A paste stays within its host (E24).** Feature Match Layout to Feature Match Layout, Broadcast Graphic to Broadcast Graphic, for layers and styles alike. The other host refuses with a reason.

**A paste lands whole or not at all (E25).** It is refused, naming the items, when one pins a Graphic Asset no longer selectable: retired, trashed, missing, or with unavailable content, asked of the Graphics Asset Library before writing. It is refused whole when it would pass a Graphic Item cap: a Broadcast Graphics Screen's 300 (ADR-0007), a Broadcast Graphic's or Feature Match Layout's 100, or a Graphic Group's 50. The commit still checks every reference as for any Screen write (ADR-0034). In Broadcast Graphics an item reading a Social Profile Projection pastes only into that projection's Presentation Group, since the projection does not travel with it and the write path refuses it anywhere else.

**Copies land in front, offset 20 pixels from where they were on the canvas.** A Graphic Group arrives with its children. Every copy gets a fresh id, arrives unlocked (ADR-0063), and keeps its name unless one in the destination already carries it. With a Graphic Group selected, or one of its children, copied non-group items land in it.

**Style paste follows the Graphic Item Definition (E26).** Between items of one Definition, every style group it declares pastes: typography, each Graphic Surface Style, and its Shape Geometry. Between two kinds that both paint a surface, only the Graphic Surface Style does. Anything else is refused.

**Graphic Theme Bindings travel.** A pasted layer keeps its `themeBindings`, so each bound group paints from the destination Screen's resolved Theme. A pasted style group carries its binding state: bound in the source binds the target to the same token, unbound pastes the literal and detaches the target.

### Why

Each is #783's recommendation for v1. Reading the system clipboard needs the browser's permission, and app-local storage already reaches every Screen in the browser. Pasting across hosts would have to drop host-only items and bindings without saying so, and a partial paste would leave the author to find what went missing.

### Consequences

- The Graphic Item caps moved to `shared/types/graphics.ts`, and `MAX_FEATURE_MATCH_SOURCE_ITEMS` to `shared/featureMatchSourceItems.ts`, so the client can refuse what the schema would. `server/schemas/api/screen.ts` re-exports them and keeps their reasoning.
- What was copied is kept per kind under a versioned key; a later build that changes the shape bumps the key rather than reading an old entry.
- Pasting a Text Graphic Item into another Broadcast Graphic does not carry the Graphic Inputs its `{inputKey}` placeholders name; they render as they would for any undeclared key.
- A Graphic Group's stagger still names its original children's ids, as a duplicate's does; stale ids are legal (ADR-0007).
- Each paste offsets from the copied position, so pasting twice lands both copies in one place.

### Rejected alternatives

- **The system clipboard as JSON (E23 b).**
- **Pasting across hosts, dropping what the other host cannot hold (E24 b).**
- **Pasting without an unselectable reference (E25 b).** The item would arrive without its picture or font, and nobody would be told.
