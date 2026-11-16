# ADR-0094: Each vocabulary has its own glossary, shared terms are defined once at the root, and a glossary holds no rules

Accepted · 2026-11-16 · Extended by ADR-0095 (`docs/adr` at the root): rules say what is true now, decisions say why, and which keeps a rule both state is decided there.

### Decision

**The workspace has three glossaries and a map.** `GLOSSARY.md` at the root holds what every app shares: identity and access, and the shared layer's named modules. `apps/stream/GLOSSARY.md` and `apps/score/GLOSSARY.md` hold each app's own words; the engine packages speak Score Keepr's. `GLOSSARY-MAP.md` at the root names the three, states the rules below, and tables where the vocabularies meet.

**A word may mean two things only where no module, API or screen handles both meanings.** Otherwise it is defined once, at the level both sides share. So Event and Tournament, Match and Pairing, Seed and Rank stay apart with a row in the map, while User, Session and the roles are defined once at the root, and Stream Keepr's Entrant became Bracket Entrant because Score Keepr's Entrant is what a bracket would be fed.

**A shared term is defined once, at the root, and an app's glossary never redefines it.** "Session" alone is the sign-in: a Feature Match Session, a Broadcast Graphics Live Session and a Realtime Event Session are written in full.

**A term's glossary follows its code.** A module that moves into `packages/nuxt-layer` brings its term to the root glossary in the same change, as Guarded Sequence and Flight did.

**A glossary says what a thing is, in a sentence or two, and holds no rules.** Stream Keepr's `CONTEXT.md` was both: it is now `GLOSSARY.md`, each entry its definition and its `_Avoid_` list, and `RULES.md`, each entry's rules under the same headings and then the Relationships. Score Keepr already had the split, with its specs in `docs/`.

**Identity terms are written to the model of Keepr Accounts (#1228) before it is built.** `RULES.md` keeps the rules of Stream Keepr's own sign-in until its cutover, under a note saying so.

### Why

- Two repositories became one workspace (ADR-0091), and each brought a vocabulary. Fourteen words collided, among them Entrant, Seed, Slot, Score and Preset, and nothing said which meaning held where.
- Shared sign-in gives every app the same User and Session. Defined in one app's glossary, they would be redefined in the next.
- `CONTEXT.md` was 121 KB, and every agent was told to read all of it before exploring. Most of an entry was rules, ADR cites and identifiers. The glossary is now under half that, and the rules are read by area.
- Operator (Stream Keepr) and Organiser (Score Keepr) are App roles, each defined in its own app. They are different jobs, often held by different people at one tournament.

### Consequences

- An agent reads its app's `GLOSSARY.md` before exploring, and the `RULES.md` or spec sections for the area it touches. The `AGENTS.md` files say so.
- `apps/stream/test/unit/docs/documentation.test.ts` checks `GLOSSARY.md` and `RULES.md` as it checked `CONTEXT.md`.
- Most `RULES.md` entries open with the sentence their glossary entry holds, so that sentence is in two files. Many also restate a decision recorded here. Which of the two keeps each rule is not decided.
- The Shared Graphics Foundation is the Graphics Composition Model: "shared" now means shared between apps, and "foundation" names the layer.
- Names kept though they no longer fit, each for the size of its rename: Screen Output Asset Capability, which is a Screen Output's whole identity (a candidate for Stream Keepr's cutover onto Keepr Accounts), Reverse Sync, and the Deck List Graphic Item, whose `deck-list` kind is stored in layouts and Template Packages.
- Prose written before this may shorten a Feature Match Session to "the Session" where its decision names it in full first. Visible text keeps its sentence case, so a label reads "Program monitor" for the Program Monitor.

### Rejected alternatives

- **One glossary for the workspace.** It would rename Stream Keepr's core terms (Event, Match, Player) through its code, its database and ninety decisions, to remove a difference that bounded contexts exist to allow.
- **No overlap between the apps' vocabularies at all.** The same cost, for words that never meet in one module.
- **The shared glossary in `packages/nuxt-layer`.** The identity terms belong to Keepr Accounts and are used by every App; the layer only carries the code that checks an Identity Proof.
- **Trimming `CONTEXT.md` in place.** Each cut would need proving against the decisions here. Moving the text loses nothing.
