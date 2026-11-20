import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import worker from '../src/worker';

// Wrangler alone could deploy the stand-in's Worker; deployed, it must admit
// nobody. Only its launcher hands it the variable that lets it answer.
describe("the Accounts Stand-in's Worker", () => {
	const request = () => new Request('http://keepr-accounts/api/identity');

	it.each([
		['with no environment, as a bare `wrangler deploy` leaves it', {}],
		[
			'with the variable set to anything but its launcher’s value',
			{ KEEPR_ACCOUNTS_STAND_IN: 'true' },
		],
	])('refuses every request %s', async (_case, env) => {
		const response = await worker.fetch(request(), env);

		expect(response.status).toBe(503);
		expect(await response.text()).toContain('keepr-accounts-stand-in');
	});

	it('answers once its launcher started it', async () => {
		const response = await worker.fetch(request(), { KEEPR_ACCOUNTS_STAND_IN: 'launched' });

		expect(response.status).not.toBe(503);
	});

	it('names an account no one holds, so a deploy of its configuration has nowhere to go', () => {
		const config = readFileSync(new URL('../stand-in.wrangler.jsonc', import.meta.url), 'utf8');

		expect(config).toMatch(/"account_id": "0{32}"/);
	});
});
