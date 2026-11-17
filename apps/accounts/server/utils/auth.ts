import type { IdentityDatabase } from '~~/server/db';
import type { AuthOptionsInput } from './authOptions';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db, schema } from '~~/server/db';
import { authOptions, sharedCookieDomainFor } from './authOptions';
import { runAfterResponse, serverEmailSender } from './email';
import { identityProofSource } from './identityProof';
import { readConfiguredSecret } from '@keepr/nuxt-layer/server/utils/configuredSecret';
import { ServiceConfigurationError } from '@keepr/nuxt-layer/server/utils/errors';

/** The setting behind `runtimeConfig.betterAuthSecret`, as the operator sets it. */
const SECRET_SETTING = 'NUXT_BETTER_AUTH_SECRET';

/**
 * A Better Auth instance as Keepr Accounts configures it, over `database`. The
 * server builds its own with this, and so does every test.
 */
export function createKeeprAuth({
	database,
	secret,
	...options
}: Omit<AuthOptionsInput, 'identityProof'> & {
	database: IdentityDatabase;
	secret: string;
}) {
	return betterAuth({
		...authOptions({ ...options, identityProof: identityProofSource(database) }),
		database: drizzleAdapter(database, {
			provider: 'sqlite',
			schema,
			// D1 has no interactive transactions; stated so a default cannot turn them on.
			transaction: false,
		}),
		secret,
	});
}

export type KeeprAuth = ReturnType<typeof createKeeprAuth>;

const instances = new Map<string | undefined, KeeprAuth>();

/**
 * The instance that answers a request to `host`. Built on first use, because the
 * secret exists only at runtime; one per cookie domain, because the session
 * cookie is shared across Keepr hosts only when served on one
 * (`sharedCookieDomainFor`). A blank secret is an unfinished deployment, and
 * answers 503 naming the setting.
 */
export function serverAuth(host: string): KeeprAuth {
	const sharedCookieDomain = sharedCookieDomainFor(host);
	let auth = instances.get(sharedCookieDomain);
	if (!auth) {
		const secret = readConfiguredSecret(useRuntimeConfig().betterAuthSecret, SECRET_SETTING);
		if (!secret)
			throw new ServiceConfigurationError(
				SECRET_SETTING,
				'is not configured, so nobody can sign in to Keepr Accounts',
			);
		auth = createKeeprAuth({
			database: db(),
			secret,
			sharedCookieDomain,
			email: serverEmailSender(),
			afterResponse: runAfterResponse,
		});
		instances.set(sharedCookieDomain, auth);
	}
	return auth;
}
