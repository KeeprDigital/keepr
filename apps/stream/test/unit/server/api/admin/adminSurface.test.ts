import type { H3Event } from 'h3';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
	A_MEMBER,
	keeprAccountsBinding,
	stubServerGlobals,
	workerRequest,
} from '~~/test/helpers/keeprAccounts';
import { typeScriptFilesUnder } from '~~/test/helpers/routeRefusalScan';

// Every route under `/api/admin/` refuses a User whose App role is `member`, 403,
// as it answers them (ADR-0131): run, not read from its imports. Anything past
// the guard throws, so a route that reaches it has not refused.

const STREAM_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const adminRouteFiles = typeScriptFilesUnder(`${STREAM_ROOT}server/api/admin/`)
	.map((file) => relative(STREAM_ROOT, file))
	.sort();

const pastTheGuard = () => {
	throw new Error('reached past the Graphics Administrator guard');
};
stubServerGlobals();
for (const name of ['readValidatedBody', 'getValidatedQuery', 'getRouterParam', 'readBody'])
	vi.stubGlobal(name, pastTheGuard);
vi.stubGlobal('setResponseHeader', () => {});
vi.doMock('~~/server/modules/graphics-asset-library/runtime', () => ({
	graphicsAssetLibraryForEvent: pastTheGuard,
}));

const accounts = keeprAccountsBinding();

describe('the admin surface', () => {
	it('is found at all, so this cannot pass by running nothing', () => {
		expect(adminRouteFiles.length).toBe(18);
	});

	it.each(adminRouteFiles)('%s refuses a member, 403', async (file) => {
		const handler = (await import(/* @vite-ignore */ `${STREAM_ROOT}${file}`)).default as (
			event: H3Event,
		) => Promise<unknown>;
		const method = /\.(get|post|put|patch|delete)\.ts$/.exec(file)![1]!.toUpperCase();

		const answer = await handler(
			workerRequest({ as: A_MEMBER, method, env: { KEEPR_ACCOUNTS: accounts } }),
		).then(
			(answered) => ({ answered }),
			(refusal: { statusCode?: number; data?: { code?: string } }) => ({
				statusCode: refusal.statusCode,
				code: refusal.data?.code,
			}),
		);

		expect(answer).toEqual({ statusCode: 403, code: 'APP_ROLE_REQUIRED' });
	});
});
