import type { EventHandler } from 'h3';
import { eq } from 'drizzle-orm';
import { createApp, createRouter, defineEventHandler, toWebHandler } from 'h3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { identityDatabase, schema } from '~~/server/db';
import { SECURITY_HEADERS } from '~~/server/utils/securityHeaders';
import { createSqliteD1Harness } from '@keepr/nuxt-layer/test/helpers/sqlite-d1';
import {
	cookiesOf,
	createTestAccounts,
	fakeBreachedPasswordService,
	PASSWORD,
} from '~~/test/helpers/keeprAccounts';

// Each of Keepr Accounts' own route handlers, behind the server's middleware, over
// the identity database: one case per route proves its body, route parameters and
// Actor reach the module that owns its rules, which are tested there.

const SECRET = 'a-throwaway-secret-for-the-unit-suite-0123456789';
const RELEASE = { app: '@keepr/accounts', version: '0.0.0-test', commit: 'abc123' };
const ORIGIN = 'http://localhost:3000';

const harness = await createSqliteD1Harness();
const database = identityDatabase(harness.database);
const sentEmail: unknown[] = [];

// What Nitro gives a route on the Worker: its globals, and the bindings in `__env__`.
vi.stubGlobal('defineEventHandler', defineEventHandler);
vi.stubGlobal('useRuntimeConfig', () => ({ betterAuthSecret: SECRET, release: RELEASE }));
vi.stubGlobal('useEvent', () => {
	throw new Error('no request context');
});
vi.stubGlobal('__env__', {
	DB: harness.database,
	EMAIL: { send: async (message: unknown) => void sentEmail.push(message) },
});

const accounts = await createTestAccounts({ harness });

/** A route file's method and path, as Nitro serves it: `[id]` a parameter, `[...all]` the rest. */
function routeOf(file: string): { method: string; path: string } {
	const [, route, method] = file.match(/server(\/api\/.+?)(?:\.(get|post|put|delete))?\.ts$/)!;
	const path = route!
		.replace(/\/index$/, '')
		.replaceAll(/\[\.\.\.\w+\]/g, '**')
		.replaceAll(/\[(\w+)\]/g, ':$1');
	return { method: (method ?? 'any').toUpperCase(), path };
}

const routeFiles = import.meta.glob<{ default: EventHandler }>('../../../server/api/**/*.ts');
const middlewareFiles = import.meta.glob<{ default: EventHandler }>(
	'../../../server/middleware/*.ts',
);

let handle: (request: Request) => Promise<Response>;

beforeAll(async () => {
	fakeBreachedPasswordService();
	const app = createApp();
	for (const load of Object.values(middlewareFiles)) app.use((await load()).default);
	const router = createRouter();
	for (const [file, load] of Object.entries(routeFiles)) {
		const { method, path } = routeOf(file);
		const handler = (await load()).default;
		if (method === 'ANY') router.use(path, handler);
		else router.add(path, handler, method.toLowerCase() as 'get');
	}
	app.use(router);
	handle = toWebHandler(app);
});

afterAll(async () => await harness.close());

let clients = 0;
let people = 0;

/** A User of their own, signed in from a client of its own: their id, address and cookie. */
async function person(extra: { role?: 'admin' } = {}) {
	const email = `person-${(people += 1)}@keepr.digital`;
	const { id } = await accounts.createUser(email, extra);
	const response = await accounts.send('/sign-in/email', {
		body: { email, password: PASSWORD },
		headers: { 'cf-connecting-ip': `198.51.100.${(clients += 1) % 250}` },
	});
	return { id, email, cookie: cookiesOf(response) };
}

/** An Organisation of its own, with an owner and a member who has App access in Stream Keepr. */
async function club() {
	const owner = await person();
	const member = await person();
	const slug = `club-${people}`;
	const { organizationId } = await accounts.addMember(owner.id, slug, { role: 'owner' });
	const { memberId } = await accounts.addMember(member.id, slug, { apps: { stream: 'admin' } });
	return { organizationId, owner, member: { ...member, memberId } };
}

