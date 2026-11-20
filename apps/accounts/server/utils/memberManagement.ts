import type { IdentityDatabase } from '~~/server/db';
import type { Actor } from './actor';
import type { AppRoles } from './appAccess';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '~~/server/db';
import { isAppId, isAppRole } from '@keepr/nuxt-layer/shared/utils/appRegistry';
import { isOrganisationRole } from '@keepr/nuxt-layer/shared/utils/identityProof';
import { APP_ROLE_NOT_IN_REGISTRY } from './appAccess';
import { recordAudit } from './auditRecord';
import { requireRecentSignIn } from './recentSignIn';
import { KeeprRefusal } from './refusal';

/**
 * Managing an Organisation's members and their App access (ADR-0114). Who may
 * manage, and how far, is decided once, in `managingStanding`.
 */

/** One member as the member screen shows them. */
export interface ListedMember {
	memberId: string;
	userId: string;
	name: string;
	email: string;
	role: string;
	apps: AppRoles;
}

/**
 * How far an Actor may manage one Organisation's members: as its owner or admin,
 * or as a Keepr Administrator, who manages any Organisation as an owner would
 * (#1228 story 48).
 */
export type ManagingStanding = 'owner' | 'admin' | 'keepr-administrator';

export interface ManagedOrganisation {
	organisation: { id: string; name: string };
	standing: ManagingStanding;
}

export interface MemberList extends ManagedOrganisation {
	members: ListedMember[];
}

const notAManager = () =>
	new KeeprRefusal(
		403,
		'NOT_A_MANAGER',
		'Only an owner or admin of this Organisation can manage its members.',
	);

/**
 * The one place that decides whether `actor` manages `organizationId`'s members,
 * and as what. Anyone else is refused 403, an unknown Organisation included, so
 * the answer tells nobody which Organisations exist.
 */
export async function managingStanding(
	database: IdentityDatabase,
	actor: Actor,
	organizationId: string,
): Promise<ManagedOrganisation> {
	const [found] = await database
		.select({
			id: schema.organization.id,
			name: schema.organization.name,
			role: schema.member.role,
		})
		.from(schema.organization)
		.leftJoin(
			schema.member,
			and(
				eq(schema.member.organizationId, schema.organization.id),
				eq(schema.member.userId, actor.userId),
			),
		)
		.where(eq(schema.organization.id, organizationId));
	if (!found) throw notAManager();
	const organisation = { id: found.id, name: found.name };
	if (actor.keeprAdministrator) return { organisation, standing: 'keepr-administrator' };
	if (found.role === 'owner' || found.role === 'admin')
		return { organisation, standing: found.role };
	throw notAManager();
}

/**
 * The standing a change to `organizationId`'s members is made with: as
 * `managingStanding`, from a sign-in no older than ten minutes.
 */
async function managingChange(
	database: IdentityDatabase,
	actor: Actor,
	organizationId: string,
): Promise<ManagedOrganisation> {
	const managed = await managingStanding(database, actor, organizationId);
	requireRecentSignIn(actor);
	return managed;
}

/** Every member of `organizationId`, first joined first, with their App access. */
export async function listMembers(
	database: IdentityDatabase,
	actor: Actor,
	organizationId: string,
): Promise<MemberList> {
	const managed = await managingStanding(database, actor, organizationId);
	const members = await database
		.select({
			memberId: schema.member.id,
			userId: schema.member.userId,
			name: schema.user.name,
			email: schema.user.email,
			role: schema.member.role,
		})
		.from(schema.member)
		.innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
		.where(eq(schema.member.organizationId, organizationId))
		.orderBy(asc(schema.member.createdAt));
	const access =
		members.length === 0
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
							members.map(({ memberId }) => memberId),
						),
					);
	return {
		...managed,
		members: members.map((listed) => ({
			...listed,
			apps: Object.fromEntries(
				access
					.filter(({ memberId }) => memberId === listed.memberId)
					.map(({ app, role }) => [app, role]),
			),
		})),
	};
}

/** One member of `organizationId`, who a change is made to. */
async function memberOf(database: IdentityDatabase, organizationId: string, memberId: string) {
	const [found] = await database
		.select({ id: schema.member.id, userId: schema.member.userId, role: schema.member.role })
		.from(schema.member)
		.where(and(eq(schema.member.id, memberId), eq(schema.member.organizationId, organizationId)));
	if (!found)
		throw new KeeprRefusal(404, 'MEMBER_NOT_FOUND', 'No such member of this Organisation.');
	return found;
}

export interface MemberChange {
	organizationId: string;
	memberId: string;
}

/**
 * Gives a member `role` in `app`, in place of any App role they held there. An
 * App the App registry does not name, or a role it does not define, is refused
 * 400 and changes nothing.
 */
