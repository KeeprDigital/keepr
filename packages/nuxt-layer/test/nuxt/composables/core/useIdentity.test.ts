import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetch, mockNavigateTo } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
	mockNavigateTo: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('navigateTo', () => mockNavigateTo);

const ADA = {
	user: { id: 'ada', email: 'ada@keepr.digital', name: 'Ada' },
	sessionId: 's',
	organisation: null,
	appRole: 'member',
	keeprAdministrator: false,
};

beforeEach(() => {
	useState('keeprIdentity').value = null;
});

describe('useIdentity', () => {
	it("asks the App's own route who the visitor is", async () => {
		mockFetch.mockResolvedValueOnce(ADA);

		const { identity, load } = useIdentity();
		await load();

		expect(mockFetch).toHaveBeenCalledWith('/api/identity');
		expect(identity.value).toEqual(ADA);
	});

	it('sends a signed-out visitor to Keepr Accounts, to come back here', async () => {
		mockFetch.mockRejectedValueOnce(Object.assign(new Error('401'), { statusCode: 401 }));

		const { identity, load } = useIdentity();
		await load();

		expect(identity.value).toBeNull();
		expect(mockNavigateTo).toHaveBeenCalledWith(
			`https://accounts.keepr.digital/sign-in?returnTo=${encodeURIComponent(window.location.href)}`,
			{ external: true },
		);
	});

	it('leaves any other refusal to its caller, sending nobody away', async () => {
		mockFetch.mockRejectedValueOnce(Object.assign(new Error('503'), { statusCode: 503 }));

		await expect(useIdentity().load()).rejects.toMatchObject({ statusCode: 503 });
		expect(mockNavigateTo).not.toHaveBeenCalled();
	});
});
