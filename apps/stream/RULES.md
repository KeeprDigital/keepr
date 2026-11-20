# Stream Keepr rules

What each term in `GLOSSARY.md` must do. An entry states a term's rules; what the term is, is in `GLOSSARY.md` (ADR-0095). The Relationships after the entries say how the terms hold together. Name things with the glossary's terms. Decisions cited as ADR-NNNN are files in `docs/adr`, in `packages/nuxt-layer/docs/adr` for the shared layer's, or in the root `docs/adr` for the workspace's.

## Terms

### Event

**Card Game**:
Chosen when the Event is created and never changed; it decides which cards, Deck Lists, match state and presentation the Event can hold. A One Piece Card Game Event has no Rounds, Matches or Match Results: Feature Match Slot Promotion and Feature Match Assignment never run for it, while Reverse Sync does, from a Player to every Feature Match Slot seating them (ADR-0057).

**Variant**:
Chosen when the Event is created and never changed, as its Card Game is; a One Piece Card Game Event has none. A Commander Event is a Magic: The Gathering Event of the Commander Variant. It is produced from its Feature Match Slots alone: it has no Players, Rounds, Matches, Metagame or Archetypes, Melee Sync never runs on one, and each player and deck is typed in on a Slot's **Seat** (ADR-0087). A Commander Event has none of the Players, Matches, Event Structure, Sync, Metagame, Archetype Review or Integrations pages, and its Match Format offers no best-of, extra turns or points system (ADR-0087).

**Round**:
A Melee-managed Round is complete when every Match stored from Melee in it has a Match Result (reported or a bye), or when the next Melee-managed Round in the Event's Round order has pairings: Rounds run strictly in sequence, so pairing the next one means this one is done. A Round with no Match stored from Melee is complete only once the next is paired. Completion is derived from synced data; no operator completes a Round (ADR-0052). A Round may carry operator-entered timing, a start and a duration in minutes, which a Round Clock counts down; Melee Sync never writes either (ADR-0066). Its duration is whole minutes, 1 to 600; a Round edit sets or clears its start and duration, and a new Round starts with neither. Start now sets the start to server time, and pressing it again restarts it; a Round edit sends the start and duration only when edited, so a save never undoes a Start now made while it was open (ADR-0066).

**Current Round**:
None before any Round is paired. Derived from stored Matches, never set by an operator (ADR-0052). A Standings Screen naming no Round shows the Current Round (ADR-0060).

