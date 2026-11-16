# ADR-0054: Cards always fit the Event Canvas, laid out by a Card Layout

Accepted · 2026-10-28 · Amended 2026-11-11: Card Sizing, Fixed width or Fit to screen, gave way to the Card Layout, and nothing leaves the Event Canvas; the sideboard takes the mainboard's layout unless customised · Amended 2026-11-12: a Deck board's columns are bounded by its Deck Source's card count · [#1087](https://github.com/KeeprDigital/stream-keepr/issues/1087), [#1088](https://github.com/KeeprDigital/stream-keepr/issues/1088), [#1089](https://github.com/KeeprDigital/stream-keepr/issues/1089), [#1091](https://github.com/KeeprDigital/stream-keepr/issues/1091), [#1109](https://github.com/KeeprDigital/stream-keepr/issues/1109)

### Decision

**A card grid always fits the space its display gives it.** Most Played Cards and each Deck List board lay their cards out by a Card Layout of three values, each a number or Auto, stored as the number or as absent, and all Auto by default: `columns`, `maxCardSize` and `cardGap` (`cardLayoutShape`). Alignment stays a nine-point value. The Card Sizing it replaced (`cardSizing`: Fixed width, which could overflow, or Fit to screen) is gone, with its CSS paths: Fit's container-query card width and Fixed's `auto-fill` tracks.

- **Solved, not styled:** a display measures the space its cards have and lays out what a solver returns, so `ScreenCardGrid` is handed its columns, card width and gap in px and only places them. Until a space is measured, its cards have no size.
- **Bounds follow the content:** columns run to the card count, not to 12, and a max card size to the Event Canvas, not to 480 px. The contract holds the outer bound: the most cards a Screen ranks, a hundred on a Deck board, and the largest side a canvas may have. The editor narrows each to the Screen's own card count, where it knows it, and to the largest card its Event's canvas holds whole. Every card grid shares one gap bound, 0 to 100 px.
  - **A Deck board's card count is read from what its settings page already holds** (#1109, `useDeckBoardCards`), with no read of its own, and follows the Deck Source live. A card is one Deck List entry, a grid cell: a Magic Player's Deck List through the deck cache, and a Broadcast Deck List's entries where the list is loaded. Where the page holds only copies, it counts those, which is looser and never under the cells: a Broadcast Deck List's summary, and the Mainboard count a One Piece Deck List reference carries. A shown companion counts once, in the sideboard. Each Columns field is bounded by the board it lays out, so a sideboard following the mainboard's layout shows only the mainboard's, bounded by the mainboard's cards. A board with no cards takes 1; with no Deck List resolved the bound stays 100. The count narrows the editor only: a stored value above it is kept until the operator edits it.
- **A stored Card Sizing read as the Card Layout it meant** (`upgradeFormerFields`, ADR-0037), until the pre-ship wipe removed the mapping with every other former field (ADR-0037). `cardSizing` and `cardWidth` are former fields. A Fixed width is the max card size, a new key so that the mapping holds on every read; a Fit grid has none. Auto columns are an absent `columns`, so `autoColumns` is a former field too, and the mapping clears the count it overrode rather than leaving it in place: a stored `autoColumns: true` reads as no `columns`, and a stale client's write of the flag stores none. A stored or stale `autoColumns: false` is dropped and its `columns` kept. It was first no field at all, refused on write and left unread in storage; a Screen storing it then refused every later write of that config, since the settings page writes back what it read. The former default differs by mode, so the mapping does too:
  - **Most Played Cards:** its default was Fit, so a config naming no Card Sizing has no max card size.
  - **Deck List:** its default was Fixed 144 px, so a board an earlier contract wrote with no Card Sizing reads as Fixed: its `cardWidth` is its max card size, and with no width the max is 144, as an explicit Fixed with no width reads. A board is an earlier contract's when it names a former field; one naming none is a Card Layout, whose absent max is Auto, so an operator can clear the max. Each board is upgraded on its own, and a board not stored stays absent.
- **A Screen that never set its layout changes:** it showed the mode's fixed columns at its default width and now chooses both, at the largest size that fits. A stored `cardGap` is kept as a set gap, since a stored default cannot be told from a choice.

