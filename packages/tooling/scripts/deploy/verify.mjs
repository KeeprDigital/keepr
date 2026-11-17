/**
 * Post-deploy verification: `deploy:verify`, the step between a Worker's
 * `wrangler deploy` and its `deployed` marker (ADR-0119). If it fails, stop and
 * roll back (apps/stream/README.md § Deploy day).
 *
 * A Release with a deploy descriptor serves its **release identity** at
 * `GET <url>/api/release`, `{ app, version, commit }`, and verification
 * passes only when it names the Release just deployed. A Release from before
 * `/api/release` is checked for liveness only, at `GET <url>/api/time`
 * (`{ serverTime: <positive integer epoch milliseconds> }`), and the output
 * says so.
 *
 * Either probe passes only on that JSON from the Worker: status 200 and an
 * `application/json` content type. Anything else fails (#617), because each of
 * these has answered "OK" on an origin that was not serving the Worker:
 *
 * - **A redirect is never followed.** A 3xx (a Cloudflare Access login, a
 *   moved route, an `http`→`https` hop) is a failure naming its `Location`;
 *   following it would let a sign-in page stand in for the Worker.
 * - **A 200 that is not the expected JSON fails**: an HTML SPA fallback, a
 *   JSON body that does not parse, or JSON of any other shape.
 * - **Any other status fails**, including other 2xx.
 *
 * A transport failure (refused, reset, timed out), a 5xx, a 429, or another
 * Release's identity is retried, since a freshly promoted Worker can briefly
 * answer those. A definitive wrong answer fails at once.
 *
 * What a pass does not establish: **dependency readiness**. Neither handler
 * reads a binding, so a pass says nothing about D1, auth, R2, KV, Ably or the
 * silent-video validator. The deployed acceptance gates (`pnpm accept deployed`)
 * are what exercise those.
 *
 * The target is the Environment's URL in the descriptor, overridable for any
 * explicit target with `KEEPR_DEPLOY_URL`.
 */

import process from 'node:process';

export const RELEASE_PATH = '/api/release';
const SERVER_TIME_PATH = '/api/time';

/** One try plus three retries, 5 s apart, 15 s each: the budget the pre-#617 curl probe had. */
const DEFAULT_ATTEMPTS = 4;
const DEFAULT_RETRY_DELAY_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 15_000;

const NOT_PROVEN =
	'D1, auth, R2, KV, Ably and validator readiness (the deployed acceptance gates cover those)';

export class DeployVerifyFailure extends Error {
	/**
	 * @param {string} message
	 * @param {{ retryable?: boolean, cause?: unknown }} [options]
	 */
	constructor(message, { retryable = false, cause } = {}) {
		super(message, { cause });
		this.name = 'DeployVerifyFailure';
		this.retryable = retryable;
	}
}

/**
 * @typedef {{ app: string, version: string, commit: string }} ReleaseIdentity
 */

/** @param {string} text */
function excerpt(text) {
	const flat = text.replace(/\s+/g, ' ').trim();
	return JSON.stringify(flat.length > 120 ? `${flat.slice(0, 120)}…` : flat);
}

/** @param {ReleaseIdentity} identity */
function named(identity) {
	return `${identity.app}@${identity.version} (${identity.commit})`;
}

/**
 * The probe URL under an explicit target base URL: any http(s) origin, path
 * prefix included. Anything else, a query or fragment among it, is refused
 * before a request, since retrying a typo would only delay the same failure.
 *
 * @param {string} baseUrl
 * @param {string} path
 */
function probeUrl(baseUrl, path) {
	let parsed;
	try {
		parsed = new URL(baseUrl);
	} catch {
		parsed = undefined;
	}
	if (
		!parsed ||
		(parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
		!parsed.host ||
		baseUrl.includes('?') ||
		baseUrl.includes('#')
	) {
		throw new DeployVerifyFailure(
			`target ${JSON.stringify(baseUrl)} (the Environment's url, or KEEPR_DEPLOY_URL) is not an http(s) URL without query or fragment.`,
		);
	}
	parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}${path}`;
	return parsed.href;
}

/**
 * The JSON body of a 200 `application/json` answer, or the failure it is.
 *
 * @param {string} url
 * @param {{ fetchRequest: typeof fetch, timeoutMs: number, signal?: AbortSignal }} options
 */
async function fetchJson(url, { fetchRequest, timeoutMs, signal }) {
	let response;
	try {
		const timeout = AbortSignal.timeout(timeoutMs);
		response = await fetchRequest(url, {
			redirect: 'manual',
			signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
		});
	} catch (error) {
		if (signal?.aborted) throw signal.reason;
		const failure = /** @type {{ cause?: { code?: string }, name?: string } | undefined} */ (error);
		const reason = failure?.cause?.code ?? failure?.name ?? 'error';
		throw new DeployVerifyFailure(`${url} could not be reached (${reason}).`, {
			retryable: true,
			cause: error,
		});
	}
	const { status } = response;
	if (status >= 300 && status < 400) {
		const location = response.headers.get('location') ?? '(no location)';
		throw new DeployVerifyFailure(
			`${url} answered ${status} redirecting to ${location}; a redirect is never the Worker's answer, and is not followed.`,
		);
	}
	if (status !== 200) {
		throw new DeployVerifyFailure(
			`${url} answered ${status}, not 200: ${excerpt(await response.text())}`,
			{ retryable: status >= 500 || status === 429 },
		);
	}
	const contentType = response.headers.get('content-type') ?? '';
	if (contentType.split(';')[0].trim().toLowerCase() !== 'application/json')
		throw new DeployVerifyFailure(
			`${url} answered ${status} with content-type "${contentType || '(none)'}", not application/json.`,
		);
	const text = await response.text();
	try {
		return { text, body: JSON.parse(text) };
	} catch {
		throw new DeployVerifyFailure(
			`${url} answered ${status} with a body that is not valid JSON: ${excerpt(text)}`,
		);
	}
}

