# ADR-0145: An App asks Keepr Accounts what to call another User, and is told of those who share an Organisation with its reader

Accepted · 2026-11-20 · [#1341](https://github.com/KeeprDigital/keepr/issues/1341) · Amends ADR-0010, ADR-0113 and ADR-0141

Since Stream Keepr relies on Keepr Accounts it holds no Users (ADR-0141), and where it shows who did something it could name only its reader: every other User's id showed raw. ADR-0141 deferred the choice between asking Keepr Accounts and keeping the names an App has seen. The owner decided on 2026-11-20: ask Keepr Accounts, by id; a reader is told the names of Users who share an Organisation with them, and no others; a name and never an email; and a User with a blank name is prevented at Keepr Accounts, in work of its own (#1354).

### Decision

**Keepr Accounts answers names by id at `GET /api/users/names?id=…&id=…`**, as `{ names: { <User id>: <name> } }`, to the Session whose cookie the request carries. An App forwards the cookie of the request it is answering over its `KEEPR_ACCOUNTS` binding, as it does for an Identity Proof (ADR-0113). The path, the parameter, the limit and the answer's shape are in the layer (`packages/nuxt-layer/shared/utils/userNames.ts`), read by both sides.

**The asker is a Session, never an App.** Nothing answers to an App's own credential, to the binding alone, or to a request with no cookie: those are refused 401 `SIGNED_OUT`, with an ended Session and a disabled User's open one, exactly where no Identity Proof is minted. An App therefore holds no directory: it can learn only what the User in front of it may.

**A User is named when they share an Organisation with the asker: any Organisation both belong to, not only the one the Session works in.**

**A Keepr Administrator is answered as anyone is.**

**Only a name is answered.** No email, role, Organisation, or disabled mark. A disabled User who is still a member is named: they did what the record says they did.

**An id it does not name is left out, and the answer never says why.** An id no User has, a User who shares no Organisation with the asker and a User whose name is blank are answered alike, by one statement that runs the same whichever they are. The route lists nobody: a User is learnt of only by an id the asker already holds.

**One question asks about at most 50 Users**; more is refused 400 `TOO_MANY_USER_IDS`.

**It renews no Session.**

**The asking half is the layer's `readUserNames`** (`packages/nuxt-layer/server/utils/userNames.ts`), for every App. It asks in questions of at most 50 ids, reads only names that are text, not blank and for an id it asked about, and never throws: while Keepr Accounts fails, refuses, does not answer in two seconds, or answers something other than names, as one with no such route does, the ids come back unnamed and the App shows them. An App names the User a request belongs to from their Identity Proof and does not ask about them.

**An answer is kept for five minutes, under the cookie it was given to**, "unnamed" included. A question that failed keeps nothing, and nothing is served past its five minutes while Keepr Accounts cannot be asked.

**Stream Keepr names a User other than its reader again** in the Evidence Ledger, the Operations Cockpit and a queue inspection (`server/utils/actorNames.ts`). It asks only about an actor that may be another User: not its reader, not an anonymous-era author, not a machine actor, and not at all when a reading holds none.

**The Accounts Stand-in answers the route too.** It holds no Users, so it names the Local Developer User and whoever it has answered as since it started, by the name it gave them last, and refuses a signed-out visitor and too long a question as Keepr Accounts does.

The rules these set are in `apps/accounts/RULES.md` under User names, the layer's `RULES.md` under User, and `apps/stream/RULES.md` under User and Evidence Ledger.

### Why

- **Any shared Organisation, because the active one is not a boundary.** A User switches the Organisation their Session works in on their own profile, at will (ADR-0113), so answering only for the active one would withhold nothing they cannot have a moment later. It would only make names come and go as they switch, and make the answer a fact about a Session, which is harder to keep correctly, where it is a fact about a User. The owner's words are "share an Organisation with them".
- **A Keepr Administrator finds any User at `/platform`, on purpose** (ADR-0117). This route serves an App's page, and an App's page is an Organisation's data, which being a Keepr Administrator gives no access to (root `GLOSSARY.md`). Answering them more here would be support access by the back door, where ADR-0117 wants it deliberate and visible; and it would give the Local Developer User's reading a rule no other User's has.
- **Indistinguishable, so the route cannot be used to test for a User.** Told "not in your Organisation", an asker would learn that an id is a real User's. One statement for every id also leaves no difference in work to time.
- **A lookup by id is not a member list.** Keepr Accounts closes the library's member list to a member without administrative rights, because it answers every member's email and roles. This answers a name, for an id the asker already holds, and a User id is 32 random characters nobody guesses.
- **The cookie is the whole credential, as for an Identity Proof.** An App credential that answered names would make each App a directory of every User, and a secret to keep in every App. Forwarding the reader's cookie means the question is exactly "what may this person be told", decided in one place.
- **Fifty bounds what one question costs.** A caller that is not the layer, a browser with a Session among them, cannot make Keepr Accounts read for an address full of ids. A page of the Evidence Ledger holds at most 500 entries and far fewer people, and the layer splits a longer list, so an App is never refused for the size of its page.
- **Five minutes, because that is already how long Keepr trusts what Keepr Accounts said** (ADR-0113). A User removed from an Organisation stops being named to its members as soon as a disabled User stops being admitted. Kept under the cookie, a name reaches only a request Keepr Accounts gave it to, with nothing the App must get right about who shares what with whom. "Unnamed" is kept as long, or an id from before ADR-0141, which no User has, would be asked about on every reading.
- **Never a reason to fail the reading.** The Evidence Ledger is where an administrator looks when something is wrong; it must not need Keepr Accounts to be well. Two seconds bounds a Keepr Accounts that accepts the question and does not answer.
- **Deploy order needs no operator step.** A Keepr Accounts without the route answers the path with its own page, as it answers any path it does not serve: measured on the built Worker. A Stream Keepr that reaches one reads no names in that, and shows ids as it does today. ADR-0120 already deploys Keepr Accounts first.
- **No renewal, because the answer carries no cookie to a browser.** A Session renewed here would be renewed in the database alone, and the browser's cookie would lapse on its old date.
- **The stand-in names who it has answered as** because that is who exists locally: "a User exists for as long as a request names them" (ADR-0141). It keeps the App on the code it runs in production, with no development branch (ADR-0113).

### Consequences

- A User removed from every Organisation a reader belongs to shows to that reader as an id from then on, though the record is of what they did as a member. So does everyone in a second Organisation sharing an Installation, as the owner accepted: Stream Keepr does not separate its data by Organisation.
- A User with a blank name shows as an id to others until #1354 lands and they have one. Stream Keepr still shows a reader their own email in that case, and nobody else's.
- A signed-in User can ask the route from a browser, with their own cookie, and is told what an App would be told for them.
- Until a name's five minutes pass, a rename does not show, and a User just invited may show as an id.
- An id from before ADR-0141 is asked about once every five minutes per reader, and is never named.

### What this changes

- **ADR-0141**: "an administrator reading names only its reader" no longer holds. The reader is still named from their Identity Proof; another User is named by asking Keepr Accounts. Of its two deferred ways, this is the first; the second, keeping the names an App has seen, is not built.
- **ADR-0010**: "display name resolved at read time" holds again for every User Keepr Accounts names to the reader, and not for the reader alone.
- **ADR-0113**: the Accounts Stand-in answers a third route, and remembers who it has answered as. It still adds no authority and is never deployed. An App still learns who a request belongs to only from an Identity Proof: this route says what to call someone, and admits nobody.

### Rejected alternatives

- **Each App keeps the names it has seen.** The owner decided against it: a name goes stale, a User who has never acted in an App has none, and a directory of Users is expected to be needed beyond this.
- **Answering only for the Organisation the Session works in.** See Why: it is not a boundary, and it makes the answer depend on the Session.
- **Answering a Keepr Administrator for any User.** See Why.
- **A route an App calls with a credential of its own**, or one trusted because it arrives over the service binding. Either makes an App a directory of every User, which the owner ruled out; a binding says which Worker called, never for whom.
- **Names in the Identity Proof**, of everyone in the reader's Organisations. An Organisation has up to 10,000 members (ADR-0114), on every request, to every App.
- **Saying which ids were refused.** It tells an asker that an id is a real User's.
- **A `POST` with the ids in its body.** It reads and changes nothing, and fifty ids fit an address.
- **Keeping a name longer, or serving a kept one while Keepr Accounts is down.** A removal would then take longer to reach an App than a disabled User does, with nothing to bound it during an outage.
