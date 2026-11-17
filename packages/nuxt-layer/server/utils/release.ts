import type { ReleaseIdentity } from '../../shared/utils/release';
import { ServiceConfigurationError } from './errors';

const FIELDS = ['app', 'version', 'commit'] as const;

/**
 * The Release this Worker serves, as its build recorded it in runtime config
 * (`nuxt.config.ts`). An app serves it at `RELEASE_PATH`, reachable without a
 * sign-in:
 * `export default defineEventHandler((event) => readReleaseIdentity(useRuntimeConfig(event)))`.
 *
 * A build that recorded none, or only part of one, is refused: verify compares
 * every field, and a guess would let the wrong Release pass.
 */
export function readReleaseIdentity(config: { release?: unknown }): ReleaseIdentity {
	const release = config.release as Partial<Record<(typeof FIELDS)[number], unknown>> | undefined;
	if (!release || !FIELDS.every((field) => typeof release[field] === 'string'))
		throw new ServiceConfigurationError(
			'runtimeConfig.release',
			'is not the { app, version, commit } a build records: rebuild the Worker.',
		);
	const { app, version, commit } = release as ReleaseIdentity;
	return { app, version, commit };
}
