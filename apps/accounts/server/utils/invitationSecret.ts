import type { IdentityDatabase } from '~~/server/db';
import type { InvitationKey } from '~~/shared/utils/invitationLink';
import { eq } from 'drizzle-orm';
import { schema } from '~~/server/db';

/**
 * The secret an Invitation's link carries (ADR-0155): what proves its holder is
 * the invitee, since only they are emailed it. The id names the Invitation and
 * is seen by its inviter, its Organisation's managers and the Audit Record; the
 * secret is seen by none of them, and is kept only as its digest.
 */

export type { InvitationKey } from '~~/shared/utils/invitationLink';

async function digestOf(secret: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** A new secret, to email, and the digest that alone is stored. */
export async function newInvitationSecret(): Promise<{ secret: string; digest: string }> {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	const secret = btoa(String.fromCharCode(...bytes))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replaceAll('=', '');
	return { secret, digest: await digestOf(secret) };
}

/** Whether `secret` is the one `invitationId`'s link carries. An Invitation with none matches nothing. */
export async function holdsInvitationSecret(
	database: IdentityDatabase,
	{ invitationId, secret }: InvitationKey,
): Promise<boolean> {
	if (secret.length === 0) return false;
	const [stored] = await database
		.select({ digest: schema.invitationSecret.digest })
		.from(schema.invitationSecret)
		.where(eq(schema.invitationSecret.invitationId, invitationId));
	return stored?.digest === (await digestOf(secret));
}