export async function setAppAccess(
	database: IdentityDatabase,
	actor: Actor,
	{ organizationId, memberId, app, role }: MemberChange & { app: string; role: string },
): Promise<void> {
	const { standing } = await managingChange(database, actor, organizationId);
	const target = await memberOf(database, organizationId, memberId);
	if (!isAppId(app) || !isAppRole(app, role))
		throw new KeeprRefusal(400, APP_ROLE_NOT_IN_REGISTRY, `${app} defines no App role ${role}.`);
	const [held] = await database
		.select({ role: schema.appAccess.role })
		.from(schema.appAccess)
		.where(and(eq(schema.appAccess.memberId, memberId), eq(schema.appAccess.app, app)));
	const now = new Date();
	await database
		.insert(schema.appAccess)
		.values({ id: crypto.randomUUID(), memberId, app, role, createdAt: now, updatedAt: now })
		.onConflictDoUpdate({
			target: [schema.appAccess.memberId, schema.appAccess.app],
			set: { role, updatedAt: now },
		});
	await recordAudit(database, {
		action: 'app-access.set',
		actorUserId: actor.userId,
		organizationId,
		subjectUserId: target.userId,
		detail: { memberId, app, role, was: held?.role ?? null, as: standing },
	});
}

export const ownerRequired = () =>
	new KeeprRefusal(403, 'OWNER_REQUIRED', 'Only an owner of this Organisation can do this.');
const lastOwner = () =>
	new KeeprRefusal(
		409,
		'LAST_OWNER',
		'This is the Organisation’s last owner. Make someone else an owner first.',
	);

/**
 * Whether the member a write names may stop being an owner: they are not one, or
 * the Organisation has another. Part of the write itself, so of two demotions
 * made at once only one can leave the Organisation without an owner: neither.
 */
function keepsAnOwner(organizationId: string) {
	return sql`(${schema.member.role} <> 'owner' or (select count(*) from ${schema.member} as owners where owners.organization_id = ${organizationId} and owners.role = 'owner') > 1)`;
}

/**
 * Changes a member's Organisation role. Only an owner, or a Keepr
 * Administrator, may; and the last owner is never demoted.
 */
export async function changeOrganisationRole(
	database: IdentityDatabase,
	actor: Actor,
	{ organizationId, memberId, role }: MemberChange & { role: string },
): Promise<void> {
	const { standing } = await managingChange(database, actor, organizationId);
	if (standing === 'admin') throw ownerRequired();
	const target = await memberOf(database, organizationId, memberId);
	if (!isOrganisationRole(role))
		throw new KeeprRefusal(400, 'ORGANISATION_ROLE_NOT_KNOWN', `No Organisation role is ${role}.`);
	const [changed] = await database
		.update(schema.member)
		.set({ role })
		.where(
			and(
				eq(schema.member.id, memberId),
				role === 'owner' ? undefined : keepsAnOwner(organizationId),
			),
		)
		.returning({ id: schema.member.id });
	if (!changed) throw lastOwner();
	await recordAudit(database, {
		action: 'member.role-changed',
		actorUserId: actor.userId,
		organizationId,
		subjectUserId: target.userId,
		detail: { memberId, role, was: target.role, as: standing },
	});
}

/**
 * Removes a member from the Organisation, with all their App access. Only an
 * owner, or a Keepr Administrator, removes an owner; and the last owner is never
 * removed.
 */
export async function removeMember(
	database: IdentityDatabase,
	actor: Actor,
	{ organizationId, memberId }: MemberChange,
): Promise<void> {
	const { standing } = await managingChange(database, actor, organizationId);
	const target = await memberOf(database, organizationId, memberId);
	if (target.role === 'owner' && standing === 'admin') throw ownerRequired();
	const access = await database
		.select({ app: schema.appAccess.app, role: schema.appAccess.role })
		.from(schema.appAccess)
		.where(eq(schema.appAccess.memberId, memberId));
	const [removed] = await database
		.delete(schema.member)
		.where(and(eq(schema.member.id, memberId), keepsAnOwner(organizationId)))
		.returning({ id: schema.member.id });
	if (!removed) throw lastOwner();
	await recordAudit(database, {
		action: 'member.removed',
		actorUserId: actor.userId,
		organizationId,
		subjectUserId: target.userId,
		detail: {
			memberId,
			role: target.role,
			apps: Object.fromEntries(access.map(({ app, role }) => [app, role])),
			as: standing,
		},
	});
}

/** Takes a member's App access in `app` away; they stay a member, with any other. */
export async function removeAppAccess(
	database: IdentityDatabase,
	actor: Actor,
	{ organizationId, memberId, app }: MemberChange & { app: string },
): Promise<void> {
	const { standing } = await managingChange(database, actor, organizationId);
	const target = await memberOf(database, organizationId, memberId);
	const [removed] = await database
		.delete(schema.appAccess)
		.where(and(eq(schema.appAccess.memberId, memberId), eq(schema.appAccess.app, app)))
		.returning({ role: schema.appAccess.role });
	// Nothing held is nothing changed, and nothing to record.
	if (!removed) return;
	await recordAudit(database, {
		action: 'app-access.removed',
		actorUserId: actor.userId,
		organizationId,
		subjectUserId: target.userId,
		detail: { memberId, app, was: removed.role, as: standing },
	});
}