/** A request a browser on Keepr Accounts' own page sends, with `cookie`. */
async function call(
	route: string,
	{
		cookie,
		body,
		headers = {},
	}: { cookie?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
	const [method, path] = route.split(' ') as [string, string];
	return await handle(
		new Request(`${ORIGIN}${path}`, {
			method,
			headers: {
				'sec-fetch-site': 'same-origin',
				...(cookie === undefined ? {} : { cookie }),
				...(body === undefined ? {} : { 'content-type': 'application/json' }),
				...headers,
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		}),
	);
}

async function invitationTo(organizationId: string, owner: { cookie: string }, email: string) {
	const response = await call(`POST /api/organisations/${organizationId}/invitations`, {
		cookie: owner.cookie,
		body: { email, role: 'member', appRoles: { stream: 'member' } },
	});
	const { invitationId } = (await response.json()) as { invitationId: string };
	return { invitationId, secret: emailedSecret(email) };
}

/** The secret of the Invitation last emailed to `to`, read from its link. */
function emailedSecret(to: string): string {
	const sent = JSON.stringify(
		sentEmail.findLast((message) => JSON.stringify(message).includes(to)),
	);
	const fragment = sent.match(/\/invitation#([^\s"\\]+)/)?.[1] ?? '';
	return new URLSearchParams(fragment).get('secret') ?? '';
}

async function roleOf(memberId: string) {
	const [row] = await database
		.select({ role: schema.member.role })
		.from(schema.member)
		.where(eq(schema.member.id, memberId));
	return row?.role ?? null;
}

async function appAccessOf(memberId: string) {
	const rows = await database
		.select({ app: schema.appAccess.app, role: schema.appAccess.role })
		.from(schema.appAccess)
		.where(eq(schema.appAccess.memberId, memberId));
	return Object.fromEntries(rows.map(({ app, role }) => [app, role]));
}

async function disabled(userId: string) {
	const [row] = await database
		.select({ banned: schema.user.banned })
		.from(schema.user)
		.where(eq(schema.user.id, userId));
	return row?.banned === true;
}

/** Each route, by the file that serves it, and a request that shows its inputs reach its work. */
const CASES: [string, () => Promise<void>][] = [
	[
		'GET /api/release',
		async () => {
			expect(await (await call('GET /api/release')).json()).toEqual(RELEASE);
		},
	],
	[
		'ANY /api/auth/**',
		async () => {
			const { email, cookie } = await person();
			const response = await call('GET /api/auth/get-session', { cookie });
			expect(await response.json()).toMatchObject({ user: { email } });
		},
	],
	[
		'GET /api/users/names',
		async () => {
			const { owner, member } = await club();
			const response = await call(`GET /api/users/names?id=${member.id}`, { cookie: owner.cookie });
			expect(await response.json()).toEqual({ names: { [member.id]: member.email.split('@')[0] } });
		},
	],
	[
		'GET /api/profile/organisations',
		async () => {
			const { organizationId, member } = await club();
			const response = await call('GET /api/profile/organisations', { cookie: member.cookie });
			expect(await response.json()).toMatchObject({
				organisations: [{ id: organizationId, role: 'member', apps: { stream: 'admin' } }],
			});
		},
	],
	[
		'GET /api/organisations/:organisationId/standing',
		async () => {
			const { organizationId, owner } = await club();
			const response = await call(`GET /api/organisations/${organizationId}/standing`, {
				cookie: owner.cookie,
			});
			expect(await response.json()).toMatchObject({ standing: 'owner' });
		},
	],
	[
		'GET /api/organisations/:organisationId/members',
		async () => {
			const { organizationId, owner, member } = await club();
			const response = await call(`GET /api/organisations/${organizationId}/members`, {
				cookie: owner.cookie,
			});
			expect(await response.json()).toMatchObject({
				members: expect.arrayContaining([expect.objectContaining({ email: member.email })]),
			});
		},
	],
	[
		'PUT /api/organisations/:organisationId/members/:memberId/role',
		async () => {
			const { organizationId, owner, member } = await club();
			const response = await call(
				`PUT /api/organisations/${organizationId}/members/${member.memberId}/role`,
				{ cookie: owner.cookie, body: { role: 'admin' } },
			);
			expect(response.status).toBe(200);
			expect(await roleOf(member.memberId)).toBe('admin');
		},
	],
	[
		'PUT /api/organisations/:organisationId/members/:memberId/app-access/:app',
		async () => {
			const { organizationId, owner, member } = await club();
			await call(
				`PUT /api/organisations/${organizationId}/members/${member.memberId}/app-access/score`,
				{ cookie: owner.cookie, body: { role: 'member' } },
			);
			expect(await appAccessOf(member.memberId)).toEqual({ stream: 'admin', score: 'member' });
		},
	],
	[
		'DELETE /api/organisations/:organisationId/members/:memberId/app-access/:app',
		async () => {
			const { organizationId, owner, member } = await club();
			await call(
				`DELETE /api/organisations/${organizationId}/members/${member.memberId}/app-access/stream`,
				{ cookie: owner.cookie },
			);
			expect(await appAccessOf(member.memberId)).toEqual({});
		},
	],
	[
		'DELETE /api/organisations/:organisationId/members/:memberId',
		async () => {
			const { organizationId, owner, member } = await club();
			await call(`DELETE /api/organisations/${organizationId}/members/${member.memberId}`, {
				cookie: owner.cookie,
			});
			expect(await roleOf(member.memberId)).toBeNull();
		},
	],
	[
		'POST /api/organisations/:organisationId/invitations',
		async () => {
			const { organizationId, owner } = await club();
			const response = await call(`POST /api/organisations/${organizationId}/invitations`, {
				cookie: owner.cookie,
				body: { email: 'Invitee@Example.com', role: 'admin', appRoles: { stream: 'member' } },
			});
			const { invitationId } = (await response.json()) as { invitationId: string };
			const [row] = await database
				.select()
				.from(schema.invitation)
				.where(eq(schema.invitation.id, invitationId));
			expect(row).toMatchObject({
				organizationId,
				email: 'invitee@example.com',
				role: 'admin',
				appRoles: JSON.stringify({ stream: 'member' }),
				inviterId: owner.id,
			});
		},
	],
	[
		'GET /api/organisations/:organisationId/invitations',
		async () => {
			const { organizationId, owner } = await club();
			await invitationTo(organizationId, owner, 'listed@example.com');
			const response = await call(`GET /api/organisations/${organizationId}/invitations`, {
				cookie: owner.cookie,
			});
			expect(await response.json()).toEqual([
				expect.objectContaining({ email: 'listed@example.com' }),
			]);
		},
	],
	[
		'DELETE /api/organisations/:organisationId/invitations/:invitationId',
		async () => {
			const { organizationId, owner } = await club();
			const key = await invitationTo(organizationId, owner, 'cancelled@example.com');
			await call(`DELETE /api/organisations/${organizationId}/invitations/${key.invitationId}`, {
				cookie: owner.cookie,
			});
			const offer = await call('POST /api/invitation/offer', { body: key });
			expect(await offer.json()).toMatchObject({ code: 'INVITATION_CANCELLED' });
		},
	],
	[
		'POST /api/invitation/offer',
		async () => {
			const { organizationId, owner } = await club();
			const key = await invitationTo(organizationId, owner, 'offered@example.com');
			const response = await call('POST /api/invitation/offer', { body: key });
			expect(await response.json()).toMatchObject({ email: 'offered@example.com' });
		},
	],
	[
		'POST /api/invitation/accept',
		async () => {
			const { organizationId, owner } = await club();
			const key = await invitationTo(organizationId, owner, 'accepting@example.com');
			const response = await call('POST /api/invitation/accept', {
				body: { ...key, name: 'Accepting', password: PASSWORD },
			});
			const session = await call('GET /api/auth/get-session', { cookie: cookiesOf(response) });
			expect(await session.json()).toMatchObject({
				user: { email: 'accepting@example.com', name: 'Accepting' },
				session: { activeOrganizationId: organizationId },
			});
		},
	],
	[
		'POST /api/invitation/decline',
		async () => {
			const { organizationId, owner } = await club();
			const key = await invitationTo(organizationId, owner, 'declining@example.com');
			await call('POST /api/invitation/decline', { body: key });
			const offer = await call('POST /api/invitation/offer', { body: key });
			expect(await offer.json()).toMatchObject({ code: 'INVITATION_DECLINED' });
		},
	],
	[
		'POST /api/invitation/accept-signed-in',
		async () => {
			const { organizationId, owner } = await club();
			const invitee = await person();
			const key = await invitationTo(organizationId, owner, invitee.email);
			await call('POST /api/invitation/accept-signed-in', { cookie: invitee.cookie, body: key });
			const response = await call('GET /api/profile/organisations', { cookie: invitee.cookie });
			expect(await response.json()).toMatchObject({
				organisations: [{ id: organizationId, role: 'member', apps: { stream: 'member' } }],
			});
		},
	],
	[
		// A Keepr Administrator exists in this database: the claim is read, and refused.
		'POST /api/first-administrator/offer',
		async () => {
			await person({ role: 'admin' });
			const claimId = await claimWritten();
			const response = await call('POST /api/first-administrator/offer', { body: { claimId } });
			expect(await response.json()).toMatchObject({ code: 'KEEPR_ADMINISTRATOR_EXISTS' });
		},
	],
	[
		'POST /api/first-administrator/claim',
		async () => {
			await person({ role: 'admin' });
			const claimId = await claimWritten();
			const response = await call('POST /api/first-administrator/claim', {
				body: { claimId, name: 'Founder', password: PASSWORD },
			});
			expect(await response.json()).toMatchObject({ code: 'KEEPR_ADMINISTRATOR_EXISTS' });
		},
	],
	[
		'GET /api/platform/organisations',
		async () => {
			const { organizationId } = await club();
			const { cookie } = await person({ role: 'admin' });
			const response = await call('GET /api/platform/organisations', { cookie });
			expect(await response.json()).toEqual(
				expect.arrayContaining([expect.objectContaining({ id: organizationId, members: 2 })]),
			);
		},
	],
	[
		'POST /api/platform/organisations',
		async () => {
			const { cookie } = await person({ role: 'admin' });
			const response = await call('POST /api/platform/organisations', {
				cookie,
				body: { name: 'Made', ownerEmail: 'made@example.com', appRoles: { stream: 'admin' } },
			});
			expect(await response.json()).toMatchObject({ organisation: { name: 'Made' } });
			const [invitation] = await database
				.select()
				.from(schema.invitation)
				.where(eq(schema.invitation.email, 'made@example.com'));
			expect(invitation).toMatchObject({ role: 'owner', appRoles: '{"stream":"admin"}' });
		},
	],
	[
		'GET /api/platform/users',
		async () => {
			const { email } = await person();
			const { cookie } = await person({ role: 'admin' });
			const response = await call(`GET /api/platform/users?q=${email}`, { cookie });
			expect(await response.json()).toEqual([expect.objectContaining({ email })]);
		},
	],
	[
		'POST /api/platform/users/:userId/disable',
		async () => {
			const { id } = await person();
			const { cookie } = await person({ role: 'admin' });
			await call(`POST /api/platform/users/${id}/disable`, { cookie });
			expect(await disabled(id)).toBe(true);
		},
	],
	[
		'POST /api/platform/users/:userId/enable',
		async () => {
			const { id } = await person();
			const { cookie } = await person({ role: 'admin' });
			await call(`POST /api/platform/users/${id}/disable`, { cookie });
			await call(`POST /api/platform/users/${id}/enable`, { cookie });
			expect(await disabled(id)).toBe(false);
		},
	],
	[
		'POST /api/platform/users/:userId/keepr-administrator',
		async () => {
			const { id, email } = await person();
			const { cookie } = await person({ role: 'admin' });
			await call(`POST /api/platform/users/${id}/keepr-administrator`, { cookie });
			const response = await call(`GET /api/platform/users?q=${email}`, { cookie });
			expect(await response.json()).toEqual([
				expect.objectContaining({ keeprAdministrator: true }),
			]);
		},
	],
	[
		'GET /api/platform/audit-record',
		async () => {
			const { id } = await person();
			const { cookie } = await person({ role: 'admin' });
			await call(`POST /api/platform/users/${id}/disable`, { cookie });
			const response = await call('GET /api/platform/audit-record', { cookie });
			expect(await response.json()).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						action: 'user.disabled',
						subject: expect.objectContaining({ id }),
					}),
				]),
			);
		},
	],
];