**Match**:
Each side's record is its Player's Round Standings after the Round once it is complete, and going into it (the previous Round's) while it is played (ADR-0052).

**Match Result**:
Only Melee Sync records one; no operator enters, edits or clears it, so a manual Match never has one (ADR-0047). Recording one never changes a Feature Match Slot's game wins or its Feature Match Session (ADR-0052).

**Game Score**:
Every reported Match that is not a bye has one; a bye or an unreported Match has none. Player history, Pairings, Head-to-Head and Top Cut Bracket show a Match's result as its Game Score, and the Match result Graphic Input Binding shows it from its first Player's side (ADR-0047).

**Round Standings**:
Melee Sync stores them only once the Round is complete, so while a Round is played the latest Round Standings are the previous Round's (ADR-0052). A sync of a Round's pairings stores the previous Round's Round Standings when none are stored: every manual sync of that Round tries, and Live Results only with its first pairings (ADR-0052). Each sync of a complete Round refreshes its Round Standings from Melee (ADR-0052).

**Position Change**:
Current standings stand as the latest Round holding them, so they compare with the one before it. A Player absent from that Round is new; with no such Round, or no position to compare, there is no Position Change. Derived from stored Round Standings, never imported.

**Player**:
A field that shows a Player's name takes the name an operator gave, otherwise their Nickname; an operator screen tells Players apart by Nickname, otherwise name; a Top Cut Bracket shows whichever its Screen picks, the other standing in while the picked one is blank, and the name when its Screen picks neither (ADR-0077). A Magic: The Gathering Player has no Nickname, so needs a name; a One Piece Card Game Player needs a name or a Nickname, and clearing the name brings the Nickname back. On every operator page a Player's name opens their match history, except in a picker that chooses a Player; a name with no Player behind it, or one a surface knows only as text, is plain text, and a row of the Players page does nothing when clicked. The match history is the Player's detail view, following Event Data live as a Player History Screen does. One is open at a time: opening another Player's, an opponent's from inside it included, replaces what it shows and remembers the way back until it closes. On the Players page `?player=<id>` names the Player whose match history is open: arriving with it opens that history, and it follows the history to another Player and away when it closes (ADR-0048).

**Nickname**:
It is not the Player's name: the operator gives that for the fields that show a name, and the Nickname fills them while there is none. Giving a name never hides the Nickname from operator screens. Player pickers find a Player by name, Nickname or Bandai member number.

**Leader**:
It sets the Deck List's colours and is how the community names the deck. A Player's Leader is their Deck List's. A Feature Match Slot Seat linked to a Player shows that Player's; an unlinked Seat holds one picked by the operator, which its Feature Match Deck List shares (ADR-0057, ADR-0074). An operator picks an unlinked Seat's Leader from a Leader-only card search, and a picked card that is not a Leader is refused; it is held by card number, and one whose card is unknown reads as no Leader. A paste naming a Leader sets the Seat's Leader, one naming none keeps the Leader picked, and one naming two or more uses the first and warns (ADR-0057).

**Commander**:
Together they set the deck's colours, by colour identity, and are how the community names the deck. A Feature Match Slot Seat holds the Commanders its operator picked, which its Feature Match Deck List shares.

**Sideboard**:
A Commander Event's Deck List has none. On a Deck List Screen only a Sideboard stacks, as a strip beside the Mainboard, which shows as a grid or a list; a stacked Sideboard placed below the Mainboard, or shown alone, shows as a grid and returns to the strip when moved back beside. Its settings offer Stack only at a Board Selection of Full with the Sideboard beside the Mainboard, and show a stack stored elsewhere as the grid drawn there (ADR-0111). A companion shows as the Sideboard's first card, tagged Companion, or in a column of its own with no Sideboard shown (ADR-0054).

**Board Selection**:
Shared by every deck-rendering surface, including Metagame card filtering. A Deck List Screen always shows a board: hiding the last board shown leaves it on (ADR-0054).

**Unresolved Deck Card**:
Resolving one names the card for every Deck List in the Event holding that entry (ADR-0031, ADR-0074). On One Piece Card Game, the Cards page lists them Event-wide, one can also be retried, and each TCG+ Import retries those its Players' Deck Lists hold, hand-edited ones included; a resolution is remembered for the Event, so every later Deck List write holding that number, a TCG+ Import, a paste or a hand entry, saves the card picked. One Piece Card Game card data comes from bandai-keepr alone, never from a TCG+ export, and a card once held is never looked up again, so a later correction does not reach it; a failed lookup fails the whole import or paste, saving nothing. Resolving one keeps whether each Deck List it rewrites was hand-edited, and adds the picked card into an entry the Deck List already holds for it. A remembered resolution holds even once bandai-keepr knows the number: only resolving it again changes it, and nothing removes it (ADR-0074).

**Metagame**:
A One Piece Card Game Event's Metagame counts cards by One Piece's card types, Character, Event and Stage, with no basic lands, highlander or Scryfall data, and shows no Conversion Target, Conversion Rate, win rate or average position: a requested one reads as none (ADR-0074). The Metagame page and Screen settings offer only what the Event's Card Game's Metagame reads, and a Screen hides any column it does not (ADR-0037, ADR-0074).

**Metagame Scope**:
A One Piece Card Game Event, having no standings, offers only every Player and a Player List, and reads any other scope as every Player (ADR-0074). The Metagame page and every Screen Mode reading the Metagame carry the same scope, so a scope asks each read the same question; an Archetype's pilots, meta share and Conversion Rate are read within it. A Screen's settings offer the Player List scope only while its Event holds a Player List (ADR-0037).

**Archetype**:
On a Two-Player Magic: The Gathering Event an operator assigns one to a Deck List in **Archetype Review**, and a Player's Archetype is that of their primary Deck List. On a One Piece Card Game Event an Archetype is a Leader card: a Player's Archetype follows their Leader and is never assigned by hand. A Commander Event has none. An operator renaming one or pinning its series customises it, and a customised Archetype stays when its last Player leaves (ADR-0074). An Event holds one Archetype per name, ignoring case and surrounding spaces: a create or rename onto a held name is refused, naming its holder, and a name is stored trimmed; Archetypes already differing only by case stay until an operator merges them (ADR-0085). On a One Piece Card Game Event there is one Archetype per distinct Leader card number, named after the Leader and coloured by it; where Leaders share a name, each clashing Archetype not customised takes its card number and keeps it once the clash is gone. A Player whose Leader is unresolved has no Archetype, and the server refuses creating, deleting or merging a One Piece Card Game Archetype by hand (ADR-0074, ADR-0085). Renaming or deleting an Archetype announces the Players it re-projected in one `player:deckProjectionsChanged` naming them, ahead of the Archetype's own message, and none when no Player changed; every Screen a Player change for one of them would reach is told once. With too many Players to name in one message it names none, meaning any Player may have changed (ADR-0084).

**Archetype Review**:
A Deck List is reviewed once it holds one and unreviewed until then; reassigning moves one reviewed Deck List to another Archetype, where renaming an Archetype changes it for every Deck List it holds, and merging one into another moves every Deck List it holds to the survivor (ADR-0085). A Commander Event and a One Piece Card Game Event have none. Merging also moves a Player holding the merged Archetype without a Deck List, and names the survivor in every Event Reference that named the merged one, where deleting it would release them; the survivor keeps its own name, colours, key cards and Pinned Chart Series, and the merge is announced as a deletion naming the survivor (ADR-0085).

**Empty Archetype**:
An Archetype with no **Pilot** in the current scope is not thereby empty. On a Magic: The Gathering Event it stays until an operator removes it, alone or with every other; a One Piece Card Game Event removes its own (ADR-0074, ADR-0085). Archetype pickers mark an Empty Archetype empty rather than hide it, and the Metagame page lists Empty Archetypes apart from its Archetype table (ADR-0085).

**Pinned Chart Series**:
One of the Theme's eight chart series, the Foundation Tokens `series-1` to `series-8`, that an operator gives an Archetype on its Metagame page, so every chart colouring Archetypes gives it that series first and it keeps it whichever others enter or leave. It names a series, never a colour: the Theme decides the look. Two shown Archetypes pinning one series leave it to the one created first. Only an operator writes it; Melee Sync never does (ADR-0069). Pinning a series another Archetype pins is never refused: the Metagame page names that Archetype and warns. A new Archetype pins none (ADR-0069).

**Conversion Rate**:
The target is a numerator condition evaluated inside the scope; it never narrows the scope itself.

**Conversion Target**:
Each Event has one, set on the Metagame page; the Metagame page, the Metagame Screen and Archetype Spotlight all count Conversion Rate against it, and a Screen holds none of its own (ADR-0061). An Event write sets it whole, its metric and threshold together or neither: a Top N of 1 to 999, or a minimum of 0 to 999 match points. A Metagame or Archetype Spotlight Screen's settings show it read-only, with a link to the Metagame page (ADR-0061).

**Melee Sync**:
An operator runs it from the Sync page; Live Results runs its Round sync on a schedule. One Melee Sync command runs per Event at a time; an operator's command takes over from a Live Results tick instead of waiting for it. Every Melee Sync path, manual or Live Results, announces Match Results, pairings and Round Standings each only when they changed, and a sync that changed nothing announces nothing (ADR-0052).

**Live Results**:
It announces only what changed and switches itself off after 12 hours with no change or when Melee refuses its credentials. Its failures are its own Live Results error, apart from the manual sync's (ADR-0052). Turning it on polls at once, clearing its Live Results error and stop reason; turning it off stops polling and changes no data, and turning Melee Sync off turns it off. It polls every five minutes after thirty minutes with no change, and each minute again on a change; probing for the next Round, idling and failures back off from a minute, doubling to fifteen. It refreshes Players only when a Round is first paired or the Current Round names a player the Event holds no Player for, never Deck Lists or Event structure; with no next Round it idles until a structure sync adds one, and a result Melee corrects after its Round is complete arrives only by a manual sync. Once Melee Sync or Live Results is off, a poll under way writes nothing more, its poll state included (ADR-0052). With no Round paired it probes the first Melee-managed Round. The Sync page offers it only while Melee Sync is on; while it is on, the page shows the Current Round, when it last checked and its Live Results error, and once it has switched itself off, why; only an operator turns it back on (ADR-0052).

**TCG+ Import**:
An operator uploads the export on the Sync page, previews what it changes, and confirms. A re-import updates Players by their Bandai member number and marks those missing from it inactive; a Deck List an operator edited by hand is kept until the operator takes the import's (ADR-0074). Nothing is saved before the operator confirms, and an import has no undo. It refuses an export missing a column it reads or with a row naming a Player by a blank Nickname, ignores the export's status column, sums its rows sharing a card number into one Deck List entry, and cuts a Nickname to 100 characters. A re-import never deletes a Player: one back in the export is active again, and one added by hand is kept and never matched, the preview warning of a possible duplicate when that Player's name or Nickname matches an incoming Nickname. It replaces a Player's Deck List only when its cards changed or it holds an Unresolved Deck Card now known, and its preview lists every Deck List it rewrites, flagging each hand-edited one the import differs from. An import announces one `tcgplus:imported`, never a `player:updated` per Player; it writes the Players before their Deck Lists, so a failure between leaves the Players without their new Deck Lists until a re-import finishes them (ADR-0074).

**Provenance**:
Only Melee Sync and the TCG+ Import write Provenance; manual operator edits never carry it.

**Manually Edited Field**:
Melee Sync stops writing that field for that Player, blank or not, and keeps importing the rest. Writing the value a field already holds is not an edit (ADR-0046). Only the server marks one, nothing hands a field back to Melee Sync, and no Player read carries the list (ADR-0046).

**Talent**:
A Talent may hold a role, free text such as "Host" or "Commentator", and a photo: an ordinary Graphic Asset Reference to one exact image revision from the Graphics Asset Library, or none (ADR-0067). Its photo is an image, never a video: setting it replaces the reference, clearing it or deleting the Talent releases the reference in the same write, and a Talent write that omits it leaves it as it is (ADR-0067). Its role is at most 100 characters, trimmed, and a blank role is stored as none (ADR-0070).

**Supported Social Network**:
Events cannot add or reorder networks.

**Social Profile**:
A Talent has at most one per network; Stream Keepr does not verify the remote account exists.

**Broadcast Deck List**:
It has no Player, competition, or Metagame identity, and may carry an Archetype Label. Only a Two-Player Magic: The Gathering Event holds Broadcast Deck Lists: writing one, or enabling them, is refused on every other Event (ADR-0087).

**Archetype Label**:
It does not reference an Archetype.

**Deck Source**:
A Deck Source naming a Player follows every write to that Player's Deck List, a TCG+ Import's included, and shows nothing while the Player holds none (ADR-0074). One naming a Seat shows whoever sits there now, through Swap Players, Swap Seats, a re-paste or a change of Commander; on a Commander Event a Deck Source is a Seat alone (ADR-0057, ADR-0087). On a One Piece Card Game or Commander Event, a Screen entering Deck List mode with no Deck Source chosen starts, in the same Screen write, on the Event's first Feature Match Slot, Seat 1, or on no Slot while it has none (ADR-0057, ADR-0074, ADR-0087). On a One Piece Card Game Event a Deck List Screen shows the Leader large, a cost curve, and the Mainboard grouped into Character, Event and Stage, each by cost, offers no Board Selection, and shows nothing for a Seat holding no Deck List (ADR-0057). On a Commander Event it shows the Commanders apart, ahead of the Mainboard and laid out as a Sideboard's cards are, or alone when the Seat holds no list, offers no Board Selection, Sideboard or companion setting, and shows nothing for a Seat nobody sits in (ADR-0087).

### Feature Match production

**Feature Match Slot**:
A reusable production control lane for showing one featured Match at a time, using mutable display/control snapshot data. A Match occupies at most one Slot.

**Seat**:
One player position of a Feature Match Slot, numbered in the Slot's own order: two on a Two-Player Magic: The Gathering or One Piece Card Game Event, up to four on a Commander Event, where a Seat is a place at the table: Seats run clockwise, an operator surface shows each where it sits, and the turn passes in Seat order. A Seat is linked to a Player or holds data its operator typed; on a Commander Event, which has no Players, every Seat is typed: a name, pronouns and LGS where the Event shows them, its Commanders, and an optional Feature Match Deck List. An empty Seat is not in the game. A third or fourth Seat, and a Commander, exist only on a Commander Event: a Slot setup save, Feature Match Session command or Deck Source naming one on any other Event is refused, and a Commander Event's Slot is never linked to a Player or a Match (ADR-0087). A Commander Event's counters, turn number and cards kept stay off air; its public Feature Match read adds Seats 3 and 4, their life and each Seat's Eliminated state, with no game-win fields, and an empty Seat's fields present and blank (ADR-0087).

**Commander Damage**:
Entering it lowers that Seat's life by the same amount. It is held by Seat and Commander number and never goes below none, so taking back more than was entered raises life only by what was there. Replacing a Seat's first Commander keeps its count, removing the first of a pair leaves its count on the one taking its place, and the damage dealt by a Commander a Seat no longer holds is dropped (ADR-0087).

**Eliminated**:
Only an operator sets or clears it: nothing derives it from life, Commander Damage or counters.

**Feature Match Assignment**:
Moving the same Match to another Slot continues the Assignment; replacing it with a different Match ends it.

**Feature Match Note**:
It moves with the Assignment between Slots and is discarded when the Assignment ends. Feature Match Notes are off for a new Event; switching them off hides them from production surfaces without deleting any.

**Feature Match Deck List**:
Only a Seat with no linked Player holds one; a linked Seat shows its Player's Deck List. It stays until replaced or its Seat is cleared, moves with its player when Seats are swapped, and never counts in the Metagame (ADR-0074). On a Commander Event it holds Magic: The Gathering cards, each the exact printing its pasted line names, its Commanders apart from its Mainboard (ADR-0087). On a One Piece Card Game Event it is pasted as `N[x] CARDNUMBER [name]` lines: a Printing id reads as its card number, a number pasted twice is added into its first line, and any other line is ignored (ADR-0057). On a Commander Event a paste naming no Commander or more than two, an unresolved card or a printing that cannot be found is refused, naming the line at fault, and nothing checks legality, colour identity, singleton or card count; the operator confirms the Commanders offered before it is saved, and a Sideboard is dropped and counted. A paste replaces Commanders picked by search, and while a list is held its Commanders are picked from its cards: a setup save leaving it beside no Commander, or one not in it, is refused (ADR-0087). A setup save naming another Slot's or a missing Feature Match Deck List keeps what the Seat holds, so a stale form never deletes a newer paste; one the save drops, by clearing or replacing it or by linking its Seat to a Player, is deleted (ADR-0057). On a One Piece Card Game or Commander Event the Cards page picks a Feature Match Slot and shows its Seats' Deck Lists side by side, each Seat's own or its linked Player's, as the Slot's Feature Match Session seats them: on One Piece Card Game a Leader section and a Mainboard section filtered by card name or number, on a Commander Event each Seat somebody sits in, its Commanders apart from its Mainboard. Choosing a card previews it on Card Spotlight, and an Unresolved Deck Card shows its number and cannot be chosen (ADR-0057, ADR-0087).

**Feature Match Session**:
It owns which Seat each player sits in: Swap Players moves them in the Feature Match Session only, and the Slot keeps its pairing order (ADR-0058). Except on a Commander Event, a new Feature Match Session opens in its Slot's order, so a swap lasts as long as its Session, and the Slot setup form shows the Seats in the active Session's order and saves each edit to the Seat its player holds in the Slot, so a swap leaves nothing to save (ADR-0058). Once a Slot's first Feature Match Session opens, the Slot always has one: no Feature Match path ends a Session without opening its successor in the same commit (ADR-0026, ADR-0029). A Commander Event's Feature Match Session plays one game, with no best-of and no game wins: it tracks each Seat's life, **Commander Damage**, counters and cards kept, which Seats are **Eliminated**, and the turn, which passes in Seat order over empty and Eliminated Seats, its number going up each time it returns to the Seat that went first. It completes when its operator declares a winning Seat or a draw, and nothing outside the Feature Match Session records the outcome. A Commander Slot has no pairing order to keep, so swapping two of its Seats moves their players in the Slot itself, with all they hold and their live state (ADR-0087). A Commander Event's Feature Match Session starts each Seat at its starting life, 40 by default, and refuses a game win, extra turns, a Sideboard reveal and Swap Players; its clock is untimed unless the Event's Match Format sets a countdown. Its outcome can be taken back, reopening the game; a reset of either kind starts a new game from its source snapshot, clock included, and only a reset changes the Seat that went first. A Seat filled during it joins at starting life; one emptied leaves at once, its turn passing to the next Seat and the Commander Damage its Commanders dealt dropped, while life already lost stays lost, and with no Seat left to take the turn the game waits on a Seat to go first again. A command naming an empty Seat changes nothing (ADR-0087).

**Feature Match Session Clock**:
An operator starts, pauses, resets, restarts, adjusts and sets it, on one Slot or on every timed Slot at once; nothing else moves it. What a rendering shows of it is a **Clock Projection**, which stands in one state at a time:

- **stopped**: not running, with no time run.
- **paused**: not running, with time run and time left.
- **running**: running, with time left or no end to reach.
- **run out**: a countdown at its end, showing `0:00`, running or not.
- **counting up**: a countdown past its end whose Match Format counts up after it, showing the time since its end (its count-up time), running or not.
- **holding at its limit**: counting up, stopped by its count-up limit, which it goes on showing (ADR-0076).
- **untimed**: an Untimed Match's, showing the Untimed Label.

Count-up time is not extra turns: a Feature Match Session's overtime is the extra turns played after time is called, counted in turns and tracked apart from the clock. Counting up is opt-in, with a limit of 1 to 600 whole minutes or none, both from the Event's Match Format, which the clock takes when its state is created: an Event edit reaches the next Match or a Match reset, never a running clock, and an Event write changing a Feature Match default other than best-of corrects every active Feature Match Session's source snapshot and announces the Slots (ADR-0076). An adjustment is exact to the millisecond, so a whole-second one moves what the clock shows by exactly that, across its end too, and a set-to shows the time set through its first second (ADR-0078).

**Untimed Match**:
A Feature Match whose Feature Match Session Clock type is untimed: it has no clock to run and so no extra turns. The type comes from the Event's Match Format when the Feature Match Session opens. Where its clock would render, it shows the Event's Untimed Label, or nothing while that label is blank.

**Feature Match Slot Promotion**:
It announces nothing before it knows whether it stands. One that commits but loses to a later one announces nothing, the new Feature Match Sessions of the Slots it cleared included, so peers show those Slots' previous Sessions until a resync or the Slot's next message (ADR-0029). One that stands announces, after its Reverse Sync, its new Feature Match Sessions, its Feature Match Assignment and every Feature Match Slot it changed, in that order, so peers get the Players' latest data; if the Reverse Sync fails, the committed promotion is still announced before the failure is answered (ADR-0033).

**Reverse Sync**:
The follow-on that copies Players' current data into every Feature Match Slot seating them, and into each such Slot's active Feature Match Session source snapshot. It runs after the Player write, Melee Sync or Feature Match Slot Promotion that caused it has committed, and announces only a Feature Match Session it has to open first, as any new Session is announced: its caller's own messages carry the rest of the result (ADR-0033). A lost Feature Match Session race is absorbed, and the next pass finds the same difference; a Slot whose pairing or active Feature Match Session moved after the pass read it is left as it now stands. A Slot setup edit to a seated Player's name, pronouns or LGS is a Player write, so Reverse Sync carries it rather than undoing it (ADR-0045). A cleared name is a Player write only for a Player with a Nickname to fall back to; otherwise it stays on the Slot alone. A setup edit to a Seat's wins, losses, draws, position, points, deck or Archetype is held by the Slot alone, so the next Reverse Sync for that Player replaces it, though not one made in the same save as a Player write. A save that writes the Player and then fails on the Slot keeps the Player's edit, and the operator retries the Slot (ADR-0045).

### Screens

**Screen**:
It holds its Screen Mode, that mode's configuration and its Screen Theme Overrides: every other part of its look comes from its Event's Theme, and its canvas from its Event, so a light and a dark look are two Themes (ADR-0051).

**Screen Mode**:
Each is named by what it shows or controls. Its key (`card`, `top-cards`, `top-cut`, …) is not its name: renaming a mode leaves its key alone, and a key renamed after release is migrated in storage and still accepted in its former spelling on a Screen write (ADR-0043). A Screen write carrying a mode's configuration under both its former and its current key keeps the current key's; nothing reads or answers a former key, and any other unknown key is refused (ADR-0043). Each Screen Mode is offered to some kinds of Event, a Commander Event only Background, Card Spotlight, Deck List, Feature Match Controls, Feature Match Overlay, Broadcast Graphics and Talent; a Screen write putting a Screen into a mode its Event is not offered is refused, and a Screen already in one keeps saving (ADR-0087).

**Screen Mode Definition**:
The definition of a Screen Mode: its defaults and configuration shape (held as one config contract, ADR-0037, which also names its Authored Stacks), data preparation, rendering contract, Screen host contract (overlay or control surface), and what it declares it carries, such as its Mode Tokens, its own Background Layer stack, its Event References, its Page Rotation, or the Output Changes its Screen Output follows. A mode that declares it carries something gets all of that thing's behaviour from the declaration alone. Generic Screen configuration UI policy belongs here rather than on the Screen configuration page. A Screen write naming a configuration field its mode does not hold is refused, unless it is a former field, one the mode dropped after release, which the write drops and every reader reads as absent or as the field it maps to. A stored configuration number outside its field's inclusive bounds reads as the nearest bound, never as the default and never refused, until a write stores another, and a write outside them is refused; a value past a length or count cap, or an exclusive bound, reads as stored (ADR-0037). A Screen's settings hide a setting that cannot have an effect, such as card points without an Event points system or a stack's columns and gap (ADR-0054).

**Event Reference**:
A field in a Screen Mode's configuration naming something that must belong to the Screen's Event: a Phase, a Round, a Player, a Player List, a Feature Match Slot, an Archetype, a Talent, a Talent Lineup, a Deck Source, or a Manual Bracket, whose Seeds may name the Event's Players (ADR-0075). Every Screen Mode Definition declares its Event References, declaring none if it has none, each field naming its kind on its config contract, and a Screen write refuses one naming something outside the Event with 404 (ADR-0038). An operator sets one through its kind's one picker, which loads what it lists; every picker but the Deck Source's offers none, which unsets it (ADR-0038). Deleting the Phase, Round, Archetype or Talent one names unsets it, deleting a Talent drops it from a lineup, and deleting the Feature Match Slot one names sets it to none (ADR-0060, ADR-0070). Each Screen a delete releases is announced once, ahead of the delete's own announcement, however many of the delete's releases rewrote it (ADR-0032, ADR-0060).

**Output Change**:
A kind of change a Screen Output can show: to its Screen, that Screen's Screen Card or Broadcast Graphics Live Session, its Event or the Event's Theme, or the Event's Players, Player Decks, Phases, Rounds, Matches, Round Standings, Feature Match Slots, Feature Match Sessions, Archetypes, Player Lists, Talents or Broadcast Deck Lists. Every Screen Mode Definition declares the Output Changes its Screen Output follows, declaring none if it follows none, each narrowed to the ids its configuration names; every Screen follows its own Screen, its Event and its Theme. One rule answers from the declaration whether a Screen shows a change. It may answer yes needlessly, which costs a re-read, and never no wrongly, which would leave stale data on air.

**Head-to-Head**:
A Screen Mode showing two Players of an Event side by side before their Match: each one's record and points (the Player's own, or their latest Round Standings while they hold none of their own), their Archetype, and the earlier Matches between them at the Event, oldest first, or that this is their first meeting. Its Players come from a Feature Match Slot, following the Slot's current Feature Match Assignment, or are picked directly.

**Talent Screen**:
Each shows its name, and as the operator chooses its role, its photo, and its Social Profiles on the Supported Social Networks chosen, all at once or one at a time as a Social Profile Rotation. It is offered to Events of every Card Game. Switching it between one Talent and a Talent Lineup keeps the choice not taken (ADR-0070).

**Talent Lineup**:
Deleting a Talent drops it from every lineup, keeping the rest in order (ADR-0070).

**Authored Stack**:
A display reset leaves one untouched, and an edit may replace one but never delete it (ADR-0037).

**Background Screen**:
A Screen in Background mode, rendering an ordered stack of Background Layers (ADR-0016).

