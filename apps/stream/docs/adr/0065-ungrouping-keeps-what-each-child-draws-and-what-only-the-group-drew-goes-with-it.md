# ADR-0065: Ungrouping keeps what each child draws, and what only the group drew goes with it

Accepted · 2026-11-04 · [#920](https://github.com/KeeprDigital/stream-keepr/issues/920) · Amended 2026-11-04: a locked group's children come out locked · [#943](https://github.com/KeeprDigital/stream-keepr/issues/943). Records E11 and E12 from [#783](https://github.com/KeeprDigital/stream-keepr/issues/783).

### Decision

**⌘G wraps two or more top-level Graphic Items in a canvas Graphic Group that changes nothing drawn.** Its box is the union of what its members draw, a rotated member by the box it turns into; it paints no surface and clips nothing, and it takes the frontmost member's slot in the Graphic Layer Order. A Source Item, a Graphic Group or a group's child refuses the selection (E8, E9), as does one larger than a group may hold (`MAX_GRAPHIC_GROUP_CHILDREN`, 50), and the editor says why.

**⌘⇧G puts each child on the canvas where its group drew it.** A canvas group's children are rebased as any item leaving a group is (`placeGraphicItem`). A row or column group's children are first placed where its flex layout put them (`laidOutOnCanvas` in `shared/modules/graphics/authoring.ts`), taking their laid-out size and losing a rotation the row never drew; a hidden child takes no space there and keeps its stored corner.

**What a child inherited is baked in; what only the group drew is dropped.** A child that can paint a surface but holds none of its own takes the group's local style default, and the default's Graphic Theme Binding, and a hidden group's children are hidden, each where the group laid it out; a locked group's children are locked (ADR-0063). The group's clipping, animation and stagger go, and so do its own surface and glow, which belonged to the group rather than to any child.

**Two visible changes are accepted for v1.** Ungrouping drops the group's own surface and glow, though its glow, a filter over the whole group, also lit its children; undo restores them. Resting positions are kept but motion is not: grouping takes members out of the Broadcast Graphic's stagger, and a member's `clear-parent` slide then clears the group's box rather than the canvas; ungrouping drops the group's stagger.

### Why

"Nothing moves" is the authoring promise of grouping both ways. A row or column child's stored corner is not where it is drawn, so rebasing from that corner, as moving one layer out of a group does (#741), would scatter a whole stack at once.

### Consequences

- The flex layout is computed twice: in CSS by the compositor (`stackedPlacement` in `app/modules/graphics/renderModel.ts`) and in `laidOutOnCanvas`. A change to one must change the other; the ungroup tests pin the layout cases.
- A child laid out to no size is stored a pixel wide, the least the write schema admits.

### Rejected alternatives

- **Replace the group's surface with a Shape Graphic Item.** It keeps the backdrop, but invents a layer the author never made; E12 drops what is not inherited.
- **Refuse to ungroup a row or column group.** The author would have to switch it to canvas first, which moves its children, so the only way out of a stack would move what it held.
