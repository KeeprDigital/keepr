import { createAccountsStandIn } from './standIn';

/**
 * What only `keepr-accounts-stand-in` sets, as a `wrangler dev --var`: without
 * it the Worker refuses every request, so one deployed by Wrangler alone
 * admits nobody (ADR-0113).
 */
const LAUNCHED_VAR = 'KEEPR_ACCOUNTS_STAND_IN';
const LAUNCHED = 'launched';

// The Accounts Stand-in as a Worker, run locally by `keepr-accounts-stand-in`.
const standIn = createAccountsStandIn();

export default {
	fetch: async (request: Request, env: Record<string, unknown> = {}): Promise<Response> =>
		env[LAUNCHED_VAR] === LAUNCHED
			? await standIn.fetch(request)
			: new Response(
					'The Accounts Stand-in answers only when keepr-accounts-stand-in starts it, and is never deployed.\n',
					{ status: 503 },
				),
};
