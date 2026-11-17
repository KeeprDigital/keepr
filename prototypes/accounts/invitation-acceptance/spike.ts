// Spike 3 (#1256). Throwaway: Invitation acceptance with email-and-password
// sign-up closed, end to end through Better Auth 1.7.25's own server calls.
// Run from the repository root: node prototypes/accounts/invitation-acceptance/spike.ts
import { createHash } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from '@better-auth/memory-adapter';
import { admin, haveIBeenPwned, organization } from 'better-auth/plugins';

// The breached-password service is the one faked boundary. Anything in BREACHED
// is reported compromised; DOWN makes the service fail.
const BREACHED = new Set(['password1234']);
let pwnedDown = false;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = String(input instanceof Request ? input.url : input);
	if (!url.startsWith('https://api.pwnedpasswords.com/range/')) return realFetch(input, init);
	if (pwnedDown) return new Response('down', { status: 503 });
	const prefix = url.slice(-5);
	const lines = [...BREACHED]
		.map((p) => createHash('sha1').update(p).digest('hex').toUpperCase())
		.filter((h) => h.startsWith(prefix))
		.map((h) => `${h.slice(5)}:42`);
	return new Response(lines.join('\r\n') + '\r\n0000000000000000000000000000000000A:0', { status: 200 });
}) as typeof fetch;

const MIN_PASSWORD_LENGTH = 12;
const db: Record<string, Record<string, unknown>[]> = {
	user: [], session: [], account: [], verification: [],
	organization: [], member: [], invitation: [],
};
/** Our own table: per-App access, one row per member and App. */
const appAccess: { memberId: string; app: string; role: string }[] = [];
const sentInvitations: { email: string; id: string }[] = [];

const auth = betterAuth({
	secret: 'spike-secret-spike-secret-spike-secret-0123456789',
	baseURL: 'http://localhost:3000',
	database: memoryAdapter(db),
	emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: MIN_PASSWORD_LENGTH },
	advanced: { disableOriginCheck: false },
	plugins: [
		admin(),
		haveIBeenPwned(),
		organization({
			allowUserToCreateOrganization: false,
			invitationExpiresIn: 60 * 60 * 24 * 7,
			cancelPendingInvitationsOnReInvite: true,
			membershipLimit: 10_000,
			invitationLimit: 10_000,
			// The per-App roles ride on the Invitation as an additional field.
			schema: { invitation: { additionalFields: { appRoles: { type: 'string', required: false, input: true } } } },
			sendInvitationEmail: async ({ email, id }) => { sentInvitations.push({ email, id }); },
		}),
	],
});

// ---- helpers ---------------------------------------------------------------

const rows: [string, boolean, string][] = [];
function check(name: string, ok: boolean, detail = '') { rows.push([name, ok, detail]); }
async function code(p: Promise<unknown>): Promise<string> {
	try { await p; return 'ok'; } catch (e) {
		const err = e as { body?: { code?: string }; status?: string; message?: string };
		return `${err.status ?? ''} ${err.body?.code ?? err.message}`.trim();
	}
}
function cookieHeader(headers: Headers): Headers {
	const cookie = headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
	return new Headers({ cookie });
}

// ---- Keepr Accounts' acceptance path ---------------------------------------

type Refusal = { refused: string };

/**
 * A new person accepts an Invitation by choosing a name and password. The calls
 * and their order are the spike's answer.
 */
