import { RefusedError } from '@keepr/realtime/client';
import { describe, expect, it, vi } from 'vitest';
import {
	OPERATOR_EMAIL_ENV,
	OPERATOR_PASSWORD_ENV,
} from '../../../scripts/graphics-acceptance/operator.mjs';
import {
	createSignedInPage,
	isProbeMessage,
	loadEnvironmentOrigins,
	openScreenOutput,
	openSession,
	PROBE_COMMAND,
	probeTarget,
} from '../../../scripts/realtime-probe/installation.mjs';
import { parseArguments, runProbe } from '../../../scripts/realtime-probe.mjs';

// What the realtime probe asks of an Installation (#1338): where it may run,
// whose Session it works in, and what it does with a Screen Output's URL. The
// network is the boundary: each case answers the probe's requests itself.

const STAGING = 'https://stream.keepr-staging.digital';
const PRODUCTION = 'https://stream.keepr.digital';
const ENVIRONMENTS = { production: PRODUCTION, staging: STAGING };
/** A Screen Output Asset Capability's shape, and nobody's. */
const CAPABILITY = 'capability-of-screen-two-0123456789';

/** A person's own sign-in, as they put it in the probe's environment. */
const CREDENTIALS = {
	[OPERATOR_EMAIL_ENV]: 'someone@keepr.digital',
	[OPERATOR_PASSWORD_ENV]: 'their-password',
};

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** A `fetch` answered by `answer`, keeping each request it was asked. */
function answering(answer: (url: URL, init: RequestInit) => Response) {
	const asked: { url: URL; init: RequestInit; headers: Headers }[] = [];
	const fetchRequest = vi.fn<typeof fetch>(async (input, init = {}) => {
		const url = new URL(String(input));
		asked.push({ url, init, headers: new Headers(init.headers) });
		return answer(url, init);
	});
	return { asked, fetchRequest };
}

describe('where the probe may run', () => {
	it('reads the Environments from the deploy descriptor', async () => {
		expect(await loadEnvironmentOrigins()).toEqual(ENVIRONMENTS);
	});

	it.each([
		['a server on this machine', 'http://127.0.0.1:8787/event/1', 'http://127.0.0.1:8787', 'local'],
		['the Staging Installation', `${STAGING}/`, STAGING, 'staging'],
	])('runs against %s as asked', (_, asked, origin, where) => {
		expect(probeTarget(asked, ENVIRONMENTS, undefined)).toEqual({ origin, where });
	});

	it.each([
		['Production', PRODUCTION, 'production'],
		['an origin that is no Environment', 'https://stream.example.test', 'neither local nor'],
		['Production, on a say that names nobody', PRODUCTION, 'production', '  '],
	])('refuses %s without a person’s say', (_, origin, named, saidBy?: string) => {
		expect(() => probeTarget(origin, ENVIRONMENTS, saidBy)).toThrow(
			expect.objectContaining({
				name: 'ProbeRefusal',
				message: expect.stringMatching(new RegExp(`${named}.*--said-by`)),
			}),
		);
	});

	it('asks nothing of an origin a run is refused, its Keepr Accounts included', async () => {
		const { fetchRequest } = answering(() => json({}));

		await expect(
			runProbe(parseArguments([PRODUCTION, '--event', '7']), {
				fetchRequest,
				env: CREDENTIALS,
				environments: ENVIRONMENTS,
			}),
		).rejects.toMatchObject({ name: 'ProbeRefusal' });
		expect(fetchRequest).not.toHaveBeenCalled();
	});

	it('runs against Production on the say of the person the run names', () => {
		expect(probeTarget(PRODUCTION, ENVIRONMENTS, ' Marcus ')).toEqual({
			origin: PRODUCTION,
			where: 'production',
			saidBy: 'Marcus',
		});
	});
});