**Background Layer**:
The Background Screen's configuration is such a stack, and every mode whose Screen Mode Definition declares one carries its own optional stack behind its content. Every plain overlay mode declares one; the graphics hosts do not, as they own their backgrounds and keep their outputs transparent. A Screen's background has two sources: its own stack, else, while that is empty, its Theme's `background` Foundation Token, a stack of the same layers; no Screen Theme Override supplies one. While a Screen holds none, its settings show its Theme's stack read-only; customising writes a copy of it as the Screen's own, its Graphic Asset Revisions becoming the Screen's own references, which a write refuses once no longer selectable, and Reset to Theme empties the Screen's stack again. The Default Theme's `background` is empty, so a Screen holding no stack under it paints black. A stack holds at most one Animation Effect layer (ADR-0016). A gradient layer holds a Graphic Fill gradient, edited with the one fill control; one stored earlier as a CSS gradient string paints as stored until an edit replaces it. A layer source carrying the former video-compatibility field still reads, the field dropped (ADR-0020).

**Screen Media Source**:
Where a Screen's own image or video comes from: one exact Graphic Asset Revision, referenced like any other Graphic Asset, or a Remote Media URL. Image and video Background Layers, a Theme's `background` stack's included, and the Feature Match Overlay Frame's image and video take one; Graphic Items and Graphic Inputs never do, as their media is Graphics Asset Library content only (ADR-0021). A video whose source changes keeps playing until the new source has its first frame or fails (ADR-0053).

**Remote Media URL**:
A Screen Media Source naming media by URL rather than by library revision, fetched by every rendering: an HTTPS URL to media the installation does not hold, or a root-relative path to media the application serves, which is only under `/video/`, never a route that serves Graphic Asset Content (ADR-0021). An empty one is unset. An HTTPS URL carries its `//` authority, and plain `http://`, any other same-origin path, and a path that could leave `/video/` once resolved or decoded are refused; a stored one outside `/video/` still renders, and the next write re-sending it is refused (ADR-0021). It is never a Graphic Asset Reference, so it protects nothing in the library. An HTTPS URL cannot travel in a Template Package, whose export or install is refused naming the field; a root-relative path travels as data and resolves against whichever installation renders it.

**Animation Effect**:
Its hosts are the Feature Match Overlay Frame, a Background Layer (on the Background Screen and every plain overlay mode), and the Broadcast Graphics Background; the vocabulary is closed, so a config or package naming an unimplemented effect is refused rather than approximated (ADR-0014). Its params share one name per concept across every effect, and a larger spatial value always draws larger, a `scale` of 1 being the effect's designed look (ADR-0025).

**Round Clock**:
Before the start, or with none, it shows the full duration, not running, and with no duration it shows no clock (ADR-0066); after the end, `0:00`, or, where its Screen counts up, which is off unless the Screen turns it on, the time since the end, keeping its ended state and colour and holding at the Screen's limit, 1 to 600 whole minutes, if it sets one (ADR-0076). Like Card Timeout and Page Rotation, nothing writes as it runs or when it runs out. It shows the Current Round unless its operator picks a Round. Two-Player Magic: The Gathering only (ADR-0066, ADR-0087).

**Clock Projection**:
A Feature Match Session Clock's display, a Round Clock, Page Rotation, a Talent Screen's Social Profile Rotation and Card Timeout are each one, and each follows the shared layer's rules for one (`packages/nuxt-layer/RULES.md`). While server time is unknown, a Page Rotation shows its first page and a Talent Screen's Social Profile Rotation its first profile, and every other Clock Projection runs on the device's own time (ADR-0009, ADR-0088).

**Interval**:
A Page Rotation counts its pages on one, and a Social Profile Rotation its steps.

**Frame Clock**:
Where a Clock Projection waits for its next change, motion changes on every frame. Broadcast Graphics playout is read on one.

**Page Rotation**:
The deterministic projection of a paginated Screen Mode's current page from its Rotation Anchor and server time, computed identically by every rendering (ADR-0009). A paginated Screen Mode Definition declares it, naming its page size field, which holds how many rows or cards a page shows or, where the mode allows, is absent for Auto: everything on one page (ADR-0054). While auto-page is on, an edit of the page size or page duration restarts the rotation from page 1; a page size edit also returns the manually selected page to page 1, whether or not auto-page is on (ADR-0039). With auto-page off it shows its manually selected page; with auto-page on and no Rotation Anchor it counts from epoch zero (ADR-0009). An edit that changes which rows it pages rather than its shape, such as its Source, Metagame Scope or Standings Round, returns the manually selected page to page 1 and leaves the Rotation Anchor alone. A Screen's settings count its pages from the rows its Screen Output renders from the Screen as saved, and clamp the manually selected page to the last (ADR-0037, ADR-0039). Most Played Cards offers its rotation only while a page holds fewer cards than it ranks (ADR-0054), and Metagame only for its table: its chart is one page, drawing at most eight Archetypes and folding the rest into Other, and keeps its page size and page duration for the table (ADR-0039).

**Top Cut Bracket**:
The single-elimination bracket a Top Cut Bracket Screen shows: its **Manual Bracket**, on a One Piece Card Game Event or when its operator chooses one (ADR-0075), else derived from the Phase its operator picks, since nothing marks a Phase as a top cut: one column per Round of that Phase, in order, each Match at the Bracket Position its winner advances from into the next column. The first Round, with any byes it leaves out, sets its size, unless the operator sets a larger one; a set size smaller than the first Round needs is ignored. The first Round is placed by Seed in standard order (1v8, 4v5, 2v7, 3v6 for a bracket of 8), the best Seeds taking any byes it leaves out, and each later Match at the Bracket Position its Players advance from, so no Bracket Position moves as later Rounds are paired; a first Round with no Seeds is placed by the next Round's pairings, else table order. A later Match seating a Player the previous Round knocked out, such as a playoff for third place sharing the Final's Round, takes a Bracket Position only after every Match that seats none. A Bracket Position no Match fills yet is pending, showing the winners advancing into it so far. Its operator's choice between a Phase and its Manual Bracket keeps the choice not taken, so switching back restores it (ADR-0075).

**Manual Bracket**:
A Top Cut Bracket its operator fills in by hand on a Top Cut Bracket Screen, for a top cut Stream Keepr holds no Rounds of: its size, its entrants in Seed order, each a Player of the Event or a typed name, paired in standard order with an empty Seed a bye, and who advanced from each Bracket Position, with an optional game score. Its results are not Match Results: only its Screen reads them (ADR-0075). Its size is 4, 8, 16 or 32. A Bracket Position no Bracket Entrant can reach passes a bye on to whoever meets it in the next column, a result counts only at a Bracket Position seating both its Bracket Entrants, and the Final's winner is champion; columns are named by size, ending Quarterfinals, Semifinals, Final. A result is held by its Bracket Position and side, not by who sat there: correcting a Bracket Entrant keeps every result, resizing keeps each Seed up to the new size and clears every result, and picking a result's winner again clears it (ADR-0075).

**Bracket Entrant**:
A Top Cut Bracket shows its name, and, as its operator chooses, its Seed and archetype; a typed name has no archetype.

**Seed**:
On a Manual Bracket, an entrant's place in its operator's list. Otherwise, a Player's final position before a Top Cut Bracket's Phase began: their position in the Round Standings of the last Round holding Round Standings before that Phase's first Round, in the Event's Round order. A Player absent from that Round, or a Phase no such Round precedes, has none. Derived from stored Round Standings, never imported.

**Rotation Anchor**:
A Screen Output never writes it.

**Screen Card**:
Only the Card read carries it; a Screen read never does (ADR-0022). Its Card Revision advances on each save and Clear; every write answer, announcement and Card read carries it, and a holder applies only a state at least as new as the one it holds (ADR-0042). A display control shows its toggle at once; if its save fails, only that field returns to the Screen Card last accepted, unless newer Card state was accepted since, the Screen selection changed, or a later control of that field is still out (ADR-0042).

**Card Revision**:
A save's and a Clear's answer, `card:updated`, `card:cleared` and the Card read all carry it, so every holder orders the Card states it is handed and applies only one at least as new as the one it holds (ADR-0042). A holder forgets it when its Screen selection changes or its Event Lifetime ends, so the next Screen's first Card state applies whatever its revision (ADR-0042).

**Card Timeout**:
Expiry is a Clock Projection, like Page Rotation: no read, client or timer writes it, and nothing announces it (ADR-0022). A Card read answers no Card for one past its Card Timeout (ADR-0042).

**Printing**:
One release of a One Piece card as bandai-keepr lists it — standard, alt-art or reprint — identified by its Printing id (`OP01-001`, `OP01-001_p1`) and imaged at `cards-img.keepr.digital/<PrintingId>.png`. A One Piece Screen Card is one Printing, chosen in Card Spotlight (ADR-0057). A Magic: The Gathering card has printings too, each one Scryfall card: a **Commander**, and each card of a Commander Event's Feature Match Deck List, is held as the one printing picked or pasted (ADR-0087). A One Piece Card Game Deck List entry shows its card's standard Printing (ADR-0074).

**Card Layout**:
The cards always fit the space the grid is given, so none leave the Event Canvas. A set column count is kept and Auto columns are the grid's to choose for the space it has, a max card size is the widest a card may be, and an Auto gap follows the card's size, as an Auto card badge size does. A Deck's boards share one card size, and its Sideboard takes the Mainboard's Card Layout and alignment unless customised, keeping its own view and stack reveal (ADR-0054). Each value is Auto by default. Columns run from 1 to the card count, at most 100 on a Deck board, a max card size to the largest card the Event Canvas holds whole, and a gap from 0 to 100 px; a stored value above the Screen's own card count or canvas is kept until the operator edits it. A card badge's size is Auto, following its card's size, or a text size, each within 8 to 48 px (ADR-0054). A Most Played Cards page holding fewer cards than a full page lays them out at a full page's card size (ADR-0054).

**Program Monitor**:
It composes what playout has taken, resolving media exactly as a Screen Output does, but is not a Screen Output.

**Screen Output Asset Capability**:
An opaque, long-lived, revocable right that lets one Screen Output resolve only the exact Graphic Asset Revisions its Screen currently publishes, its resolved Theme Tokens' included — its Theme's Foundation Tokens and its own overrides of its mode's Mode Tokens (ADR-0050) — and, on a Talent Screen showing photos, the revision each Talent it shows now references for its photo, so a replaced or cleared photo stops resolving with the write that released it (ADR-0070), never Graphics Asset Library discovery. It is also the output's whole identity to the installation: it admits the lookup of its Screen, the reads of what that Screen publishes — its Event context, which holds only the Event fields a rendering shows and its Theme, and the data of the Screen Mode it is in, never another it holds configuration for, derived from the Screen's saved configuration — and the **Realtime Ticket** that lets it hear its own Screen's channel, and nothing of its Event's, in place of a Session (ADR-0010, ADR-0022, ADR-0143). Regenerating it closes at once every realtime socket its Screen's outputs hold, once the new one is stored, and each watcher of the Screen's presence is told they left; the sockets of other Screens, and of Sessions, are untouched. A socket let in on the former capability a moment before, which reaches the Event's object after, is refused there for a minute, by which time no such socket can still be on its way; one let in on the regenerated capability is not. Where the sockets cannot be closed, the regeneration stands, the attempt is made twice, and then the answer says so and the server's log names the Screen under `screen_output_disconnect_failed`. The Screen's page warns the Operator that outputs opened from earlier URLs may still follow the Screen, and that regenerating again closes them (ADR-0137, ADR-0142).

**Screen Output Link**:
It is not presented on reads: it is exchanged once for the capability, which then does everything a capability does. It is derived from what the capability is derived from, never stored, so regenerating the capability regenerates the link and the former link stops exchanging. No Session stands in for it.

**Realtime Ticket**:
A Screen Output asks for one with `POST /api/realtime/ticket?eventId=<id>`, presenting its Screen Output Asset Capability as a bearer, and is answered the ticket and when it expires. No Session is read and none stands in for the capability. A capability that is missing, is no Screen's, or is a Screen's of another Event, and an Event id that is not one, are refused with the same 401, which says nothing of which. A ticket lasts 30 s and admits one socket of the Event it was given for. It is spent when a socket presents it, whatever that socket is answered, and of two sockets that present one at once, one is let in. It admits only while the capability it was given for is still its Screen's, so regenerating a capability leaves its unspent tickets admitting nobody. Only a digest of a ticket is stored, and each ticket given deletes the ones that expired unspent (ADR-0137, ADR-0142).

**Output Hand-out**:
The Screen header, the Feature Match Overlay editor and the Program Monitor each show the same one; a graphics host's own Screen Outputs are offered by name behind each control. The Screen's address printed beside it carries no capability and is not a hand-out.

### Client and live-state infrastructure

**Realtime Event Session**:
An operator's client holds one for its Event, and so does an editor preview, which renders configuration not yet saved. A **Screen Output** or **Program Monitor** holds none: it hears only its **Screen**'s own channel.

**Realtime Subscription**:
The transport holds it from creation until its consumer disposes it, and asks for it again on each socket of its **Event**; no failure and no refusal ends one (ADR-0023, ADR-0143).

**Reconnect Resync**:
Realtime messages are notifications and the server holds authority, so a resync re-reads and never clears what it holds; the one thing it drops is an operator page's Player deck cache, read through again on its next read (ADR-0031). It re-reads once the channel its consumer listens on is attached again having lost continuity, not when the connection comes back, which is before anything listens again (ADR-0023). That channel is the consumer's to name: its Event's for an operator page or a preview, its **Screen**'s own for a **Screen Output** or **Program Monitor**. A consumer listening on no channel yet re-reads when the connection comes back instead. A consumer that read before its channel first attached also re-reads once off that attach, which reports no continuity loss yet followed a window nothing listened in. It exposes the disconnection so a control surface can disable its actions, while an output on program does not.

**Event Data Resync**:
Besides Event Data collections, it covers the operator's Event and the selected Screen's Card. A consumer names its datasets while mounted, with its own re-read of anything no store holds. Each consumed dataset is re-read once, in place, only if its store holds it and keeping its scope; one whose re-read fails or does not land is behind. A held dataset nobody consumed at the resync is behind, and its next consumer re-reads it. The end of an **Event Lifetime** forgets what was behind (ADR-0028). An operator's resync also runs when its client, having been refused on its Event, is let in (ADR-0028, ADR-0143).

**Screen Mode Data Freshness**:
A mode states what it reads; what its rendering shows is declared once, as the **Output Changes** its **Screen Mode Definition** follows, and one rule reads that declaration. A **Screen Output** or **Program Monitor** hears its **Screen**'s own channel, where the server has applied the rule to the Screen as saved and names the kinds of Output Change that touched it; a preview or settings editor hears its Event's channel and applies the same rule to the configuration it renders. The module owns the initial load, live-follow on what it hears, a slow re-read while realtime is degraded (disconnected, or its client refused on the Event its page is on), the same slow re-read after its latest read failed, a re-read once the channel it hears on first attaches, and **Reconnect Resync**. A message or that first attach heard while a read is in flight asks for one follow-up read once it settles, rather than superseding it, so a burst of messages costs one more read per read in flight. Every re-read holds the last accepted rendering until it answers.

