import type { H3Event } from 'h3';
import { setResponseHeader } from 'h3';
import { describe, expect, it, vi } from 'vitest';
import {
	A_MEMBER,
	keeprAccountsBinding,
	stubServerGlobals,
	workerRequest,
} from '~~/test/helpers/keeprAccounts';

// "Who am I" tells the page the User and their App role, and nothing more of the
// Identity Proof: not the Session, the Organisation or the Keepr Administrator flag.

stubServerGlobals();
vi.stubGlobal('setResponseHeader', setResponseHeader);
const whoAmI = (await import('~~/server/api/identity.get')).default as unknown as (
	event: H3Event,
) => Promise<unknown>;

describe('GET /api/identity', () => {
	it('answers the User and App role alone', async () => {
		const answer = await whoAmI(
			workerRequest({ as: A_MEMBER, env: { KEEPR_ACCOUNTS: keeprAccountsBinding() } }),
		);

		expect(answer).toEqual({
			user: { id: 'ada', name: 'Ada', email: 'ada@keepr.invalid' },
			appRole: 'member',
		});
	});
});