/** @param {unknown} body @returns {body is Record<string, unknown>} */
const isRecord = (body) => body !== null && typeof body === 'object' && !Array.isArray(body);

/**
 * @param {string} url
 * @param {ReleaseIdentity | undefined} expected
 * @param {{ fetchRequest: typeof fetch, timeoutMs: number, signal?: AbortSignal }} options
 */
async function probe(url, expected, options) {
	const { text, body } = await fetchJson(url, options);
	if (expected === undefined) {
		const serverTime = isRecord(body) ? body.serverTime : undefined;
		if (typeof serverTime !== 'number' || !Number.isSafeInteger(serverTime) || serverTime <= 0)
			throw new DeployVerifyFailure(
				`${url} answered 200 with JSON that is not { serverTime: <epoch milliseconds> }: ${excerpt(text)}`,
			);
		return { url, serverTime };
	}
	if (
		!isRecord(body) ||
		!['app', 'version', 'commit'].every((key) => typeof body[key] === 'string')
	)
		throw new DeployVerifyFailure(
			`${url} answered 200 with JSON that is not a release identity { app, version, commit }: ${excerpt(text)}`,
		);
	const identity = /** @type {ReleaseIdentity} */ (body);
	if (
		identity.app !== expected.app ||
		identity.version !== expected.version ||
		identity.commit !== expected.commit
	)
		throw new DeployVerifyFailure(
			`${url} names ${named(identity)}, not the Release just deployed, ${named(expected)}.`,
			{ retryable: true },
		);
	return { url, identity };
}

/**
 * Probe `<baseUrl>/api/release` for the `expected` identity, or, without one,
 * `<baseUrl>/api/time` for liveness, retrying only what a settling promotion
 * can answer. Rejects with a `DeployVerifyFailure` (or `signal.reason` once
 * `signal` aborts).
 *
 * Stream Keepr's `worker:smoke` calls this against the built Worker on workerd,
 * so the bundle itself proves it passes the probe it is deployed behind.
 *
 * @param {{
 *   baseUrl: string,
 *   expected?: ReleaseIdentity,
 *   fetchRequest?: typeof fetch,
 *   attempts?: number,
 *   retryDelayMs?: number,
 *   timeoutMs?: number,
 *   signal?: AbortSignal,
 * }} options
 */
export async function verifyDeployment({
	baseUrl,
	expected,
	fetchRequest = fetch,
	attempts = DEFAULT_ATTEMPTS,
	retryDelayMs = DEFAULT_RETRY_DELAY_MS,
	timeoutMs = DEFAULT_TIMEOUT_MS,
	signal,
}) {
	const url = probeUrl(baseUrl, expected === undefined ? SERVER_TIME_PATH : RELEASE_PATH);
	for (let attempt = 1; ; attempt += 1) {
		try {
			return await probe(url, expected, { fetchRequest, timeoutMs, signal });
		} catch (error) {
			if (!(error instanceof DeployVerifyFailure) || !error.retryable || attempt >= attempts)
				throw error;
			console.error(`deploy:verify: attempt ${attempt}/${attempts}: ${error.message} Retrying.`);
			await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
		}
	}
}

/**
 * Verify the Installation of `release` in `environment` serves it: its
 * identity at `commit` when the Release serves one, liveness otherwise. Logs
 * what the pass does and does not prove; resolves with which it checked.
 *
 * The environment and fetch are arguments so that a test hands it both: a
 * regression in how the target is read then asks the test's stand-in, not
 * production.
 *
 * @param {{
 *   release: import('./release.mjs').Release,
 *   environment: string,
 *   commit: string,
 *   env?: Record<string, string | undefined>,
 *   fetchRequest?: typeof fetch,
 *   log?: (line: string) => void,
 *   attempts?: number,
 *   retryDelayMs?: number,
 *   timeoutMs?: number,
 * }} options
 * @returns {Promise<import('./release.mjs').Release['verifies']>}
 */
export async function verifyInstallation({
	release,
	environment,
	commit,
	env = process.env,
	fetchRequest = fetch,
	log = console.log,
	...probeOptions
}) {
	const installation = release.descriptor.environments[environment];
	if (!installation)
		throw new DeployVerifyFailure(`${release.app} has no Installation in ${environment}.`);
	const baseUrl = env.KEEPR_DEPLOY_URL || installation.url;
	if (release.verifies === 'release') {
		const expected = { app: release.app, version: release.version, commit };
		const { url } = await verifyDeployment({ baseUrl, expected, fetchRequest, ...probeOptions });
		log(
			`deploy:verify: ${url} names ${named(expected)}, the Release just deployed. Not proven: ${NOT_PROVEN}.`,
		);
	} else {
		const { url } = await verifyDeployment({ baseUrl, fetchRequest, ...probeOptions });
		log(
			`deploy:verify: ${url} answered the Worker's clock reading: liveness only, since ${release.app}@${release.version} predates /api/release. ` +
				`Not proven: which Release is serving, or ${NOT_PROVEN}.`,
		);
	}
	return release.verifies;
}
