import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEnsure, mockNavigateTo } = vi.hoisted(() => ({
	mockEnsure: vi.fn(),
	mockNavigateTo: vi.fn(),
}));

vi.mock('~/modules/access/session', () => ({
	useAccess: () => ({ ensure: mockEnsure }),
}));

mockNuxtImport('navigateTo', () => mockNavigateTo);
mockNuxtImport('defineNuxtRouteMiddleware', () => (fn: any) => fn);

const { default: middleware } = await import('~/middleware/access.global');

function createRoute(fullPath: string) {
	const [path, search] = fullPath.split('?');
	const query = Object.fromEntries(new URLSearchParams(search ?? ''));
	return { path, fullPath, query } as any;
}

function runMiddleware(fullPath: string) {
	return middleware(createRoute(fullPath), createRoute('/'));
}

// The page gate is UX over the Session boundary: what it does with each answer
// to "who is this browser". The answers themselves are `useAccess`'s.
describe('access.global middleware', () => {
	beforeEach(() => {
		mockEnsure.mockReset();
		mockNavigateTo.mockReset();
	});

	it.each([
		['lets a signed-in operator through', 'signed-in', '/event/12/matches', undefined],
		// `useIdentity` is already sending the browser to Keepr Accounts.
		['drops the navigation of a signed-out visitor', 'signed-out', '/event/12/matches', false],
		['still gates the Screens control surface', 'signed-out', '/event/12/screens/3', false],
		[
			'does not take an operator off a page over an unanswered ask',
			'unavailable',
			'/event/12/matches',
			undefined,
		],
	])('%s', async (_case, status, path, answer) => {
		mockEnsure.mockResolvedValue(status);

		expect(await runMiddleware(path)).toBe(answer);
		expect(mockNavigateTo).not.toHaveBeenCalled();
	});

	it('tells a User with no App access so, in place of the page they asked for', async () => {
		mockEnsure.mockResolvedValue('no-access');

		await runMiddleware('/event/12/matches');

		expect(mockNavigateTo).toHaveBeenCalledWith('/no-access');
	});

	it.each([
		['the Screen Output page, which has no operator and no cookie', '/event/12/screen/main'],
		['the page that tells a User they have no access', '/no-access'],
	])('leaves %s alone, and does not even ask who the browser is', async (_case, path) => {
		await runMiddleware(path);

		expect(mockNavigateTo).not.toHaveBeenCalled();
		expect(mockEnsure).not.toHaveBeenCalled();
	});
});
