import type { SqliteD1Harness } from '@keepr/nuxt-layer/test/helpers/sqlite-d1';
import type { EmailRecorder } from '~~/server/email/recorder';
import type { EmailSender } from '~~/server/email/sender';
import type { Actor } from '~~/server/utils/actor';
import type { KeeprAuth } from '~~/server/utils/auth';
import { eq, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { identityDatabase, schema } from '~~/server/db';
import { createEmailRecorder } from '~~/server/email/recorder';
import { requestActor } from '~~/server/utils/actor';
import { createKeeprAuth } from '~~/server/utils/auth';
import { sharedCookieDomainFor } from '~~/server/utils/authOptions';
import { createSqliteD1Harness } from '@keepr/nuxt-layer/test/helpers/sqlite-d1';

/** A host Keepr Accounts answers on locally, where the session cookie is host-only. */
export const LOCAL_HOST = 'localhost:3000';
/** The production host, where the session cookie is shared across Keepr hosts. */
export const PRODUCTION_HOST = 'accounts.keepr.digital';
/** The staging host, where the session cookie is shared across staging's Keepr hosts. */
export const STAGING_HOST = 'accounts.keepr-staging.digital';

/** A password long enough for every rule, and in no breach. */
export const PASSWORD = 'a-long-enough-password';

export interface TestAccounts {
	auth: KeeprAuth;
	harness: SqliteD1Harness;
	/** Every email Keepr Accounts has sent, unless the test handed it a sender of its own. */
	email: EmailRecorder;
	/** Settles the work requests left running after their responses, sending email among it. */
	afterResponses: () => Promise<void>;
	/** Sends a request to Keepr Accounts' `/api/auth` routes, as a browser on `host` would. */
	send: (
		path: string,
		init?: {
			method?: string;
			body?: unknown;
			headers?: Record<string, string>;
			host?: string;
		},
	) => Promise<Response>;
	/** A User, made the way Keepr Accounts makes one: server-side, never by sign-up. */
	createUser: (email: string, extra?: { role?: 'admin' | 'user' }) => Promise<{ id: string }>;
	/** Signs `email` in and answers the cookie a browser would send back. */
	signIn: (email: string, host?: string) => Promise<string>;
	/** Signs `email` in: the Actor their browser is, sending `method` from Keepr Accounts' own page. */
	actor: (email: string, method?: string) => Promise<Actor>;
	/** An Organisation with `ownerEmail`'s User as its owner, made through the library. */
	createOrganisation: (name: string, ownerEmail: string) => Promise<{ id: string }>;
	/** The Audit Record, in the order it was written. */
	auditRecord: () => Promise<(typeof schema.auditRecord.$inferSelect)[]>;
	/**
	 * Makes `userId` a member of the Organisation `slug`, creating it if new, with
	 * an Organisation role and App access. The routes that do this are not built
	 * yet: the same rows, written the way the library writes them.
	 */
	addMember: (
		userId: string,
		slug: string,
		access?: { role?: OrganisationRole; apps?: Record<string, string> },
	) => Promise<{ organizationId: string; memberId: string }>;
}

export type OrganisationRole = 'owner' | 'admin' | 'member';

/**
 * Keepr Accounts' Better Auth, configured as the server configures it, over a
 * SQLite database with the app's real migrations. Each call is a fresh database,
 * unless handed one: two instances over one stand for two Worker isolates.
 */
export async function createTestAccounts(
	options: { host?: string; harness?: SqliteD1Harness; email?: EmailSender } = {},
): Promise<TestAccounts> {
	const host = options.host ?? LOCAL_HOST;
	const harness = options.harness ?? (await createSqliteD1Harness());
	const database = identityDatabase(harness.database);
	const email = createEmailRecorder();
	const running: Promise<unknown>[] = [];
	const auth = createKeeprAuth({
		database,
		secret: 'a-throwaway-secret-for-the-unit-suite-0123456789',
		sharedCookieDomain: sharedCookieDomainFor(host),
		email: options.email ?? email,
		afterResponse: (work) => running.push(work),
	});

	const userIdOf = async (address: string) => {
		const user = await (await auth.$context).internalAdapter.findUserByEmail(address);
		if (!user) throw new Error(`no User for ${address}`);
		return user.user.id;
	};

	const send: TestAccounts['send'] = async (path, init = {}) => {
		const requestHost = init.host ?? host;
		const origin = `${requestHost.startsWith('localhost') ? 'http' : 'https'}://${requestHost}`;
		const method = init.method ?? (init.body === undefined ? 'GET' : 'POST');
		return await auth.handler(
			new Request(`${origin}/api/auth${path}`, {
				method,
				headers: {
					host: requestHost,
					origin,
					...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
					...init.headers,
				},
				...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
			}),
		);
	};

	const signIn: TestAccounts['signIn'] = async (email, signInHost) => {
		const response = await send('/sign-in/email', {
			body: { email, password: PASSWORD },
			host: signInHost,
		});
		if (response.status !== 200) throw new Error(`sign-in answered ${response.status}`);
		return cookiesOf(response);
	};

	return {
		auth,
		harness,
		email,
		async afterResponses() {
			await Promise.all(running.splice(0));
		},
		send,
		async createUser(email, extra = {}) {
			const { user } = await auth.api.createUser({
				body: { email, password: PASSWORD, name: email.split('@')[0]!, role: extra.role },
			});
			return user;
		},
		signIn,
		async actor(email, method = 'POST') {
			return await requestActor(
				auth,
				new Request(`http://${host}/api/organisations`, {
					method,
					headers: { cookie: await signIn(email), 'sec-fetch-site': 'same-origin' },
				}),
			);
		},
		async createOrganisation(name, ownerEmail) {
			const organisation = await auth.api.createOrganization({
				body: {
					name,
					slug: name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-'),
					userId: await userIdOf(ownerEmail),
				},
			});
			if (!organisation) throw new Error(`no Organisation ${name}`);
			return organisation;
		},
		async auditRecord() {
			return await database
				.select()
				.from(schema.auditRecord)
				.orderBy(sql`rowid`);
		},
		async addMember(userId, slug, access = {}) {
			const now = new Date();
			const [existing] = await database
				.select({ id: schema.organization.id })
				.from(schema.organization)
				.where(eq(schema.organization.slug, slug));
			const organizationId = existing?.id ?? randomUUID();
			if (!existing)
				await database
					.insert(schema.organization)
					.values({ id: organizationId, name: slug, slug, createdAt: now });
			const memberId = randomUUID();
			await database.insert(schema.member).values({
				id: memberId,
				organizationId,
				userId,
				role: access.role ?? 'member',
				createdAt: now,
			});
			for (const [app, role] of Object.entries(access.apps ?? {}))
				await database.insert(schema.appAccess).values({
					id: randomUUID(),
					memberId,
					app,
					role,
					createdAt: now,
					updatedAt: now,
				});
			return { organizationId, memberId };
		},
	};
}

/** The `name=value` pairs a response sets, as a browser would send them back. */
export function cookiesOf(response: Response): string {
	return response.headers
		.getSetCookie()
		.map((value) => value.split(';')[0])
		.join('; ');
}

/** The session cookie a response sets: its name, value and lower-cased attributes. */
export function sessionSetCookie(response: Response) {
	const header = response.headers
		.getSetCookie()
		.find((value) => /^(?:__Secure-)?better-auth\.session_token=/.test(value));
	if (!header) return undefined;
	const [pair, ...attributes] = header.split(';').map((part) => part.trim());
	const separator = pair!.indexOf('=');
	return {
		name: pair!.slice(0, separator),
		value: pair!.slice(separator + 1),
		attributes: attributes.map((attribute) => attribute.toLowerCase()),
	};
}

/**
 * The breached-password service, the one outside service Keepr Accounts calls,
 * answered here: a password in `breached` is reported compromised.
 */
export function fakeBreachedPasswordService(breached: readonly string[] = []) {
	const hashes = breached.map((password) =>
		createHash('sha1').update(password).digest('hex').toUpperCase(),
	);
	vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
		const url = String(input instanceof Request ? input.url : input);
		const prefix = url.match(/^https:\/\/api\.pwnedpasswords\.com\/range\/([0-9A-F]{5})$/)?.[1];
		if (!prefix) throw new Error(`No request leaves the unit suite: ${url}`);
		const lines = hashes
			.filter((hash) => hash.startsWith(prefix))
			.map((hash) => `${hash.slice(5)}:42`);
		return new Response(`${lines.join('\r\n')}\r\n`, { status: 200 });
	});
}

/** The breached-password service, unreachable: it answers every check with a 503. */
export function fakeBreachedPasswordServiceDown() {
	vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
		const url = String(input instanceof Request ? input.url : input);
		if (!url.startsWith('https://api.pwnedpasswords.com/'))
			throw new Error(`No request leaves the unit suite: ${url}`);
		return new Response('Service Unavailable', { status: 503 });
	});
}
