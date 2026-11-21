// Whether a built Worker carries the Accounts Stand-in. JavaScript, so an App's
// build script Node runs with no build step reads it as the stand-in does.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STAND_IN_BUNDLE_MARK } from './bundleMark.mjs';

/** @param {string} directory @returns {Generator<string>} */
function* bundledFiles(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) yield* bundledFiles(path);
		// Source maps carry the source, not what runs.
		else if (!entry.name.endsWith('.map')) yield path;
	}
}

/**
 * Scans a built Worker under `directory` for the stand-in's code. An App's
 * Worker must carry none: the stand-in signs anyone in (ADR-0113). Answers
 * `{ ok, lines }` for the caller to print before it chooses an exit code. A
 * directory with nothing in it is not a pass.
 *
 * @param {string} directory
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function standInScan(directory) {
	let files;
	try {
		files = [...bundledFiles(directory)];
	} catch (error) {
		return {
			ok: false,
			lines: [`no-accounts-stand-in: cannot read ${directory}: ${error.message}`],
		};
	}
	if (files.length === 0)
		return { ok: false, lines: [`no-accounts-stand-in: nothing to scan under ${directory}.`] };
	const carrying = files.filter((file) =>
		readFileSync(file, 'utf8').includes(STAND_IN_BUNDLE_MARK),
	);
	if (carrying.length > 0)
		return {
			ok: false,
			lines: [
				'no-accounts-stand-in: the Accounts Stand-in is in the Worker bundle. It signs anyone in;',
				'nothing an App ships may import `@keepr/accounts-stand-in` (ADR-0113).',
				...carrying.map((file) => `  ${file}`),
			],
		};
	return {
		ok: true,
		lines: [`no-accounts-stand-in: none in ${files.length} bundled file(s) under ${directory}`],
	};
}
