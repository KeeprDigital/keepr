import { describe, expect, it } from 'vitest';
import { acceptedReturnAddress } from '~~/shared/utils/returnAddress';

// After signing in, a User is sent back only to an address of their Installation's
// Keepr domain, so a crafted link cannot send them anywhere hostile; local addresses
// only when Keepr Accounts is local.

const PRODUCTION = 'https://accounts.keepr.digital';
const STAGING = 'https://accounts.keepr-staging.digital';
const LOCAL = 'http://localhost:3000';

describe('the return address after signing in', () => {
	it.each([
		[
			'a page of an App',
			PRODUCTION,
			'https://stream.keepr.digital/event/4',
			'https://stream.keepr.digital/event/4',
		],
		['the Keepr domain itself', PRODUCTION, 'https://keepr.digital/', 'https://keepr.digital/'],
		['a page of Keepr Accounts', PRODUCTION, '/profile?tab=sessions', '/profile?tab=sessions'],
		[
			"a page of a staging App, from staging's Keepr Accounts",
			STAGING,
			'https://stream.keepr-staging.digital/event/4',
			'https://stream.keepr-staging.digital/event/4',
		],
		[
			'a local App, from a local Keepr Accounts',
			LOCAL,
			'http://localhost:3001/x',
			'http://localhost:3001/x',
		],
		[
			'a loopback address, from a local Keepr Accounts',
			LOCAL,
			'http://127.0.0.1:8787/',
			'http://127.0.0.1:8787/',
		],
	])('accepts %s', (_case, servedFrom, candidate, accepted) => {
		expect(acceptedReturnAddress(candidate, servedFrom)).toBe(accepted);
	});

	it.each([
		['nothing', PRODUCTION, undefined],
		['an empty address', PRODUCTION, ''],
		['another site', PRODUCTION, 'https://elsewhere.example/'],
		['a host that only ends like Keepr', PRODUCTION, 'https://evilkeepr.digital/'],
		['a host that only starts like Keepr', PRODUCTION, 'https://keepr.digital.example/'],
		['a Keepr host over plain http', PRODUCTION, 'http://stream.keepr.digital/'],
		['a Keepr host behind credentials', PRODUCTION, 'https://user:pass@stream.keepr.digital/'],
		['a scheme-relative address', PRODUCTION, '//elsewhere.example/'],
		['a backslash that browsers read as one', PRODUCTION, '/\\elsewhere.example/'],
		['script', PRODUCTION, 'javascript:alert(1)'],
		['a path a tab turns into another host', PRODUCTION, '/\t/elsewhere.example/'],
		['a path a line break turns into another host', PRODUCTION, '/\n/elsewhere.example/'],
		['a path with a carriage return', PRODUCTION, '/\r/elsewhere.example/'],
		['a Keepr address with a control character', PRODUCTION, 'https://stream.keepr.digital/\u0000'],
		['a path with a delete character', PRODUCTION, '/profile\u007F'],
		['a local address, from production', PRODUCTION, 'http://localhost:3001/'],
		['a staging App, from production', PRODUCTION, 'https://stream.keepr-staging.digital/'],
		["a production App, from staging's Keepr Accounts", STAGING, 'https://stream.keepr.digital/'],
		['another site, from a local Keepr Accounts', LOCAL, 'http://elsewhere.example/'],
	])('refuses %s', (_case, servedFrom, candidate) => {
		expect(acceptedReturnAddress(candidate, servedFrom)).toBeNull();
	});
});
