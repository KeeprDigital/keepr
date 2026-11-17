/**
 * Where an app names the Release it is serving, and what it answers. The layer
 * registers no route, so every app registers this path with
 * `readReleaseIdentity`; the deploy tooling's verify requires it to name the
 * Release just deployed (ADR-0119).
 */
export const RELEASE_PATH = '/api/release';

/**
 * A Release, as the build that produced the Worker recorded it: the app's name
 * without `@keepr/`, its package version, and the commit it was built from.
 */
export interface ReleaseIdentity {
	app: string;
	version: string;
	commit: string;
}
