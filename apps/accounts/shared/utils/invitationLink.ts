/** An Invitation as its link names it: its id, and the secret only its invitee is emailed. */
export interface InvitationKey {
	invitationId: string;
	secret: string;
}

/**
 * The page an Invitation's link opens, its id and secret in the fragment so no
 * request line or log carries them. Only the invitee is sent it, by email
 * (ADR-0155).
 */
export function invitationLink(origin: string, invitationId: string, secret: string): string {
	const fragment = new URLSearchParams({ id: invitationId, secret });
	return `${origin}/invitation#${fragment}`;
}

/** The Invitation a link's fragment names, as the invitee's page reads it; `null` for none. */
export function invitationInFragment(hash: string): InvitationKey | null {
	const params = new URLSearchParams(hash.replace(/^#/, ''));
	const invitationId = params.get('id');
	const secret = params.get('secret');
	return invitationId && secret ? { invitationId, secret } : null;
}