async function acceptAsNewUser(input: { invitationId: string; name: string; password: string }):
	Promise<{ setCookie: string[]; userId: string; memberId: string } | Refusal> {
	const ctx = await auth.$context;
	// 1. Read the Invitation ourselves: no session yet, so the plugin's getInvitation cannot.
	const invitation = await ctx.adapter.findOne<{
		id: string; email: string; status: string; expiresAt: Date; appRoles?: string;
	}>({ model: 'invitation', where: [{ field: 'id', value: input.invitationId }] });
	if (!invitation || invitation.status !== 'pending' || invitation.expiresAt < new Date()) {
		return { refused: 'INVITATION_NOT_FOUND' };
	}
	// 2. An address with a User signs in and accepts instead.
	if (await ctx.internalAdapter.findUserByEmail(invitation.email)) return { refused: 'USER_EXISTS_SIGN_IN' };
	// 3. Minimum length: the server-side create does not check it.
	if (input.password.length < MIN_PASSWORD_LENGTH) return { refused: 'PASSWORD_TOO_SHORT' };
	// 4. Create the User, email verified, credential linked; breached check runs here.
	const created = await auth.api.createUser({
		body: { email: invitation.email, name: input.name, password: input.password, data: { emailVerified: true } },
	}).catch((e: { body?: { code?: string } }) => ({ refused: e.body?.code ?? String(e) }) as Refusal);
	if ('refused' in created) return created;
	// 5. Sign in, server-side, to get a Session and its cookie.
	const signIn = await auth.api.signInEmail({
		body: { email: invitation.email, password: input.password },
		returnHeaders: true,
	});
	// 6. Accept, as the new Session.
	const accepted = await auth.api.acceptInvitation({
		body: { invitationId: invitation.id },
		headers: cookieHeader(signIn.headers),
		returnHeaders: true,
	});
	// 7. Copy the per-App roles: the library does not.
	const member = accepted.response!.member as { id: string };
	for (const [app, role] of Object.entries(JSON.parse(invitation.appRoles ?? '{}') as Record<string, string>)) {
		appAccess.push({ memberId: member.id, app, role });
	}
	// 8. Hand the browser the session cookie (sign-in's; accept's if it set a new one).
	const setCookie = [...signIn.headers.getSetCookie(), ...accepted.headers.getSetCookie()];
	return { setCookie, userId: created.user.id, memberId: member.id };
}

// ---- the run ---------------------------------------------------------------

const ctx = await auth.$context;

// An owner, made directly: the first-administrator claim is not this spike.
const owner = await auth.api.createUser({ body: { email: 'owner@example.com', name: 'Owner', password: 'owner-password-long', data: { emailVerified: true } } });
const ownerCookie = cookieHeader((await auth.api.signInEmail({ body: { email: 'owner@example.com', password: 'owner-password-long' }, returnHeaders: true })).headers);
const org = await auth.api.createOrganization({ body: { name: 'Keepr', slug: 'keepr', userId: owner.user.id } });

// Sign-up is closed.
check('sign-up over HTTP refused', (await auth.handler(new Request('http://localhost:3000/api/auth/sign-up/email', {
	method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
	body: JSON.stringify({ email: 'x@example.com', password: 'abcdefghijklmnop', name: 'X' }),
}))).status === 400, 'EMAIL_PASSWORD_SIGN_UP_DISABLED');

const orgCreate = await code(auth.api.createOrganization({ body: { name: 'Mine', slug: 'mine' }, headers: ownerCookie }));
check('ordinary User cannot create an Organisation', orgCreate !== 'ok', orgCreate);

// Invite with an Organisation role and per-App roles.
const invite = (email: string, role: 'member' | 'admin' | 'owner', headers = ownerCookie) =>
	auth.api.createInvitation({
		body: { email, role, organizationId: org!.id, appRoles: JSON.stringify({ stream: 'admin', score: 'member' }) },
		headers,
	});
const inv1 = await invite('new@example.com', 'member');
check('Invitation stores appRoles', (inv1 as { appRoles?: string }).appRoles === '{"stream":"admin","score":"member"}', String((inv1 as { appRoles?: string }).appRoles));
check('Invitation lasts 7 days', Math.round((new Date(inv1.expiresAt).getTime() - Date.now()) / 86400000) === 7);
check('sendInvitationEmail called', sentInvitations.at(-1)?.id === inv1.id);

// Re-inviting replaces.
const inv2 = await invite('new@example.com', 'member');
const old = await ctx.adapter.findOne<{ status: string }>({ model: 'invitation', where: [{ field: 'id', value: inv1.id }] });
check('re-invite cancels the earlier Invitation', old?.status === 'canceled' && inv2.id !== inv1.id, `old status ${old?.status}`);

// Refusals before anything is created.
check('earlier (replaced) Invitation refused', (await acceptAsNewUser({ invitationId: inv1.id, name: 'N', password: 'a-long-enough-password' }) as Refusal).refused === 'INVITATION_NOT_FOUND');
check('short password refused by our check', (await acceptAsNewUser({ invitationId: inv2.id, name: 'N', password: 'short' }) as Refusal).refused === 'PASSWORD_TOO_SHORT');
check('library createUser itself admits a short password',
	(await code(auth.api.createUser({ body: { email: 'short@example.com', name: 'S', password: 'abc' } }))) === 'ok');
