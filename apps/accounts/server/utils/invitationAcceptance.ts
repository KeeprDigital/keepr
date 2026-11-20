import type { IdentityDatabase } from '~~/server/db';
import type { KeeprAuth } from './auth';
import type { AppRoles } from './appAccess';
import type { InvitationKey } from './invitationSecret';
import { MIN_PASSWORD_LENGTH } from '~~/shared/utils/newPassword';
import { offeredAppRoles } from './appAccess';
import { refuseCrossSiteWrite } from './actor';
import { browserHeaders } from './browserHeaders';
import { holdsInvitationSecret } from './invitationSecret';
import { organisationRecords } from './organisations';
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
	new KeeprRefusal(404, 'INVITATION_NOT_FOUND', 'There is no such invitation.');

/** Why an Invitation that was once open no longer is, by the library's status. */
const CLOSED: Record<string, [code: string, message: string]> = {
	canceled: ['INVITATION_CANCELLED', 'This invitation has been cancelled.'],
	accepted: ['INVITATION_ACCEPTED', 'This invitation has already been accepted.'],
	rejected: ['INVITATION_DECLINED', 'This invitation has been declined.'],
};

/**
 * The pending, unexpired Invitation `key` names, or a refusal saying why it is
 * closed: 410 with the reason, or 404 for no such Invitation. A secret not its
 * own is answered as no such Invitation, so the id alone learns nothing, not
 * even whether it is open (ADR-0155). Read directly: the library's own read
 * needs a Session, which an invitee has not got.
 */
async function pendingInvitation(
	auth: KeeprAuth,
	database: IdentityDatabase,
	key: InvitationKey,
): Promise<InvitationRow> {
	if (!(await holdsInvitationSecret(database, key))) throw notFound();
	const { adapter } = await auth.$context;
	const invitation = await adapter.findOne<InvitationRow>({
		model: 'invitation',
		where: [{ field: 'id', value: key.invitationId }],
	});
	if (!invitation) throw notFound();
	if (invitation.status !== 'pending') {
		const closed = CLOSED[invitation.status];
		throw closed ? new KeeprRefusal(410, ...closed) : notFound();
	}
	if (invitation.expiresAt < new Date())
		throw new KeeprRefusal(410, 'INVITATION_EXPIRED', 'This invitation has expired.');
	return invitation;
}

/**
 * The invitee declines from the Invitation's link, signed in or not: the
 * link's secret is the proof, as it is for accepting. Closes it and writes it in
 * the Audit Record, naming the address's User when it has one. A decline another
 * origin's page sent is refused 403 (`refuseCrossSiteWrite`).
 */
export async function declineInvitation(
	auth: KeeprAuth,
	database: IdentityDatabase,
	key: InvitationKey,
	request: Request,
): Promise<void> {
	refuseCrossSiteWrite(request);
	const { invitationId } = key;
	const invitation = await pendingInvitation(auth, database, key);
	const { adapter, internalAdapter } = await auth.$context;
	const declined = await adapter.update<InvitationRow>({
		model: 'invitation',
		where: [
			{ field: 'id', value: invitationId },
			{ field: 'status', value: 'pending' },
		],
		update: { status: 'rejected' },
	});
	if (!declined) {
		// Answered or cancelled in between: say which.
		await pendingInvitation(auth, database, key);
		throw notFound();
	}
	const user = await internalAdapter.findUserByEmail(invitation.email);
	await organisationRecords(database).invitationDeclined({
		invitationId,
		organizationId: invitation.organizationId,
		email: invitation.email,
		userId: user?.user.id ?? null,
	});
}

/** What the invitee is shown before accepting, to the holder of the link's secret. */
export async function invitationOffer(
	auth: KeeprAuth,
	database: IdentityDatabase,
	key: InvitationKey,
): Promise<InvitationOffer> {
	const invitation = await pendingInvitation(auth, database, key);
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

export interface NewUserAcceptance extends InvitationKey {
	name: string;
	password: string;
}

/**
 * Creates the invitee's User and accepts the Invitation as them, answering the
 * cookies that sign their browser in. The Invitation's App roles are copied into
 * App access as it is accepted (`organisationOptions`). Refused before anything is
 * written unless the link's secret is the Invitation's, it is open, the address
 * has no User, the name is not blank and the password is long enough and in no
 * breach.
 */
export async function acceptInvitationAsNewUser(
	auth: KeeprAuth,
	database: IdentityDatabase,
	{ invitationId, secret, name, password }: NewUserAcceptance,
	requestHeaders?: Headers,
): Promise<{ setCookie: string[] }> {
	const invitation = await pendingInvitation(auth, database, { invitationId, secret });
	const { internalAdapter } = await auth.$context;
	if (await internalAdapter.findUserByEmail(invitation.email))
		throw new KeeprRefusal(
			409,
			'USER_ALREADY_EXISTS',
			'This address already has a Keepr account: sign in to accept.',
		);
	// The library's server-side creation does not check the minimum (#1256).
	if (password.length < MIN_PASSWORD_LENGTH)
		throw new KeeprRefusal(400, 'PASSWORD_TOO_SHORT', 'Password too short');

	try {
		// The breached-password check runs here, then a blank name is refused
		// (`userName.ts`), before anything is written.
		await auth.api.createUser({
			body: {
				email: invitation.email,
				name,
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

/**
 * The invitee who has a User accepts, signed in with the invited address and
 * holding the link's secret: the Organisation and its App access are added to
 * their User, and their Session works in it. Signed in with another address, it
 * is refused 403 and nothing changes; so is an accept another origin's page sent.
 */
export async function acceptInvitationSignedIn(
	auth: KeeprAuth,
	database: IdentityDatabase,
	key: InvitationKey,
	request: Request,
): Promise<void> {
	refuseCrossSiteWrite(request);
	await pendingInvitation(auth, database, key);
	try {
		await auth.api.acceptInvitation({
			body: { invitationId: key.invitationId },
			headers: request.headers,
		});
	} catch (error) {
		throw refusalFromAuth(error);
	}
}
