import { describe, expect, it } from 'vitest';
import { isAppId, isAppRole } from '../../../shared/utils/appRegistry';

// App access is assigned only as an App the registry names and a role that App defines.

describe('the App registry', () => {
	it.each([
		['stream', true],
		['score', true],
		['accounts', false],
		// Inherited from every object, so not in the registry.
		['toString', false],
	])('names %s as an App: %s', (app, named) => {
		expect(isAppId(app)).toBe(named);
	});

	it.each([
		['stream', 'admin', true],
		['score', 'member', true],
		['stream', 'owner', false],
		['score', 'Admin', false],
	] as const)('%s defines the App role %s: %s', (app, role, defined) => {
		expect(isAppRole(app, role)).toBe(defined);
	});
});
