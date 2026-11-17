import type { ReleaseIdentity } from '../shared/utils/release';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The Release a build is of, recorded into runtime config at build time and
 * served at `/api/release` (ADR-0119): the app's name (its package's, without
 * `@keepr/`), its package version, and the commit checked out.
 *
 * A checkout git cannot read builds as commit `unknown`, which no deploy's
 * verify accepts.
 */
export function buildReleaseIdentity({
	rootDir,
	headCommit = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' }),
}: {
	rootDir: string;
	headCommit?: () => string;
}): ReleaseIdentity {
	const manifest = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')) as {
		name: string;
		version?: string;
	};
	let commit: string;
	try {
		commit = headCommit().trim();
	} catch {
		commit = 'unknown';
	}
	return {
		app: manifest.name.replace(/^@keepr\//, ''),
		version: manifest.version ?? 'unversioned',
		commit,
	};
}