describe('the Session the probe works in', () => {
	// An App asks Keepr Accounts nothing for a request with no cookie of its own (ADR-0158).
	it("is the Local Developer User's locally, by the Accounts Stand-in's cookie, and nobody is asked", async () => {
		const { fetchRequest } = answering(() => json({}));

		expect(await openSession('http://127.0.0.1:8787', { env: CREDENTIALS, fetchRequest })).toBe(
			'keepr-stand-in=',
		);
		expect(fetchRequest).not.toHaveBeenCalled();
	});

	it('is the one Keepr Accounts answers the person’s own sign-in with, as the cookie a request carries', async () => {
		const { asked, fetchRequest } = answering(() => {
			const headers = new Headers();
			headers.append('set-cookie', '__Secure-session=abc; Path=/; HttpOnly');
			headers.append('set-cookie', 'other=1; Path=/');
			return new Response(null, { headers });
		});

		expect(await openSession(STAGING, { env: CREDENTIALS, fetchRequest })).toBe(
			'__Secure-session=abc; other=1',
		);
		expect(asked).toHaveLength(1);
		expect(asked[0]!.url.origin).toBe('https://accounts.keepr-staging.digital');
	});

	it.each([
		['nobody is named to sign in as', {}, () => json({}), OPERATOR_PASSWORD_ENV],
		['Keepr Accounts refuses the sign-in', CREDENTIALS, () => json({}, 401), '401'],
	])('is refused, saying so, when %s', async (_, env, answer, said) => {
		const { fetchRequest } = answering(answer);

		await expect(openSession(STAGING, { env, fetchRequest })).rejects.toMatchObject({
			name: 'ProbeRefusal',
			message: expect.stringContaining(said),
		});
	});
});

describe('what the probe asks as a signed-in page', () => {
	const ORIGIN = 'https://stream.keepr-staging.digital';
	const page = (fetchRequest: typeof fetch, cookie = 'session=abc') =>
		createSignedInPage({ origin: ORIGIN, cookie, fetchRequest });

	it('makes its write as the page does: the Screen command, with its Session and its own origin', async () => {
		const { asked, fetchRequest } = answering(() => json({ ok: true }));

		expect(await page(fetchRequest).publish(7, 3)).toEqual({ ok: true });

		const [{ url, init, headers }] = asked as [(typeof asked)[number]];
		expect(`${init.method} ${url.pathname}`).toBe('POST /api/events/7/screens/3/command');
		expect(JSON.parse(String(init.body))).toEqual(PROBE_COMMAND);
		expect(headers.get('cookie')).toBe('session=abc');
		expect(headers.get('origin')).toBe(ORIGIN);
	});

	it.each([
		['the status of a write the server refused', () => json({}, 503), 'HTTP 503'],
		[
			'the failure of a write that was not answered',
			() => {
				throw new Error('fetch failed');
			},
			'fetch failed',
		],
	])('answers %s, and does not throw', async (_, answer, why) => {
		const { fetchRequest } = answering(answer);

		expect(await page(fetchRequest).publish(7, 3)).toEqual({ ok: false, why });
	});

	it('hands out a Screen Output’s URL as the Output Hand-out does, its capability in the fragment', async () => {
		const { asked, fetchRequest } = answering(() => json({ assetCapability: CAPABILITY }));

		const url = await page(fetchRequest).outputUrl(7, { id: 3, slug: 'main', name: 'Main' });

		expect(url).toBe(`${ORIGIN}/event/7/screen/main?output=overlay#asset-capability=${CAPABILITY}`);
		expect(asked[0]!.url.pathname).toBe('/api/events/7/screens/3/asset-capability');
		expect(asked[0]!.headers.get('cookie')).toBe('session=abc');
	});

	it('holds its Event’s channel and each probed Screen’s, on a socket that carries its Session', () => {
		const signedIn = page(fetch);

		expect(signedIn.channels(7, [3, 4])).toEqual(['event:7', 'screen:7:3', 'screen:7:4']);
		expect(signedIn.socketAddress(7)).toBe(
			'wss://stream.keepr-staging.digital/realtime/socket?eventId=7',
		);
		expect(signedIn.socketHeaders).toEqual({ cookie: 'session=abc', origin: ORIGIN });
	});
});

