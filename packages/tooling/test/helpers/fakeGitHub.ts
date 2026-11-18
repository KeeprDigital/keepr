/**
 * GitHub's Deployments API, in memory: what the promotion markers are stored
 * in (ADR-0133). It answers the requests `gh api` would send, by method and
 * path under `repos/{owner}/{repo}/`, as GitHub does: deployments newest
 * first, each one's statuses newest first, an environment created by its
 * first deployment, and a deployment refused at a commit GitHub lacks.
 *
 * Its state is plain JSON, so the `gh` stand-in a command-line test puts on
 * PATH (`fakeGhScript`) keeps it in a file between calls.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

export interface FakeDeployment {
	id: number;
	sha: string;
	environment: string;
	payload: unknown;
}
export interface FakeStatus {
	state: string;
	log_url?: string;
}
export interface FakeGitHubState {
	deployments: FakeDeployment[];
	statuses: Record<string, FakeStatus[]>;
	environments: string[];
	/** The commits GitHub has; a deployment at any other is refused. Undefined: every commit. */
	commits?: string[];
}

export const emptyGitHub = (commits?: string[]): FakeGitHubState => ({
	deployments: [],
	statuses: {},
	environments: [],
	...(commits ? { commits } : {}),
});

export function fakeGitHub(state: FakeGitHubState = emptyGitHub()) {
	const requests: { method: string; path: string; body?: unknown }[] = [];

	function request(method: string, path: string, body?: unknown): unknown {
		requests.push({ method, path, ...(body === undefined ? {} : { body }) });
		const url = new URL(path, 'https://api.github.invalid/');
		const perPage = Number(url.searchParams.get('per_page') ?? 30);
		const page = Number(url.searchParams.get('page') ?? 1);
		const slice = <T>(items: T[]) => items.slice((page - 1) * perPage, page * perPage);
		const statuses = /^\/deployments\/(\d+)\/statuses$/.exec(url.pathname);

		if (method === 'GET' && url.pathname === '/deployments') {
			const environment = url.searchParams.get('environment');
			return slice(
				state.deployments
					.filter((deployment) => environment === null || deployment.environment === environment)
					.toSorted((a, b) => b.id - a.id),
			);
		}
		if (method === 'POST' && url.pathname === '/deployments') {
			const { ref, environment, payload } = body as {
				ref: string;
				environment: string;
				payload: unknown;
			};
			if (state.commits && !state.commits.includes(ref))
				throw new Error(`gh: No ref found for: ${ref} (HTTP 422)`);
			const deployment = { id: state.deployments.length + 1, sha: ref, environment, payload };
			state.deployments.push(deployment);
			if (!state.environments.includes(environment)) state.environments.push(environment);
			return deployment;
		}
		if (statuses && method === 'GET')
			return slice((state.statuses[statuses[1]!] ?? []).toReversed());
		if (statuses && method === 'POST') {
			const id = statuses[1]!;
			const status = body as FakeStatus;
			const deployment = state.deployments.find((each) => String(each.id) === id);
			if (!deployment) throw new Error(`gh: Not Found (HTTP 404)`);
			// GitHub's auto_inactive: a success retires the environment's earlier successes.
			if (status.state === 'success')
				for (const earlier of state.deployments)
					if (
						earlier.environment === deployment.environment &&
						earlier.id !== deployment.id &&
						state.statuses[earlier.id]?.at(-1)?.state === 'success'
					)
						state.statuses[earlier.id]!.push({ state: 'inactive' });
			(state.statuses[id] ??= []).push(status);
			return { id: Object.values(state.statuses).flat().length, ...status };
		}
		if (method === 'GET' && url.pathname === '/environments')
			return {
				total_count: state.environments.length,
				environments: slice(state.environments).map((name) => ({ name })),
			};
		throw new Error(`gh: the fake GitHub has no ${method} ${path}`);
	}

	/** An environment's markers as GitHub holds them: each deployment, newest first, and its statuses. */
	function history(environment: string) {
		return state.deployments
			.filter((deployment) => deployment.environment === environment)
			.toSorted((a, b) => b.id - a.id)
			.map((deployment) => ({
				sha: deployment.sha,
				payload: deployment.payload,
				statuses: (state.statuses[deployment.id] ?? []).map((status) => status.state),
			}));
	}

	return { state, request, requests, history };
}

/**
 * A `gh` for PATH that answers `gh api --method <M> repos/{owner}/{repo}/<path>
 * [--input -]` from the fake GitHub whose state is in `stateFile`.
 */
export function fakeGhScript(stateFile: string) {
	return `#!${process.execPath}
import { readFileSync, writeFileSync } from 'node:fs';
import { fakeGitHub } from ${JSON.stringify(import.meta.filename)};
const [command, , method, route, input] = process.argv.slice(2);
if (command !== 'api') process.exit(2);
const state = JSON.parse(readFileSync(${JSON.stringify(stateFile)}, 'utf8'));
const body = input === '--input' ? JSON.parse(readFileSync(0, 'utf8')) : undefined;
try {
	const answer = fakeGitHub(state).request(method, route.replace('repos/{owner}/{repo}/', ''), body);
	writeFileSync(${JSON.stringify(stateFile)}, JSON.stringify(state));
	process.stdout.write(JSON.stringify(answer));
} catch (error) {
	process.stderr.write(error.message + '\\n');
	process.exit(1);
}
`;
}

export function readGitHubState(stateFile: string): FakeGitHubState {
	return JSON.parse(readFileSync(stateFile, 'utf8')) as FakeGitHubState;
}

export function writeGitHubState(stateFile: string, state: FakeGitHubState) {
	writeFileSync(stateFile, JSON.stringify(state));
}
