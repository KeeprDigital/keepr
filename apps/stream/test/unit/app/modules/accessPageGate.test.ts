import { describe, expect, it } from 'vitest';
import { isScreenOutputPage, NO_ACCESS_PATH, pageRequiresSession } from '~/modules/access/pageGate';

// Deny-by-default: a page is gated unless it is one of the two exemptions, each
// an exact shape, so a page added beside one is gated until somebody decides.
describe('pageRequiresSession', () => {
	it.each([
		['an ordinary operator page', '/', true],
		['the Screen Output page', '/event/12/screen/main', false],
		['the Screens control surface, which differs by one letter', '/event/12/screens/3', true],
		['a page under the Screen Output page', '/event/12/screen/main/settings', true],
		['the page that tells a User they have no access', NO_ACCESS_PATH, false],
		['a page that merely starts like it', `${NO_ACCESS_PATH}-policy`, true],
	])('%s: %s', (_case, path, gated) => {
		expect(pageRequiresSession(path)).toBe(gated);
	});
});

describe('isScreenOutputPage', () => {
	it.each([
		['/event/12/screen/main', true],
		['/event/12/screen/main/', true],
		['/event/12/screens/3', false],
		['/no-access', false],
	])('%s: %s', (path, output) => {
		expect(isScreenOutputPage(path)).toBe(output);
	});
});
