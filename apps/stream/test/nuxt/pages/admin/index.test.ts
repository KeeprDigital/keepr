import { useRouter } from '#app';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockEnsure } = vi.hoisted(() => ({ mockEnsure: vi.fn() }));

vi.mock('~/modules/auth/session', () => ({
	useAuthSession: () => ({ ensure: mockEnsure, status: { value: 'unknown' } }),
}));

describe('/admin', () => {
	afterEach(async () => {
		await useRouter().replace('/');
	});

	// `/admin` lands on the Operations Cockpit, behind the same page gate as
	// every other `/admin/**` page.
	it.each([
		['signed-in', '/admin/graphics-assets', {}],
		['signed-out', '/login', { redirect: '/admin/graphics-assets' }],
	])('a %s browser ends at %s', async (session, path, query) => {
		mockEnsure.mockResolvedValue(session);

		await useRouter().push('/admin');

		const { currentRoute } = useRouter();
		expect({ path: currentRoute.value.path, query: currentRoute.value.query }).toEqual({
			path,
			query,
		});
	});
});
