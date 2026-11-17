# Stream Keepr glossary

Domain vocabulary for Stream Keepr. Use these terms when naming modules, seams, tests, and architecture notes. Each entry says what a thing is; what it must do is under the same heading in `RULES.md`.

Who a person is and what they may use (User, Session, Organisation, App role) is in the root `GLOSSARY.md`. How these words meet Score Keepr's is in the root `GLOSSARY-MAP.md`.

## Language

### Event

**Event**:
One tournament as Stream Keepr produces it for broadcast: its Players, Matches, Screens and settings.
_Avoid_: Tournament (Score Keepr's word, for the competition itself).

**Card Game**:
The trading card game an Event is played in: Magic: The Gathering or One Piece Card Game.
_Avoid_: game, game mode, game system, TCG.

**Variant**:
How a Magic: The Gathering Event's games are played: Two-Player, or Commander, a free-for-all among up to four players in a single game.
_Avoid_: game mode, mode, format (a format is a card pool, and an Event's Match Format is its best-of and clock settings).

**Phase**:
A segment of an Event structure, such as Swiss or Top Cut.

**Round**:
A unit of tournament play within a Phase, containing Matches and optional tournament-state metadata synced from Melee.

**Current Round**:
The latest Melee-managed Round, in the Event's Round order (Phase sort order, round number, id), that has pairings: at least one Match stored from Melee.
_Avoid_: active Round, live Round.

**Match**:
A pairing between Players in a Round, with its Match Result and the records used for standings and broadcast workflows.
_Avoid_: Feature Match when referring to the pairing.

**Match Result**:
Whether a Match is reported or a bye, and its game wins and game draws.
_Avoid_: score, for the whole result.

**Game Score**:
A Match's game wins and game draws read from one of its Players' side, theirs first, in en dashes: 2–1, or 1–1–1 with a game draw.

**Match Format**:
An Event's best-of and clock settings for its Matches.
_Avoid_: format alone (a format is a card pool).

**Round Standings**:
The standings for Players as of a specific Round, including that Round's results.

**Position Change**:
How many positions a Player moved since the previous Round's Round Standings: the nearest earlier Round, in the Event's Round order (Phase sort order, then round number), that holds Round Standings.
_Avoid_: movement, rank delta.

**Player**:
A competitor in an Event.

**Nickname**:
A One Piece Card Game Player's handle in Bandai TCG+, owned by the TCG+ Import and refreshed by each import; an Operator types it only for a Player added by hand.
_Avoid_: name, display name, when meaning the TCG+ handle.

**Player List**:
A named set of an Event's Players that an Operator makes.
_Avoid_: group, segment

**Card**:
One card of the Event's Card Game, as its card data source knows it.

**Deck List**:
Submitted cards for a game: a Player's (one per Phase on Magic: The Gathering; one per Player on One Piece Card Game, imported or entered by hand), or a Feature Match Deck List.

**Leader**:
The single leader card heading a One Piece Card Game Deck List, held apart from its Mainboard.

**Commander**:
One of the one or two cards heading a deck on a Commander Event, held apart from its Mainboard.
_Avoid_: general, EDH; Commander alone for the Variant where it could be read as the card (say Commander Event).

**Mainboard**:
The starting portion of a Deck List — the cards a Player begins each game with.

**Sideboard**:
The reserve portion of a Deck List, exchanged with Mainboard cards between games.

**Board Selection**:
Which boards of a Deck List a rendering surface presents: Full (Mainboard and Sideboard), Mainboard only, or Sideboard only.

**Unresolved Deck Card**:
A Deck List entry naming no known card: on Magic: The Gathering, one imported by **Melee Sync** whose name matched none; on One Piece Card Game, a card number the card data source does not know, from a **TCG+ Import**, a hand-entered Deck List or a paste.

**Metagame**:
Analysis of Players, Deck Lists, cards, archetypes, and standings within an Event or scoped Player group.

**Metagame Scope**:
Which Players a Metagame read counts: every Player, the top N by placement, those with at least a minimum match-point total, or one Player List's members.

**Archetype**:
A strategic Deck classification used for Metagame analysis.

**Archetype Review**:
The Two-Player Magic: The Gathering workflow in which an Operator assigns each Player's Deck List an Archetype.

**Empty Archetype**:
An Archetype no Deck List in its Event is assigned to, whichever Deck List is a Player's primary and whatever the Metagame Scope, and that no Player holds without one.

**Pinned Chart Series**:
One of the Theme's eight chart series that an Operator gives an Archetype, so every chart colouring Archetypes gives it that series first.
_Avoid_: archetype colour, chart colour (an Archetype's mana colours are its colours).

**Pilot**:
A Player of an Archetype within the current Metagame scope; an Archetype's pilots are its Players in that scope.

**Conversion Rate**:
The percentage of an Archetype's Players in the current Metagame scope that reached their Event's **Conversion Target**.
_Avoid_: top-cut rate, cash rate, qualification rate

**Conversion Target**:
What a Player must reach to count as converted: a Top N placement (N at least 1) or a minimum match-point total (0 or more), Top 8 by default.
_Avoid_: conversion threshold, when naming the whole target; cut line.

**Melee Sync**:
The workflow that imports and refreshes Event structure, Players, Deck Lists, standings, Matches, and Rounds from Melee.gg.

**Live Results**:
A per-Event setting, off by default and on only while Melee Sync is on, under which Melee Sync polls Melee.gg each minute for the Current Round's Match Results, and for the next Round's pairings once the Current Round is complete.
_Avoid_: auto-sync, polling, when naming the setting.

**TCG+ Import**:
The workflow that imports a One Piece Card Game Event's Players, their Nicknames and their Deck Lists from a Bandai TCG+ deck list export.
_Avoid_: CSV import, deck upload.

**Provenance**:
The import-owned identity and lifecycle facts on a synced record: its external identity, sync status, activity, and last-seen time.
_Avoid_: external fields, sync metadata.

**Manually Edited Field**:
A Melee-imported Player field, name or pronouns, that an Operator has changed by hand, on the Players page or in a Feature Match Slot's setup.
_Avoid_: override, local override.

**Talent**:
An Event-scoped broadcast presenter or commentator who may be selected for production graphics.

**Supported Social Network**:
One of Twitch, YouTube, X, Instagram, TikTok, or Bluesky: the application-owned, ordered catalog of public networks available for Talent profiles, each supplying its label, icon, and profile-URL rule.

**Social Profile**:
A Talent's public identity on one Supported Social Network, identified by a normalized handle from which its profile URL is derived.
_Avoid_: Commentator handle, social link

**Broadcast Deck List**:
An Event-scoped card list prepared by an Operator solely for display on a Deck List Screen.

**Archetype Label**:
Optional broadcast-only text and mana colours on a Broadcast Deck List, used as its secondary Deck List Screen identity.

**Deck Source**:
The required data binding of a Deck List Screen: either one Event-scoped Player (or no selected Player), one Event-scoped Broadcast Deck List, or one Seat of an Event-scoped Feature Match Slot.

### Feature Match production

**Feature Match Slot**:
A reusable production control lane for showing one featured Match at a time. Written Slot for short.
_Avoid_: Feature Match when referring to the reusable lane.

**Seat**:
One player position of a Feature Match Slot, numbered in the Slot's own order: two on a Two-Player Magic: The Gathering or One Piece Card Game Event, up to four on a Commander Event.
_Avoid_: side, player side (a Match keeps its two sides); pod, for a Commander Slot's Seats together.

**Commander Damage**:
The damage a Seat has taken from one opposing Commander on a Commander Event, counted per Commander, so a Seat facing a pair holds a count for each.

**Eliminated**:
A Seat whose player is out of a Commander game.
_Avoid_: dead, knocked out, lost.

**Feature Match Assignment**:
A Round-scoped selection of a Match for a Feature Match Slot.
_Avoid_: Feature Match when referring to the saved Round selection.

**Feature Match Note**:
A single mutable plain-text production note belonging to a Feature Match Assignment.

**Feature Match Deck List**:
A Deck List held by one Seat of a Feature Match Slot rather than by a Player, pasted by the Operator.
_Avoid_: slot deck, match deck.

**Feature Match Session**:
The live state timeline for a Feature Match Slot.

**Feature Match Session Clock**:
The clock a Feature Match Session holds for its Match: a countdown from the Match Format's duration, a count up from zero, or none for an Untimed Match.
_Avoid_: match timer, round timer (a Round Clock is a Round's), overtime for count-up time.

**Untimed Match**:
A Feature Match whose Feature Match Session Clock is of the untimed type: it has no clock to run and so no extra turns.
_Avoid_: unclocked match, timeless match

**Untimed Label**:
The text an Event shows where an Untimed Match's clock would be.

**Feature Match Slot Promotion**:
The workflow that promotes a Match into a Feature Match Slot for production controls and saves the Round-scoped Feature Match Assignment.

**Reverse Sync**:
The follow-on that copies Players' current data into every Feature Match Slot seating them, and into each such Slot's active Feature Match Session.
_Avoid_: player sync, match snapshot refresh.

### Screens

**Screen**:
A broadcast or control surface that can show Feature Match Slot output, decks/cards, standings, graphics, or other prepared content.

**Screen Mode**:
A rendering mode for a Screen, such as Background, Card Spotlight, Deck List, Standings, Top Cut Bracket, Feature Match Controls, Feature Match Overlay, Broadcast Graphics, Metagame, Most Played Cards, Player History, Pairings, Archetype Spotlight, Head-to-Head, Round Clock, or Talent.
_Avoid_: Top Cards for the Most Played Cards mode (one word from Top Cut); Feature Match for the control mode (the on-air one is the Feature Match Overlay); Deck Screen and Card Screen for a Screen in Deck List or Card Spotlight mode (say Deck List Screen, Card Spotlight Screen).

**Screen Mode Definition**:
The definition of a Screen Mode: its defaults and configuration shape, its data preparation, its rendering and host contracts, and what it declares it carries.

**Event Reference**:
A field in a Screen Mode's configuration naming something that must belong to the Screen's Event: a Phase, a Round, a Player, a Player List, a Feature Match Slot, an Archetype, a Talent, a Talent Lineup, or a Deck Source.
_Avoid_: data binding (a Graphic Input Binding is a Broadcast Graphics concept), Graphic Asset Reference (an installation-wide library link, not Event data)

**Output Change**:
A kind of change a Screen Output can show, such as one to its Screen, its Event's Theme or the Event's Players. Each Screen Mode Definition declares the kinds its Screen Output follows.
_Avoid_: invalidation, dependency (what one rendering's read depends on is Screen Mode Data Freshness's)

**Head-to-Head**:
A Screen Mode showing two Players of an Event side by side before their Match: each one's record and points, their Archetype, and the earlier Matches between them at the Event.
_Avoid_: meeting, when naming an earlier Match.

**Talent Screen**:
A Screen in Talent mode, introducing the Event's Talent on air: one Talent, or a **Talent Lineup** of up to eight in the order picked, as a lower third or a full panel.
_Avoid_: desk screen, casters screen

**Talent Lineup**:
The ordered list of Talents a Talent Screen shows together, at most eight; an Event Reference of its own kind.
_Avoid_: desk, panel (a full panel is a layout)

**Authored Stack**:
An ordered list in a Screen Mode's configuration holding authored content with no recovery path: the Background Screen's Background Layers and a Broadcast Graphics Screen's stack of Broadcast Graphics.

**Background Screen**:
A Screen in Background mode, rendering an ordered stack of Background Layers.
_Avoid_: Idle screen, empty state

**Background Layer**:
One entry in an ordered Background Layer stack — a colour, gradient, image, video, or Animation Effect — owning its own enabled state and opacity.
_Avoid_: background type, media background (when meaning a layer)

**Screen Media Source**:
Where a Screen's own image or video comes from: one exact Graphic Asset Revision, or a Remote Media URL.
_Avoid_: media URL, asset source

**Remote Media URL**:
A Screen Media Source naming media by URL rather than by library revision, fetched by every rendering: an HTTPS URL to media the Installation does not hold, or a root-relative path to media the application serves, which is only under `/video/`, never a route that serves Graphic Asset Content.
_Avoid_: hotlink, external asset

**Animation Effect**:
A named, autonomously animating background renderer that ships with Stream Keepr, with its own per-effect configuration.
_Avoid_: Vanta effect, frame animation, shader background, background effect

**Round Clock**:
A Screen Mode showing a Round's name and the time left in it, projected from the Round's Operator-entered start and duration and server time, so every rendering of the same Round shows the same time.
_Avoid_: round timer (the Feature Match Session Clock is a Match's, not a Round's).

Clock Projection, Interval and Frame Clock live in the shared layer, so they are defined in the root `GLOSSARY.md`.

**Page Rotation**:
The deterministic projection of a paginated Screen Mode's current page from its Rotation Anchor and server time, computed identically by every rendering.
_Avoid_: Auto-paging when naming the projection itself — auto-page is the operator toggle that turns rotation on.

**Top Cut Bracket**:
The single-elimination bracket a Top Cut Bracket Screen shows: a Manual Bracket, or one derived from the Rounds of a Phase its Operator picks.
_Avoid_: bracket slot (a Slot is a Feature Match Slot)

**Bracket Position**:
The place one Match sits in a Top Cut Bracket: its column and its place in it, holding two Bracket Entrants.
_Avoid_: bracket slot (a Slot is a Feature Match Slot), node

**Manual Bracket**:
A Top Cut Bracket its Operator fills in by hand on a Top Cut Bracket Screen, for a top cut Stream Keepr holds no Rounds of.
_Avoid_: manual Top Cut, custom bracket

**Bracket Entrant**:
Whoever occupies one side of a Bracket Position: a Player of the Event, or a name its Operator typed on a Manual Bracket.
_Avoid_: Entrant (Score Keepr's unit of pairing), competitor, participant

**Seed**:
A Bracket Entrant's position entering a Top Cut Bracket: its place in the Operator's list on a Manual Bracket, otherwise the Player's position in the last Round Standings before the bracket's Phase. It is the Rank a Score Keepr tournament would supply.
_Avoid_: rank, bracket position (a Bracket Position is where a Match sits)

**Rotation Anchor**:
The server timestamp a Page Rotation counts from, written only by an Operator surface — when auto-page is enabled, when an edit changes the rotation's shape (a display reset among them), or when an Operator selects a page mid-rotation.

**Screen Card**:
The one Card a Screen in Card Spotlight mode shows, set and cleared by an Operator.

**Card Revision**:
The count a Screen Card's saves and Clears advance, never its expiry.

**Card Timeout**:
A Screen Card's optional duration, after which every holder hides it by the shared clock.
_Avoid_: auto-clear (nothing clears the Card when it runs out)

**Printing**:
One release of a card: standard, alt-art or reprint. A One Piece Card Game Printing is one bandai-keepr lists; a Magic: The Gathering printing is one Scryfall card.
_Avoid_: variant, parallel, version.

**Screen Output**:
A live rendering variant exposed by a Screen Mode Definition, such as overlay, fill, or key.
_Avoid_: Export mode when referring to live Screen rendering.

**Overlay Output**:
A Screen Output that renders the final composed colour and opacity over transparency.

**Fill Output**:
A Screen Output that renders the final composed colour flattened over black.
_Avoid_: Beauty when naming product concepts.

**Key Output**:
A Screen Output that renders the final composed opacity as a grayscale alpha matte.
_Avoid_: Black-and-white export, chroma key.

**Card Layout**:
How a card grid on a Most Played Cards Screen or a Deck List board lays out its cards: columns, max card size and gap, each a number or Auto.
_Avoid_: Card Sizing, Fit, Fixed width, auto columns, card width, dynamic card size.

**Program Monitor**:
A control surface's own live rendering of the Screen it drives.
_Avoid_: Preview — which composes the authored state its embedder pushes in and resolves media as the author. Confidence monitor.

**Screen Output Asset Capability**:
The identity of one Screen Output to the Installation, in place of a Session: an opaque, long-lived, revocable right to read only what its Screen publishes, the exact Graphic Asset Revisions it shows included.

**Screen Output Link**:
A short text, about 16 characters, that names one Screen and proves the right to its Screen Output Asset Capability.
_Avoid_: short link, output token, output code, share link.

**Output Hand-out**:
The one place an Operator is handed a Screen Output's URL: Open and Copy URL side by side, each carrying a Screen Output Asset Capability obtained at the moment of the hand-out, and refusing rather than handing out a URL without one.
_Avoid_: Outputs popover, share button.

### Client and live-state infrastructure

Named modules and invariants. Guarded Sequence and Flight live in the shared layer, so they are defined in the root `GLOSSARY.md`.

**Event Data**:
The client-side access path for Event-scoped data such as Players, Phases, Rounds, Matches, Feature Match Slots, Feature Match Assignments, Screens, Talents, Archetypes, Player Lists, and Player Decks.

**Realtime Event Session**:
The client-side subscription for Event messages.

**Realtime Subscription**:
A consumer's standing request to the realtime transport: a room handler, a channel handler, a presence watch, or a presence entry.
_Avoid_: registration.

**Reconnect Resync**:
The client-side module owning the invariant "losing message continuity is itself a reason to re-read authoritative state."
_Avoid_: reconnect handler, resubscribe hook.

**Event Data Resync**:
The client-side module owning which Event Data this client consumes, so **Reconnect Resync** re-reads exactly that.
_Avoid_: refresh registry, reload list.

**Screen Mode Data Freshness**:
The client-side module owning the invariant "a Screen Output shows its Screen Mode's current data."
_Avoid_: mode refresh hook, per-mode live sync.

**Rendering Readiness**:
The client-side invariant "program holds what it shows until what replaces it is ready."
_Avoid_: preload, loading state, when naming the invariant.

**Event Lifetime**:
The span of one Event's client-side state, from the store reset that begins it to the one that ends it.
_Avoid_: Event session, Event generation.

**Field Ownership**:
The set of fields one action may write, derived from the change the action predicts.
_Avoid_: owns array, field mask, declared ownership.

**Sequenced Live State**:
The server-side module owning the invariant "one authoritative order of accepted commands per live aggregate."
_Avoid_: event store, event sourcing, command bus, write-ahead log.

**Live State Follower**:
The client-side module owning the client half of Sequenced Live State: whether what arrives for a followed live aggregate moves the held snapshot forward.
_Avoid_: sequence guard, live session sync, client event store.

**Command Receipt**:
The record that one command ID was already accepted for a live aggregate, holding the command's canonical content so a retry is answered with the current authoritative snapshot and a reused ID with different content is rejected.
_Avoid_: event row, command log, audit record, idempotency key.

**Batch Command**:
One Feature Match Session command carrying the absolute setter commands of a multi-field Operator save, sequenced, receipted, and announced as one so the save lands whole or not at all.
_Avoid_: bulk update, transaction, multi-command, command group.

### Identity and access

User, Session, Organisation, App role and Keepr Administrator are defined in the root `GLOSSARY.md`.

**Operator**:
The Stream Keepr App role of a User who runs an Event's broadcast.
_Avoid_: Organiser (Score Keepr's App role), user, producer

**Installation**:
One deployed Stream Keepr and the data it holds. What is installation-wide is shared by all its Events.
_Avoid_: instance, tenant, deployment

**Password Reset Link**:
The single-use, expiring credential a Graphics Administrator hands a person out of band to set their own password. Stream Keepr's own until it moves onto Keepr Accounts.
_Avoid_: invite token, activation link.

**Graphics Administrator**:
The Stream Keepr App role that may operate the Operations Cockpit and Operational Queues and change Graphics Asset Library Capacity limits.
_Avoid_: admin (an Organisation role), Keepr Administrator (who runs the platform)

**Local Developer Session**:
The synthetic Session a browser receives while Stream Keepr's development bypass is active. Stream Keepr's own until it moves onto Keepr Accounts.

**Graphics Authoring Lease**:
The exclusive, Session-scoped right to edit one graphics authoring artifact: a Screen's complete graphics Edit workspace or one reusable graphics Template.

### Theming

**Theme**:
A named, installation-scoped set of Foundation Token values giving every Screen of an Event one look and feel, whatever its Screen Mode.
_Avoid_: Style Set, brand, skin, palette (when naming the whole)

**Default Theme**:
The built-in Theme that ships with Stream Keepr, used by every Event that picks no Theme.
_Avoid_: base theme, fallback theme

**Theme Token**:
One named value a Screen may consume from its Theme, such as a colour, font, or Graphic Asset.
_Avoid_: variable, style entry

**Foundation Token**:
A Theme Token naming an application-wide role any Screen Mode may consume, such as the accent colour, the heading font, or the screen inset.

**Mode Token**:
A Theme Token a Screen Mode Definition declares for an element of its rendering that has no Foundation role, such as Standings' Position Change climb colour or a Pairings result badge's colours.
_Avoid_: component token

**Screen Theme Override**:
A Screen's own value for one of its mode's Mode Tokens, used by that Screen in place of the token's default, or, on a plain overlay mode, for the `inset` or `alignment` Foundation Token its host places content by, in place of its Theme's value.
_Avoid_: local style, pin

**Screen Settings Group**:
One element or decision on a Screen's settings page, such as its Table or a card badge, holding the controls for it and, under its heading in its card's "Look", the Screen Theme Overrides of the Mode Tokens that style it.

**Event Canvas**:
The pixel coordinate space every overlay Screen of an Event is authored and rendered in, default 1920 × 1080.
_Avoid_: screen size, resolution

**Event Presentation Settings**:
What an Event sets once for every Screen it has: its Theme, its Event Canvas, and its on-air wording and formatting, such as the record separator, position format, and Untimed Label.
_Avoid_: on-air formatting (when naming the whole group)

**Screen Mode Sample Dataset**:
One fixed canonical set of Event Data per Card Game, chosen by the Event's Card Game, that a Theme preview renders every Screen Mode against, with the card data its cards are drawn with, a Screen Card, and one built-in Theme-bound Broadcast Graphic on air.
_Avoid_: dummy data, test data

**Graphic Theme Binding**:
A Graphic Item property group, or a Broadcast Graphic's enter, update or exit recipe, that names one whole Foundation Token of its type rather than holding its own value.
_Avoid_: style reference, pin, override, Graphic Input Binding (which maps a Graphic Input to Event Data)

### Broadcast Graphics

**Broadcast Graphics Screen**:
A Screen in Broadcast Graphics mode whose output composes an ordered stack of concurrently visible Broadcast Graphics.

**Broadcast Graphics Background**:
The one Animation Effect a Broadcast Graphics Screen composes its stack over, with its own enabled state and opacity.
_Avoid_: Screen background, backdrop graphic, background layer (a Background Layer stack is what the plain overlay modes carry; a graphics host composes over this instead)

**Broadcast Graphic**:
An authored visual composition that an Operator shows, hides, and controls as one unit on a Broadcast Graphics Screen.

**Broadcast Graphic Template**:
A user-created reusable Broadcast Graphic that can be copied into a Broadcast Graphics Screen and transferred between Events.

**Broadcast Graphics Live Session**:
The continuous playout epoch of a Broadcast Graphics Screen.

**Broadcast Graphics Live State Change**:
What one accepted command changed about a Broadcast Graphics Live Session's live state, per Broadcast Graphic, carried by the realtime notification instead of the state itself.
_Avoid_: patch, delta, diff, partial state, incremental update.

**Broadcast Graphics Recovery Fault**:
Why the durable live state behind a Broadcast Graphics Live Session could not be trusted: missing, corrupt (wrong shape), or incompatible (a value this build cannot interpret).
_Avoid_: corrupt state flag, live state validation error.

**Graphic Input**:
A named, required-or-optional presentation value declared by a Broadcast Graphic Template, typed text, number, toggle, choice, color, or media.

**Graphic Source Selection**:
A named, single-entity Event Data selection owned by a placed Broadcast Graphic.

**Graphic Input Binding**:
An Event-specific, type-compatible mapping from a Graphic Input to one broadcast-facing field on a Graphic Source Selection, drawn from a curated stable field catalog rather than Event Data storage or API properties.

**Graphic Input Override**:
An Operator-supplied typed value that takes precedence over a Graphic Input Binding without replacing it.

**Graphic Input Status**:
What Live Control reports about one Graphic Input's value: manual, bound, overridden, pending, unavailable, superseded or stale.
_Avoid_: stale-input-edit, command rejection codes when naming a value's status.

**Live Control**:
The Operator-facing controls generated for a placed Broadcast Graphic from its Graphic Source Selections and Graphic Inputs.

**On-air Update Policy**:
Whether a Graphic Input change is staged for Operator confirmation or applied immediately to an on-air Broadcast Graphic.

**Graphic Playout State**:
The Operator-visible lifecycle status of a placed Broadcast Graphic: off, waiting, entering, on-air, updating, or exiting.
_Avoid_: Visibility when referring to lifecycle or transition status

**Graphic Channel**:
An optional playout lane on a Broadcast Graphics Screen allowing at most one of its Broadcast Graphics on air at a time.
_Avoid_: Layer when referring to mutual-exclusion behaviour

**Graphic Channel Handoff Policy**:
The per-Graphic Channel rule for replacing its selected Broadcast Graphic: Overlap starts the outgoing exit and incoming enter together; Out then in waits for the outgoing exit to complete.

**Take**:
The playout action that puts a Broadcast Graphic on air.
_Avoid_: show, play

**Out**:
The playout action that takes a Broadcast Graphic off air.
_Avoid_: hide, clear

**Update Graphic**:
The playout action that accepts every staged Graphic Input value of an on-air Broadcast Graphic at once.
_Avoid_: refresh, apply

**Cut**:
An execution modifier that makes Take, Update Graphic, or Out reach its target immediately without running the corresponding Graphic Animation phase.

**Social Profile Projection**:
A named Broadcast Graphic presentation controller that references a Talent Graphic Source Selection and atomically supplies the current Social Profile's network key, label, handle, and profile URL to independently authored Graphic Items.

**Social Network Icon Graphic Item**:
A Graphic Item rendering the application-owned vector icon for one statically selected Supported Social Network or the current network of one Social Profile Projection.

**Social Profile Presentation Group**:
The ordinary Graphic Group associated one-to-one with a Social Profile Projection, containing its icon, text, and decoration consumers.

**Social Profile Rotation**:
The progression of a Talent's Social Profiles one at a time, with an eight-second default dwell configurable from two to sixty seconds, which every rendering projects from server time without writing.

**Social Profile Transition**:
The synchronized visual change between profiles in a Social Profile Rotation: Cut, Crossfade, Slide Left, Slide Right, Slide Up, or Slide Down, lasting 100–2,000 ms (default 250).

### Template Packages

**Template Package**:
A single-template portable artifact transferring one Broadcast Graphic Template or one Feature Match Layout Template.
_Avoid_: Mixed template package, Event-wide template package

**Template Package Preflight**:
The complete inspection a received Template Package passes before anything may be installed. It never installs anything.

**Template Package Preflight Report**:
The one immutable result of Template Package Preflight, carrying migrations, revalidation outcomes, mapping proposals, quota impact, and every issue with a stable code and remediation.
_Avoid_: Import preview, dry-run result

**Preflight Report Fingerprint**:
The identity of one exact preflight proposal — archive bytes, compatibility profiles, proposed mappings, and issues, but not the clock.

**Template Package Mapping Proposal**:
How one packaged asset identity would become a local Graphic Asset, decided by provenance: an exact Graphic Asset Origin match reuses the local revision; a related revision, digest-only match, or new content creates a separate local Graphic Asset (reusing canonical bytes where the digest exists).

**Template Package Installation**:
The one atomic act turning a confirmed Template Package Preflight Report into local state.

**Installed Graphics Template**:
The independent local copy of the single Template a Template Package carried, with its own identity and managed revision.
_Avoid_: Imported template, template installation record.

### Graphics Asset Library

**Graphics Asset Library**:
The shared graphics-specific module that ingests, validates, stores, resolves, deduplicates, and lifecycle-manages images, silent videos, fonts, and generated thumbnails for Broadcast Graphics and Feature Match Overlay.

**Library Workspace**:
The author-facing surface over the Graphics Asset Library for discovering, ingesting, renaming, re-associating, and moving Graphic Assets through Retire, Trash, and Restore, working as the signed-in User.
_Avoid_: Graphics Asset Library Workspace, asset manager, library page

**Graphics Asset Library Capacity**:
The installation-wide storage envelope comprising the Canonical Graphics Quota and Graphics Staging Allowance.

**Canonical Graphics Quota**:
The limit on deduplicated retained Graphic Asset Content and Graphics Derivative bytes, including retained revision history and Trash.

**Graphics Staging Allowance**:
The separate limit on provisional bytes held by incomplete Graphics Ingestion Operations, and by terminal ones whose staged input release has not yet been proven: their bytes stay counted, and listed as unreleased staged input, until the byte store confirms the deletes.

**Canonical Capacity Pressure**:
The normal, warning, critical, or full state derived from use of the Canonical Graphics Quota.

**Graphic Asset**:
A stable-identity library resource for a validated image, silent video, or font, owned by the installation-wide Graphics Asset Library and reusable across Events.

**Retired Graphic Asset**:
A Graphic Asset hidden from discovery and unavailable for new references while existing references keep resolving.

**Trashed Graphic Asset**:
An unreferenced Graphic Asset removed from discovery and new references, restorable for 30 days; afterwards it is purged only after a fresh proof that no reference points to any revision.

**Graphic Asset Content**:
One immutable validated byte payload and its technical media facts, identified by the SHA-256 digest of its exact stored bytes, independent of filenames and library metadata.

**Graphic Asset Revision**:
An immutable content-bearing version of one Graphic Asset, created when its file content changes.

**Graphic Asset Reference**:
A persisted link from one graphics artifact to one exact Graphic Asset identity and revision.

**Graphic Asset Origin**:
The immutable source identity, revision, and digest recorded on the local Graphic Asset Revision a Template Package installed, recognising related later imports without creating a cross-installation identity or link.

**Missing Graphic Asset Reference**:
A Graphic Asset Reference whose asset or pinned revision does not exist: an integrity failure that never falls back to another revision.

**Unavailable Graphic Asset Content**:
The retryable state in which a referenced asset and revision exist but their bytes cannot currently be resolved.

**Graphic Asset Validation**:
Strict acceptance proving exact source bytes are safe, supported, decodable, and consistent, without changing them.

**Graphic Asset Compatibility Profile**:
The versioned contract of accepted formats, bounds, validation rules, and output requirements applied to every ingestion path.

**Graphics Ingestion Operation**:
A durable, reconnectable workflow receiving a local upload, approved remote copy, file replacement, or Template Package, publishing the complete result atomically or nothing.

**Graphics Derivative**:
A generated thumbnail or preview dependent on one source Graphic Asset or graphics Template revision, inheriting its access and lifecycle and never itself a Graphic Asset.

**Graphics Retention Sweep**:
The scheduled pass that reclaims only state proven unreachable past its full recovery guarantee: expiring staged input, Revision Pruning, purging eligible Trash, collecting unreachable content, and Evidence Sealing.

**Revision Pruning**:
Removal of a superseded Graphic Asset Revision no reference reaches, 90 days after it became unreferenced.

**Graphic Asset Tombstone**:
The durable proof that a Graphic Asset identity was purged, recording when, why, and the reference proof.

**Early Purge**:
An explicitly confirmed Graphics Administrator action purging an unreferenced Trashed Graphic Asset before its 30-day window, with the same fresh reference proof and tombstone as scheduled purge.

**Content Quarantine**:
The holding state for Graphic Asset Content whose last reachability disappeared, kept seven days and rechecked before deletion; content reached again is released.

**Graphics Reconciliation**:
The pass, scheduled and triggered by readers observing integrity failures, comparing the content the catalogue expects against the bytes the store holds.

**Graphics Discrepancy**:
One durable disagreement between catalogue and byte store, with its evidence, affected pinned usage, and the actions valid in its state.

**Critical Integrity Incident**:
A Graphics Discrepancy where stored bytes contradict their owning digest, an object contradicts its integrity metadata, or a canonical object has no digest-owned identity.

**Exact-Byte Repair**:
The Graphics Administrator action restoring Unavailable Graphic Asset Content from supplied bytes proving the same digest, size, media type, and validation facts.

**Deep Verification**:
The Graphics Administrator action that re-reads and re-hashes stored bytes in full, detecting changes behind unchanged size and media type.

**Derivative Regeneration**:
Reproduction of a missing Graphics Derivative from available source content.

**Evidence Ledger**:
The chronological administrator-facing record of automated Graphics Asset Library lifecycle and reconciliation decisions, naming actor, transition, reference count, bytes, quota state, deadline, outcome, and reason — never keys, digests, filenames, URLs, or secrets.

**Evidence Terminal Cleanup**:
The recorded event saying an Evidence Ledger subject is finished — a purge, Revision Pruning, content deletion, staged input expiry, or settled Graphics Discrepancy.

**Evidence Sealing**:
The Graphics Retention Sweep stage stamping the one-year expiry onto unsealed Evidence Ledger entries whose subject has recorded an Evidence Terminal Cleanup.

**Evidence Category Group**:
The operational vocabulary the Evidence Ledger is filtered by — ingestion, lifecycle, pruning, purge, quarantine, reconciliation, repair, regeneration, restoration — each a set of categories.

### Library operations

**Operations Cockpit**:
The administrator-only surface answering, in one reading, whether the Graphics Asset Library is safe and what needs attention.
_Avoid_: dashboard, storage admin panel.

**Library Component Condition**:
Whether one library component can answer and agrees with the other side: healthy, degraded, or unavailable.

**Storage Health Alert**:
One open call on a Graphics Administrator's attention — critical, warning, or info — derived from durable state rather than remembered, so a persistent one survives reload until its subject is resolved.

**Graphics Ingestion Attention State**:
What an unfinished Graphics Ingestion Operation needs now: expired staged input, retryable, awaiting confirmation, or working.

**Operational Queue**:
One risk-ordered list of Graphics Asset Library work grouped by what is wrong with it, holding a complete count and a deadline-ordered sample.
_Avoid_: work list, task list, incident bucket.

**Queue Inspector**:
The administrator detail surface for one Operational Queue item: identity, state, deadline, affected usage, catalogue expectation beside byte evidence, filtered Evidence, and only the valid actions.

**Queue Action Outcome**:
The vocabulary every Operational Queue action reports in: completed, already-in-state, reference-blocked, retryable-unavailable, or integrity-conflict.

### Graphics Composition Model

**Graphics Composition Model**:
The Graphic Item, geometry, styling, grouping and animation vocabulary that Broadcast Graphics and Feature Match Overlay both compose with.
_Avoid_: Shared Graphics Foundation (the former name), graphics engine

**Host Contract**:
The declaration a graphics Screen Mode supplies when embedding the shared compositor and the shared graphics editor: the context and canvas it offers, what its item tree holds, and which edits are forbidden.

**Graphic Item**:
A visual part within a Broadcast Graphic or Feature Match Layout, such as text, media, or a shape.
_Avoid_: Element, Widget

**Graphic Item Definition**:
The application-owned contract for one Graphic Item kind: identifier and configuration version, schema and defaults, editor controls, renderer behaviour, migration, and asset-reference discovery.

**Text Graphic Item**:
A Graphic Item that renders literal text or a Graphic Text Template.

**Graphic Text Template**:
A string combining literal text with `{inputKey}` placeholders for Graphic Inputs, rendered by a Text Graphic Item.
_Avoid_: Expression when referring to placeholder substitution

**Graphic Placeholder Style**:
An optional typography-only override for one placeholder or projection reference in a Text Graphic Item.

**Graphic Font Selection**:
Which font a Graphic Item's typography or Graphic Placeholder Style paints with: one application font shipped with Stream Keepr, or one exact font Graphic Asset Revision referenced like any other Graphic Asset.
_Avoid_: Font family, font stack

**Text Overflow Policy**:
The behaviour when the text of a Text Graphic Item, Clock Graphic Item, or Player Life Graphic Item exceeds its bounds: clip, ellipsis, or shrink to an author-set minimum size and then ellipsis.

**Media Graphic Item**:
A Graphic Item rendering an image or silent video with a Media Fit, focal position, opacity, and optional Shape Geometry clipping.

**Media Fit**:
How an image or video fills the box it is drawn in: cover, contain, or fill.
_Avoid_: object fit, scaling mode

**Shape Graphic Item**:
A Graphic Item that renders a bounded Shape Geometry.

**Deck List Graphic Item**:
A feature-match-context Graphic Item rendering one Seat's Sideboard, and only its Sideboard, as cards or a text list within its bounds.

**Clock Graphic Item**:
A context-gated Graphic Item that renders the active Feature Match Session Clock, the Untimed Label for an Untimed Match, or nothing at all while that label is blank.

**Player Life Graphic Item**:
A context-gated Graphic Item that renders one Seat's life total.

**Game Wins Graphic Item**:
A context-gated Graphic Item that renders one Seat's game-win indicators.

**Commander Damage Graphic Item**:
A context-gated Graphic Item that renders the Commander Damage one Seat has taken: one count per opposing Commander, in Seat order, each hidden while zero.

**Seat Indicator Graphic Item**:
A context-gated Graphic Item shown only while its Seat is in the state its author picked, the active player's or Eliminated, playing its enter and exit as that state flips.

**Shape Geometry**:
A parameterised rectangle with independently square, rounded, or cut corners and bounded left or right edge slant.

**Graphic Group**:
A structural Graphic Item arranging direct context-available Graphic Items as a row, column, or canvas, optionally coordinating clipping or animation and supplying overridable local style defaults.

**Graphic Surface Style**:
The shared visual treatment for the Graphic Items that paint a surface (Text, Shape, Graphic Group, Clock, Player Life, and Game Wins, which paints its win boxes with two more): fill, fill opacity, a uniform outline around the Shape Geometry, and glow.

**Graphic Fill**:
A solid colour or a linear gradient with an angle and two to four positioned stops with opacity.
_Avoid_: Raw CSS gradient

**Graphic Layer Order**:
The back-to-front order of sibling Graphic Items within a Broadcast Graphic or Graphic Group; a group is one layer among its siblings.
_Avoid_: Author-editable z-index

**Graphic Anchor Point**:
One of nine points on a canvas-positioned Graphic Item that fixes its displayed position during resize.

**Geometry Unit**:
An authoring projection of canonical pixel geometry or motion distance as pixels, a percentage of the containing canvas or Graphic Group, or a centred 32-unit grid.
_Avoid_: Graphic Geometry Unit, ±16 unit

**Editor Focus Mode**:
A per-browser authoring preference that gives a graphics Edit workspace — the Feature Match Overlay editor's or the Broadcast Graphics Screen's — the whole page by hiding the app sidebar and the Screen-level cards around it.
_Avoid_: Fullscreen (the browser's own mode), zen mode

**Graphic Rotation**:
The optional static rotation of a canvas-positioned Graphic Item around its Graphic Anchor Point.

**Graphic Animation**:
The recipe-based motion owned independently by a Broadcast Graphic or Graphic Item through enter, on-screen, update, and exit phases.
_Avoid_: Keyframe timeline, motion path, animated effect stack

**Graphic Animation Recipe**:
A bounded combination of at most one fade, slide, scale, and reveal channel, running simultaneously with shared timing and easing.

**Graphic Resting State**:
The authored geometry and appearance of a Broadcast Graphic or Graphic Item while settled on air.

**Graphic Animation Origin**:
One of nine points determining the apparent origin of a scale channel, defaulting to centre and independent of the Graphic Anchor Point.

**Graphic Animation Preview**:
Deterministic editor-only playback of one lifecycle phase or a full lifecycle of a Broadcast Graphic, a Feature Match Layout, or one Feature Match Layout Item. It never changes live Screen state.

### Feature Match Overlay

**Feature Match Overlay**:
A Screen Mode rendering a production-ready Feature Match Layout for a Feature Match Slot, including external video source areas, Graphic Items, frame graphics, and fill/key outputs.
_Avoid_: Generic overlay editor

**Feature Match Layout**:
The authored arrangement a Feature Match Overlay renders: the Frame, its Source Items, and one composition of ordered Graphic Items.
_Avoid_: Overlay config

**Feature Match Overlay Frame**:
The continuous graphic area of a Feature Match Layout behind and around its Layout Items.
_Avoid_: Panel area, background panel

**Feature Match Layout Item**:
A Graphic Item placed in a Feature Match Layout; layouts use the shared Graphic Item hierarchy.
_Avoid_: Region

**Source Item**:
A host-owned Feature Match Overlay element placing an external video source, with optional Frame cutout and source framing: its corner radii, border sides and glow position.
_Avoid_: Source Region, camera box, Source Graphic Item

**Layer Lock**:
An author's lock on one layer of a Feature Match Layout or a Broadcast Graphic, a Graphic Item or a Source Item, against canvas edits: the canvas neither moves, resizes nor rotates it, arrow nudges skip it, and a click on it falls through to the layer beneath.
_Avoid_: Frozen layer, pinned layer

**Feature Match Layout Template**:
A reusable Feature Match Layout that can be copied into a Screen's Feature Match Overlay configuration: one an author saved, one a Template Package installed, or a built-in one the application ships.
_Avoid_: Preset, Feature Match Overlay Preset (the former term for a built-in one)

**Feature Match Layout Host Vocabulary**:
The terms a Feature Match Layout uses whose meaning the Installation supplies: Source Roles, naming the main source or one Seat's, and Feature Match tokens a Graphic Text Template binds.
_Avoid_: Free-form role, camera name

**Feature Match Sample Dataset**:
One fixed canonical set of Feature Match values per Card Game, chosen by the Event's Card Game, that a preview resolves a Feature Match Layout against when no Feature Match Slot is bound; a Theme preview, which has no Event, uses the Card Game the Operator picks, or Commander, a pick beside them.
_Avoid_: Dummy data, test data

**Feature Match Stress Dataset**:
One fixed set of the longest plausible Feature Match values per Card Game, chosen as the Feature Match Sample Dataset is, live state included: life totals, Sideboards and their card names, and the clock, or the longest Untimed Label for an Untimed Match.
_Avoid_: worst-case data, overflow data
