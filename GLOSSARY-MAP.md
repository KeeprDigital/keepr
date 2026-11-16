# Glossary Map

Keepr has three vocabularies. Use each in its own code, and the shared one everywhere.

## Contexts

- [Keepr](./GLOSSARY.md): what every app shares. Identity and access, and the shared layer's named modules.
- [Stream Keepr](./apps/stream/GLOSSARY.md): producing the broadcast of a tournament. Its rules are in `apps/stream/RULES.md`.
- [Score Keepr](./apps/score/GLOSSARY.md): running a tournament. The engine packages (`packages/pairing`, `packages/standings`, `packages/engine-core`) speak it too. Its rules are the specs in `apps/score/docs`.

## Rules

- **A word may mean two things only where no module, API or screen handles both meanings.** Otherwise it is defined once, at the level both sides share.
- **A shared term is defined once, in the root glossary.** An app's glossary uses it and never redefines it.
- **"Session" alone is the sign-in.** Feature Match Session, Broadcast Graphics Live Session and Realtime Event Session are always written in full.
- **A term's glossary follows its code.** A module that moves into `packages/nuxt-layer` brings its term to the root glossary in the same change.
- **A glossary says what a thing is, in a sentence or two.** What it must do is a rule, and goes in the app's rules.

## Relationships

- **Keepr → every App**: an App learns who a request belongs to from Keepr Accounts, as an Identity Proof. A User, Session, Organisation or App role means the same thing in every App.
- **Stream Keepr ↔ Score Keepr**: neither reads the other today. Stream Keepr's tournament data comes from Melee Sync and the TCG+ Import. The rows below are how the two would meet.
- **Screen Output**: Stream Keepr's one identity that is not a User. A Screen Output is admitted by its Screen Output Asset Capability, in place of a Session.

## The same thing under two names

| Stream Keepr | Score Keepr | How they relate |
|---|---|---|
| Event | Tournament | An Event is the broadcast production of one Tournament. |
| Match | Pairing | A Match is a Pairing as imported, with its Match Result. |
| Match Result | Result | Both say what happened in one Pairing. Stream Keepr only imports one; Score Keepr's is reported to the Standings Engine. |
| Round Standings | Standings | Round Standings are the Standings as of one Round. |
| Seed | Rank | A Seed is the Rank an Entrant holds entering a Top Cut. |
| Top Cut Bracket | Top Cut | The Top Cut Bracket is a Screen's display of a Top Cut, which is a Phase. |
| Player | Entrant, Player | A Stream Keepr Player is an Entrant that is one Player. Stream Keepr has no Team. |
| Phase, Round | Phase, Round | The same things. |

## The same word for two things

| Word | Stream Keepr | Score Keepr |
|---|---|---|
| Slot | Short for Feature Match Slot: a production lane showing one Match. | One side of a Pairing in a Fixed-Structure System. |
| Entrant | Not a term. A bracket's side is a Bracket Entrant. | The unit that is paired and ranked. |
| Score | Not a term. A Match's game wins are its Game Score. | The number saying how well an Entrant is doing. |
| Seed | A position entering a Top Cut. | Not a term: say Rank, or Random Seed for randomness. |
| Preset | A former term: say built-in Feature Match Layout Template. | A named, dated piece of Configuration. |
| Operator / Organiser | Operator: the App role of a User running a broadcast. | Organiser: the App role of a User running a tournament. Often different people at one tournament. |
| consumer / Consumer | Lowercase: code that holds a Realtime Subscription. | The software that calls the engines. |

A Commander Event, a game among up to four, has no counterpart in Score Keepr: a Pairing is always two Entrants.
