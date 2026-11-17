# Spike 3: Invitation acceptance with sign-up closed (#1256)

Throwaway. Kept on this branch as a primary source; never merged, not part of
any gate. Findings, not decisions: the build's decisions are its ADRs.

## Answer: it works

With `emailAndPassword.disableSignUp: true`, Keepr Accounts creates the User
itself (email verified), signs them in, and accepts the Invitation through the
organization plugin, end to end, using only Better Auth 1.7.25's own server
calls. Run it: `node prototypes/accounts/invitation-acceptance/spike.ts` from
the repository root (memory adapter; only the breached-password service is
faked). 26 checks, all pass, each an assertion.

## The server calls, in order (new invitee: name + password)

1. **Read the Invitation** with `(await auth.$context).adapter.findOne({ model: 'invitation', where: [{ field: 'id', value }] })`.
   Refuse unless `status === 'pending'` and `expiresAt` is in the future.
   (`auth.api.getInvitation` needs a Session, which the invitee has not got.)
2. **Route an existing User away**: `ctx.internalAdapter.findUserByEmail(invitation.email)`
   found → they sign in and accept (below). Otherwise go on.
3. **Check the minimum password length ourselves** (see "not done by the library").
4. **Create the User**: `auth.api.createUser({ body: { email: invitation.email, name, password, data: { emailVerified: true } } })`.
   The admin plugin's server-side call: no headers, so no session is required;
   it hashes the password and links the `credential` account. The
   breached-password check runs here (`/admin/create-user` is in
   `haveIBeenPwned`'s default paths).
5. **Sign in**: `auth.api.signInEmail({ body: { email, password }, returnHeaders: true })`
   → a Session and its `set-cookie`.
6. **Accept**: `auth.api.acceptInvitation({ body: { invitationId }, headers: <cookie from 5>, returnHeaders: true })`.
   The plugin checks pending / unexpired / recipient email, marks it
   `accepted`, creates the `member` row with the Invitation's role, and sets
   the Session's active Organisation to it.
7. **Copy the per-App roles** from the Invitation into App access, keyed by the
   new `member.id` from step 6's response.
8. **Return step 5's `set-cookie`** to the browser (asserted: step 6 sets none, as there is no cookie cache).

**An existing User** signs in normally, then step 6 with their cookie, then step 7.

## Configuration found to work

```ts
emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
plugins: [
  admin(),
  haveIBeenPwned(),
  organization({
    allowUserToCreateOrganization: false,
    invitationExpiresIn: 60 * 60 * 24 * 7,
    cancelPendingInvitationsOnReInvite: true,
    membershipLimit: 10_000,   // default 100
    invitationLimit: 10_000,   // default 100
    schema: { invitation: { additionalFields: { appRoles: { type: 'string', required: false, input: true } } } },
    sendInvitationEmail: async ({ email, id, ... }) => { /* the sending seam */ },
  }),
]
```

`appRoles` is accepted by `createInvitation`'s body and stored on the row (JSON
string, e.g. `{"stream":"admin","score":"member"}`).

## What the library does not do

| Gap | Measured | Keepr Accounts must |
|---|---|---|
| Copying per-App roles on acceptance | `member` row only | write App access after step 6 (or in `organizationHooks.afterAcceptInvitation`, which receives the Invitation and member) |
| Minimum password length on server-side create | `auth.api.createUser` admitted `"abc"` with `minPasswordLength: 12` set; it checks only the maximum | check length before step 4 |
| Reading an Invitation without a Session | `getInvitation` requires one | read the row through the adapter (step 1) |
| Registering through an Invitation with sign-up closed | `POST /sign-up/email` → 400 `EMAIL_PASSWORD_SIGN_UP_DISABLED` | steps 4–5 |
| Atomicity | transaction option off; steps 4–7 are separate writes | tolerate a partial run: if 5–7 fail after 4, the User exists, so a retry hits step 2 and signs in to accept; App access copy (7) should be retried with it, or done in a D1 batch with a member lookup |

## What the library does do (measured)

| Behaviour | Result |
|---|---|
| sign-up closed | 400 `EMAIL_PASSWORD_SIGN_UP_DISABLED` |
| `allowUserToCreateOrganization: false` | a signed-in User, an owner even, gets `FORBIDDEN YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION`; a server call with `userId` and no headers still creates (how a Keepr Administrator's route would) |
| re-invite same address (`cancelPendingInvitationsOnReInvite`) | earlier Invitation → `canceled`, new one pending |
| Invitation life | 7 days |
| `sendInvitationEmail` | called with the Invitation's id |
| breached password on `createUser` | `PASSWORD_COMPROMISED` |
| breached-password service down | refused (`Failed to check password. Status: 503`); no User created (fails closed) |
| replayed / cancelled / expired Invitation | refused before anything is created |
| signed-in User with a different email | `YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION` |
| admin invites an owner | `YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE` (only an owner may) |
| admin invites a member | allowed |
| accepted Session | `activeOrganizationId` = the Invitation's Organisation |
| email verification before accepting | not required with `requireEmailVerificationOnInvitation` unset and default id generation; a custom `advanced.generateId` or `database.generateId` turns it on (`shouldRequireVerifiedEmailForInvitationIdAction`). Ours is verified anyway |
