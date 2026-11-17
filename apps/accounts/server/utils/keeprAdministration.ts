import type { IdentityDatabase } from '~~/server/db';
import type { Actor } from './actor';
import type { AppRoles } from './appAccess';
import type { AuditAction } from './auditRecord';
import type { InvitationSending } from './invitations';
import { asc, count, desc, eq, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { schema } from '~~/server/db';
import { offeredAppRoles } from './appAccess';
import { recordAudit } from './auditRecord';
import { invitedAddress, issueInvitation } from './invitations';
import { userIsKeeprAdministrator } from './keeprAdministrator';
import { requireRecentSignIn } from './recentSignIn';
import { KeeprRefusal, refusalFromAuth } from './refusal';

/**
 * What a Keepr Administrator does to run the platform (#1228 § Keepr
 * Administrator), through Keepr Accounts' own routes: the admin add-on's stay
 * closed (`CLOSED_PATHS`). Each checks the Actor is a Keepr Administrator, a
 * change from a recent sign-in, and each change is in the Audit Record.
 */

/** Refuses 403 anyone who is not a Keepr Administrator. */
function requireKeeprAdministrator(actor: Actor): void {
	if (!actor.keeprAdministrator)
		throw new KeeprRefusal(
			403,
			'NOT_A_KEEPR_ADMINISTRATOR',
			'Only a Keepr Administrator can do this.',
		);
}

/** One Organisation as the platform screen lists it. */
export interface ListedOrganisation {
	id: string;
	name: string;
	createdAt: string;
	members: number;
}

/** Every Organisation on the platform, first created first. */
export async function listOrganisations(
	database: IdentityDatabase,
	actor: Actor,
): Promise<ListedOrganisation[]> {
	requireKeeprAdministrator(actor);
	const rows = await database
		.select({
			id: schema.organization.id,
			name: schema.organization.name,
			createdAt: schema.organization.createdAt,
			members: count(schema.member.id),
		})
		.from(schema.organization)
		.leftJoin(schema.member, eq(schema.member.organizationId, schema.organization.id))
		.groupBy(schema.organization.id)
		.orderBy(asc(schema.organization.createdAt), asc(schema.organization.name));
	return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

/** One User as the platform screen finds them. */
export interface FoundUser {
	id: string;
	name: string;
	email: string;
	disabled: boolean;
	keeprAdministrator: boolean;
}

/** How many Users one search answers at most. */
export const FOUND_USERS_LIMIT = 50;

/**
 * The Users whose name or email contains `query`, ignoring case, by name. Every
 * character of the query is matched as itself, a wildcard included.
 */
export async function findUsers(
	database: IdentityDatabase,
	actor: Actor,
	query: string,
): Promise<FoundUser[]> {
	requireKeeprAdministrator(actor);
	const sought = query.trim();
	if (sought.length === 0) return [];
	const pattern = `%${sought.replaceAll(/[\\%_]/g, (character) => `\\${character}`)}%`;
	const rows = await database
		.select({
			id: schema.user.id,
			name: schema.user.name,
			email: schema.user.email,
			banned: schema.user.banned,
			keeprAdministrator: userIsKeeprAdministrator,
		})
		.from(schema.user)
		.where(
			or(
				sql`${schema.user.name} like ${pattern} escape '\\'`,
				sql`${schema.user.email} like ${pattern} escape '\\'`,
			),
		)
		.orderBy(asc(schema.user.name), asc(schema.user.email))
		.limit(FOUND_USERS_LIMIT);
	return rows.map(({ banned, keeprAdministrator, ...found }) => ({
		...found,
		disabled: banned === true,
		keeprAdministrator: Boolean(keeprAdministrator),
	}));
}

export interface NewOrganisation {
	name: string;
	/** The address the first owner is invited at. */
	ownerEmail: string;
	/** The App roles offered to the first owner. */
	appRoles?: unknown;
}

export interface CreatedOrganisation {
	organisation: { id: string; name: string };
	invitationId: string;
	/** The Invitation's link, emailed and shown to copy. */
	link: string;
}

/** A slug for `name`: its letters and digits, hyphenated. */
function slugOf(name: string): string {
	return name
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, '-')
		.replaceAll(/^-|-$/g, '');
}

/**
 * Creates an Organisation and invites its first owner. The Keepr Administrator
 * who creates it does not become a member: the Organisation has none until the
 * invitee accepts, as its owner, with the App roles offered.
 */
export async function createOrganisation(
	database: IdentityDatabase,
	actor: Actor,
	{ name, ownerEmail, appRoles }: NewOrganisation,
	sending: InvitationSending,
): Promise<CreatedOrganisation> {
	requireKeeprAdministrator(actor);
	requireRecentSignIn(actor);
	const named = name.trim();
	if (named.length === 0) throw new KeeprRefusal(400, 'NAME_REQUIRED', 'Name the Organisation.');
	const address = invitedAddress(ownerEmail);
	if (!address)
		throw new KeeprRefusal(400, 'INVALID_EMAIL', 'Enter the first owner’s email address.');
	let offered: AppRoles;
	try {
		offered = offeredAppRoles(appRoles);
	} catch (error) {
		throw refusalFromAuth(error);
	}

	const organisation = { id: crypto.randomUUID(), name: named };
	// Its slug is unique, so of two made at once under one name only one is.
	const [created] = await database
		.insert(schema.organization)
		.values({ ...organisation, slug: slugOf(named) || organisation.id, createdAt: new Date() })
		.onConflictDoNothing()
		.returning({ id: schema.organization.id });
	if (!created)
		throw new KeeprRefusal(409, 'ORGANISATION_EXISTS', 'An Organisation has this name already.');
	await recordAudit(database, {
		action: 'organisation.created',
		actorUserId: actor.userId,
		organizationId: organisation.id,
		detail: { name: named, as: 'keepr-administrator' },
	});
	const { invitationId, link } = await issueInvitation(
		database,
		{
			organisation,
			email: address,
			role: 'owner',
			appRoles: offered,
			inviterId: actor.userId,
			as: 'keepr-administrator',
		},
		sending,
	);
	return { organisation, invitationId, link };
}

/** A User or Organisation an Audit Record row names, as it is now; `null` for none or gone. */
interface Named {
	id: string;
	name: string;
}

/** One row of the Audit Record, as the platform screen shows it. */
export interface SeenAuditRow {
	id: string;
	at: string;
	action: AuditAction;
	actor: (Named & { email: string }) | null;
	subject: (Named & { email: string }) | null;
	organisation: Named | null;
	detail: Record<string, unknown> | null;
}

/** How many rows of the Audit Record the platform screen shows: the latest. */
export const AUDIT_RECORD_SHOWN = 200;

/** The latest rows of the Audit Record, newest first, each naming whom and where. */
export async function readAuditRecord(
	database: IdentityDatabase,
	actor: Actor,
): Promise<SeenAuditRow[]> {
	requireKeeprAdministrator(actor);
	const record = schema.auditRecord;
	const actorUser = alias(schema.user, 'actor_user');
	const subjectUser = alias(schema.user, 'subject_user');
	const rows = await database
		.select({
			id: record.id,
			at: record.at,
			action: record.action,
			detail: record.detail,
			actorId: actorUser.id,
			actorName: actorUser.name,
			actorEmail: actorUser.email,
			subjectId: subjectUser.id,
			subjectName: subjectUser.name,
			subjectEmail: subjectUser.email,
			organisationId: schema.organization.id,
			organisationName: schema.organization.name,
		})
		.from(record)
		.leftJoin(actorUser, eq(actorUser.id, record.actorUserId))
		.leftJoin(subjectUser, eq(subjectUser.id, record.subjectUserId))
		.leftJoin(schema.organization, eq(schema.organization.id, record.organizationId))
		.orderBy(desc(record.at), sql`${record}.rowid desc`)
		.limit(AUDIT_RECORD_SHOWN);
	return rows.map((row) => ({
		id: row.id,
		at: row.at.toISOString(),
		action: row.action as AuditAction,
		actor:
			row.actorId === null
				? null
				: { id: row.actorId, name: row.actorName!, email: row.actorEmail! },
		subject:
			row.subjectId === null
				? null
				: { id: row.subjectId, name: row.subjectName!, email: row.subjectEmail! },
		organisation:
			row.organisationId === null ? null : { id: row.organisationId, name: row.organisationName! },
		detail: row.detail === null ? null : (JSON.parse(row.detail) as Record<string, unknown>),
	}));
}

/** The User `userId`, who a change is made to; 404 when there is none. */
async function userOf(database: IdentityDatabase, userId: string) {
	const [found] = await database
		.select({ id: schema.user.id })
		.from(schema.user)
		.where(eq(schema.user.id, userId));
	if (!found) throw new KeeprRefusal(404, 'USER_NOT_FOUND', 'No such User.');
	return found;
}

/**
 * Disables a User and ends every Session they have, so they are signed out of
 * Keepr Accounts at once and of every App when its Identity Proof lapses. A
 * Keepr Administrator cannot disable themselves.
 */
export async function disableUser(
	database: IdentityDatabase,
	actor: Actor,
	userId: string,
): Promise<void> {
	requireKeeprAdministrator(actor);
	requireRecentSignIn(actor);
	const target = await userOf(database, userId);
	if (target.id === actor.userId)
		throw new KeeprRefusal(409, 'CANNOT_DISABLE_SELF', 'You cannot disable your own account.');
	// Disabled first, so no sign-in can open a Session after they are ended.
	await database
		.update(schema.user)
		.set({ banned: true, banReason: null, banExpires: null, updatedAt: new Date() })
		.where(eq(schema.user.id, target.id));
	const ended = await database
		.delete(schema.session)
		.where(eq(schema.session.userId, target.id))
		.returning({ id: schema.session.id });
	await recordAudit(database, {
		action: 'user.disabled',
		actorUserId: actor.userId,
		subjectUserId: target.id,
	});
	await recordAudit(database, {
		action: 'user.sessions-ended',
		actorUserId: actor.userId,
		subjectUserId: target.id,
		detail: { sessionsEnded: ended.length },
	});
}

/** Enables a disabled User again: they sign in as before. */
export async function enableUser(
	database: IdentityDatabase,
	actor: Actor,
	userId: string,
): Promise<void> {
	requireKeeprAdministrator(actor);
	requireRecentSignIn(actor);
	const target = await userOf(database, userId);
	await database
		.update(schema.user)
		.set({ banned: false, banReason: null, banExpires: null, updatedAt: new Date() })
		.where(eq(schema.user.id, target.id));
	await recordAudit(database, {
		action: 'user.enabled',
		actorUserId: actor.userId,
		subjectUserId: target.id,
	});
}
