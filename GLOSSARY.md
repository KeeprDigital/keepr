# Keepr glossary

The words every Keepr app shares: who a person is and what they may use, and the named modules of the shared layer. Each app's own words are in its own glossary; `GLOSSARY-MAP.md` says where, and how the vocabularies meet.

Identity and access is written to the model of Keepr Accounts (issue #1228). Until Stream Keepr moves onto it, Stream Keepr's own sign-in follows the rules in `apps/stream/RULES.md`.

## Language

### Identity and access

**Keepr Accounts**:
The service at `accounts.keepr.digital` that holds every User, Session, Organisation and App access, and vouches for them to each App. It is not an App: every User reaches their own profile there, and nobody is granted access to it.
_Avoid_: accounts app, auth service, identity provider, Accounts Keepr

**App**:
A Keepr product a User can be granted access to, named in the App registry with the roles it defines. Stream Keepr and Score Keepr are Apps.
_Avoid_: tool, product, service; app (lowercase) for anything not in the registry, though a deployable under `apps/` is still an app

**App registry**:
The one list naming each App and the App roles it defines.
_Avoid_: role table, app list

**User**:
Anyone who can sign in: one per person across every App. A User is not a Player; a competitor has no account.
_Avoid_: account (acceptable when the subject is the credential), member (a User in one Organisation), author

**Local Developer User**:
The stand-in User a development setup answers with, so local work needs no sign-in. No production build knows it.
_Avoid_: bypass user, test user

**Session**:
One signed-in browser, recognised by every App. It carries the Organisation its User is working in, and never owns work. "Session" alone always means this: any other session is written in full.
_Avoid_: login (the act), token

**Organisation**:
A group of Users that access is granted within. A User may belong to several and works in one at a time.
_Avoid_: tenant, team (Score Keepr's Team is several Players), workspace, account

**Organisation role**:
What a member may do to their Organisation's membership: owner, admin or member. It governs only who may invite people and set access, never what anyone may do inside an App.
_Avoid_: permission level; role alone where an App role could be meant

**Invitation**:
An offer to an email address to join an Organisation with stated roles, which does nothing until the invitee accepts it.
_Avoid_: invite link, sign-up

**App role**:
A named grant an App defines in the App registry, which a member of an Organisation holds in that App or does not. Operator is one of Stream Keepr's; Organiser is one of Score Keepr's.
_Avoid_: permission, job title; role alone where an Organisation role could be meant

**App access**:
The one App role, or none, that a member of an Organisation holds in an App.
_Avoid_: permission, entitlement, grant

**Keepr Administrator**:
A User marked as running the platform: they create Organisations, can find any User, and see the record of administrative actions. It is separate from every Organisation role and App role, and gives no access to an Organisation's data inside an App.
_Avoid_: admin (an Organisation role), superuser, Graphics Administrator (a Stream Keepr App role)

**Identity Proof**:
The short-lived signed statement Keepr Accounts gives an App about one request: its User, Session, active Organisation, Organisation role, App roles, and whether the User is a Keepr Administrator. An App checks it for itself.
_Avoid_: token alone, JWT, session token

### Platform

Named modules of `packages/nuxt-layer`. A module's term lives beside its code: one that moves into the layer brings its term here in the same change.

**Guarded Sequence**:
The client-side module owning the invariant "discard the result of async work that newer work has superseded." Scoped or keyed; issues Flights.
_Avoid_: generation counter, version guard, latest-wins map

**Flight**:
A ticket for one unit of supersedable async work, checked for staleness after each await. Staleness is monotonic.
_Avoid_: request id, generation

**Clock Projection**:
What a clock shows at one instant, as a pure function of its stored state and server time: the value, and how long until that value next changes on its own.
_Avoid_: ticker, timer (nothing ticks; a projection is re-evaluated when it changes).

**Interval**:
Equal periods counted from an anchor instant: which period is current, and when the next begins, is a pure function of the anchor, the period and server time.
_Avoid_: cycle, loop.

**Frame Clock**:
The instant motion is read at: server time, read again on every animation frame while anything read at it is in motion, and left where it stopped once all of it has settled.
_Avoid_: animation timer, render loop.