let claims = 0;

/** A First Administrator Claim, as the command writes one. */
async function claimWritten() {
	const id = `claim-${(claims += 1)}`;
	await database
		.insert(schema.firstAdministratorClaim)
		.values({ id, email: `founder-${claims}@keepr.digital`, createdAt: new Date() });
	return id;
}

/** Every route, by the file that serves it. */
const ROUTES = Object.keys(routeFiles).map((file) => {
	const { method, path } = routeOf(file);
	return `${method} ${path}`;
});

/** A route's path with each parameter filled. */
function filled(route: string) {
	return route.replace('**', 'get-session').replaceAll(/:(\w+)/g, (_match, name) => `some-${name}`);
}

describe('every route', () => {
	it('has its case here', () => {
		expect(CASES.map(([route]) => route).toSorted()).toEqual(ROUTES.toSorted());
	});

	it.each(CASES)('%s reaches its work with what it was sent', async (_route, check) => {
		expect.hasAssertions();
		await check();
	});
});

/** The routes that need a Session: all but those an invitee, a claimant or an App asks signed out. */
const SIGNED_OUT_ROUTES = new Set([
	'GET /api/release',
	'ANY /api/auth/**',
	'POST /api/invitation/offer',
	'POST /api/invitation/accept',
	'POST /api/invitation/decline',
	// Needs a Session, but asks first for the link's secret, without which it answers none.
	'POST /api/invitation/accept-signed-in',
	'POST /api/first-administrator/offer',
	'POST /api/first-administrator/claim',
]);