**The card layout solvers take each constraint as Auto or a number and return the largest card that fits** (`solveCardGrid`, `solveDeckLayout`, `solveDeckGroups`; #1072).

- **Columns:** a set count is kept. Auto is chosen by one continuous score (`layoutScore`) from 1 to the card count. Each column choice is laid out at the largest card size that fits, and the choices are compared on:
  - card size, relative to the largest possible;
  - the share of the width the cards span;
  - the square root of the share of the height they span;
  - how full their rows are.

  Every term is a ratio, so the same choice holds at any canvas, card or gap size, and no small change flips it. Width counts more than height: space under a grid reads as margin, space beside it as a gap.

- **Max card size:** no card is wider. A Deck's boards share one card size, so they share the least max any board sets, the stacked strip's included.
- **Gap:** an Auto gap is a fixed ratio of the solved card width, the one that gives the mode's former default gap at its former default card width: 12 px at 160 px on a card grid (`AUTO_GAP_RATIO`), 8 px at 144 px on a Deck board (`DECK_AUTO_GAP_RATIO`). A set gap is kept while it is no wider than the card it leaves. Past that the gap is the card's own width, so a gap too large for its space shrinks with the cards instead of pushing them off the Event Canvas.

**A Deck's boards are laid out together from the space they measure** (`solveDeckLayout`). A Deck has no pages, so the Screen measures the space below its header and lays both boards out at one card size: the largest at which both fit.

- **Columns:** each board's columns are chosen alongside the other's. A sideboard below the mainboard, choosing its own columns, wraps at the mainboard's width: it takes as many as the mainboard has, or as many as it has cards.
- **Stack:** a stacked sideboard shows less of each card, down to its name bar (`MIN_STACK_REVEAL_SHARE`), before its cards shrink. The strip and its reveal are otherwise unchanged.
- **A list is not laid out:** a board beside or under a list is laid out alone, in the space the list leaves it. Beside, a list takes a share of the width by its list columns, a grid by its set columns, a strip one.
- **The companion alone:** with no sideboard shown, the companion is laid out as a one-card sideboard grid, in the sideboard's place.
- **Measured, not guessed:** a board's heading and a Most Played Cards name label are measured from hidden copies, as their Theme types them, by layout height (`useLayoutHeight`), which the Screen's scale leaves alone. The gap between boards is set from the value the layout reads.
- **Placement:** boards laid out together are sized exactly and fill the space they share. Across the axis they share, each board sits at its own `alignment`, as far as the Screen's edge, a sideboard's heading with it. Along it they sit together at the mainboard's `alignment`, so the space they leave is shared out around them. A sideboard aligned away from the mainboard (bottom below it, right beside it) goes to that far edge instead.

**The sideboard takes the mainboard's layout unless customised** (#1091), so an operator sets a Deck up once.

- **What it takes:** the mainboard's layout values: its Card Layout, list columns and alignment. Card badges are the Deck's, so both boards already share them. The sideboard's view and its stack reveal stay its own, so the strip beside the mainboard and its reveal are unchanged.
- **Customised is stored, not flagged:** a sideboard block naming a layout value is its own, completed from the board defaults; one naming none, or none stored, follows the mainboard (`resolveDeckBoards`, `sideboardCustomised`). Settings' Customise writes the mainboard's values as the sideboard's whole block, alignment and list columns always among them, so a customised layout of all Auto values is still its own. "Use mainboard's" writes back only the view and reveal.
- **Stored blocks stay customised:** every block an editor wrote names its alignment and list columns, so a Screen that stored a sideboard layout keeps it. Only a sideboard never written, or reset, follows the mainboard. The display reset writes the sideboard's own defaults alone, a stack with a 30 px reveal.

**A One Piece Card Game Deck List's groups are laid out together** (`solveDeckGroups`). Character, Event and Stage sit one under the other beside the Leader, at one column count, so their cards line up, and one card size, the largest at which every group, its heading and the gaps between them fit. They sit together at the Mainboard's alignment. The Leader fits a fixed share of the Screen.

**Only a sideboard stacks, as the strip beside the mainboard.** The mainboard's views are grid and list. A sideboard stack placed below the mainboard, or shown alone, renders as a grid and keeps `view: 'stack'` stored, so moving it back beside restores the strip. Settings shows the Stack tab disabled in those cases. A mainboard stack stored by an older client reads as a grid (`resolveDeckBoards`).

**A card grid's sizes are its mode's config, not Mode Tokens.** Each one a single display reads moved back beside the control it sizes, which amends ADR-0051's #844 bullet: a Theme Token is shared. Most Played Cards holds its Card Layout and each badge's own text size and position (`rankBadgeTextSize`, `statBadgeTextSize`, `rankBadgePosition`, `statBadgePosition`), as a Deck's badges are; each Deck board its Card Layout, the sideboard `stackReveal`, and the Deck its four text sizes; Card Spotlight `cardWidth`. The three badge shadows read a new `shadow` Foundation Token.

**A card badge's size is Auto or a text size in px** (#1089), the badge laid out around it in em. Each badge has its own size field (`cardBadgeSizeField`, 8 to 48 px), absent for Auto, the default.

- **Auto follows the card:** a fixed share of the card's solved width (`cardBadgeTextSize`), the share that gives the badge's former default text size at its mode's former default card width, as an Auto gap does. That is 14 px on a 160 px Most Played Cards card (`TOP_CARDS_AUTO_BADGE_RATIO`), and 16 px for a quantity badge and 14 px for a point badge on a 144 px Deck card (`DECK_AUTO_BADGE_RATIOS`). Each Deck board's badges follow that board's card width, and Auto keeps to a set size's bounds, 8 to 48 px (`CARD_BADGE_SIZE_BOUNDS`), so a very small or large card cannot take its badge past them. A Deck list row has no card, so its Auto point badge keeps 14 px.
- **A stored size is kept** as a set size, the former default included, as a stored `cardGap` is: a stored default cannot be told from a choice.
- **One row per badge:** settings shows each badge as one row holding whether it shows, its position and its size; emptying the size returns it to Auto. A badge's Screen Settings Group is declared `layout: 'row'`, which the generic renderer draws as one row its title names, so no mode writes a badge component. Its colours stay Mode Tokens, in the Card Badges card's Looks after the rows.

**Earlier sizes were not migrated.** Every field Card Sizing replaced is a former field, which a stored config may still carry and which reads as the mode's default until the Screen is next written:

- `dynamicCardSize`;
- the size presets;
- `stackOverlap`;
- `scale`;
- `rowsPerPage` on Most Played Cards.

**Most Played Cards pages by cards.** `cardsPerPage` replaced `rowsPerPage`. Columns no longer change which cards a page holds, so the Screen chooses its auto columns from the grid space it measures, and a page laid out at a full page's capacity keeps its card size. Page counts stay computed from inputs every surface holds, so the settings editor and the Screen Output agree.

**Cards per page is Auto or a number** (#1090). Auto is `cardsPerPage` absent, the default, and means one page of every card; the derived "Split into pages" toggle, which stored the most a page can hold to mean off, is removed. A page size is Auto in one place, `rotationPageCount` in `shared/modules/page-rotation`, which the Screen Output's paging and the editor's page count both call, so they stay equal (#780). The editor shows the rotation's controls only while a page holds fewer cards than the Screen ranks, since nothing else can page. A stored `cardsPerPage` of 60 is kept as a set page size, as a stored `cardGap` is: it still shows one page, and a stored default cannot be told from a choice.

**The Deck's information is the deck's alone.**

- **Counters:** none are shown.
- **Companion:** it is a card, the sideboard's first, tagged "Companion" and listed once, or in a column of its own with no sideboard (`showCompanion`).
- **Header:** the Player's name and the deck's name are each their own line (`showPlayerName`, `showDeckName`).
- **Visibility:** each board's card shows or hides it, writing the one `board` selection, so the last board shown stays on.
- **Hidden settings:** a setting that cannot have an effect is not shown:
  - card points without an Event points system;
  - the details row's look while the row is empty;
  - a stack's columns and gap, since its cards overlap in one column.

### Why

A Theme exists to share a look across Screens. A size only one display reads gained nothing from the Theme and cost an override section away from the control it sized.

With "Dynamic card size", columns only filled the canvas width. Card height followed the card's aspect, so enough rows ran off the bottom of the Event Canvas with no way to stop them. Card Sizing answered that with a Fit mode beside a Fixed one that took an exact width and accepted overflow. Nothing should ever leave the Event Canvas, so Fixed width and its overflow went too: a max card size keeps what Fixed was for, a few cards not growing to fill the screen, without the overflow. The mainboard stack and the horizontal sideboard row were never used.

### Consequences

- A Screen that was Fixed looks the same while it fits and shrinks where it used to overflow.
- Cards in a page of 60, or in a long deck, can be small. Paging, not a minimum size, is the operator's way to keep Most Played Cards large.
- A tall header costs card size, never overflow.
- Deck List Screens that never set a layout grow from 144 px cards to the largest that fit.