describe('what the probe does with a Screen Output’s URL', () => {
	const URL_HANDED = `http://127.0.0.1:8787/event/7/screen/main?output=overlay#asset-capability=${CAPABILITY}`;
	const anOutput = (ticket: () => Response = () => json({ ticket: 'ticket/1+' })) =>
		answering((url) => (url.pathname === '/api/realtime/ticket' ? ticket() : json({ id: 3 })));

	it('finds its Screen by the slug in its path, presenting its capability and no Session', async () => {
		const { asked, fetchRequest } = anOutput();

		const output = await openScreenOutput(URL_HANDED, { fetchRequest });

		expect(output).toMatchObject({ eventId: 7, screenId: 3, channel: 'screen:7:3' });
		expect(asked[0]!.url.pathname).toBe('/api/screen-output/events/7/screens/slug/main');
		expect(asked[0]!.headers.get('authorization')).toBe(`Bearer ${CAPABILITY}`);
		expect(asked[0]!.headers.has('cookie')).toBe(false);
	});

	it('presents its capability for a Realtime Ticket for each socket, and puts it in the address', async () => {
		const { asked, fetchRequest } = anOutput();
		const output = await openScreenOutput(URL_HANDED, { fetchRequest });

		const addresses = [await output.address(), await output.address()];

		expect(addresses[0]).toBe('ws://127.0.0.1:8787/realtime/socket?eventId=7&ticket=ticket%2F1%2B');
		const tickets = asked.filter(({ url }) => url.pathname === '/api/realtime/ticket');
		expect(tickets).toHaveLength(2);
		expect(tickets[0]).toMatchObject({ init: { method: 'POST' } });
		expect(tickets[0]!.url.searchParams.get('eventId')).toBe('7');
		expect(tickets[0]!.headers.get('authorization')).toBe(`Bearer ${CAPABILITY}`);
		expect(tickets[0]!.headers.has('cookie')).toBe(false);
	});

	it.each([
		['a refusal when the route refuses it (401)', () => json({}, 401), true],
		['a refusal when the route refuses it (403)', () => json({}, 403), true],
		['a failed attempt when the route fails', () => json({}, 503), false],
		['a failed attempt when the route answers no ticket', () => json({}), false],
	])('reads %s', async (_, ticket, refused) => {
		const { fetchRequest } = anOutput(ticket);
		const output = await openScreenOutput(URL_HANDED, { fetchRequest });

		const failure = await output.address().catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(Error);
		expect(failure instanceof RefusedError).toBe(refused);
	});

	it.each([
		['carries no capability', 'http://127.0.0.1:8787/event/7/screen/main?output=overlay'],
		['is no Screen’s', `http://127.0.0.1:8787/event/7#asset-capability=${CAPABILITY}`],
	])('refuses a URL that %s, and asks nothing', async (_, url) => {
		const { fetchRequest } = anOutput();

		await expect(openScreenOutput(url, { fetchRequest })).rejects.toThrow('Screen Output URL');
		expect(fetchRequest).not.toHaveBeenCalled();
	});
});

describe('which messages are the probe’s write', () => {
	it.each([
		['the command that hides the debug panel', 'screen:command:debug', { shown: false }, true],
		['the command that shows it', 'screen:command:debug', { shown: true }, false],
		['another command, whatever it carries', 'screen:command:identify', { shown: false }, false],
		['a message with no data', 'screen:command:debug', null, false],
	])('%s: %s', (_, name, data, own) => {
		expect(isProbeMessage({ name, data })).toBe(own);
	});
});

describe('what a run is asked for', () => {
	const ASKED = ['http://127.0.0.1:8787', '--event', '7'];

	it('is two signed-in sockets and 400 publishes a second apart, late past 400 ms, unless it says', () => {
		expect(parseArguments(ASKED)).toMatchObject({
			origin: 'http://127.0.0.1:8787',
			eventId: 7,
			screenIds: undefined,
			sessions: 2,
			count: 400,
			forMs: undefined,
			everyMs: 1000,
			lateMs: 400,
			cuts: [],
		});
	});

	it.each([
		['250ms', 250],
		['90s', 90_000],
		['20m', 1_200_000],
		['8h', 28_800_000],
		['1.5s', 1500],
	])('reads the duration %s', (written, ms) => {
		expect(parseArguments([...ASKED, '--for', written])).toMatchObject({
			forMs: ms,
			count: undefined,
		});
	});

	it('reads each cut as a client, when, and for how long', () => {
		const asked = [...ASKED, '--cut', 'output-3@20s+10s', '--cut', 'session-1@500ms+2m'];

		expect(parseArguments(asked).cuts).toEqual([
			{ client: 'output-3', afterMs: 20_000, forMs: 10_000 },
			{ client: 'session-1', afterMs: 500, forMs: 120_000 },
		]);
	});

	it('reads the Screens it is to probe', () => {
		expect(parseArguments([...ASKED, '--screens', '3,5']).screenIds).toEqual([3, 5]);
	});

	it.each([
		['no origin', ['--event', '7']],
		['no Event', ['http://127.0.0.1:8787']],
		['a second origin', [...ASKED, 'http://127.0.0.1:9999']],
		['an option it does not know', [...ASKED, '--evry', '1s']],
		['an option with no value', [...ASKED, '--count']],
		['a duration with no unit', [...ASKED, '--every', '500']],
		['a count that is not a whole number', [...ASKED, '--count', '4.5']],
		['both a count and a length', [...ASKED, '--count', '4', '--for', '1m']],
		['a cut it cannot read', [...ASKED, '--cut', 'output-3@20s']],
		['a Screen that is not an id', [...ASKED, '--screens', '3,main']],
	])('refuses %s rather than run something else', (_, argv) => {
		expect(() => parseArguments(argv)).toThrow(expect.objectContaining({ name: 'ProbeRefusal' }));
	});
});
