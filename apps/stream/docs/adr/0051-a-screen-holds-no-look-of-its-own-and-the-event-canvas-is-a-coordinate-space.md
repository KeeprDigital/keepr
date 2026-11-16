# ADR-0051: A Screen holds no look of its own, and the Event Canvas is a coordinate space

Accepted · 2026-10-27 · [#812](https://github.com/KeeprDigital/stream-keepr/issues/812) · Amended 2026-10-28: only overlay Screen Modes scale the Event Canvas, and Standings and Metagame's last look fields are Mode Tokens · [#851](https://github.com/KeeprDigital/stream-keepr/issues/851) · Amended by ADR-0049: no Mode Token holds type, which a display reads from Foundation Tokens · Amended by ADR-0054: a size or spacing one display alone reads is its mode's config, not a Mode Token

### Decision

**`ScreenConfig` is deleted.** A Screen holds its Screen Mode, that mode's content config and its Screen Theme Overrides.

- Background, text colours, padding and alignment become Theme Tokens.
- colorMode goes: a light look and a dark look are two Themes.
- Mode config holds what a mode shows (headers, columns, page size, Event References). Mode Tokens hold how it looks (colour, type, spacing, size, media, motion).

**Each Event sets one Event Canvas** (default 1920×1080) in its Event Presentation Settings, with its Theme and on-air wording. Every Screen of the Event uses it, graphics hosts included, and every overlay Screen Mode scales it uniformly to fit its window. There is no per-Screen canvas. Feature Match Controls is the exception: it is an operator surface, so it fills its window and consumes no Theme Token (#812, Q37 and Q44).

### Why

Canvas size and wording are set once per production, not per brand or per Screen. Dimension tokens are in canvas pixels. If canvas meant output resolution, a Theme reused on a 4K show would render at half size. As a coordinate space the canvas changes only for a different aspect ratio, and output resolution is the browser source's to set.

### Consequences

- Today's two canvases (`ScreenConfig` width/height and the graphics hosts' canvas fields) become one.
- Padding and alignment are the `inset` and `alignment` Foundation Tokens. The inset is one value on every side; the separate horizontal and vertical padding a Screen had is not kept. A plain overlay mode's Screen host consumes them itself, so they are among what its Screen consumes and may override (#826). The Background Screen and the graphics hosts render edge to edge and consume neither, and Feature Match Controls consumes no Theme Token at all.
- A portrait display on a landscape Event is not supported; an override is the reopening path if a real case appears.
- Resizing the Event Canvas moves the frame every graphics composition of the Event was authored in, yet takes no Graphics Authoring Lease, like any other Event Presentation Settings write (ADR-0030).
- On-air wording stays on the Event, so one Theme serves Events that word things differently.
- Holding text stays on the Event but is set in Event Controls, not Event Presentation Settings: an operator rewrites it during a show, while the settings here are set once per production.
- The existing look fields are dropped, not migrated, and existing Screens render the Default Theme.
- The plain modes' remaining look fields became Mode Tokens and former fields (#844): their colours, type and Card Spotlight's enter and exit. Card Spotlight's on/off switch went with its speed, since a motion recipe with no channel cuts.
- **A Theme Token is shared, never a value one display alone reads** (amended by ADR-0054). A Mode Token defaults to a Foundation Token, so it carries a shared value to the place it is consumed. A size or spacing only one display reads is that mode's config, edited beside the control it sizes: Most Played Cards' Card Layout and badge size; each Deck board's Card Layout, the sideboard's stack reveal, and the Deck's badge, pill and chip text sizes; Card Spotlight's card width. A badge's size is its text size, Auto or px (ADR-0054), and the badge is laid out around it in em, so one value sizes it whole. A colour, type, motion or surface a brand would set stays a Theme look even where one mode reads it, such as the Metagame chart palette. The badges' shadow is the `shadow` Foundation Token, which their displays read directly (#1078).
- Standings and Metagame followed (#851). Animate entries became `row-motion`, which also times Metagame's chart bars. Both modes declare it from one shared definition whose default follows the `motion-enter` Foundation Token's timing with its own slide, so a Theme's enter motion paces their rows (#1082, ADR-0049). Standings' `reveal` view mode keeps its own rise as `reveal-motion`, a literal, since its pace matches no Foundation motion. An entering row starts an eighth of the duration after the one above it, so a cut has no stagger either. No plain mode keeps a motion field in config.
- Their max width is config (#1081): `maxWidth`, Auto or a width in Event Canvas pixels within the canvas side bounds. Auto is stored as absent and fills the Screen. It is a size only its own display reads, so it sits beside the table it sizes, as the card sizes do. The `max-width` Mode Token #851 made of it is a former token, and a width stored in one is not read back; nor is the `maxTableWidth` field before it, which stays a former field.
- A motion Mode Token reaches its display as custom properties a CSS transition reads: its timing, and the excursion state the element enters from and leaves to. A slide clearing its parent travels the whole Screen, which is the size container its Screen host sets.
- `text-inverse` is text on the primary text colour. Every badge, pill and chip whose surface is `text-primary` pairs it with `text-inverse`, so a light Theme sets the two as a pair.