describe('a route that needs a Session', () => {
	it.each(ROUTES.filter((route) => !SIGNED_OUT_ROUTES.has(route)))(
		'%s answers 401 to a request with none',
		async (route) => {
			const response = await call(filled(route), {
				body: route.startsWith('GET') ? undefined : {},
			});

			expect(response.status).toBe(401);
		},
	);
});

// As every other write: a cross-site form post could otherwise sign a victim's
// browser in as the attacker's new User.
describe('a write another origin’s page made the browser send', () => {
	it.each(ROUTES.filter((route) => /^(?:POST|PUT|DELETE) /.test(route)))(
		'to %s is refused 403',
		async (route) => {
			const { cookie } = await person({ role: 'admin' });

			const response = await call(filled(route), {
				cookie,
				body: {},
				headers: { 'sec-fetch-site': 'same-site', origin: 'https://stream.keepr.digital' },
			});

			expect(response.status).toBe(403);
			expect(await response.json()).toMatchObject({ code: 'CROSS_SITE_REQUEST' });
		},
	);
});

describe('every response', () => {
	it.each([
		['a page', 'GET /'],
		['an answer of Keepr Accounts’ own', 'GET /api/release'],
		['an answer of the library’s', 'GET /api/auth/get-session'],
		['a refusal', 'GET /api/platform/organisations'],
	])('carries the security headers: %s', async (_case, route) => {
		const response = await call(route);

		expect(Object.fromEntries(response.headers)).toMatchObject(SECURITY_HEADERS);
		expect(SECURITY_HEADERS['content-security-policy']).toContain("frame-ancestors 'none'");
	});

	it.each([
		['Keepr Accounts’ own', 'GET /api/release'],
		['the library’s', 'GET /api/auth/get-session'],
	])('of %s API is not stored', async (_case, route) => {
		expect((await call(route)).headers.get('cache-control')).toBe('no-store');
	});
});
