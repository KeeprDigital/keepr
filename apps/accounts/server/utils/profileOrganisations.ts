import type { IdentityDatabase } from '~~/server/db';
import type { KeeprAuth } from './auth';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '~~/server/db';
import { KeeprRefusal } from './refusal';

/** One of a User's Organisations, as their profile shows it. */
export interface ProfileOrganisation {
	id: string;
	name: string;
	/** Their Organisation role in it. */
	role: string;
	/** Their App role in each App they can use in it; an App left out is no access. */
	apps: Record<string, string>;
}

export interface ProfileOrganisations {
	/** The Organisation the Session works in, or none. */
	active: string | null;
	/** In the order they joined. */
	organisations: ProfileOrganisation[];
}

/**
 * The signed-in User's Organisations and their App access in each, and the one
 * their Session works in. Read through the database, because App access is Keepr
 * Accounts' own table, which the library does not know. 401 with no Session.
 */
export async function profileOrganisations(
	auth: KeeprAuth,
	database: IdentityDatabase,
	headers: Headers,
): Promise<ProfileOrganisations> {
	const signedIn = await auth.api.getSession({ headers });
	if (!signedIn) throw new KeeprRefusal(401, 'UNAUTHORIZED', 'Sign in to see your organisations.');

	const memberships = await database
		.select({
			memberId: schema.member.id,
			id: schema.organization.id,
			name: schema.organization.name,
			role: schema.member.role,
		})
		.from(schema.member)
		.innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
		.where(eq(schema.member.userId, signedIn.user.id))
		.orderBy(asc(schema.member.createdAt), sql`${schema.member}.rowid`);
	const access =
		memberships.length === 0
			? []
			: await database
					.select({
						memberId: schema.appAccess.memberId,
						app: schema.appAccess.app,
						role: schema.appAccess.role,
					})
					.from(schema.appAccess)
					.where(
						inArray(
							schema.appAccess.memberId,
							memberships.map(({ memberId }) => memberId),
						),
					);

	const active = (signedIn.session as { activeOrganizationId?: string | null })
		.activeOrganizationId;
	return {
		active: memberships.some(({ id }) => id === active) ? active! : null,
		organisations: memberships.map(({ memberId, id, name, role }) => ({
			id,
			name,
			role,
			apps: Object.fromEntries(
				access.filter((row) => row.memberId === memberId).map(({ app, role }) => [app, role]),
			),
		})),
	};
}