const breached = await acceptAsNewUser({ invitationId: inv2.id, name: 'N', password: 'password1234' }) as Refusal;
check('breached password refused on createUser', breached.refused === 'PASSWORD_COMPROMISED', breached.refused);
pwnedDown = true;
const down = await acceptAsNewUser({ invitationId: inv2.id, name: 'N', password: 'a-long-enough-password' }) as Refusal;
pwnedDown = false;
check('breached-password service down fails closed', down.refused !== undefined && !(await ctx.internalAdapter.findUserByEmail('new@example.com')), down.refused);

// The path itself.
const result = await acceptAsNewUser({ invitationId: inv2.id, name: 'New Person', password: 'a-long-enough-password' });
check('new User accepts', !('refused' in result), JSON.stringify(result).slice(0, 120));
if (!('refused' in result)) {
	const user = await ctx.internalAdapter.findUserById(result.userId);
	check('User has emailVerified', user?.emailVerified === true);
	const member = await ctx.adapter.findOne<{ role: string; organizationId: string }>({ model: 'member', where: [{ field: 'id', value: result.memberId }] });
	check('member row with the Invitation role', member?.role === 'member' && member.organizationId === org!.id);
	const invRow = await ctx.adapter.findOne<{ status: string }>({ model: 'invitation', where: [{ field: 'id', value: inv2.id }] });
	check('Invitation accepted', invRow?.status === 'accepted');
	check('App access copied', JSON.stringify(appAccess.filter((r) => r.memberId === result.memberId).map((r) => [r.app, r.role])) === '[["stream","admin"],["score","member"]]');
	const browser = new Headers({ cookie: result.setCookie.map((c) => c.split(';')[0]).join('; ') });
	const session = await auth.api.getSession({ headers: browser });
	check('browser cookie is a live Session', session?.user.id === result.userId);
	check('Session active Organisation set by accept', (session?.session as { activeOrganizationId?: string }).activeOrganizationId === org!.id);
	check('set-cookie count', true, `${result.setCookie.length}: ${result.setCookie.map((c) => c.split('=')[0]).join(', ')}`);
	check('replaying the accepted Invitation refused', (await acceptAsNewUser({ invitationId: inv2.id, name: 'N', password: 'a-long-enough-password' }) as Refusal).refused === 'INVITATION_NOT_FOUND');
}

// Existing User accepts while signed in with the invited address.
const org2 = await auth.api.createOrganization({ body: { name: 'Other', slug: 'other', userId: owner.user.id } });
const inv3 = await auth.api.createInvitation({ body: { email: 'new@example.com', role: 'admin', organizationId: org2!.id }, headers: ownerCookie });
check('existing User routed to sign in', (await acceptAsNewUser({ invitationId: inv3.id, name: 'N', password: 'a-long-enough-password' }) as Refusal).refused === 'USER_EXISTS_SIGN_IN');
const newCookie = cookieHeader((await auth.api.signInEmail({ body: { email: 'new@example.com', password: 'a-long-enough-password' }, returnHeaders: true })).headers);
check('existing User accepts signed in', (await code(auth.api.acceptInvitation({ body: { invitationId: inv3.id }, headers: newCookie }))) === 'ok');

// Wrong recipient.
const inv4 = await auth.api.createInvitation({ body: { email: 'someone-else@example.com', role: 'member', organizationId: org2!.id }, headers: ownerCookie });
check('different signed-in email refused', (await code(auth.api.acceptInvitation({ body: { invitationId: inv4.id }, headers: newCookie }))).includes('YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION'));

// Only an owner invites an owner (new@ is an admin of org2 now).
check('admin cannot invite an owner', (await code(auth.api.createInvitation({ body: { email: 'o2@example.com', role: 'owner', organizationId: org2!.id }, headers: newCookie }))).includes('YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE'));
check('admin can invite a member', (await code(auth.api.createInvitation({ body: { email: 'm2@example.com', role: 'member', organizationId: org2!.id }, headers: newCookie }))) === 'ok');

// Expired.
const inv5 = await auth.api.createInvitation({ body: { email: 'late@example.com', role: 'member', organizationId: org2!.id }, headers: ownerCookie });
await ctx.adapter.update({ model: 'invitation', where: [{ field: 'id', value: inv5.id }], update: { expiresAt: new Date(Date.now() - 1000) } });
check('expired Invitation refused', (await acceptAsNewUser({ invitationId: inv5.id, name: 'L', password: 'a-long-enough-password' }) as Refusal).refused === 'INVITATION_NOT_FOUND');

for (const [name, ok, detail] of rows) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
process.exitCode = rows.every(([, ok]) => ok) ? 0 : 1;
