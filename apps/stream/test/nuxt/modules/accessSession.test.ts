import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '@keepr/nuxt-layer/test/helpers/deferred';
import { useAccess } from '~/modules/access/session';

// What this browser makes of each answer to "who am I" (ADR-0141). The ask and
// the trip to Keepr Accounts are the layer's `useIdentity`, tested there: only
// the network is faked here.

// The module itself, not the recognised browser the shared setup gives every suite.
vi.unmock('~/modules/access/session');

const { mockFetch, mockNavigateTo } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
	mockNavigateTo: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('navigateTo', () => mockNavigateTo);

const ADA = {
	app: 'stream',
	user: { id: 'ada', email: 'ada@keepr.digital', name: 'Ada' },
	sessionId: 's',
	organisation: null,
	appRole: 'member',
	keeprAdministrator: false,
};
const refusal = (statusCode: number) =>
	Object.assign(new Error(String(statusCode)), { statusCode });

beforeEach(() => {
	useState('keeprIdentity').value = null;
	mockFetch.mockReset();
	mockNavigateTo.mockReset();
});

describe('useAccess', () => {
	it.each([
		['a User with App access', () => mockFetch.mockResolvedValueOnce(ADA), 'signed-in'],
		['a signed-out visitor', () => mockFetch.mockRejectedValueOnce(refusal(401)), 'signed-out'],
		['a User with no App access', () => mockFetch.mockRejectedValueOnce(refusal(403)), 'no-access'],
		// The server did not say: never grounds for taking an operator off a page.
		[
			'Keepr Accounts unreachable',
			() => mockFetch.mockRejectedValueOnce(refusal(503)),
			'unavailable',
		],
		[
			'a request that never arrived',
			() => mockFetch.mockRejectedValueOnce(new Error('offline')),
			'unavailable',
		],
		// Only the server calls a browser signed out: an answer that names nobody does not.
		[
			'an answer that is no Identity',
			() => mockFetch.mockResolvedValueOnce(undefined),
			'unavailable',
		],
	])('reads %s as %s', async (_case, answer, status) => {
		answer();

		expect(await useAccess().ensure()).toBe(status);
	});

	it('sends only a signed-out visitor to Keepr Accounts to sign in', async () => {
		mockFetch.mockRejectedValueOnce(refusal(403));
		await useAccess().ensure();
		expect(mockNavigateTo).not.toHaveBeenCalled();

		mockFetch.mockRejectedValueOnce(refusal(401));
		await useAccess().ensure();
		expect(mockNavigateTo).toHaveBeenCalledWith(
			expect.stringContaining('https://accounts.keepr.digital/sign-in?returnTo='),
			{ external: true },
		);
	});

	it('holds the Identity it was given, and does not ask again while it holds one', async () => {
		mockFetch.mockResolvedValueOnce(ADA);
		const access = useAccess();

		await access.ensure();
		await access.ensure();

		expect(access.identity.value).toEqual(ADA);
		expect(mockFetch).toHaveBeenCalledOnce();
	});

	// An outage during one navigation is recovered by the next.
	it('asks again after an answer that gave it nobody', async () => {
		mockFetch.mockRejectedValueOnce(refusal(503)).mockResolvedValueOnce(ADA);

		expect(await useAccess().ensure()).toBe('unavailable');
		expect(await useAccess().ensure()).toBe('signed-in');
	});

	it('shares one ask among callers that ask while it is in the air', async () => {
		const answer = deferred<typeof ADA>();
		mockFetch.mockReturnValueOnce(answer.promise);

		const asks = [useAccess().ensure(), useAccess().ensure(), useAccess().load()];
		answer.resolve(ADA);

		expect(await Promise.all(asks)).toEqual(['signed-in', 'signed-in', 'signed-in']);
		expect(mockFetch).toHaveBeenCalledOnce();
	});

	// A surface whose own request was refused 401 still holds the Identity it
	// was given: `load` asks whatever this browser believes.
	it('asks the server outright on load, whatever Identity it holds', async () => {
		mockFetch.mockResolvedValueOnce(ADA).mockRejectedValueOnce(refusal(401));
		const access = useAccess();
		await access.ensure();

		expect(await access.load()).toBe('signed-out');
		expect(access.identity.value).toBeNull();
	});
});
