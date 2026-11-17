import type { KeeprAuth } from './auth';
import type { AppRoles } from './appAccess';
import { MIN_PASSWORD_LENGTH } from '~~/shared/utils/newPassword';
import { offeredAppRoles } from './appAccess';
import { browserHeaders } from './browserHeaders';
import { KeeprRefusal, refusalFromAuth } from './refusal';

/**
 * Accepting an Invitation with no User yet (#1228 § Invitations). The library
 * has no way to register through an Invitation while sign-up is closed, so Keepr
 * Accounts creates the User itself, its email verified because the emailed link
 * proved it, signs them in, and accepts as them: the order spike 3 found (#1256).
 */

interface InvitationRow {
	id: string;
	email: string;
	status: string;
	expiresAt: Date;
	organizationId: string;
	inviterId: string;
	role: string;
	appRoles?: string | null;
}

/** What an invitee is shown before accepting. */
export interface InvitationOffer {
	email: string;
	organisationName: string;
	inviterName: string;
	role: string;
	appRoles: AppRoles;
	/** Whether the address already has a User, who signs in to accept instead. */
	hasUser: boolean;
}

const notFound = () =>
	new KeeprRefusal(404, 'INVITATION_NOT_FOUND', 'This invitation is not open to accept.');

/**
 * The pending, unexpired Invitation `invitationId` names. Read directly: the
 * library's own read needs a Session, which an invitee has not got.
 */
async function pendingInvitation(auth: KeeprAuth, invitationId: string): Promise<InvitationRow> {
	const { adapter } = await auth.$context;
	const invitation = await adapter.findOne<InvitationRow>({
		model: 'invitation',
		where: [{ field: 'id', value: invitationId }],
	});
	if (!invitation || invitation.status !== 'pending' || invitation.expiresAt < new Date())
		throw notFound();
	return invitation;
}

export async function invitationOffer(
	auth: KeeprAuth,
	invitationId: string,
): Promise<InvitationOffer> {
	const invitation = await pendingInvitation(auth, invitationId);
	const { adapter, internalAdapter } = await auth.$context;
	const [organisation, inviter, existing] = await Promise.all([
		adapter.findOne<{ name: string }>({
			model: 'organization',
			where: [{ field: 'id', value: invitation.organizationId }],
		}),
		internalAdapter.findUserById(invitation.inviterId),
		internalAdapter.findUserByEmail(invitation.email),
	]);
	if (!organisation) throw notFound();
	return {
		email: invitation.email,
		organisationName: organisation.name,
		inviterName: inviter?.name ?? 'Someone',
		role: invitation.role,
		appRoles: offeredAppRoles(invitation.appRoles),
		hasUser: existing !== null,
	};
}

export interface NewUserAcceptance {
	invitationId: string;
	name: string;
	password: string;
}

/**
 * Creates the invitee's User and accepts the Invitation as them, answering the
 * cookies that sign their browser in. The Invitation's App roles are copied into
 * App access as it is accepted (`organisationOptions`). Refused before anything is
 * written unless the Invitation is open, the address has no User, the name is not
 * blank and the password is long enough and in no breach.
 */
export async function acceptInvitationAsNewUser(
	auth: KeeprAuth,
	{ invitationId, name, password }: NewUserAcceptance,
	requestHeaders?: Headers,
): Promise<{ setCookie: string[] }> {
	const invitation = await pendingInvitation(auth, invitationId);
	const { internalAdapter } = await auth.$context;
	if (await internalAdapter.findUserByEmail(invitation.email))
		throw new KeeprRefusal(
			409,
			'USER_ALREADY_EXISTS',
			'This address already has a Keepr account: sign in to accept.',
		);
	if (name.trim().length === 0) throw new KeeprRefusal(400, 'NAME_REQUIRED', 'Enter your name.');
	// The library's server-side creation does not check the minimum (#1256).
	if (password.length < MIN_PASSWORD_LENGTH)
		throw new KeeprRefusal(400, 'PASSWORD_TOO_SHORT', 'Password too short');

	try {
		// The breached-password check runs here, before anything is written.
		await auth.api.createUser({
			body: {
				email: invitation.email,
				name: name.trim(),
				password,
				data: { emailVerified: true },
			},
		});
		const signedIn = await auth.api.signInEmail({
			body: { email: invitation.email, password },
			headers: browserHeaders(requestHeaders),
			returnHeaders: true,
		});
		const setCookie = signedIn.headers.getSetCookie();
		await auth.api.acceptInvitation({
			body: { invitationId },
			headers: new Headers({ cookie: setCookie.map((value) => value.split(';')[0]).join('; ') }),
		});
		return { setCookie };
	} catch (error) {
		throw refusalFromAuth(error);
	}
}
