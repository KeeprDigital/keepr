import { expect, it, vi } from 'vitest';
import {
	A_MEMBER,
	keeprAccountsBinding,
	stubServerGlobals,
	workerRequest,
} from '~~/test/helpers/keeprAccounts';

/**
 * Stream Keepr's reading of who a request belongs to shares the Identity Proof
 * across the Worker's isolates, through the Worker's Cache API (ADR-0150). The
 * cache is faked at its boundary; the rule's branches are tested at the
 * resolver's home, in `apps/accounts`.
 */

stubServerGlobals();

const kept = new Map<string, string>();
vi.stubGlobal('caches', {
	open: async () => ({
		match: async (url: string) => (kept.has(url) ? new Response(kept.get(url)) : undefined),
		put: async (url: string, response: Response) => void kept.set(url, await response.text()),
		delete: async (url: string) => kept.delete(url),
	}),
});

const accounts = keeprAccountsBinding();

/** `requestIdentity` as one isolate of the Worker holds it: a fresh copy of the module. */
async function isolate() {
	vi.resetModules();
	return (await import('~~/server/utils/session')).requestIdentity;
}

/** A request whose writes to the cache are awaited, as `ctx.waitUntil` keeps them. */
async function readAs(requestIdentity: Awaited<ReturnType<typeof isolate>>) {
	const pending: Promise<unknown>[] = [];
	const event = workerRequest({ as: A_MEMBER, env: { KEEPR_ACCOUNTS: accounts } });
	// The request Cloudflare routed to the Worker, as Nitro hands it on.
	Object.assign(event.context.cloudflare as object, {
		request: new Request('https://stream.keepr.digital/api/events'),
	});
	Object.assign(event, { waitUntil: (promise: Promise<unknown>) => void pending.push(promise) });
	const identity = await requestIdentity(event);
	await Promise.all(pending);
	return identity;
}

it('answers a second isolate from the Identity Proof the first was given, asking nothing', async () => {
	await readAs(await isolate());
	accounts.asked.length = 0;

	const identity = await readAs(await isolate());

	expect(identity).toMatchObject({ user: { id: 'ada' }, appRole: 'member' });
	expect(accounts.asked).toEqual([]);
});
