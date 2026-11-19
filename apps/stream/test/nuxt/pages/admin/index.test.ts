import { useRouter } from '#app';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockEnsure } = vi.hoisted(() => ({ mockEnsure: vi.fn() }));

vi.mock('~/modules/access/session', () => ({
	useAccess: () => ({ ensure: mockEnsure }),
}));

describe('/admin', () => {
	afterEach(async () => {
		await useRouter().replace('/');
	});

	// `/admin` lands on the Operations Cockpit, behind the same page gate as
	// every other `/admin/**` page.
	it.each([
		['signed-in', '/admin/graphics-assets'],
		['no-access', '/no-access'],
	])('a %s browser ends at %s', async (session, path) => {
		mockEnsure.mockResolvedValue(session);

		await useRouter().push('/admin');

		expect(useRouter().currentRoute.value.path).toBe(path);
	});
});