**Rendering Readiness**:
A Screen Mode rendering is ready once its display has declared its data settled, its fonts (library and application) have loaded or failed, and every image, video and pending part inside it has loaded or failed. A mode change renders the incoming mode hidden and cuts to it once ready, and a change within a mode that brings new images swaps in once they have loaded; a rendering that never settles is shown after a ten-second timeout (ADR-0053). On a first load nothing shows until the rendering is ready; a mode left before it was ready is dropped, and returning to the mode on program drops the one loading. A read that fails settles as ready, showing the mode's error state (ADR-0053). While a rendering's library fonts load, its display, or a graphics host's canvas, is hidden and its background shows, so one whose library fonts never settle goes on program at the timeout with its background alone; an application font never hides a display, and a face a display on program comes to need swaps in. A font that fails shows its fallback face (ADR-0050, ADR-0053).

**Event Lifetime**:
Coming back to an Event begins a new one, because the Event is loaded afresh. A write's continuation — merging its answer, rolling back, follow-up reloads — runs only while the Flight for the lifetime it began in is current; the caller still receives the answer (ADR-0024). The write itself still finishes for its own Event, at the revisions its lifetime last knew (ADR-0041). What no Event Lifetime owns still follows a late answer: the Events list learns of a save or create, and a late Event delete still clears the loaded Event it names (ADR-0024). Selecting a Screen for its Screen Card, even the one selected, is a boundary too: a Screen Card save or Clear answered after it changes nothing the client holds, and a Clear changes what it holds only once it succeeds (ADR-0024). A settings surface sends every edit it has queued when it ends, whether or not a save is in flight (ADR-0041).

**Field Ownership**:
Client-side it is a scope rule: an optimistic action's merges and rollbacks write only its owned fields, and remote updates never overwrite fields another action currently owns. A client shows a **Screen** as the newest revision it holds with every unsettled write's fields laid over it: it never applies a revision older than the one held, a failed write rolls back to what the server holds now and never over a newer local edit, and a write answers its caller with the newer of its answer and the revision held. A Screen deleted while a write to it was out stays deleted (ADR-0041).
Server-side it is an acceptance rule carried as a Field Ownership claim: a Set Input or Set Override states the effective value it believes it replaces (override, then resolving Graphic Input Binding, then working value or default). A claim still describing what its operator saw is applied; an overtaken claim is refused so the loser sees what landed. A command with no claim is applied unconditionally. The claim is re-checked whenever a command is re-reduced onto a newer state.

**Sequenced Live State**:
It owns monotonic sequencing, compare-and-swap protection, Command Receipts, and the decision to announce a committed command; reducers, merge policies, and notification content stay with the feature. It also owns a live aggregate's epoch lifecycle: closing the active epoch, opening its successor, forgetting the ended epoch's Command Receipts in the same commit, and announcing the change only when the commit actually made one (ADR-0029). A newly opened Feature Match Session is announced with its whole snapshot and an ended one is not, and Graphic Input Bindings re-resolve once per change; a Broadcast Graphics Live Session's end is announced, except on the way to its Screen's deletion (ADR-0029).

**Live State Follower**:
Epochs are ordered by aggregate id (ADR-0026). It drops a duplicate notification and anything from an older epoch, refuses a command result from an older sequence or an older epoch, answers a gap, a newer epoch or a notification with no difference by reloading — unless the notification carries its whole snapshot — and supersedes overlapping loads as Flights. A snapshot another resource's read carries is held only when not behind, and supersedes no load. Reconnect Resync re-reads through its load, or through a read of the resource that carries the snapshot (a Feature Match Slot on a Screen Output); neither clears what is held. The feature supplies only where it holds a snapshot and how to apply a full state or a difference. A command's result says whether it was accepted and what is held now, and a feature merging an answer merges what is held, so a refused late answer settles from the newer state. A Feature Match Slot read carrying a Feature Match Session older than the one held, or none while one is held, is behind as a whole: the held Slot stays, the rest of its load still applies, a Slot settings answer answers its caller with the held Slot, and a Feature Match Slot Promotion answer carrying it applies no Feature Match Assignment (ADR-0026).

**Command Receipt**:
Retained for a bounded window, not as history.

**Batch Command**:
Relative commands stay out because wrapping one forfeits its merge-retry semantics.

### Identity and access

User, Session, App access and the roles are defined in the root `GLOSSARY.md`. Stream Keepr holds none of them: it relies on Keepr Accounts, and learns who a request belongs to only from an Identity Proof, by the shared layer's rules for one (`packages/nuxt-layer/RULES.md`). Nothing in Stream Keepr, a build or a request admits a request without an Identity Proof that verifies: no setting, variable, header or query skips the question (ADR-0113, ADR-0141).

**User**:
The one User Keepr Accounts holds for a person. Stream Keepr keeps no User: it records a User's id where one owns work or acted, and reads a name from the Identity Proof of the request in hand, or, for a User other than that one, by asking Keepr Accounts as the page is read (ADR-0141, ADR-0145). A User owns work, so an operation survives the browser that started it (ADR-0010). Whoever needs Stream Keepr is invited in Keepr Accounts with App access to `stream`. A User with none is refused 403 on every route that requires a Session, as every App refuses one, and is told so in place of the app's pages (ADR-0113, ADR-0141). A User signs in, signs out and manages their account at Keepr Accounts alone: a signed-out visitor is sent there to sign in, and returned to the page they were on (ADR-0141).
Locally the Accounts Stand-in answers every request as the **Local Developer User**, with no sign-in, unless its `keepr-stand-in` cookie names another User, or nobody (ADR-0113, ADR-0141).

**Session**:
One signed-in browser, held by Keepr Accounts and recognised here by its Identity Proof. It admits a request — the deny-by-default boundary over `/api/**` requires one (ADR-0010) — and is the granularity of a Graphics Authoring Lease, because one person in two browsers is two concurrent editors. A Session never owns work. Every `/api/**` route requires one except server time, the release identity, the Realtime Ticket, the Screen Output routes and the public routes, and a route added later requires one unless it joins them. A request refused for want of a Session is answered 401, while a Screen Output route refuses with 404, never 401 or 403. On a path that requires a Session, a request whose method is not GET, HEAD or OPTIONS is refused 403 unless its `Sec-Fetch-Site` is `same-origin` or `none` or, sending no `Sec-Fetch-Site`, its `Origin` names the host it was addressed to; a request carrying neither header is admitted (ADR-0010). A Session's realtime socket is held to the same rule, though its upgrade is a GET: one another origin's page opened is refused (ADR-0137). An ended Session or a disabled User stops being admitted within five minutes, the life of an Identity Proof, and a Session is admitted for as long while Keepr Accounts cannot be reached; past that, a path that requires a Session answers 503 until Keepr Accounts does (ADR-0113). A request that carries the cookie of Stream Keepr's former sign-in beside Keepr Accounts' session cookie, which has the same name, is read by Keepr Accounts' alone, and the former one is expired in the browser (ADR-0141). A Screen Output that presents its Screen Output Asset Capability is admitted without Keepr Accounts being asked, and on a Screen Output route a User with no App access, or a Session nobody can vouch for just then, reads as no Session (ADR-0141).
Locally every browser is in the Local Developer User's one Session, so two browsers are one editor, unless the Accounts Stand-in's cookie names another Session (ADR-0141).

**Graphics Administrator**:
A signed-in User whose Identity Proof names the `admin` App role in `stream`, authorised to operate the Operations Cockpit and Operational Queues, and change Graphics Asset Library Capacity limits. Every `/admin/**` page and `/api/admin/**` route admits only them: a request with no Session is refused 401, and a User without the role 403, as the shared layer refuses one in every App (ADR-0131, ADR-0141). The role is granted in Keepr Accounts, to a member of an Organisation by whoever manages its members, and nothing in Stream Keepr grants it. The Local Developer User holds it. The Evidence Ledger records the Graphics Administrator who acted.

**Graphics Authoring Lease**:
Other Sessions may observe accepted changes but cannot modify the leased artifact. A Screen's Edit workspace is its Broadcast Graphics stack and its Feature Match Layout, under one lease, so a Feature Match Overlay's display reset, which writes its layout, needs it. Nothing else on a Screen is leased: choosing its Feature Match Slot, changing its Screen Mode, its Screen Card, its Screen Theme Overrides, Live Session and Screen commands, a live state reset and deleting the Screen are open to every Session, as are Theme writes and resizing the Event Canvas (ADR-0030, ADR-0049, ADR-0051, ADR-0072). A Screen write is refused under another Session's lease only when it would change what the lease covers, so a rename carrying the Edit workspace back unchanged is accepted, and the lease is checked again as a write commits, a graphics Template placement's included, so a take-over in between refuses it with the lease's own conflict (ADR-0030). Each graphics editor asks for the lease as its Edit workspace opens and is read-only without it, offering a take-over. Losing it, to another Session or to its deadline, drops the editor's unsaved edits and clears its undo history; a request that goes unanswered is no loss until the deadline passes, and an editor merely not holding it keeps its unsaved edits. A lease granted to an editor that has since closed or moved on is released at once (ADR-0030). A lease keeps its holder's name, as their Identity Proof gave it when the lease was taken, and a Session that finds the artifact held is told that name, never the holder's Session or address; a holder with a blank name is not named (ADR-0141).

**Operator**:
An Operator's form settles on what its save stored: once the save lands, a value the save normalized, such as trimmed text, a blank read as none or numeric text as a number, reads as saved, a value edited while the save was in flight stays unsaved, and a failed save leaves the form as it was. A form in a modal holding unsaved changes asks before the modal closes, before navigation or a browser unload, and before its Event is left; keeping the edit keeps both the form and its Event (ADR-0044).

### Theming

**Theme**:
It holds Foundation Tokens only: a Mode Token is set per Screen, so a Theme never styles one Screen Mode differently from another. It holds values, never compositions: it may supply a logo a Broadcast Graphic shows, but the Broadcast Graphic itself is a template's. An Event uses one Theme; a Theme may serve many Events. An edit reaches every Screen using it at once, with no draft or publish step. It themes what Screens render, never the operator app. Its writes are per token, the last write winning, and its editor lists the Foundation Tokens grouped by kind (colours, type, motion, surfaces, background and placement, assets, chart), with `inset`, `alignment` and `animation-effect` beside `background`, and nothing per Screen Mode (ADR-0049).

**Default Theme**:
It is read-only: it cannot be edited or deleted.

**Theme Token**:
Stream Keepr owns every token's name, type, and where it may be consumed; users set values, never names. A token Stream Keepr removes is a former token: a write naming one is accepted and the token dropped, and a stored one is read by nothing. A Theme or Screen Theme Override write naming only tokens it drops answers with the Theme or Screen as it stands, advancing no revision and announcing nothing (ADR-0049).

**Foundation Token**:
Every one has a default value shipped with Stream Keepr. A Screen Mode's display reads one directly for its shared chrome: its type from `heading` and `body`, its title, surface, text and dividers from the colour of that role, as the Metagame chart reads the chart series. The `logo` holds an image or silent video Graphic Asset Reference, or none, its default (ADR-0050). `text-inverse` is text on the `text-primary` colour: every badge, pill or chip whose surface is `text-primary` writes in `text-inverse`, so a Theme sets the two as a pair (ADR-0051).

**Mode Token**:
A mode whose every element has a Foundation role declares none, as Head-to-Head and Talent do. Its default is a Foundation Token, so a new Screen Mode follows every existing Theme unchanged. A motion one follows a Foundation motion's timing and keeps its own movement, as the row motion Standings and Metagame share takes the enter motion's pace and its own slide. Where no Foundation Token fills its role, such as Card Spotlight's zoom, whose pace matches no Foundation motion, it defaults to a literal; a composite default's colours still name Foundation Tokens where they can, as the Feature Match Overlay Frame's fill names `surface`. Only its default names a token: a value set for it is a literal. It is set per Screen, as a Screen Theme Override, never in a Theme; unset, it reads its default. A size or spacing only one display reads, such as a Card Layout, a card badge's size or Card Spotlight's card width, is its Screen Mode's configuration, never a Mode Token (ADR-0051, ADR-0054).

**Screen Theme Override**:
Every other Foundation Token, Graphic Items' bindings and the logo included, comes from the Theme alone: a write naming one is accepted and the token dropped, and one stored before is read by nothing. Clearing it returns the Screen to what the token inherits. A write naming another Screen Mode's Mode Token, or a name no token has, is refused whole (ADR-0049). A display reset leaves every Screen Theme Override in place (ADR-0072).

**Screen Settings Group**:
A Screen Mode declares its groups once, on its config contract, each in one of the page's fixed cards (Live, Source, Content, Header, Paging, Background & Placement), so the page opens on the controls an operator uses during a show and closes on Background & Placement, with nothing after it; a config field and a Mode Token each name the group they sit in, and a Mode Token renders nowhere else, so it is hidden while its group is. The Screen's `inset` and `alignment` sit in the closing "Background & Placement" card; no card lists a Foundation Token a Screen takes from its Theme alone (ADR-0072). A setting whose condition is false is not shown, never disabled, and a control that cannot have an effect is not rendered. A setting offers exactly its configuration field's label, bounds, step and options, unless it reads a tighter bound from the Screen, as a Card Layout's columns go up to the cards it lays out and its max card size up to the largest card the Event Canvas holds; a write is checked against the field's own bound (ADR-0037, ADR-0054). A card's Look is one collapsed section at the card's end: closed, it counts the Screen Theme Overrides it holds; open, it lists each shown group's Mode Tokens, each marked Default or Overridden, and clears every override there in one write. A Screen Theme Override of a Mode Token whose group is hidden still applies, but cannot be changed from the page until its group shows. Background & Placement opens only when it holds a Background Layer or an `inset` or `alignment` override, until it is toggled in that browser; Live and Source are always open, and every other card and each Look keeps the open state last chosen in a browser, on every Screen of its mode (ADR-0072).

**Event Canvas**:
A Screen Output scales it uniformly to fit its window, so output resolution is not the canvas's to set. Feature Match Controls, an operator surface, fills its window instead (ADR-0051).

**Event Presentation Settings**:
Holding text is not among them: it changes during a show, so it is set in Event Controls with the commentators. Wording stays here rather than in the Theme, so a Theme can serve Events that word things differently.

