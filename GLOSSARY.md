# Keepr glossary

The words every Keepr app shares: who a person is and what they may use, how each app is released and deployed, and the named modules of the shared layer. Each app's own words are in its own glossary; `GLOSSARY-MAP.md` says where, and how the vocabularies meet.

Identity and access is written to the model of Keepr Accounts (issue #1228), which Stream Keepr relies on (ADR-0141, in `apps/stream/docs/adr`).

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
The User the Accounts Stand-in answers with, so local work needs no sign-in: a Keepr Administrator who owns the Keepr Organisation and holds the highest App role in every App. No production build knows it.
_Avoid_: bypass user, test user

**Accounts Stand-in**:
The Worker a development setup runs under Keepr Accounts' service name, which answers every App's request with an Identity Proof for the Local Developer User, or for whoever the request's own cookie asks it to answer as, signed by a key of its own. It is never deployed.
_Avoid_: mock accounts, fake auth, auth bypass, stub

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
A named grant an App defines in the App registry, which a member of an Organisation holds in that App or does not. Operator is one of Stream Keepr's; Organiser is one of Score Keepr's. It reaches only the data of the Organisation that granted it: a Stream Keepr Installation honours it only from the Organisation the Installation serves (ADR-0161).
_Avoid_: permission, job title; role alone where an Organisation role could be meant

**App access**:
The one App role, or none, that a member of an Organisation holds in an App.
_Avoid_: permission, entitlement, grant

**Keepr Administrator**:
A User marked as running the platform: they create Organisations, can find any User, see the record of administrative actions, and make another User one. It is separate from every Organisation role and App role, and gives no access to an Organisation's data inside an App.
_Avoid_: admin (an Organisation role), superuser, Graphics Administrator (a Stream Keepr App role)

**Identity Proof**:
The short-lived signed statement Keepr Accounts gives an App about one request: its User, Session, active Organisation, Organisation role, App roles, and whether the User is a Keepr Administrator. An App checks it for itself.
_Avoid_: token alone, JWT, session token

**Return Address**:
Where Keepr Accounts sends a User once they have signed in: the page of the App that sent them to sign in.
_Avoid_: redirect, callback URL

### Releasing and deploying

**Release**:
One numbered version of one app, with the changelog of what changed since its previous Release. Several apps may release together; each is deployed on its own.
_Avoid_: version (the number alone), build, tag

**Changeset**:
A file in `.changeset/` naming the apps a change ships in, each with its bump, and the line each one's next Release gets in its changelog. An empty changeset names none.
_Avoid_: release note, change file

**Version PR**:
The one pull request that turns the changesets waiting on `main` into each app's next version and changelog. Merging it releases every app it names.
_Avoid_: Release PR (release-please's, gone)

**Environment**:
Where Installations run: Production, which serves Users, or Staging, which proves a Release before Production does. Staging alone always means the Staging Environment.
_Avoid_: stage, env; staging for Stream Keepr's ingestion staging store or Graphics Staging Allowance, which are always written in full

**Installation**:
One app deployed in one Environment, and the data it holds. Stream Keepr's Staging Installation shares nothing with its Production Installation. A Stream Keepr Installation serves one Organisation, which it names, and admits no User working in another, whatever App role that Organisation gave them (ADR-0161).
_Avoid_: instance, tenant, deployment (the act of deploying)

**Deploy descriptor**:
An app's statement of what is deployed, `apps/<app>/deploy.jsonc`, read from the Release being deployed: its build, its Worker, its D1 databases, its Installation per Environment, and its parts. An app with one is deployable.
_Avoid_: deploy config, manifest, wrangler config (the Worker's own)

**Part**:
A Worker an app deploys from source beside its own, with its own promotion marker and fingerprint, such as Stream Keepr's silent-video validator.
_Avoid_: component (a marker's field, which also names the app), sidecar

**Promotion marker**:
The GitHub Deployments environment recording one app's, or one part's, latest deploy to one Environment, `pending` or `deployed`, named `<app>/<environment>[-<part>]` (ADR-0133; an annotated tag on `origin` of that name before it).
_Avoid_: deploy tag, production tag

**Release identity**:
The app, version and commit an Installation's Worker was built from, which it serves at `/api/release` and a deploy's verify requires to name the Release just deployed.
_Avoid_: build info, version endpoint

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

**Cross-site write check**:
Whether a state-changing request was made by a browser on behalf of another origin, read from what the browser says about where the request came from. Every app's Session-authenticated writes refuse what it flags.
_Avoid_: CSRF token, origin check (Better Auth's own, which trusts a list of hosts)

**Frame Clock**:
The instant motion is read at: server time, read again on every animation frame while anything read at it is in motion, and left where it stopped once all of it has settled.
_Avoid_: animation timer, render loop.
