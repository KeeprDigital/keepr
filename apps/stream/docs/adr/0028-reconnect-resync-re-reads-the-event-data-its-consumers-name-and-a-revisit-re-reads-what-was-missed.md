# ADR-0028: Reconnect Resync re-reads the Event Data its consumers name, and a revisit re-reads what was missed

Accepted · 2026-10-20 · [#610](https://github.com/KeeprDigital/stream-keepr/issues/610)

### Decision

**A consumer names the Event Data it reads, and Reconnect Resync re-reads exactly that.** Event Data Resync (`app/modules/event-data/resync.ts`) counts consumers per dataset: the Event, Players, Phases, Rounds, Matches, Feature Match Slots, Archetypes, Player Lists, Player Decks, Screens, and the selected Screen's Card. A page consumes each `useEventPageLoading` entry while it is mounted, and names what it loads outside them. The default layout consumes the Event and Screens, and Live Control consumes the Event Data it resolves Graphic Input Bindings from. The Realtime Event Session runs the resync beside the Feature Match Assignment and Broadcast Deck List reloads. It does so once the Event channel is attached again having lost continuity (#641), and when its subscriptions stop waiting on a token (ADR-0023). A token wait missed what was published meanwhile too, and a first attach over an unbroken connection reports no continuity loss. Each dataset is re-read once, however many consumers share it, in place and only if its store already holds it. Its scope is kept: a Round's Matches stay a Round's Matches. A re-read that fails or does not land leaves its dataset behind.

**What nobody consumed at the resync is behind.** A store outlives the page that loaded it, and `useEventPageLoading` skips a loaded store. So the next consumer to name a behind dataset re-reads it instead of trusting it. `resetAllEventStores()` forgets what is behind, because the reset ends the Event Lifetime and nothing it held survives.

**The Card Spotlight mode reads through Screen Mode Data Freshness.** The Card store still follows the Card's own messages, which reach a Screen Output or Program Monitor on its Screen's channel while the Screen is in that mode. The module re-reads it on reconnection, and on the slow cadence while realtime is degraded. Only a change of Screen deselects the old one. A re-read leaves the Card on air until it answers.

### Why

The Realtime Event Session re-read only Assignments and Broadcast Deck Lists on reconnect. An Event Data collection already held stayed as it was when the socket dropped, and so did a Card on program. The Card Spotlight mode loaded on mount and on a Screen change only, so a Card changed or cleared during the outage stayed on air. Live Control computed latest bound values from stale stores. Re-reading only what is consumed keeps a resync's cost to what is on screen.

### Consequences

- An operator's resync re-reads every consumed collection at once. That is a burst of list reads per open page, once per reconnection.
- Each Event Reference picker of a mode's Settings panel consumes the Event Data it loads (ADR-0038), and the panel consumes what it reads itself. A store loaded by a component that does not consume it is not re-read on reconnect. It is behind, and its next consumer re-reads it.
- A consumer that also reads what no store holds passes its own re-read, which runs on every resync until the consumer is disposed. The metagame pages pass their summary and section fetch. That re-read is never behind, since it dies with its page. A metagame page can fetch twice on one resync, once for its own re-read and once more when the Player re-read bumps the roster version.
- A Feature Match Slot re-read offers its Session to the Live State Follower, which holds it when it is newer. So a Session missed in the outage reaches Live Control's bound values through the Slots.
- The Card Spotlight mode, through Screen Mode Data Freshness, also re-reads on the degraded cadence while disconnected.
- A Card read answers whether it landed. A read of no Card has landed. A failed read has not, so the operator's stays behind and a Screen Output's is retried on the slow cadence. A read something newer superseded has not either, as a superseded collection load has not; the newer state is already held (#726). Nor has a read answering a Card Revision older than the one held (ADR-0042).
- The Feature Match and Feature Match Overlay modes read their Slot through Screen Mode Data Freshness as well (#592). Their Reconnect Resync re-reads the whole Slot through the Screen and offers its Session to the Live State Follower, rather than reloading the Session alone. So a promotion missed in the outage is found as well as a score. A gap in the Session's notifications still reloads through the follower's load, by the same Screen read. On a Screen Output or Program Monitor the Session's notifications are the ones its Screen's channel forwards, at the Event's sequence numbers, and its resync runs off that channel; a Slot change reaches it as a cause and re-reads the Slot the same way.

### Rejected alternatives

- **Re-read every loaded store on reconnect.** It is simpler, but it pays for data no mounted surface shows. It also cannot tell a consumed dataset from one that is just held.
- **Have `useEventPageLoading` always reload on mount.** That fixes a revisit, but every page navigation would re-read lists that live-follow already keeps current.
