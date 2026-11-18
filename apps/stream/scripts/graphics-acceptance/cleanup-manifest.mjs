/**
 * What a deployed run wrote, written down before it was written (#619).
 *
 * The validator gate stages fixtures straight into the staging bucket, with no
 * Graphics Ingestion Operation behind them, so ordinary retention has no record
 * through which to find one a run abandoned. This manifest is that record. A
 * key is added **before** the command that creates it, so a run killed between
 * the two still lists it; it is removed only once its delete has succeeded. A
 * run whose deletes did not all succeed leaves the manifest behind and fails,
 * and the next run deletes what it lists before it stages anything, refusing
 * to stage while any of it remains; a cleanup retry works through it alone. R2
 * deletes are idempotent, so retrying a key that is already gone is harmless.
 *
 * A poster is written by the Workflow, not by the run, so its entry also names
 * the Workflow instance. Until that instance is seen to have settled it may
 * still write the poster after any delete, so the entry stays listed however
 * the delete went: a run that gave up on an instance does not pass, and a later
 * run asks the instance again.
 *
 * The manifest is an object in the Installation's own staging bucket,
 * `MANIFEST_KEY`, beside what it lists (ADR-0129): a run on a CI runner leaves
 * nothing on the runner, so the next run, wherever it runs, finds it. Each
 * Environment's bucket is its own (#525), so a cleanup pending in staging does
 * not stop a run in production, or the reverse. A manifest a run kept on its
 * machine before, under the gitignored `.cache/`, is still read there, and
 * moves into the bucket on the next write. It holds object keys, so it is
 * never printed: evidence carries only counts.
 */

import { Buffer } from 'node:buffer';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AcceptanceFailure } from './evidence.mjs';
import { RemoteCommandFailure, remoteFailureDetail } from './validator-commands.mjs';

/** Where the manifest lives in the target's staging bucket, apart from every key the app writes. */
export const MANIFEST_KEY = 'acceptance/silent-video-validator-cleanup.json';

/** Where acceptance kept its private state on a machine, one directory per Environment. */
export const ACCEPTANCE_CACHE = fileURLToPath(new URL('../../.cache/acceptance/', import.meta.url));

const MANIFEST_FILE = 'silent-video-validator-cleanup.json';

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

/** A manifest command that failed, named by its step alone, like any other the gate runs. */
async function manifestCommand(action) {
	try {
		return await action();
	} catch (error) {
		if (error instanceof RemoteCommandFailure)
			throw new AcceptanceFailure('validator-command-failed', {
				step: 'manifest',
				...remoteFailureDetail(error),
			});
		throw error;
	}
}

/**
 * The cleanup manifest of the Installation `target` names, kept in its staging
 * bucket through `commands`, the validator gate's Wrangler adapter.
 *
 * Before the manifest moved into the bucket, a run kept it on its machine, one
 * per Environment, and before there were Environments the one manifest,
 * production's, sat directly in the cache. When the bucket holds none, a
 * manifest at either place is read, and the next write moves it.
 *
 * @param {{
 *   target: { accountId: string, stagingBucket: string, workflow: string, environment: string },
 *   commands: { getObject: Function, putObject: Function, deleteObject: Function },
 *   cacheDirectory?: string,
 * }} options
 */
export function openInstallationCleanupManifest({
	target,
	commands,
	cacheDirectory = ACCEPTANCE_CACHE,
}) {
	const localPaths = [
		join(cacheDirectory, target.environment, MANIFEST_FILE),
		...(target.environment === 'production' ? [join(cacheDirectory, MANIFEST_FILE)] : []),
	];
	let state;
	/** The local file the manifest was read from, removed once the bucket holds it. */
	let adopted;

	async function persist() {
		if (state.objects.length === 0) {
			await manifestCommand(() => commands.deleteObject({ target, key: MANIFEST_KEY }));
		} else {
			await manifestCommand(() =>
				commands.putObject({
					target,
					key: MANIFEST_KEY,
					bytes: Buffer.from(`${JSON.stringify(state, null, '\t')}\n`, 'utf8'),
					contentType: 'application/json',
				}),
			);
		}
		if (adopted) {
			await rm(adopted, { force: true });
			adopted = undefined;
		}
	}

	/** The manifest's text in the bucket, else on this machine; undefined when neither has one. */
	async function readLeft() {
		const held = await manifestCommand(() => commands.getObject({ target, key: MANIFEST_KEY }));
		if (held) return Buffer.from(held).toString('utf8');
		for (const path of localPaths) {
			try {
				const text = await readFile(path, 'utf8');
				adopted = path;
				return text;
			} catch (error) {
				if (error?.code !== 'ENOENT') throw error;
			}
		}
		return undefined;
	}

	return {
		/**
		 * The manifest a previous run left, or undefined. One that lists nothing
		 * (a run that died before its first write) is no manifest, and is removed.
		 */
		async read() {
			const text = await readLeft();
			if (text === undefined) return undefined;
			let left;
			try {
				left = JSON.parse(text);
			} catch {
				throw new AcceptanceFailure('harness-precondition-unmet', {
					reason: 'cleanup-manifest-unreadable',
				});
			}
			if (!Array.isArray(left?.objects) || left.objects.length === 0) {
				state = { objects: [] };
				await persist();
				state = undefined;
				return undefined;
			}
			return left;
		},
		/** Nothing is written until the first `record`, so an empty run leaves no manifest. */
		begin() {
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
