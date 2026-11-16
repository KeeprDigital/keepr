# ADR-0056: A stopgap public read shows a Feature Match Slot as its Overlay would

Accepted · 2026-10-29. Extends ADR-0055.

An Event is producing its Feature Match graphics in vMix rather than with a Feature Match Overlay, and vMix needs the Slot's names, records and clock without a session or a Screen Output Asset Capability.

### Decision

**`GET /api/public/events/:id/feature-match-slots/:slotId` is unauthenticated** under ADR-0055's `/api/public/` prefix, with the same `access-control-allow-origin: *` and `cache-control: no-store`. It answers a one-element array holding one row of strings, because a vMix JSON Data Source reads an array as rows and shows `null` as text: every Feature Match token the Overlay resolves for the Event's kind (`player1Name`, `player1Record`, … `eventName`), then `clock` and each Seat's live state. On a Two-Player or One Piece Card Game Event that is `player1Life`, `player1GameWins`, `player2Life` and `player2GameWins`, and for vMix alone `player1Game1Win`, `player1Game2Win`, `player2Game1Win` and `player2Game2Win`: `#FFFFFFFF` once that game is won and `#00000000` before, eight hex digits that read the same as ARGB or RGBA. An unknown Event, or a Slot not of that Event, is a 404.

**A Commander Slot's row holds its four Seats and no game win** (ADR-0087, [#1179](https://github.com/KeeprDigital/stream-keepr/issues/1179)). Its tokens are the four Seats', each with its Commanders' images and no record, and its live state is `player{N}Life` and `player{N}Eliminated` for Seats 1 to 4. Eliminated is a colour, as a game win is: `#FFFFFFFF` while the Seat is Eliminated and `#00000000` otherwise. It has no `player{N}GameWins` or `player{N}Game{N}Win`, because a Commander Session plays one game. The row names the same fields however many Seats are filled, so a vMix title's bindings hold as Seats fill: an empty Seat's tokens and life are empty strings, and it reads as not Eliminated whatever state the Session holds for it. A Two-Player or One Piece Card Game Event's row is field for field what it was.

**It applies the Overlay's display rules by sharing their code.** The token values moved from the app into `shared/featureMatchOverlayValues.ts`, and the clock's rendering into `projectFeatureMatchClock` in `shared/utils/clock.ts`, which `useClockDisplay` now calls. The row itself is `featureMatchPublicRow`'s (`server/utils/featureMatchPublicRow.ts`), which reads who sits in a Seat as the tokens do (`featureMatchSidePlayer`, ADR-0058). The clock is read at request time: a countdown's remaining time, its count-up time when it counts up after, an Untimed Match's Untimed Label (empty while blank), and `0:00` with no Session, as the Overlay shows it. A Slot without a Session starts none.

### Why

A stopgap that works now. Sharing the rules rather than copying them keeps vMix and an Overlay showing the same Slot identically.

### Consequences

- Anyone can enumerate Slots by id and read the Players' names, pronouns, LGS, records, decks and the live state of a Feature Match: what an Overlay would put on air.
- vMix polls, so its clock is only as fresh as its polling interval; it does not tick between reads.
- Replace with a capability- or token-scoped read when a real integration needs one, as ADR-0055 says.
