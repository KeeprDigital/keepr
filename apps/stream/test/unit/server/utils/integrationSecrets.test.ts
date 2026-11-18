import {
	readConfiguredSecret,
	SHARED_SECRET_MIN_LENGTH,
} from '@keepr/nuxt-layer/server/utils/configuredSecret';
import { describe, expect, it } from 'vitest';
import { INTEGRATION_ADMIN_BOOTSTRAP_TOKEN } from '~~/test/integration/environment';

// The spawned integration server arms the bootstrap with this; a floor above it
// would turn the route the suite acquires its operator through into a 503.
describe("the integration suite's shared secret", () => {
	it('is read as configured', () => {
		expect(
			readConfiguredSecret(INTEGRATION_ADMIN_BOOTSTRAP_TOKEN, 'NUXT_SETTING', {
				minLength: SHARED_SECRET_MIN_LENGTH,
			}),
		).toBe(INTEGRATION_ADMIN_BOOTSTRAP_TOKEN);
	});
});
