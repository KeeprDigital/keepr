import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * The identity schema: Better Auth's tables for the add-ons Keepr Accounts runs,
 * and four of its own. Written by hand and held to the library's own table
 * definitions by `test/unit/server/db/identitySchema.test.ts`, which a library bump
 * that changes a field fails (ADR-0112).
 *
 * A property key is the library's field name, which its Drizzle adapter resolves
 * columns by; the SQL name underneath is snake_case. Table names equal the model
 * names. The library issues its own string ids and writes every timestamp itself,
 * so no column here carries a database default.
 */

// ---- Better Auth: users, Sessions, credentials ---------------------------------

export const user = sqliteTable('user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: integer('email_verified', { mode: 'boolean' }).notNull(),
	image: text('image'),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
	// The admin add-on: `admin` marks a Keepr Administrator; `banned` a disabled User.
	role: text('role'),
	banned: integer('banned', { mode: 'boolean' }),
	banReason: text('ban_reason'),
	banExpires: integer('ban_expires', { mode: 'timestamp_ms' }),
});

export const session = sqliteTable(
	'session',
	{
		id: text('id').primaryKey(),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		token: text('token').notNull().unique(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		userId: text('user_id')
			.references(() => user.id, { onDelete: 'cascade' })
			.notNull(),
		// The admin add-on's. Its impersonation route is closed (`CLOSED_PATHS`).
		impersonatedBy: text('impersonated_by'),
		// The organisation add-on: the Organisation this Session is working in.
		activeOrganizationId: text('active_organization_id'),
	},
	(table) => [index('session_user_id_idx').on(table.userId)],
);

export const account = sqliteTable(
	'account',
	{
		id: text('id').primaryKey(),
		accountId: text('account_id').notNull(),
		providerId: text('provider_id').notNull(),
		userId: text('user_id')
			.references(() => user.id, { onDelete: 'cascade' })
			.notNull(),
		accessToken: text('access_token'),
		refreshToken: text('refresh_token'),
		idToken: text('id_token'),
		accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
		refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
		scope: text('scope'),
		password: text('password'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
	},
	(table) => [index('account_user_id_idx').on(table.userId)],
);

export const verification = sqliteTable(
	'verification',
	{
		id: text('id').primaryKey(),
		identifier: text('identifier').notNull(),
		value: text('value').notNull(),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
	},
	(table) => [index('verification_identifier_idx').on(table.identifier)],
);

/** The rate limiter's counts, one row per client and path. `lastRequest` is epoch ms. */
export const rateLimit = sqliteTable('rateLimit', {
	id: text('id').primaryKey(),
	key: text('key').notNull().unique(),
	count: integer('count').notNull(),
	lastRequest: integer('last_request').notNull(),
});

// ---- Better Auth: Organisations, members, Invitations --------------------------

export const organization = sqliteTable(
	'organization',
	{
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		slug: text('slug').notNull().unique(),
		logo: text('logo'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		metadata: text('metadata'),
	},
	(table) => [index('organization_slug_idx').on(table.slug)],
);

/** A User's membership of one Organisation, with their Organisation role. */
export const member = sqliteTable(
	'member',
	{
		id: text('id').primaryKey(),
		organizationId: text('organization_id')
			.references(() => organization.id)
			.notNull(),
		userId: text('user_id')
			.references(() => user.id)
			.notNull(),
		role: text('role').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	},
	(table) => [
		index('member_organization_id_idx').on(table.organizationId),
		index('member_user_id_idx').on(table.userId),
		// One membership per User and Organisation, so two accepts at once make one.
		uniqueIndex('member_organization_user_idx').on(table.organizationId, table.userId),
	],
);

export const invitation = sqliteTable(
	'invitation',
	{
		id: text('id').primaryKey(),
		organizationId: text('organization_id')
			.references(() => organization.id)
			.notNull(),
		email: text('email').notNull(),
		role: text('role'),
		status: text('status').notNull(),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		inviterId: text('inviter_id')
			.references(() => user.id)
			.notNull(),
		// Keepr's: the App role offered in each App, as JSON (`{ "stream": "admin" }`).
		appRoles: text('app_roles'),
	},
	(table) => [
		index('invitation_organization_id_idx').on(table.organizationId),
		index('invitation_email_idx').on(table.email),
	],
);

// ---- Better Auth: the keys Identity Proofs are signed with ---------------------

export const jwks = sqliteTable('jwks', {
	id: text('id').primaryKey(),
	publicKey: text('public_key').notNull(),
	// Encrypted with the sign-in secret by the library.
	privateKey: text('private_key').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
	alg: text('alg'),
	crv: text('crv'),
});

// ---- Keepr Accounts' own ---------------------------------------------------------

/**
 * App access: the one App role a member holds in an App, or no row for none. The
 * App and the role are names from the App registry, checked when assigned, so a
 * new App or role needs no migration.
 */
export const appAccess = sqliteTable(
	'appAccess',
	{
		id: text('id').primaryKey(),
		memberId: text('member_id')
			.references(() => member.id, { onDelete: 'cascade' })
			.notNull(),
		app: text('app').notNull(),
		role: text('role').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
	},
	(table) => [uniqueIndex('app_access_member_app_idx').on(table.memberId, table.app)],
);

/**
 * The Audit Record: one row per administrative action, only ever added. Who acted
 * and whom it touched are kept as ids without a foreign key, so the record
 * outlives anything it names.
 */
export const auditRecord = sqliteTable(
	'auditRecord',
	{
		id: text('id').primaryKey(),
		at: integer('at', { mode: 'timestamp_ms' }).notNull(),
		actorUserId: text('actor_user_id'),
		action: text('action').notNull(),
		organizationId: text('organization_id'),
		subjectUserId: text('subject_user_id'),
		// What else the action needs to be understood, as JSON.
		detail: text('detail'),
	},
	(table) => [
		index('audit_record_at_idx').on(table.at),
		index('audit_record_organization_id_idx').on(table.organizationId),
		index('audit_record_subject_user_id_idx').on(table.subjectUserId),
	],
);

/**
 * The First Administrator Claim: the one-time offer of the first Keepr
 * Administrator role to an email address, written by a command and never by a
 * request. Consumed once, by the User it created.
 */
export const firstAdministratorClaim = sqliteTable('firstAdministratorClaim', {
	id: text('id').primaryKey(),
	email: text('email').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	consumedAt: integer('consumed_at', { mode: 'timestamp_ms' }),
	consumedByUserId: text('consumed_by_user_id').references(() => user.id),
});

/**
 * The secret an Invitation's emailed link carries, kept only as its SHA-256
 * digest. Keepr Accounts' own table, which the library does not know, so none of
 * its routes can answer it. An Invitation without one is never answered.
 */
export const invitationSecret = sqliteTable('invitationSecret', {
	invitationId: text('invitation_id')
		.primaryKey()
		.references(() => invitation.id, { onDelete: 'cascade' }),
	digest: text('digest').notNull(),
});
