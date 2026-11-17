import type { KeeprAuth } from './auth';
import type { AppRoles } from './appAccess';
import { offeredAppRoles } from './appAccess';
import { refusalFromAuth } from './refusal';

/** An Invitation still open to accept, as its Organisation's owners and admins see it. */
export interface PendingInvitation {
	id: string;
	email: string;
	role: string;
	appRoles: AppRoles;
	inviterName: string;
	expiresAt: string;
}

interface ListedInvitation {
	id: string;
	email: string;
	role: string;
	status: string;
	expiresAt: Date | string;
	inviterId: string;
	appRoles?: unknown;
}

/**
 * The pending, unexpired Invitations of the Organisation the caller works in,
 * soonest to lapse first. Listed through the library's own route, so who may see
 * them is its rule: an owner or admin, and only an owner sees an owner's offer.
 */
export async function pendingInvitations(
	auth: KeeprAuth,
	headers: Headers,
): Promise<PendingInvitation[]> {
	let listed: ListedInvitation[];
	try {
		listed = (await auth.api.listInvitations({ headers })) as ListedInvitation[];
	} catch (error) {
		throw refusalFromAuth(error);
	}
	const now = Date.now();
	const open = listed
		.map((invitation) => ({ ...invitation, expiresAt: new Date(invitation.expiresAt) }))
		.filter(({ status, expiresAt }) => status === 'pending' && expiresAt.getTime() > now)
		.toSorted((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
	const { internalAdapter } = await auth.$context;
	const inviters = new Map<string, string>();
	for (const inviterId of new Set(open.map(({ inviterId }) => inviterId)))
		inviters.set(inviterId, (await internalAdapter.findUserById(inviterId))?.name ?? 'Someone');
	return open.map((invitation) => ({
		id: invitation.id,
		email: invitation.email,
		role: invitation.role,
		appRoles: offeredAppRoles(invitation.appRoles),
		inviterName: inviters.get(invitation.inviterId)!,
		expiresAt: invitation.expiresAt.toISOString(),
	}));
}
