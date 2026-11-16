# ADR-0070: A Talent Screen names its Talents as Event References, and its output resolves the photos it shows

Accepted · 2026-11-04 · [#782](https://github.com/KeeprDigital/stream-keepr/issues/782). Records T1 to T6 from [#783](https://github.com/KeeprDigital/stream-keepr/issues/783). Extends ADR-0038, ADR-0050, ADR-0060 and ADR-0067.

### Decision

**The Talent Screen Mode (`talent`) shows one Talent or a lineup, chosen by a setting.** `selection` is `one` or `lineup`; `talentId` names the one Talent and `talentIds` the lineup, at most eight, in the order shown. The choice not taken is kept, as Head-to-Head keeps its. Layout is a setting: `lowerThird` or `fullPanel`. It is a plain overlay mode, reading Foundation Tokens for everything it paints and declaring no Mode Token (ADR-0049, #1079), with its own Background Layer stack and the generic header, off by default. There is no live quick control (T6 a).

**Each picked Talent is an Event Reference.** `talentId` is of a new kind, `talent`, and `talentIds` of another, `talentLineup`, whose value is a list of Talent ids. A Screen write naming another Event's Talent is refused with 404 `Talent not found`, as for every kind (ADR-0038).

**Deleting a Talent releases it in the same write.** The Talent delete batches `buildReleaseScreenEventReferencesQuery(eventId, ['talent', 'talentLineup'])` after the delete, beside the photo release (ADR-0067), and announces each released Screen with `screen:updated`, without an origin, before `talent:deleted` (ADR-0060). A `talent` field is removed. A `talentLineup` list loses only the ids the Event no longer holds, keeping the rest in order; it is not removed, since the lineup's other Talents still stand.

**The operator picks which Supported Social Networks show** (`socialNetworks`), and they show in the catalog's order whatever order they were picked in. **An optional Social Profile Rotation** (`rotateSocialProfiles`, default off) shows one profile at a time for `socialProfileDwellMs`, 2 to 60 seconds, default 8. It has no Live Session to anchor it, so it is projected from epoch zero, as a Page Rotation with no anchor is (ADR-0009): every rendering at one server instant shows the same profile, every Talent of a lineup steps at the same instant through its own profiles, and nothing writes. It reuses the Social Profile Projection's `projectSocialProfileRotation`, with a cut. An unsynced rendering shows the first profile.

**The Screen Output read** `GET /api/screen-output/events/:id/screens/:screenId/talent` answers the picked Talents in order, skipping any the Event no longer holds, each with its name, role, photo and the Social Profiles on the chosen networks (ADR-0022). It answers the photo only while the Screen shows photos (`showPhoto`).

**The Screen Output Asset Capability admits the photo of each Talent its Screen shows, while the Screen is in Talent mode and shows photos.** The revision must be indexed by that Talent's `talent`/`photo` Graphic Asset Reference in the Screen's Event (ADR-0067), so a photo replaced or cleared stops resolving with the write that released it. A Talent the Screen keeps but does not show, such as the one Talent while it shows a lineup, supplies nothing. It is a third path beside the mode's own references and the resolved Theme Tokens (ADR-0050), not an index row the Screen owns.

**It is offered to Events of every Card Game.** It needs no results and no Deck Lists, so ADR-0057 does not exclude it.

**A Talent holds a free-text role** (`event_talents.role`), at most 100 characters, trimmed, blank stored as none. It is edited with the Talent, carried on `talent:created` and `talent:updated`, and shown on the Screen while `showRole` is on (T5 b).

### Why

Productions want a plain "on the desk" Screen without authoring a Broadcast Graphic, and #783 settled its shape. A Talent's photo is indexed by the Talent, not the Screen, so the Screen write cannot index it as a mode reference without copying the Talent's photo into every Screen naming it, and keeping those copies current on each Talent write. Reading the Talent's own reference keeps one owner, and the capability already reads past the Screen's own rows for Theme content. A lineup that lost a deleted Talent should still show the rest, so it drops the id rather than unsetting the field.

### Consequences

- A Talent Screen's output re-reads on `talent:updated` and `talent:deleted` for a Talent it shows, and on a config change of what the read derives from: the Talents, the networks and `showPhoto`.
- A photo shown on a Talent Screen can still not be retired, since the Talent's reference holds Retire back (ADR-0067); the Screen adds no reference of its own.
- The Screen Mode Sample Dataset holds a sample lineup, a host and a commentator without photos, so a Theme preview renders the mode for either Card Game.
- Binding a Talent's role to a Broadcast Graphics Graphic Input is not covered.

### Rejected alternatives

- **Index the shown photos under the Screen's own owner slots.** Every Talent photo write would have to rewrite the index of each Screen naming that Talent, or the output would resolve a replaced photo until the Screen was next saved.
- **One list for both choices, showing its first Talent in `one`.** Switching between one Talent and the lineup would lose the one Talent picked, and picking one would reorder the lineup.
- **Re-anchor the rotation when it is turned on.** It would need a stored anchor and the Page Rotation's write rules; with every Talent stepping together from epoch zero there is no visible restart to protect.
