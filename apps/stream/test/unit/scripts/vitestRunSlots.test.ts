import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { acquireRunSlots } from '@keepr/tooling/scripts/slots.mjs';
import { afterEach, describe, expect, it } from 'vitest';
import { LOAD_TOLERANT_TEST_TIMEOUT_MS } from '@keepr/nuxt-layer/test/helpers/loadTolerantBounds';

// The run-slot pool itself is the workspace's, tested with it
// (`packages/tooling/test/slots.test.ts`); this is this app's Vitest wiring of it.

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

const directories: string[] = [];
afterEach(() => {
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

/** The child's exit status and what it wrote to stderr; a child that outlasts the bound is stopped, never waited on. */
function finished(child: ChildProcess) {
	let stderr = '';
	child.stderr?.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
	const stop = setTimeout(() => child.kill('SIGKILL'), LOAD_TOLERANT_TEST_TIMEOUT_MS / 2);
	return new Promise<{ status: number | null; stderr: string }>((done) => {
		child.once('close', (status) => {
			clearTimeout(stop);
			done({ status, stderr });
		});
	});
}

/**
 * The unit and Nuxt configs hold a run to its slots through a Vitest plugin
 * hook and by setting `maxWorkers` as the run starts. Neither is documented
 * API: this runs a real Vitest, so a bump that stops honouring either fails here.
 */
describe('a Vitest run held to its run slots', () => {
	it('starts no more workers than the slots it was given, and tells them what the run holds', async () => {
		// Inside the checkout, where the fixture's config can resolve `vitest`.
		const fixture = mkdtempSync(join(repositoryRoot, 'node_modules/.cache/run-slots-fixture-'));
		directories.push(fixture);
		const ledger = join(fixture, 'ledger.sqlite');
		const poolIds = join(fixture, 'pool-ids');
		mkdirSync(poolIds);
		for (const file of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
			writeFileSync(
				join(fixture, `${file}.test.ts`),
				`
				import { writeFileSync } from 'node:fs';
				import { it } from 'vitest';
				it('records its worker', async () => {
					writeFileSync(${JSON.stringify(poolIds)} + '/${file}', (process.env.VITEST_POOL_ID ?? '') + ' of ' + process.env.STREAM_KEEPR_RUN_SLOTS_HELD);
					await new Promise(done => setTimeout(done, 150));
				});
			`,
			);
		}
		writeFileSync(
			join(fixture, 'vitest.config.mts'),
			`
			import { defineConfig } from 'vitest/config';
			import { heldToRunSlots } from ${JSON.stringify(join(repositoryRoot, 'vitest.shared.ts'))};
			export default defineConfig({
				plugins: [heldToRunSlots('fixture', { path: ${JSON.stringify(ledger)}, total: 8 })],
				test: { include: ['*.test.ts'], exclude: [] },
			});
		`,
		);
		// Another gate holds five of the eight, so the run gets the three left: half of the six it could use.
		const other = await acquireRunSlots({
			path: ledger,
			total: 8,
			env: {},
			want: 5,
			label: 'another worktree',
		});

		const run = await finished(
			spawn(join(repositoryRoot, 'node_modules/.bin/vitest'), ['run', '--root', fixture], {
				cwd: repositoryRoot,
				stdio: ['ignore', 'ignore', 'pipe'],
				env: Object.fromEntries(
					Object.entries(process.env).filter(
						([name]) => !name.startsWith('VITEST') && !name.startsWith('STREAM_KEEPR_RUN_SLOTS'),
					),
				),
			}),
		);
		other.release();

		expect(run.status, run.stderr).toBe(0);
		const used = readdirSync(poolIds).map((file) => readFileSync(join(poolIds, file), 'utf8'));
		expect(used).toHaveLength(8);
		expect([...new Set(used)].toSorted()).toEqual(['1 of 3', '2 of 3', '3 of 3']);
	});
});
