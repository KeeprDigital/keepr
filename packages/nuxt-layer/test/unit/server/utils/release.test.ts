import { expect, it } from 'vitest';
import { ServiceConfigurationError } from '../../../../server/utils/errors';
import { readReleaseIdentity } from '../../../../server/utils/release';

// `/api/release` answers the identity the build baked into runtime config, and
// refuses rather than answering a partial one: the deploy's verify compares it.

const IDENTITY = { app: 'stream', version: '1.8.0', commit: 'c'.repeat(40) };

it('answers the release identity the build recorded', () => {
	expect(readReleaseIdentity({ release: IDENTITY })).toEqual(IDENTITY);
});

it.each([
	['no identity', {}],
	['an identity missing its commit', { release: { app: 'stream', version: '1.8.0' } }],
	['a version that is not text', { release: { ...IDENTITY, version: 1.8 } }],
])('refuses a build that recorded %s', (_case, config) => {
	expect(() => readReleaseIdentity(config)).toThrow(ServiceConfigurationError);
});
