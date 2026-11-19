# ADR-0140: Realtime moves onto the object in one cut, with no flag, and Ably's code leaves with it

Accepted · 2026-11-19 · part of [#1310](https://github.com/KeeprDigital/keepr/issues/1310) · Amends ADR-0137

ADR-0137 moved Stream Keepr behind a flag: one per Installation, choosing the transport for the server and its pages together, Staging first, with Ably wired until production had run a show on the object.

### Decision

**There is no flag.** The server publishes through the Event's object only, and the pages hear through it only. Each half's Ably code is removed in the change that moves that half.

**The cut lands together.** The server's publish ([#1316](https://github.com/KeeprDigital/keepr/issues/1316)), the pages' transport ([#1317](https://github.com/KeeprDigital/keepr/issues/1317)) and who may hear what ([#1315](https://github.com/KeeprDigital/keepr/issues/1315)) are built apart and merged one after another. Between the first and the last, `main` is not a Stream Keepr anyone can use, and no Version PR is merged.

**Production stays on the Release before the cut until Staging's gates pass** ([#1318](https://github.com/KeeprDigital/keepr/issues/1318)). The Release that carries the cut is deployed to Staging and no further.

**Rollback is the previous Release, redeployed.** Never to one from before 3.0.2, which created the object's class.

**The realtime integration tests run on the object only**, in local `workerd`, in CI, with no key. Ably keeps no test of its own once its half has moved.

### Why

- **Nothing waits on production.** The owner has no show on it before the gates can pass, so the time a flag would have bought is there already.
- **A flag keeps two transports true.** Each seam would carry a second implementation, each tested on both, until the last Installation flipped. Then a removal change, with its own risk.
- **Ably could no longer be tested here.** On 2026-11-19 the Ably app behind the local key was found disabled, and CI has never had a key (ADR-0137). The path a flag would have kept was one nobody could run.

### Consequences

- **`main` cannot release Stream Keepr while the cut is partly merged.** A Version PR also releases every other app it names, so none is merged in that window. The cut's changes wait as drafts until all three are ready.
- **Production takes no Stream Keepr Release until #1318 passes.** A fix it cannot wait for would have to be cut from the earlier Release's tag, which the workspace has no procedure for.
- **#1319 shrinks to the production deploy and the operator's steps**: delete `NUXT_ABLY_API_KEY` from each Installation and the secret store, and close the Ably apps. The code is already gone.
- **The major changeset moves** to the change that removes the key's last reader, which is #1317.
- **The root `AGENTS.md` exception for realtime tests in CI ends with #1317**, not #1319.
- **#1318's gates are unchanged.** They run on the Release deployed to Staging, where a flag would have been turned on.

### Rejected alternatives

- **The flag**, as ADR-0137 had it. The reasons above. What would reopen it: a show on production before the gates can pass.
- **No flag, with Ably's code left in place until production has run a show.** Code nothing calls and nothing can test.
