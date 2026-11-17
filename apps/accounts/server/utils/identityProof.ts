import type { IdentityDatabase } from '~~/server/db';
import type {
	IdentityProofClaims,
	OrganisationRole,
} from '@keepr/nuxt-layer/shared/utils/identityProof';
import { APIError } from 'better-auth/api';
import { and, asc, eq } from 'drizzle-orm';
import { schema } from '~~/server/db';

/**
 * What Keepr Accounts reads from the identity database to mint an Identity
 * Proof, and to give a new Session its active Organisation. Read through the
 * database itself, because App access is Keepr Accounts' own table, which the
 * library's adapter does not know (ADR-0113).
 */
export interface IdentityProofSource {
	/** The Organisation a new Session of `userId` works in: the one they joined first, or none. */
	activeOrganizationAtSignIn: (userId: string) => Promise<string | null>;
	/** The claims an Identity Proof adds for this Session. Refuses a disabled User. */
	claims: (session: {
		user: {
			id: string;
			email: string;
			name: string;
			role?: unknown;
			banned?: unknown;
			banExpires?: unknown;
		};
		session: { id: string; activeOrganizationId?: unknown };
	}) => Promise<IdentityProofClaims>;
}

/** Whether the admin add-on's ban is in force: no end, or an end still to come. */
function isDisabled(user: { banned?: unknown; banExpires?: unknown }): boolean {
	if (user.banned !== true) return false;
	if (user.banExpires === null || user.banExpires === undefined) return true;
	return new Date(user.banExpires as string | number | Date).getTime() > Date.now();
}

export function identityProofSource(database: IdentityDatabase): IdentityProofSource {
	return {
		async activeOrganizationAtSignIn(userId) {
			const [first] = await database
				.select({ organizationId: schema.member.organizationId })
				.from(schema.member)
				.where(eq(schema.member.userId, userId))
				.orderBy(asc(schema.member.createdAt))
				.limit(1);
			return first?.organizationId ?? null;
		},

		async claims({ user, session }) {
			// A disabled User's open Session mints nothing, so disabling reaches every
			// App within one Identity Proof's life even before their Sessions end.
			if (isDisabled(user)) throw new APIError('UNAUTHORIZED');
			const org =
				typeof session.activeOrganizationId === 'string' ? session.activeOrganizationId : null;
			const [member] = org
				? await database
						.select({ id: schema.member.id, role: schema.member.role })
						.from(schema.member)
						.where(and(eq(schema.member.organizationId, org), eq(schema.member.userId, user.id)))
				: [];
			const access = member
				? await database
						.select({ app: schema.appAccess.app, role: schema.appAccess.role })
						.from(schema.appAccess)
						.where(eq(schema.appAccess.memberId, member.id))
				: [];
			return {
				sid: session.id,
				email: user.email,
				name: user.name,
				org: member ? org : null,
				orgRole: (member?.role as OrganisationRole | undefined) ?? null,
				apps: Object.fromEntries(access.map(({ app, role }) => [app, role])),
				// The admin add-on keeps several roles comma-separated.
				keeprAdmin: typeof user.role === 'string' && user.role.split(',').includes('admin'),
			};
		},
	};
}