**Screen Mode Sample Dataset**:
That graphic is no Broadcast Graphic Template. The One Piece Card Game set holds a Feature Match Slot whose Seats hold Leaders and a Feature Match Deck List, and a Printing as its Screen Card. A Commander Event has a set of its own, which the preview offers as a pick beside the Card Games. A Theme serves Events of every Card Game and has no Event of its own, so its preview shows the Card Game the operator picks. Like the Feature Match Sample Dataset, it never appears on a live Screen Output.

**Graphic Theme Binding**:
A Graphic Item property group, or a Broadcast Graphic's enter, update or exit recipe, that names one whole Foundation Token of its type rather than holding its own value: a typography, a text or icon colour, a Graphic Surface Style, a Graphic Fill, a Shape Geometry, a Graphic Animation Recipe, or a Media Graphic Item's picture, from an asset token such as the logo. The compositor paints it from the Screen's resolved Theme. Detaching copies the resolved value in as the property's own; binding replaces it; editing it detaches it. A bound property keeps the value it last resolved to, so its document stays complete and renders without a Theme. A binding naming no Foundation Token of its slot's type is refused on a write and paints nothing on a read (ADR-0049).

### Broadcast Graphics

**Broadcast Graphics Background**:
It renders in the Overlay and Fill Outputs, never the Key Output.

**Broadcast Graphic Template**:
Templates are not live Screen state. Each has a stable identity and managed revision; placing or importing one creates an independent copy with no update link.

**Broadcast Graphics Live Session**:
It survives reloads, disconnections, and restarts, and ends when the Screen leaves Broadcast Graphics mode or its live state is explicitly reset. Commands from an ended Live Session never affect a later one. Reading a Screen's Live Session, a Screen Output's read included, opens one when the Screen has none, without announcing it (ADR-0022, ADR-0029).

**Broadcast Graphics Live State Change**:
A peer at the immediately preceding sequence applies it; a peer offered none (too large, a recognised repeat, or indescribable) reloads the authoritative snapshot (ADR-0004).

**Broadcast Graphics Recovery Fault**:
It is derived on every read; while it stands, readers act on a state with nothing on air, and the first accepted command — in practice an explicit Take — clears it. A stale animation start time is not a fault.

**Graphic Input**:
It may be entered manually or resolved from a type-compatible Event Data field, but never exposes a whole Event Data entity.

**Graphic Source Selection**:
It resolves from the current Event, an operator selection, or a fixed relationship from another Graphic Source Selection; it is not a collection query.

**Graphic Input Override**:
It persists across hide/show cycles until cleared, while the binding keeps resolving underneath.

**Graphic Input Status**:
What Live Control reports about one Graphic Input's value: manual (no binding), bound (binding agrees with program), overridden, pending (would-go-on-air differs from on-air), unavailable (nothing valid could go on air), superseded (this operator's edit lost a field-scoped race and was refreshed), or stale (on air holding a value its binding no longer provides). When several apply, the first in order superseded, stale, unavailable, overridden, pending, bound, manual is reported. Command rejection codes are a separate vocabulary describing a command's fate.

**Live Control**:
It selects sources, edits values and overrides, stages updates, and controls playout without authoring bindings, custom controls, queries, or expressions.

**On-air Update Policy**:
Staged values are accepted atomically through Update Graphic; a template recommends the policy and the operator may override it per placed graphic.

**Graphic Playout State**:
Waiting means selected by an Out then in Graphic Channel handoff but off every program output until the outgoing graphic finishes.

**Graphic Channel**:
Graphics in different channels may be on air concurrently.

**Cut**:
It never changes authored recipes or another action already in progress.

**Social Profile Projection**:
A Broadcast Graphic may declare several, each with its own rotation, Presentation Group, and Live Control; Feature Match Overlay does not consume them (ADR-0011).

**Social Network Icon Graphic Item**:
It is not a Graphic Asset.

**Social Profile Presentation Group**:
The projection transitions the whole group together; its projected values cannot be overridden. It is removed only with its Social Profile Projection, never on its own (ADR-0081).

**Social Profile Rotation**:
On a Social Profile Projection it is default-on and on-air-only, and its state belongs to the Broadcast Graphics Live Session; a Take or selection re-anchors the dwell. A projection's rendering without synced server time holds the profile last accepted or anchored, neither blanking nor writing, and a change to the accepted profile set keeps the current network while it still has a profile, re-anchoring it there (ADR-0011). On a Talent Screen it is an operator setting, default off, with no live state: it projects from epoch zero, as a Page Rotation with no anchor does, so every output shows the same profile and every Talent in a lineup steps together, each through its own profiles (ADR-0070).

**Social Profile Transition**:
A newer target replaces rather than queues; an explicit Update Graphic uses its own update animation instead.

### Template Packages

**Template Package**:
Both kinds share the envelope, asset handling, validation, migration, conflict, and atomic installation contract while keeping separate payloads, libraries, and workflows.

**Template Package Preflight**:
The complete inspection a received Template Package passes before anything may be installed, run as a Graphics Ingestion Operation over staged archive bytes: archive safety and envelope limits, deterministic schema migration, revalidation under the receiver's current Graphic Asset Compatibility Profile, local derivative regeneration, and one Template Package Preflight Report. Preflight never installs anything.

**Template Package Preflight Report**:
Package errors terminate the operation; exhausted local capacity is retryable. Warnings pause it once for a confirmation bound to its Preflight Report Fingerprint.

**Preflight Report Fingerprint**:
A confirmation is valid only for the fingerprint it names.

**Template Package Mapping Proposal**:
The same origin identity and revision with a different digest rejects the whole package.

**Template Package Installation**:
It re-derives the report from the same staged bytes and installs only while the conclusion matches what was confirmed; bytes and derivatives are written first, then one transaction publishes every asset, revision, origin, association, rewritten reference, and the Installed Graphics Template. Repeating it answers with the installation already committed, first reinstalling that Installed Graphics Template if it was removed (ADR-0068).

**Installed Graphics Template**:
Its Graphic Asset References already point at exact local revisions and protect them; the source identity is provenance only. It is never revised, but any signed-in User may remove it, which releases its references and keeps its record as provenance (ADR-0068). A removed one is in no listing and reads as not found, its removal records no Evidence Ledger entry, and importing its Template Package again installs a new Installed Graphics Template (ADR-0068).

### Graphics Asset Library

**Graphics Asset Library**:
It is not a general file manager.

**Graphic Asset**:
Events may associate with or reference one but never own it.

**Retired Graphic Asset**:
An asset a saved or installed template, a Theme, a Screen Theme Override or a Talent's photo references cannot be retired (ADR-0034, ADR-0050, ADR-0067, ADR-0068). It may be restored.

**Graphic Asset Revision**:
Metadata changes do not create one.

**Graphic Asset Reference**:
A revision is in use exactly when a reference points to it.

**Unavailable Graphic Asset Content**:
It never changes the reference; the catalogue's record of it is advisory, and the byte store is the only current source.

**Graphic Asset Validation**:
Unsupported content is rejected; previews are separate Graphics Derivatives. A font is accepted only on a browser's evidence that it loads and renders representative glyphs; the server's own checks refuse what they can earlier, but never accept a font alone (ADR-0005). A transparent video revision is accepted only once Chromium proves it renders transparent, on every path that accepts one: ingestion, repair and Template Package installation (ADR-0020).

**Graphic Asset Compatibility Profile**:
Each Graphic Asset Revision records the profile it was accepted under.

**Graphics Ingestion Operation**:
Its provisional content is never discoverable or referenceable. It has at most one active attempt at a time (ADR-0073).

**Graphics Retention Sweep**:
A missed sweep only retains state longer.

**Revision Pruning**:
Latest and referenced revisions are never pruned; a new reference cancels pruning and Trash pauses it.

**Graphic Asset Tombstone**:
It prevents resurrection and identity reuse.

**Early Purge**:
Storage pressure never shortens the window on its own.

**Graphics Reconciliation**:
The catalogue is authoritative for expected reachability, the byte store only for present bytes.

**Graphics Discrepancy**:
It names its subject by opaque domain identity, never object key, digest, or bucket.

**Critical Integrity Incident**:
It fails closed and is isolated from repair, regeneration, and deletion.

**Exact-Byte Repair**:
It creates no revision and changes no reference.

**Deep Verification**:
It writes nothing, is the only action on a Critical Integrity Incident, and can release a verified Content Quarantine copy.

**Derivative Regeneration**:
It must reproduce the exact recorded bytes; anything else is a Critical Integrity Incident.

**Evidence Ledger**:
The chronological administrator-facing record of Graphics Asset Library lifecycle and reconciliation decisions, whether a person or the system made them, naming actor, transition, reference count, bytes, quota state, deadline, outcome, and reason — never keys, digests, filenames, URLs, or secrets. Authoring metadata edits (rename, Event re-association) are not ledger material. An entry a person caused names their User as actor, by id (ADR-0010). Stream Keepr holds no Users, so each is named as the page is read: the reader's own id reads as the name their Identity Proof vouches for, or their email while the name is blank, and another User's as the name Keepr Accounts tells this reader, which it does of a User who shares an Organisation with them. No other User's email is shown. An anonymous-era actor is labelled as one, and every other actor reads as it was recorded: a machine actor, about which Keepr Accounts is never asked, and a User it did not name, whether no User has the id, they share no Organisation with the reader, their name is blank, or Keepr Accounts could not be asked. A reading is never refused for want of a name, and a name is kept no longer than five minutes. The Operations Cockpit and a queue inspection name a Graphics Ingestion Operation's initiator the same way (ADR-0141, ADR-0145).

**Evidence Terminal Cleanup**:
An entry's one-year retention counts from its subject's last one; until then it never expires.

**Evidence Sealing**:
Sealing and expiry write no Evidence of their own.

**Evidence Category Group**:
Groups overlap deliberately.

### Library operations

**Operations Cockpit**:
It composes Library Component Condition, Storage Health Alerts, capacity, unfinished ingestion, the discrepancy backlog, deadlines, and recent Evidence, holding no state of its own.

**Library Component Condition**:
The catalogue and the byte store are always judged separately.

**Graphics Ingestion Attention State**:
Expiry is decided first; terminal operations have none.

**Operational Queue**:
One queue per operational state — Critical Integrity Incident, Unavailable Graphic Asset Content, missing Graphics Derivative, retryable ingestion, expired staged input, unreleased staged input, Trashed Graphic Asset, superseded Graphic Asset Revision, quarantined object, Retired Graphic Asset — kept distinct because the valid action differs.

**Queue Inspector**:
Its selection lives in the address and every reading is composed afresh.

**Queue Action Outcome**:
Already-in-state means the subject already was how the action asks, never that it ran and fixed nothing.

### Graphics Composition Model

**Graphics Composition Model**:
The Graphic Item, geometry, styling, grouping, animation, definition, and rendering vocabulary used by both Broadcast Graphics and Feature Match Overlay, unifying their composition model without merging their Screen Modes, live context, or template artifacts. A graphics document carrying a former field, stored or in an exported Template Package, still reads, and the field is dropped: a former Graphic Style Set link, or the video-compatibility field of a Media Graphic Item or a media Graphic Input value. Every other unknown key is refused (ADR-0020, ADR-0049).

**Host Contract**:
The declaration a graphics Screen Mode supplies when embedding the shared compositor and the shared graphics editor: available context kinds, top-level host extras and canvas rules for the compositor; and for the editor, what its item tree holds, which document its edits write, and which edits are forbidden (no Graphics Authoring Lease, a placement in flight, a composition that may not be written now, such as a Broadcast Graphic on air, which undo and redo also leave as it is). Capability outside it stays host-owned. Undo steps back one verb at a time over the item tree alone, leaving a Broadcast Graphic's Graphic Channel and the Broadcast Graphics Background as they are. Several selected layers always sit in one composition, so align, group and paste act within one Broadcast Graphic, and a Graphic Group is never selected with its own child (ADR-0081).

**Graphic Item**:
Items are edited individually but never taken on or off air independently of their composition; an item whose live data is empty renders nothing while remaining on air.

**Graphic Item Definition**:
Definitions ship with Stream Keepr; templates never provide executable ones, and an import referencing an unsupported one fails atomically. A Definition may require a host or data context.

**Graphic Text Template**:
A Broadcast Graphic may also reference a Social Profile Projection as `{projectionKey.networkLabel}`, `{projectionKey.handle}`, or `{projectionKey.profileUrl}`. No other property access, formatting, fallbacks, conditionals, or expressions exist.

**Graphic Placeholder Style**:
Literal text uses the item's base typography.

**Graphic Font Selection**:
An application font always paints from the copy Stream Keepr ships, in every script its package covers, never from one installed on the rendering machine or fetched from a font host (ADR-0086).

**Text Overflow Policy**:
Text never visibly overflows. A live string can be longer than the author ever saw, which is why the Clock and Player Life carry one too; whether a kind has one is its Graphic Item Definition's to declare.

**Media Graphic Item**:
Video has playback-rate and looping controls and starts from the beginning when its Broadcast Graphic enters.

**Media Fit**:
One vocabulary shared by Media Graphic Items, image and video Background Layers, and the Feature Match Overlay Frame's image and video.

**Deck List Graphic Item**:
A feature-match-context Graphic Item rendering one Seat's Sideboard as cards or a text list within its bounds, with no framing, labels, or board choice of its own. An empty Sideboard renders nothing. An operator reveals or hides each Seat's Sideboard as Feature Match Session state; while it is hidden the item renders nothing and stays on air. The reveal never shows an item its author hid, and a host with no Feature Match context shows it revealed (ADR-0015).

**Commander Damage Graphic Item**:
A context-gated Graphic Item that renders the Commander Damage one Seat has taken: one count per opposing Commander, in Seat order, each beside the card of the Commander that dealt it and hidden while zero; with no count to show it renders nothing, its surface included. Commander Events only, and only a host supplying a Commander game's context is offered it (ADR-0087).

**Seat Indicator Graphic Item**:
It is how a Feature Match Layout marks whose turn it is and who is out. It is offered on every Variant and marks the active player on any Event that tracks one (ADR-0087).

**Shape Geometry**:
Rectangle, rule, slanted-edge, and corner-cut presets initialise the same geometry rather than distinct types. One corner editor edits it wherever it appears, and edits a Source Item's corner radii as rounded corners only.

**Graphic Group**:
Graphic Groups do not nest. A Graphic Item moved into or out of a group keeps where it is drawn, its geometry rebased between canvas and group space; a row or column group refuses a rotated item rather than straightening it. Grouping wraps two or more top-level Graphic Items in a canvas group that changes nothing drawn: it paints no surface, clips nothing, takes its frontmost member's place in the Graphic Layer Order, and takes its members out of their Broadcast Graphic's stagger. A selection holding a Source Item, a Graphic Group or a group's child, or more Graphic Items than a group holds, is refused with a reason. Ungrouping puts each child where its group drew it, a row or column child at the place and size it was laid out at, losing a rotation it never drew; each child keeps what it inherited, the group's hiding and, where it holds no surface of its own, the group's local style default and its Graphic Theme Binding, and the group's clipping, animation, stagger, surface and glow are dropped (ADR-0065).

