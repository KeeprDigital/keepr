import {
	readConfiguredSecret,
	SHARED_SECRET_MIN_LENGTH,
} from '@keepr/nuxt-layer/server/utils/configuredSecret';
import { describe, expect, it } from 'vitest';
import {
	INTEGRATION_ADMIN_BOOTSTRAP_TOKEN,
	INTEGRATION_GRAPHICS_ADMIN_TOKEN,
} from '~~/test/integration/environment';

// The spawned integration server arms both surfaces with these; a floor
// above either would turn every administrator route there into a 503.
describe("the integration suite's shared secrets", () => {
	it.each([
		['INTEGRATION_GRAPHICS_ADMIN_TOKEN', INTEGRATION_GRAPHICS_ADMIN_TOKEN],
		['INTEGRATION_ADMIN_BOOTSTRAP_TOKEN', INTEGRATION_ADMIN_BOOTSTRAP_TOKEN],
	])('%s is read as configured', (_name, fixture) => {
		expect(
			readConfiguredSecret(fixture, 'NUXT_SETTING', { minLength: SHARED_SECRET_MIN_LENGTH }),
		).toBe(fixture);
	});
});
