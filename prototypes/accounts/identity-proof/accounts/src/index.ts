// Spike 2 (#1256). Throwaway: Keepr Accounts reduced to what minting an
// Identity Proof needs. Memory adapter: one isolate under `wrangler dev` keeps
// it for the run, and Better Auth on D1 is already proven by Stream Keepr.
import { betterAuth } from 'better-auth';
import { memoryAdapter } from '@better-auth/memory-adapter';
import { admin, jwt, organization } from 'better-auth/plugins';

const ISSUER = 'https://accounts.keepr.digital';
const AUDIENCE = 'https://keepr.digital';

const db: Record<string, Record<string, unknown>[]> = {
	user: [], session: [], account: [], verification: [], jwks: [],
	organization: [], member: [], invitation: [], appAccess: [],
};

const auth = betterAuth({
	secret: 'spike-secret-spike-secret-spike-secret-0123456789',
	database: memoryAdapter(db),
	baseURL: {
		allowedHosts: ['accounts.keepr.digital', 'localhost:*', '127.0.0.1:*'],
		fallback: 'https://accounts.keepr.digital',
		protocol: 'auto',
	},
	emailAndPassword: { enabled: true, disableSignUp: true },
	// updateAge is 2s so a /token call after 2s measures whether a renewed cookie comes back.
	session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 2 },
	advanced: { disableOriginCheck: false },
	plugins: [
		admin(),
		organization(),
		jwt({
			jwt: {
				issuer: ISSUER,
				audience: AUDIENCE,
				expirationTime: '5m',
				// The Identity Proof's claims. definePayload is handed only the session,
				// so the member and App-access rows come from the adapter directly.
				definePayload: async ({ user, session }) => {
					const ctx = await auth.$context;
					const orgId = (session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;
					const member = orgId
						? await ctx.adapter.findOne<{ id: string; role: string }>({
								model: 'member',
								where: [{ field: 'organizationId', value: orgId }, { field: 'userId', value: user.id }],
							})
						: null;
					const apps = Object.fromEntries(
						member
							? (db.appAccess as { memberId: string; app: string; role: string }[])
									.filter((row) => row.memberId === member.id)
									.map((row) => [row.app, row.role])
							: [],
					);
					return {
						sid: session.id,
						email: user.email,
						name: user.name,
						org: orgId,
						orgRole: member?.role ?? null,
						apps,
						keeprAdmin: (user as { role?: string }).role === 'admin',
					};
				},
			},
		}),
	],
});

export default {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		// Spike-only seeding: a User, an Organisation with them as owner, and App access.
		if (url.pathname === '/spike/seed') {
			const ctx = await auth.$context;
			const user = await ctx.internalAdapter.createUser({
				email: 'ada@example.com', name: 'Ada', emailVerified: true, role: 'admin',
			});
			await ctx.internalAdapter.linkAccount({
				userId: user.id, providerId: 'credential', accountId: user.id,
				password: await ctx.password.hash('correct horse battery staple'),
			});
			const org = await auth.api.createOrganization({ body: { name: 'Keepr', slug: 'keepr', userId: user.id } });
			const member = await ctx.adapter.findOne<{ id: string }>({
				model: 'member', where: [{ field: 'userId', value: user.id }],
			});
			db.appAccess.push({ memberId: member!.id, app: 'stream', role: 'admin' });
			return Response.json({ user, org });
		}
		// Spike-only: tokens a hostile or broken issuer would produce, signed with the real key.
		if (url.pathname === '/spike/forge') {
			const payload = JSON.parse(url.searchParams.get('payload') ?? '{}');
			const overrideOptions = JSON.parse(url.searchParams.get('override') ?? '{}');
			const { token } = await auth.api.signJWT({ body: { payload, overrideOptions } });
			return Response.json({ token });
		}
		return auth.handler(request);
	},
};