**Graphic Surface Style**:
An independently styled edge is a separate Shape Graphic Item from the rule preset.

**Graphic Fill**:
Complex surfaces are Media Graphic Items. A gradient Background Layer holds the gradient form.

**Graphic Anchor Point**:
Stored geometry stays a top-left rectangle; it is not a responsive constraint or animation origin.

**Geometry Unit**:
It serves Graphic Items and Source Items alike and changes display and entry only.

**Editor Focus Mode**:
One setting serves both editors; it is entered and left only through the editor's own toggle, and never applies to the Broadcast Graphics Live workspace. It changes layout only. It keeps the mode's Screen Settings Groups and their Looks, so the Feature Match Overlay's Frame and Source Item rows show in the inspector of the layer each styles (ADR-0072).

**Graphic Rotation**:
Row and column items do not rotate; skew, perspective, and raw transforms are not exposed.

**Graphic Animation**:
Whole-graphic and item motion compose; there are no arbitrary keyframes.

**Graphic Resting State**:
Recipes move relative to it and never change it.

**Graphic Animation Preview**:
Deterministic editor-only playback of one lifecycle phase or a full lifecycle, optionally at varied speed or looping, of a Broadcast Graphic, a whole Feature Match Layout, or one Feature Match Layout Item alone with the rest of its layout at its Graphic Resting State; a Feature Match Overlay Frame keeps its Animation Effect throughout (ADR-0059). It never changes live Screen state, writes nothing, and has no playhead, scrubbing, or keyframes. An item alone starts at the run's start, free of its group's stagger, and a Graphic Group alone plays its children under its own; a Feature Match Layout never updates, so it has no update phase to play. It needs no Graphics Authoring Lease, so an observer may run it (ADR-0059).

### Feature Match Overlay

**Feature Match Layout**:
The Frame and Source Items are host-owned. It is portable so it can be saved as a Feature Match Layout Template.

**Feature Match Overlay Frame**:
Its fill, border, glow, Animation Effect and the media its Theme adds beneath its own are the Feature Match Overlay's Mode Tokens; the layout holds its opacity, its own image and video, and which edges its border runs along.

**Source Item**:
Its fill, border and glow are the Feature Match Overlay's Source Item surface Mode Token. It is not a Graphic Item and lives in the layout's own Source Item list.

**Layer Lock**:
An author's lock on one layer of a Feature Match Layout or a Broadcast Graphic, a Graphic Item or a Source Item, against canvas edits: the canvas neither moves, resizes nor rotates it, arrow nudges skip it, and a click on it falls through to the layer beneath; with several layers selected, the canvas moves only the unlocked ones. It stays selectable from the layer list and editable in its property panel, and every other edit still acts on it: delete, duplicate, hide, reorder, copy and paste, group and ungroup, align and distribute. Locking a Graphic Group locks its children; a child locked through its group cannot be unlocked on its own, and a locked child of an unlocked group still moves with its group. Ungrouping a locked Graphic Group locks each child, and grouping keeps each member's own lock, the new group starting unlocked (ADR-0063, ADR-0065). Locking or unlocking is a layout edit, one undo step made only by the Graphics Authoring Lease holder, so an observer sees locks but cannot change them. It is stored on the layer itself, so every operator of the Screen sees it and it travels with a Feature Match Layout Template or a Broadcast Graphic Template; a copy of a locked layer arrives unlocked (ADR-0063).

**Feature Match Layout Template**:
It carries no Feature Match Slot assignment, and placing one replaces the Screen's whole layout as an unlinked copy. A built-in one is marked as such, is placed like any other, and cannot be revised, removed or exported. A template naming a third or fourth Seat, or anything only a Commander Event holds, is a four-Seat template, offered to Commander Events alone; every other template is offered to every other Event. Its content decides which, and nothing declares it. Placing one that states an aspect ratio more than 0.05 from the Event Canvas's warns in its confirmation; only a built-in states one, 16:9. A built-in pins no Graphic Asset Revision, so it places on any installation and holds back no Graphic Asset's retirement (ADR-0080). One four-Seat built-in, Commander Table, ships, and a Screen's "Reset mode settings" writes the layout its Event is offered: Commander Table on a Commander Event, the default layout on every other (ADR-0087).

**Feature Match Layout Host Vocabulary**:
On a Commander Event a Seat's deck token names its Commanders, its colours token their colour identity, and an image token each Commander's card. On a One Piece Card Game Event a Seat's deck token names its Leader, its colours token the Leader's colours, and a Leader image token adds the Leader's card (ADR-0057). An Event is offered, and holds values for, the tokens of its kind: a Commander Event four Seats' with no record or Leader image, every other Event two Seats' with no Commander term (ADR-0087). Each is closed and pinned by the layout format version, so a package naming an unimplemented term is refused. The Frame's Animation Effect was one until it became a Mode Token; its identity is still recognised.

**Feature Match Sample Dataset**:
The One Piece Card Game set names each Seat's Leader, and a Commander Event has a set of its own, seating four. It never appears on a live Screen Output.

**Feature Match Stress Dataset**:
The Feature Match Overlay editor's preview resolves a Feature Match Layout against it while its author asks it to, over a bound Feature Match Slot's live data too (ADR-0062). Asking is editor state and is never saved. It never appears on a live Screen Output. It is offered with or without the Graphics Authoring Lease, no Program Monitor shows it, and a Theme preview offers none (ADR-0062).

## Relationships

### Event and Feature Match production

