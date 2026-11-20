/**
 * The secret the integration suite invents for itself, and who it asks as.
 *
 * A leaf module, importing only the Accounts Stand-in's cookie, and that is its
 * whole reason for existing separately from `helpers.ts`: the suite's client
 * (`./client.ts`) needs the operator to sign every request as, and `helpers.ts`
 * needs the client for `$fetchRaw`, so holding these in `helpers.ts` would make
 * the two import each other. `helpers.ts` re-exports every name here.
 */

import { standInCookie } from '@keepr/accounts-stand-in/cookie';

export const INTEGRATION_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY =
	'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

/**
 * The operator the suite asks as (ADR-0141): a User of its own, a Graphics
 * Administrator, named to the server's Accounts Stand-in by its cookie. A
 * request the suite forgot to sign carries none, and is refused 401 (ADR-0158).
 */
export const INTEGRATION_OPERATOR_ID = 'integration-operator';
export const INTEGRATION_OPERATOR_NAME = 'Integration Operator';
export const INTEGRATION_OPERATOR_COOKIE = standInCookie({
	user: INTEGRATION_OPERATOR_ID,
	name: INTEGRATION_OPERATOR_NAME,
});

/**
 * What a request sends to ask as a signed-out visitor: the stand-in's own word
 * for it, so the question reaches Keepr Accounts' stand-in, which answers with
 * no Identity Proof as Keepr Accounts answers a browser nobody is signed in on.
 * A request carrying no cookie at all is refused before anyone is asked.
 */
export const INTEGRATION_SIGNED_OUT_COOKIE = standInCookie('signed-out');
