/**
 * What a deployed run wrote, written down before it was written (#619).
 *
 * The validator gate stages fixtures straight into the staging bucket, with no
 * Graphics Ingestion Operation behind them, so ordinary retention has no record
 * through which to find one a run abandoned. This file is that record. A key is
 * added **before** the command that creates it, so a run killed between the two
 * still lists it; it is removed only once its delete has succeeded. A run whose
 * deletes did not all succeed leaves the file behind, the next run refuses to
 * stage more until it is gone, and a cleanup retry works through it. R2 deletes
 * are idempotent, so retrying a key that is already gone is harmless.
 *
 * A poster is written by the Workflow, not by the run, so its entry also names
 * the Workflow instance. Until that instance is seen to have settled it may
 * still write the poster after any delete, so the entry stays listed however
 * the delete went: a run that gave up on an instance does not pass, and a later
 * retry asks the instance again.
 *
 * There is one manifest per Environment (#525), so a cleanup pending in
 * staging does not stop a run in production, or the reverse.
 *
 * The file holds object keys, so it is private (0600), lives under the
 * gitignored `.cache/`, and is never printed: evidence carries only counts.
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { AcceptanceFailure } from './evidence.mjs';

/** Where acceptance keeps its private state, one directory per Environment. */
export const ACCEPTANCE_CACHE = fileURLToPath(
	new URL('../../.cache/acceptance/', import.meta.url),
);

const MANIFEST_FILE = 'silent-video-validator-cleanup.json';

/**
 * The manifest of one Environment's deployed runs. Before there were
 * Environments the one manifest, production's, sat directly in the cache: a
 * production run adopts it there, so a cleanup it lists is still pending.
 *
 * @param {{ environment: string, cacheDirectory?: string }} options
 */
export function openEnvironmentCleanupManifest({
	environment,
	cacheDirectory = ACCEPTANCE_CACHE,
}) {
	return openCleanupManifest(join(cacheDirectory, environment, MANIFEST_FILE), {
		unscoped: environment === 'production' ? join(cacheDirectory, MANIFEST_FILE) : undefined,
	});
}

/** Instance statuses after which a Workflow writes nothing more. */
const SETTLED_STATUS = /Complete|Errored|Terminated/;

export function isSettledStatus(status) {
	return SETTLED_STATUS.test(status ?? '');
}

/** The part of a target a manifest is bound to: where its objects are. */
function targetIdentity({ accountId, stagingBucket, workflow }) {
	return { accountId, stagingBucket, workflow };
}

function sameTarget(left, right) {
	return (
		left.accountId === right.accountId &&
		left.stagingBucket === right.stagingBucket &&
		left.workflow === right.workflow
	);
}

/**
 * @param {string} path
 * @param {{ unscoped?: string }} [options] a manifest from before Environments,
 *   moved to `path` when `path` has none
 */
function openCleanupManifest(path, { unscoped } = {}) {
	let state;

	async function persist() {
		if (state.objects.length === 0) {
			await rm(path, { force: true });
			return;
		}
		await mkdir(dirname(path), { recursive: true, mode: 0o700 });
		const temporary = `${path}.${process.pid}.tmp`;
		await writeFile(temporary, `${JSON.stringify(state, null, '\t')}\n`, { mode: 0o600 });
		await rename(temporary, path);
	}

	/** The text at `path`, else an unscoped manifest moved there first; ENOENT when neither exists. */
	async function readLeft() {
		try {
			return await readFile(path, 'utf8');
		} catch (error) {
			if (error?.code !== 'ENOENT' || !unscoped) throw error;
		}
		await mkdir(dirname(path), { recursive: true, mode: 0o700 });
		await rename(unscoped, path);
		return await readFile(path, 'utf8');
	}

	return {
		/**
		 * The manifest a previous run left, or undefined. One that lists nothing
		 * (a run that died before its first write) is no manifest, and is removed.
		 */
		async read() {
			let left;
			try {
				left = JSON.parse(await readLeft());
			} catch (error) {
				if (error?.code === 'ENOENT') return undefined;
				throw new AcceptanceFailure('harness-precondition-unmet', {
					reason: 'cleanup-manifest-unreadable',
				});
			}
			if (!Array.isArray(left?.objects) || left.objects.length === 0) {
				await rm(path, { force: true });
				return undefined;
			}
			return left;
		},
		/** Nothing is written until the first `record`, so an empty run leaves no file. */
		begin(target) {
			state = {
				version: 1,
				target: targetIdentity(target),
				objects: [],
			};
		},
		resume(manifest) {
			state = manifest;
		},
		/**
		 * Before the command that creates the object. `instance` names the
		 * Workflow instance that writes it, for an object the run does not write.
		 */
		async record(key, { instance } = {}) {
			if (!state.objects.some((entry) => entry.key === key)) {
				state.objects.push(instance ? { key, instance } : { key });
				await persist();
			}
		},
		/** The writing instance has settled, so a delete of this key now stays deleted. */
		async settle(key) {
			const entry = state.objects.find((candidate) => candidate.key === key);
			if (entry?.instance) {
				delete entry.instance;
				await persist();
			}
		},
		async forget(key) {
			state.objects = state.objects.filter((entry) => entry.key !== key);
			await persist();
		},
		pending: () => state?.objects.map((entry) => ({ ...entry })) ?? [],
	};
}

/**
 * Delete everything a manifest still lists, against the target it was written
 * for. Every key is tried even after one fails, and the count left is the
 * answer: zero is the only outcome that lets a run pass.
 */
export async function drainCleanupManifest({ manifest, commands, target }) {
	let cleaned = 0;
	for (const { key, instance } of manifest.pending()) {
		try {
			if (instance) {
				const { status } = await commands.describeInstance({ target, id: instance });
				if (isSettledStatus(status)) await manifest.settle(key);
			}
			await commands.deleteObject({ target, key });
			if (!manifest.pending().find((entry) => entry.key === key)?.instance) {
				await manifest.forget(key);
				cleaned += 1;
			}
		} catch {
			// Stays listed; the count below reports it.
		}
	}
	return { cleaned, remaining: manifest.pending().length };
}

/** Refuse a manifest that was written for some other account, bucket or Workflow. */
export function assertManifestTarget(manifest, target) {
	if (!manifest?.target || !sameTarget(manifest.target, target))
		throw new AcceptanceFailure('harness-target-inconsistent', {
			reason: 'manifest-target-mismatch',
		});
}