- An **Event** has exactly one **Card Game**, fixed at creation
- A One Piece Card Game **Deck List** has one **Leader** or none, a **Mainboard**, and no **Sideboard**; a breach of the deck rules (a 50-card Mainboard, four copies of a card, one Leader, the Leader's colours) is warned of and never refuses its save (ADR-0057)
- An **Event** contains **Players**, **Phases**, **Rounds**, **Matches**, **Feature Match Slots**, **Feature Match Assignments**, **Screens**, broadcast configuration, game-specific settings, and optional **Melee Sync** configuration
- **Players**, **Phases**, **Rounds**, **Matches**, **Feature Match Slots**, and **Deck Lists** carry **Provenance** when they originate from **Melee Sync**
- A **Phase** contains ordered **Rounds**; a **Round** contains zero or more **Matches** and **Feature Match Assignments**, and may have **Round Standings**
- **Melee Sync** never removes a manual **Round** or **Match**: an imported **Phase** or **Round** that leaves Melee.gg, or that a Melee data reset would remove, while holding one is kept as a manual one, its **Provenance** cleared, and the operator is told which; a kept **Round** loses its imported **Matches** and its **Round Standings**, a kept **Phase** keeps the format it was played in, so **Deck Lists** still match its Matches, and the structure sync announces each kept one as updated. A **Phase** or **Round** Melee.gg brings back after it was kept is imported as a new one beside it, never adopted (ADR-0040)
- **Live Results** polls only the **Current Round**, or probes the next **Round** once it is complete; a **Round**'s **Round Standings** are stored only once it is complete, on every **Melee Sync** path (ADR-0052)
- A **Match Result** comes only from **Melee Sync**; a manual **Match**, including one kept under ADR-0040, has none, and no Player's record, history, Head-to-Head or **Top Cut Bracket** reads one an operator entered (ADR-0047); a **Manual Bracket**'s results are not Match Results, and only its Screen reads them (ADR-0075)
- A **Feature Match Slot** belongs to exactly one **Event** and may reference at most one current **Match**
- A **Feature Match Assignment** connects exactly one **Match** to exactly one **Feature Match Slot** for exactly one **Round**, and may have one **Feature Match Note**
- Within one **Round**, a **Match** and a **Feature Match Slot** each have at most one **Feature Match Assignment**
- A **Feature Match Slot Promotion** creates or updates one **Feature Match Assignment**
- A **Feature Match Slot**'s Seat has at most one **Feature Match Deck List**; in a One Piece Card Game Event a Seat linked to a **Player** shows that Player's **Deck List** and **Leader** instead, and an unlinked Seat's Feature Match Deck List is its only Deck List, its **Leader** the Seat's Leader. Replacing either while a **Feature Match Session** is active updates that Session's source snapshot (ADR-0074). On a One Piece Card Game Event a linked Seat's **Deck List** and **Leader** are its Player's whatever a setup save sends: its setup edits that Player's Deck List as a Player write, and a paste to the Seat itself is refused (ADR-0057, ADR-0074)
- Every One Piece Card Game **Player**'s **Deck List** counts in the **Metagame**; a **Feature Match Deck List** never does (ADR-0074)
- A **Feature Match Session** belongs to exactly one **Feature Match Slot**; while active, the Slot's identity binding fields resolve from the session's source snapshot and its live binding fields from the session's current state
- Except on a Commander Event, while a **Feature Match Session** is active, it decides which player each Seat of its **Feature Match Slot** shows; the Slot's own Seats keep their pairing order (ADR-0058). Swapping two of a Commander Slot's Seats exchanges their players in the Slot itself, and its active Session follows (ADR-0087)
- On a Commander Event, Feature Match Controls show a **Feature Match Slot**'s **Seats** two by two, clockwise from the top left, and offer no Edit Match State dialog, Change First Player or Match reset; a **Screen**'s life permission covers **Commander Damage** and **Eliminated**, and its game win permission covers declaring the outcome and taking it back (ADR-0087)
- Deleting a **Player** leaves each **Feature Match Slot** Seat seating them with no Player: the Seat keeps the data it shows but none of that Player's Deck List reference, the Slot's active **Feature Match Session** is corrected to it, and the Slot is announced
- Deleting a **Match**, alone or as one Melee no longer lists, unlinks each **Feature Match Slot** showing it and deletes its **Feature Match Assignments**; both are announced

### Screens and outputs

- A **Screen** has exactly one current **Screen Mode**
- A **Screen** stores each **Screen Mode**'s configuration as a fragment, which every reader completes from the mode's defaults, so a changed default reaches every Screen that never set the field. A Screen write leaves a field it omits unchanged, and its `null` deletes the stored value, which then reads as the default; an **Authored Stack** takes no `null`, and a plain overlay mode's own **Background Layer** stack does (ADR-0037). Clearing an optional field in a Screen's settings sends that `null`, and the field reads as its default at once (ADR-0041)
- A display reset returns a **Screen Mode**'s configuration to its defaults, clearing a field whose default is unset, such as a custom header, and keeps its **Authored Stacks**, its own **Background Layer** stack, its **Event References**, a **Manual Bracket** among them, and a **Top Cut Bracket**'s choice of source (ADR-0037, ADR-0038, ADR-0041, ADR-0075)
- A client's edits of one **Screen** made at once never conflict with each other: each write is sent at the revision the one before it was answered with, while writes to different Screens run at once (ADR-0041)
- A Deck **Screen Mode** has exactly one **Deck Source**: either no Player or one Player from the Screen's **Event**, one **Broadcast Deck List** from that Event while Broadcast Deck Lists are enabled, or one Seat of a **Feature Match Slot** from that Event, followed live; a Screen write naming a **Broadcast Deck List** that cannot be selected is refused with 409 `SCREEN_DECK_SOURCE_CONFLICT`, and a **Deck Source** whose Player or Broadcast Deck List goes away during the write is not saved (ADR-0038)
- A selected **Broadcast Deck List** prevents deleting that list or disabling Broadcast Deck Lists; deleting the whole **Event** is the cascade exception
- Deleting a selected **Player**, alone or in a Melee data reset, clears every **Deck Source** naming them to no Player in the same write (ADR-0032), and empties each **Seed** of a **Manual Bracket** naming them, keeping every other Seed and every result (ADR-0075); each such **Screen**'s **Screen Output** follows it and stops reading the deleted Player (ADR-0032)
- Deleting a **Feature Match Slot**, alone or by lowering the Event's Slot count, clears every **Deck Source** showing a Seat of it to no Slot in the same write (ADR-0057), and sets every other **Event Reference** naming it to none (ADR-0060); each such **Screen** is announced, so its **Screen Output** shows its mode's no-Slot state
- A Metagame **Screen**'s cards view and a Most Played Cards **Screen** may each count one **Archetype**'s cards alone, naming it by an **Event Reference**: renaming the Archetype keeps the filter, and deleting it unsets the filter, so the Screen counts every Archetype's cards (ADR-0038, ADR-0060)
- While a Most Played Cards **Screen** ranks pointed cards, its card type filter keeps nonbasic lands in (ADR-0037)
- A Standings **Screen**'s range names positions, not a row count: every **Player** tied at its last position shows, and a Player with no position counts after every placed Player, so a range from the top shows rows before any **Round Standings** exist. Entering its reveal view starts the reveal from none (ADR-0037)
- **Broadcast Graphics Screen** and **Feature Match Overlay** each expose **Overlay Output**, **Fill Output**, and **Key Output** variants with identical canvas dimensions, all derived from one final composed frame
- A graphics **Screen Output** uses one stable Screen URL with an output selection; an omitted or invalid selection renders the **Overlay Output**
- At the same authoritative time, every graphics **Screen Output** resolves the same composition and animation phase; a late-loading or reconnected one catches up rather than replaying
- The **Feature Match Overlay**'s Sideboard reveal and **Seat Indicator Graphic Items** are the host-local exception: each output plays a **Deck List Graphic Item**'s authored enter or exit when its side's Sideboard reveal flag changes, and a Seat Indicator Graphic Item's when its Seat enters or leaves the state it marks, on its own clock from when it observes the change, so outputs agree within realtime skew rather than at one authoritative time. First load and reload render the settled frame; an output that was disconnected across the change plays the motion late on **Reconnect Resync** rather than catching up (ADR-0015, ADR-0087)
- Application-level output alignment does not promise hardware genlock between browser windows or capture devices
- A **Screen Output** renders its **Event Canvas** scaled uniformly to fit its window, letterboxed, whenever its **Screen Mode Definition** registers viewport-fit scaling
- Every realtime-fed surface re-reads authoritative state on **Reconnect Resync**; a reconnected **Screen Output** renders the current **Screen Mode** without waiting for the next change
- A **Screen Output** whose realtime link is disconnected holds its last accepted rendering rather than blanking
- A page hears realtime on one socket for the **Event** it is on, kept while it is on that Event though for a moment it asks nothing there. A page holding a **Screen Output Asset Capability** asks for a **Realtime Ticket** with it for each socket, and never to be let in as the **Session** its browser holds; any other page opens its socket as its Session (ADR-0143)
- A client with no realtime connection retries with no attempt limit, at least every 30 s, and reports the fault where an operator can see it once it has had none for 8 s (ADR-0137)
- A client refused on the **Event** its page is on reports it where an operator can see it as soon as the refusal is heard, with no retries first, and keeps asking, at least every 30 s with no attempt limit. A **Realtime Ticket** refused 401 or 403 is a refusal; any other failure to get one is a failed attempt. A refused socket's fault stands until the client is let in or the page leaves that Event, whatever it disposes. A refused channel is asked again on the next socket, never on a timer, and its fault ends then, or once the last thing asked of the channel is disposed (ADR-0143)
- A **Realtime Subscription** outlives any refusal or transport failure until its consumer disposes it; once its Event's socket is let in again, the original handler receives again — and a held presence entry enters — without a remount (ADR-0023)
- Only a **Screen Output** enters its **Screen**'s presence and answers its **Screen**'s commands; a **Program Monitor** or preview joins neither, so every count of what is watching a **Screen** counts outputs alone; a **Screen Output** renders without waiting on its presence entry, which, with its commands, follows once realtime can carry them (ADR-0023)
- Every **Screen** command is safe to hear twice: it says what an output is to do, and none turns over what the output last did. The server makes a publish that failed once more, and cannot tell a failed call from one whose answer was lost, so a command already delivered can arrive again (ADR-0143)
- A **Screen Output** or **Program Monitor** hears only its **Screen**'s own channel and nothing of its Event's, which a Screen Output's **Realtime Ticket** would not let it hear; a preview, which renders configuration not yet saved, stays in its Event's room (ADR-0143)
- A **Screen Output**'s presence entry reports the realtime protocol it follows; one reporting none was loaded before outputs followed their **Screen**'s channel, and a control surface says so until it is reloaded
- A **Screen Output** carries its **Screen Output Asset Capability** in its URL; every surface handing an operator such a URL obtains one at that moment or hands out nothing
- A **Screen Output** holding no capability renders nothing at all (ADR-0010)
- A **Screen Output**, **Program Monitor** or preview reads everything it renders through its **Screen**, whatever credential it holds, never through an operator's Event reads, and changes no live state by reading it, except that a **Broadcast Graphics Live Session** read opens the Screen's Live Session, unannounced and with nothing on air, when it has none (ADR-0022)
- A **Screen Output** on program follows its **Screen** by identity, so renaming the Screen's slug leaves it showing that Screen. A **Screen Output** or **Program Monitor** never leaves its page on its own: it goes blank where it stands when its **Screen** is deleted, and holds what it shows when its **Event** is deleted (ADR-0022)
- A **Screen Output** whose Event context read fails says the Event's details are unavailable, never that its **Screen** was not found, and retries every 15 s until it loads; a failed re-read of the Event context is retried the same way (ADR-0022)
- A preview needs no capability: it is admitted by its operator's **Session** and resolves media as its author (ADR-0010). A **Program Monitor** resolves media through a capability, as a **Screen Output** does, and without one shows nothing and states that it is unavailable
- **Screen Outputs** and authoring run on Chromium, the only engine transparent video is supported on; another browser may flatten its alpha, and nothing detects or refuses it (ADR-0020)
- **Broadcast Graphics Screen** and **Feature Match Overlay** previews are one preview shell: output selection, zoom and pan, item selection (a ⌘-click adds an item or takes it out), canvas handles for what the editor may move, guides that skip a locked layer, and advisory action-safe (5%) and title-safe (10%) guides; guides never appear in live **Screen Outputs** and never clip items. Zoom and pan are view state: they never write, need no **Graphics Authoring Lease**, and start at Fit on every visit

### Theming

- An **Event** uses exactly one **Theme**; an Event that chose none uses the **Default Theme**, which ships with Stream Keepr and cannot be edited or deleted
- A **Theme** in use by any **Event** cannot be deleted, and the refusal names those Events
- A **Theme** stores only the **Foundation Tokens** it sets; every other token reads its shipped default. A write naming a **Mode Token** is accepted and the token dropped, and one stored before is read by nothing
- A value a **Theme** or a **Screen Theme Override** stores for a **Theme Token** never names another token: it is a literal, and so is every colour inside a fill, a surface or a background colour layer
- Only a shipped default names a token: a **Mode Token**'s default may name a **Foundation Token** of its type, a motion one may follow a motion **Foundation Token**'s timing with its own movement, and a colour inside a composite default may name a colour **Foundation Token**; nothing names a **Mode Token**, and a colour's default names nothing
- A stored value that names a token, written before values were literals, still reads as the literal it resolves to, and the next edit of its token stores that literal
- A **Screen** resolves a **Mode Token** from its own **Screen Theme Override**, else the token's default, and a **Foundation Token** from its **Event**'s **Theme**, else the token's default; only a plain overlay mode's `inset` and `alignment` read the Screen's own **Screen Theme Override** first
- A **Screen Theme Override** of another mode's **Mode Token** is kept while the **Screen** shows a different **Screen Mode**, and applies again on its return
- A **Graphic Item** property either names a whole **Foundation Token** of its type or holds its own value; detaching copies the token's resolved value in
- A typography **Theme Token** carries no size; the consuming **Graphic Item** or **Screen Mode** display owns it
- A colour **Theme Token** may be translucent; a consumer's own opacity multiplies it
- A **Graphic Asset** a **Theme** or **Screen Theme Override** references cannot be retired or trashed, and the refusal names its referrers
- A **Broadcast Graphic Template** or **Feature Match Layout Template** carries **Graphic Item** token names, never a **Theme**, and renders under whichever Theme it is placed in; its editor previews under a Theme its author picks
- A **Theme** edit reaches every **Screen Output** of every **Event** using it at once
- Feature Match Controls consumes no **Theme Token**: it is an operator surface
- The `inset` is one value on every side; the Background Screen and the graphics hosts render edge to edge and consume neither `inset` nor `alignment` (ADR-0051)

### Access

- A **Graphics Ingestion Operation** is owned by the **User** who initiated it; its UUID is a name, not a right, and another user is told it does not exist
- A **Graphics Ingestion Operation** outlives the **Session** it started in: its owner resumes it by signing in from any browser, and the same idempotency key from a second browser continues it (ADR-0010)
- A graphics **Screen** Edit workspace or reusable graphics Template has at most one **Graphics Authoring Lease**, and a lease never restricts **Live Control**
- A page hears realtime only on a socket of its **Event**'s object, and nothing reads a channel's history (ADR-0137, ADR-0143)
- A realtime socket is `/realtime/socket?eventId=<id>`, one per **Event**, and is let in only as a **Session** or as a **Screen Output**; a socket that presents a `ticket` is judged by it alone, whatever **Session** its browser holds (ADR-0137, ADR-0142)
- A **Session**'s socket is let in when it was not opened by another origin's page, its **User** has App access, and the Event exists. It may hear its Event's channel and every channel of the Event's **Screens**, and may enter the presence of those Screens' channels and no other; it is named `user:<User id>`
- A **Screen Output**'s socket is let in for a **Realtime Ticket** that is unexpired, unspent, given for this Event, and whose capability is still its **Screen**'s. It may hear and enter its own Screen's channel and nothing else, its Event's channel included; it is named `screen-output:<Screen id>`, and also carries the version of the capability that let it in, which is how regenerating the capability closes the former's sockets and spares its own
- Deleting a **Screen** closes at once every realtime socket its outputs hold, once the Screen is gone, and each watcher of its presence is told they left; other Screens' sockets, and Sessions', are untouched. Where the sockets cannot be closed, the delete stands, the attempt is made twice, and the server's log then names the Screen under `screen_output_disconnect_failed`: those outputs stay connected until they drop, and cannot return (ADR-0144)
- Every other socket is refused the same way: accepted, then closed with `CLOSE_REFUSED` (4403), which a page can read and which says nothing of why. What a socket may hear and enter is held by the Event's object: asking for a channel outside it is answered `refused`, and changes nothing
- A socket whose caller could not be judged, because Keepr Accounts or the database did not answer, is neither let in nor refused: the upgrade fails with the server's own 5xx, and a page tries again
- Everything under `/api/public/` is outside the **Session** boundary over `/api/**`, so a route belongs there only if anyone on the internet may read what it answers. Each such read answers with `access-control-allow-origin: *` and `cache-control: no-store`, and with 404 for an unknown **Event** (ADR-0055)
- `GET /api/public/events/:id/on-air` answers the Event's id, name and holding text and its commentator 1 and 2 **Talents** that are set, in slot order; `GET /api/public/events/:id/commentators` and `GET /api/public/events/:id/holding-text` answer the same facts for a vMix JSON Data Source, each a one-element array of one flat row, an unset value an empty string (ADR-0055)
- `GET /api/public/events/:id/feature-match-slots/:slotId` answers a one-element array of one row of strings: every Feature Match token the **Feature Match Overlay** resolves for the Event's kind, with the value the Overlay shows, then `clock` and each Seat's live state; a **Feature Match Slot** not of the Event is a 404. Its `clock` is the **Feature Match Session Clock**'s **Clock Projection** at the read, as the Overlay shows it: an **Untimed Match**'s Untimed Label, empty while blank, and `0:00` with no **Feature Match Session**, which the read does not open (ADR-0056)
- On a Two-Player Magic: The Gathering or One Piece Card Game Event the public Feature Match Slot row holds each Seat's life and game wins, and `player{N}Game1Win` and `player{N}Game2Win`, `#FFFFFFFF` once that game is won and `#00000000` before. On a Commander Event it holds four Seats, each with its **Commanders**' images and no record or game win, and `player{N}Life` and `player{N}Eliminated`, `#FFFFFFFF` while **Eliminated** and `#00000000` otherwise; it names the same fields however many Seats are filled, an empty Seat's tokens and life empty and the Seat never Eliminated (ADR-0056)

### Broadcast Graphics composition

- A **Broadcast Graphics Screen** has at most one active **Broadcast Graphics Live Session** and renders an ordered stack of zero or more **Broadcast Graphics**
- A **Broadcast Graphics Screen** composes in its **Event**'s **Event Canvas**; every **Broadcast Graphic** on it is authored in that coordinate space, and fitting to another viewport scales uniformly without reflow
- A **Broadcast Graphics Screen** has a transparent host and ignores the Screen inset and alignment Foundation Tokens
- Concurrent **Broadcast Graphics** composite once into one transparent frame in authored Screen stack order; Take timing and **Graphic Channel** membership never change that order
- An empty **Broadcast Graphics Screen** is transparent in its **Overlay Output** and black in its **Fill Output** and **Key Output**
- A **Broadcast Graphic Template** initializes a copy of a **Broadcast Graphic** on a **Broadcast Graphics Screen**
- A **Broadcast Graphic** contains one or more **Graphic Items**, at most 100 at its top level, and a **Broadcast Graphics Screen** at most 300 in all, **Graphic Group** children included; a Screen configuration over its byte budget is refused at the write even within every cap (ADR-0007, ADR-0064)
- A **Broadcast Graphic** that is on a program output, or may be while playout cannot be known, is not edited in the Edit workspace, nor reordered among the others that are, and the server refuses the same write from any client; undo leaves it as it is, its **Graphic Channel** stays writable, and **Live Control** still acts on it (ADR-0081)

### Graphics Composition Model

- A **Broadcast Graphic** and a **Feature Match Layout** use the **Graphics Composition Model**
- Every **Graphic Item** is interpreted by one application-owned **Graphic Item Definition**
- The shared base **Graphic Item** kinds are **Text Graphic Item**, **Media Graphic Item**, **Shape Graphic Item**, and **Graphic Group**
- A **Graphic Group** may contain any context-available **Graphic Item** except another **Graphic Group**, and at most 50 (ADR-0065)
- A **Shape Graphic Item** renders one **Shape Geometry**; a **Media Graphic Item** or **Graphic Group** may use one as its clipping boundary
- A **Text Graphic Item**, **Shape Graphic Item**, **Graphic Group**, **Clock Graphic Item**, **Player Life Graphic Item**, **Game Wins Graphic Item**, **Commander Damage Graphic Item**, or **Seat Indicator Graphic Item** may have one **Graphic Surface Style** of its own, which may have one **Graphic Fill**; a **Game Wins Graphic Item** has two more, for an unwon and a won win box. Which surfaces and which **Shape Geometry** a kind has, and whether it reads a Seat, are its **Graphic Item Definition**'s to declare
- A **Broadcast Graphic** and each **Graphic Group** own the **Graphic Layer Order** of their direct Graphic Items
- Every top-level **Graphic Item** and canvas-positioned **Graphic Group** child has one **Graphic Anchor Point**, and may have one **Graphic Rotation**
- A **Text Graphic Item** may render a **Graphic Text Template**, may define one **Graphic Placeholder Style** per referenced **Graphic Input**, and has one **Text Overflow Policy**; a **Clock Graphic Item** and a **Player Life Graphic Item** each have one too
- **Media Graphic Item** playback is independent of **Graphic Animation**
- Copied layers and a copied **Graphic Item** style are kept in this browser, never on the system clipboard, and paste on any **Screen** of any **Event** in it; copying writes nothing, so an observer may copy, and pasting needs the **Graphics Authoring Lease** (ADR-0064)
- Layers and styles paste only within their host, **Feature Match Layout** to Feature Match Layout and **Broadcast Graphic** to Broadcast Graphic, and the other host refuses with a reason; a **Graphic Item** reading a **Social Profile Projection** pastes only into that projection's **Social Profile Presentation Group** (ADR-0064)
- A paste lands whole or not at all: it is refused, naming the **Graphic Items**, when one pins a **Graphic Asset** that is retired, trashed or missing or has **Unavailable Graphic Asset Content**, and refused whole when it would pass a Graphic Item cap (ADR-0064)
- Pasted layers land in front, offset from where they were copied, each with a fresh identity and unlocked, a **Graphic Group** with its children, keeping its name unless the destination already holds one by it; with a Graphic Group or one of its children selected, pasted non-group Graphic Items land in that group (ADR-0064)
- A style pastes every style group between **Graphic Items** of one **Graphic Item Definition** (typography, each **Graphic Surface Style**, **Shape Geometry**), only the Graphic Surface Style between two kinds that both paint a surface, and is refused otherwise (ADR-0064)
- A pasted layer keeps its **Graphic Theme Bindings**, painting each bound group from the destination Screen's resolved **Theme**; a pasted style binds the target to the same **Foundation Token** where the source was bound, and otherwise pastes the literal and detaches the target (ADR-0064)

### Graphic Animation

- A **Broadcast Graphic** and its **Graphic Items** may each own an optional **Graphic Animation**, which compose; a **Graphic Animation** owns at most one **Graphic Animation Recipe** per lifecycle phase
- A newly authored **Broadcast Graphic** or **Graphic Item** has no recipes until its author enables them; a missing recipe or a **Cut** completes the corresponding phase immediately
- Graphic Animation presets are authoring shortcuts that initialise editable recipes, not runtime concepts
- Every recipe operates relative to its owner's **Graphic Resting State**
- A scale channel uses one **Graphic Animation Origin** and a uniform factor from zero to twice the resting size
- A slide channel uses one of eight compass directions and a fixed distance (any **Geometry Unit**, measured against its owner's parent: width for east/west, height for north/south, the shorter side for a diagonal; stored in pixels) or the distance needed to clear its owner's parent. A Graphic Animation Recipe held by a **Foundation Token** has no owner, so its fixed distance is entered in pixels
- A reveal channel wipes from one edge across its owner's rectangular bounds, preserving existing **Shape Geometry** clipping
- A fade channel reduces opacity from the resting value; fades on a **Broadcast Graphic** and its items compose multiplicatively
- Easing is linear, ease-in, ease-out, ease-in-out, back-in, back-out, or back-in-out; rotation, skew, perspective, filters, morphing, motion paths, and arbitrary transforms are outside **Graphic Animation**
- A recipe lasts 50 ms to 10 s and may be delayed or staggered by up to 10 s; recipes in one phase measure delay from one shared phase start
- A **Broadcast Graphic** or **Graphic Group** may stagger a selected subset of its direct items in list or reverse-list order, adding each item's offset to its own delay
- A finite phase completes after its latest delayed or staggered recipe completes; an indefinite on-screen recipe does not prevent on-air
- Every output and **Live Control** projects a phase from one authoritative effective start time, except the **Feature Match Overlay**'s host-local Sideboard reveal and **Seat Indicator Graphic Items**; output acknowledgements never gate completion
- An on-screen recipe begins after enter completes, cycles from the resting state to an excursion and back without accumulating, and runs once, a fixed 1–100 times, or until exit, with an optional pause of up to 60 s
- A **Graphic Item**'s update recipe runs only when its rendered content changes; a **Broadcast Graphic**'s runs when any of its content changes
- An update recipe cross-transitions old and new renderings: a slide moves old out and new in the same direction; a reveal moves one boundary with new content behind it
- An update interrupts an active on-screen recipe, which then restarts; exit interrupts enter, update, or on-screen motion and continues from the rendered state
- A **Broadcast Graphic** may be in more than one phase at once (at most one update or on-screen alongside at most one enter or exit), and every **Screen Output** and **Live Control** projects the same set (ADR-0002)
- An exit composes over the motion it interrupted; concurrent fades multiply, slides add, scales apply in turn, and reveals intersect; a Take reversing an exit keeps any update or on-screen motion running beneath it, so neither snaps to its **Graphic Resting State** (ADR-0002)

### Playout

- A **Broadcast Graphics Screen** accepts playout actions in one authoritative order, and every **Live Control** and output converges on it
- Take and Out express the latest desired on-air state rather than queued events; the last accepted conflicting intent wins and repeated or duplicate actions have no further effect
- Take, Out, Cut Take, and Cut Out apply to the latest accepted **Graphic Playout State**; Out during enter and Take during exit reverse smoothly from the rendered state
- **Cut** modifies Take, Update Graphic, or Out and is not a standalone action
- Every placed **Broadcast Graphic** has one **Graphic Playout State** and may belong to one **Graphic Channel**
- A **Graphic Channel** has one **Graphic Channel Handoff Policy**, defaulting to Overlap
- Taking a **Broadcast Graphic** replaces the on-air graphic in the same **Graphic Channel**; a channel retains only its latest selection and never queues Takes
- Overlap begins the outgoing exit and incoming enter at the same logical instant; under Overlap a new Take reverses the current incoming graphic into exit and cuts off any older outgoing one
- Out then in begins the incoming enter at the outgoing exit's scheduled completion; a new Take replaces any waiting incoming graphic while the outgoing one finishes
- Overlap and **Cut** skip the waiting state; a cut channel replacement switches immediately without overlap
- A waiting **Broadcast Graphic** is absent from every output, enters with the values its Take accepted however long it waits, and is cancelled by Out

### Graphic Inputs and updates

- A **Broadcast Graphic Template** declares zero or more **Graphic Inputs**; copying it onto a Screen copies each declared default as the initial manual value and creates independently editable **Graphic Source Selections** and **Graphic Input Bindings**
- A **Graphic Source Selection** selects the current **Event** or exactly one **Player**, **Talent**, **Phase**, **Round**, **Match**, **Feature Match Slot**, or **Archetype**
- A directly selected **Player** follows current **Event Data**; a **Player** derived from a **Match** or **Feature Match Slot** resolves from that production snapshot
- A **Graphic Input Binding** maps one **Graphic Input** to one field on a **Graphic Source Selection**; several bindings may share one selection
- The binding field catalog separates stable common fields from game-specific ones, and may expose atomic typed fields and named broadcast-formatted fields; a field naming the Commander **Variant** is offered to Commander Events alone (ADR-0087)
- A **Graphic Input Binding** may read discrete live scalar state from a **Feature Match Slot**; ticking clocks and collections need specialised **Graphic Items**
- A value violating its declared type or constraints is unavailable rather than coerced; an unavailable binding never falls back to the template default
- A choice input's default is one of its options or none; a media input declares which media it accepts, which bounds both its default and **Live Control**'s picker
- Each operator-selected **Graphic Source Selection** generates one picker and each **Graphic Input** one field in **Live Control**, which distinguishes latest bound, working, and accepted on-air values
- Relevant **Realtime Event Session** changes re-resolve affected bindings; the **On-air Update Policy** decides when they go on air
- Each **Graphic Input** has an **On-air Update Policy** of staged (the default) or live; live applies immediately only while its graphic is on a program output
- A required unavailable **Graphic Input** prevents taking an off-air graphic; if one becomes unavailable on air, its last accepted value stays until updated or overridden
- Update Graphic atomically accepts every pending staged value for one **Broadcast Graphic**, is available only while entering, on-air, or updating, and is refused as stale when another operator already accepted a newer set
- Editing while off, waiting, or exiting changes the working values the next Take accepts; accepted changes do not animate while off air or exiting
- Accepted changes during enter coalesce into one update after enter; changes during an update replace the single pending rendering, never queue
- One atomically accepted set of on-air changes starts one update phase; interrupting an update never rolls back its accepted values
- Exit discards a pending visual update but keeps its accepted values, holding the rendering the interrupted update was travelling towards until it leaves
- Cutting Update Graphic accepts every pending staged value and shows the new rendering immediately; during enter it swaps the rendering at its current animated state and preserves the enter schedule

### Graphics Asset Library

- A **Graphic Asset** belongs to the installation-wide **Graphics Asset Library**, never to an **Event**, and has one stable identity distinct from its **Graphic Asset Content**
- Any byte change creates different **Graphic Asset Content**; several **Graphic Assets** may share content without sharing identity, name, metadata, or **Graphic Asset Origin**
- A **Graphic Asset** has one or more ordered **Graphic Asset Revisions**, each referencing exactly one **Graphic Asset Content**
- Replacing a file creates a new revision; replacing with current content is a no-op, while returning to older content creates a new revision over the existing content
- Every persisted graphics reference pins one asset identity and exact revision, never a filename, URL, object key, or hash; selecting an asset pins its latest revision and later revisions need explicit adoption
- **Graphic Asset References** — not Event associations, origins, deliveries, or **Graphics Derivatives** — determine which revisions are in use; a superseded revision stays resolvable while pinned
- Creating, changing, publishing, or transferring a reference requires its exact revision to resolve
- A **Missing Graphic Asset Reference** stays persisted and diagnosable until repaired, invalidating its owning artifact
- **Unavailable Graphic Asset Content** fails only operations that currently need its bytes
- A **Graphic Asset** may be associated with or referenced from several **Events** and by templates, Themes, Screens, and placed graphics without per-Event copies; associations organise discovery only
- Deleting an **Event** removes its associations and references but never deletes or hides shared **Graphic Assets**
- Graphics authors may discover and reference every **Graphic Asset**; a **Screen Output** may resolve only those its **Screen** publishes
- A **Broadcast Graphics Screen** publishes the revisions its configuration pins plus the media values its **Broadcast Graphics Live Session** has accepted; a value no longer accepted stops being published as it leaves air
- Every **Graphic Asset Revision** passes **Graphic Asset Validation** under one **Graphic Asset Compatibility Profile** before it is referenceable
- Every upload, approved remote copy, file replacement, and Template Package installation runs as one durable, idempotent **Graphics Ingestion Operation** with reconnectable progress, one compatibility report, cancellation before publication, and retry from checkpoints
- Staged bytes and provisional assets or templates are visible only through their operation
- Approved remote ingestion copies exact bytes once from a public HTTPS source and never creates a hotlink or remote dependency
- An ordinary ingestion exactly matching existing content defaults to reusing that **Graphic Asset** without overwriting its metadata, while allowing an explicit separate asset
- A **Graphics Derivative** belongs to exactly one source revision, is reclaimed with it, and never keeps its content reachable on its own
- **Graphic Asset Content** stays reachable while any retained revision or derivative points at it, and enters **Content Quarantine** only once that disappears
- An unexpected canonical object enters **Content Quarantine** for the same recheck and is never adopted as an asset
- A revision's retention deadline is established and recorded at supersession, not when a sweep first sees it
- A **Graphic Asset Tombstone** outlives the **Evidence Ledger** entries about its purge and satisfies no reference

### Evidence and reconciliation

- Every automated **Graphics Retention Sweep** decision, **Early Purge**, and **Graphic Asset** lifecycle transition records one **Evidence Ledger** entry; a transition never fails for want of Evidence
- A disagreement a reader observes opens one **Graphics Discrepancy** and one Evidence entry however often it is read; high-volume delivery observations stay in logs and metrics
- **Graphics Reconciliation** is the only writer of the catalogue's **Unavailable Graphic Asset Content** state, and every reader observing a contradiction feeds it; a report never changes or fails its read, and a **Screen Output**'s read answers before its report, a report it cannot make being left for the scheduled pass to observe again (ADR-0073)
- Readers and **Graphics Reconciliation** share one definition of agreement, so content failing closed is never still served
- A **Graphics Discrepancy** never changes the asset, revision, or reference it affects
- A **Critical Integrity Incident** blocks clearing **Unavailable Graphic Asset Content** for the same content while open
- The **Operations Cockpit** states catalogue condition separately from byte-store condition, offers only actions that cannot shorten a recovery guarantee, and still answers when the catalogue cannot
- **Operational Queues** are ordered most severe first, then by deadline; each samples independently so no backlog hides another queue's work
- A **Queue Inspector** resolves its subject by identity rather than from a sample, and the library re-proves an action's validity before writing
- **Exact-Byte Repair** is offered only for **Unavailable Graphic Asset Content** and **Derivative Regeneration** only for a missing derivative; a quarantined object offers no writing action
- A recheck that leaves a **Graphics Discrepancy** open reports retryable-unavailable, not already-in-state
- An **Early Purge** from a **Queue Inspector** requires typed confirmation as well as the fresh all-revision reference proof

### Template Packages and template writes

- A Template Package contains only the **Graphic Assets** its single template transitively requires, and its import revalidates their bytes under the receiver's current **Graphic Asset Compatibility Profile**
- **Template Package Preflight** rejects unsafe or traversing paths, links, colliding or duplicate paths, encrypted or compressed entries, nested archives, undeclared or missing entries, inconsistent sizes, envelope-limit violations, and schemas newer than the installation reads
- A **Template Package Preflight Report** reports every blocking problem together
- A **Template Package Installation** applies only the **Template Package Mapping Proposals** of the fingerprint its author confirmed, installing exactly one **Installed Graphics Template** with every packaged identity mapped to one exact local revision
- Two packaged identities claiming one source identity and revision reject the complete package
- A proposal reusing a **Retired Graphic Asset** or **Trashed Graphic Asset** is reported before confirmation and stays retryable, since neither takes new references until restored
- A later locally created revision never inherits **Graphic Asset Origin** from an imported one
- An **Installed Graphics Template** owns one ordinary **Graphic Asset Reference** per asset field, so a pinned asset cannot be retired or enter Trash until the Template is removed
- Removing an **Installed Graphics Template** releases its references in the same write and leaves placed copies untouched; retrying its **Template Package Installation** reinstalls it while every revision it pins is on an active **Graphic Asset** (ADR-0068)
- Every write of a **Broadcast Graphic Template** or **Feature Match Layout Template** requires each **Graphic Asset Reference** it holds to name an available revision of an active **Graphic Asset** whose kind fits its slot, including references it already held; a refused write names each failing reference and why: it does not exist, its content is unavailable, its asset is retired or trashed, or its kind does not fit (ADR-0034)
- A **Graphic Asset** cannot be retired while any **Broadcast Graphic Template**, **Feature Match Layout Template**, **Installed Graphics Template**, **Theme**, **Screen Theme Override** or **Talent** references any of its revisions, and the refusal names them, a Talent with its Event; a **Screen**'s own mode reference does not hold it back; a template write and a Retire of an asset it references never both land, whichever commits first holding back or refusing the other (ADR-0034, ADR-0050, ADR-0067, ADR-0068)
- A **Template Package Installation** run inside an **Event** associates every asset it created or reused with that Event without changing reused assets' metadata
- A failed or cancelled installation leaves nothing discoverable

### Feature Match Overlay

- A **Feature Match Overlay** renders exactly one **Feature Match Layout** for exactly one **Feature Match Slot**
- A **Feature Match Layout** has exactly one **Feature Match Overlay Frame** and one or more **Graphic Items**, at most 100 in all, **Graphic Group** children included (ADR-0007)
- A **Source Item** may cut through the **Feature Match Overlay Frame**
- An empty **Seat**'s **Source Item** and the **Graphic Items** reading it render nothing
- A **Feature Match Layout Template** stores a reusable **Feature Match Layout**; a built-in one ships with the application and is stored nowhere
- Placing a four-Seat **Feature Match Layout Template** on an **Event** it is not offered to is refused, as is any Screen write giving a four-Seat **Feature Match Layout** to a **Screen** of any Event but a Commander Event, asked only of a layout the write changes; a Commander Event's Screen may hold a two-Seat layout, and saving to the library is never refused, the library saying when this Event does not list what was saved (ADR-0087)
- A **Feature Match Layout** declares its **Feature Match Layout Host Vocabulary** to a **Template Package** and never carries an Event identity
