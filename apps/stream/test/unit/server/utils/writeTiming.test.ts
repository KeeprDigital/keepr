import { describe, expect, it, vi } from 'vitest';
import { stubH3Event } from '@keepr/nuxt-layer/test/helpers/h3Event';
import {
	beginWriteTiming,
	createWriteTiming,
	logWriteTiming,
	writeTimingOf,
} from '~~/server/utils/writeTiming';

// A late write's log line names where its time went (#1363): each step's time
// and calls, the whole, and whether the isolate was cold.

const COMMAND = {
	method: 'POST',
	path: '/api/events/3/screens/7/command',
	statusCode: 200,
};

/** A clock that moves only when a step's work says so, as a Worker's moves only across I/O. */
function manualClock() {
	let now = 1_000;
	return {
		clock: () => now,
		takes: (ms: number) => async () => {
			now += ms;
		},
		fails: (ms: number) => async () => {
			now += ms;
			throw new Error('refused');
		},
	};
}

describe('a write that called its Event’s object', () => {
	it('names each step’s time and calls, and the whole', async () => {
		const { clock, takes } = manualClock();
		const timing = createWriteTiming(4, clock);

		await timing.time('identity', takes(5));
		timing.identityProof('asked');
		await timing.time('d1', takes(20));
		await timing.time('d1', takes(30));
		await timing.time('publish', takes(300));
		await takes(10)();

		expect(timing.fields(COMMAND)).toEqual({
			message: 'realtime_write_timed',
			method: 'POST',
			path: '/api/events/3/screens/7/command',
			statusCode: 200,
			totalMs: 365,
			identityMs: 5,
			identityProof: 'asked',
			d1Ms: 50,
			d1Queries: 2,
			publishMs: 300,
			publishCalls: 1,
			publishFailures: 0,
			isolateRequest: 4,
		});
	});

	it('counts and times a call that failed, as a publish made once more is', async () => {
		const { clock, takes, fails } = manualClock();
		const timing = createWriteTiming(1, clock);

		await expect(timing.time('publish', fails(800))).rejects.toThrow('refused');
		await timing.time('publish', takes(40));

		expect(timing.fields(COMMAND)).toMatchObject({
			totalMs: 840,
			publishMs: 840,
			publishCalls: 2,
			publishFailures: 1,
		});
	});

	// A write answered from the Session boundary's cache, or with none, asked nothing.
	it('names no identity time where who it belongs to was never read', async () => {
		const { clock, takes } = manualClock();
		const timing = createWriteTiming(1, clock);

		await timing.time('publish', takes(1));

		expect(timing.fields(COMMAND)).toMatchObject({ identityMs: null, identityProof: null });
	});
});

describe('which requests have a line', () => {
	it('logs none for a write that never called its Event’s object', async () => {
		const { clock, takes } = manualClock();
		const timing = createWriteTiming(1, clock);

		await timing.time('d1', takes(5));

		expect(timing.fields(COMMAND)).toBeNull();
	});

	it.each([
		['GET', false],
		['HEAD', false],
		['OPTIONS', false],
		['POST', true],
		['PATCH', true],
		['DELETE', true],
	])('times a %s request: %s', (method, timed) => {
		const event = stubH3Event({ method, context: {} });

		beginWriteTiming(event);

		expect(writeTimingOf(event) !== undefined).toBe(timed);
	});

	// Reads count too: an isolate's first request is a cold start, whatever it was.
	it('numbers each write among every request its isolate was handed', async () => {
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		const write = (path: string) =>
			stubH3Event({ method: 'POST', path, context: {}, node: { res: { statusCode: 200 } } });
		const first = write('/api/events/3/screens/7/command');
		const second = write('/api/events/3/screens/8/command');

		beginWriteTiming(first);
		beginWriteTiming(stubH3Event({ method: 'GET', context: {} }));
		beginWriteTiming(second);
		for (const event of [first, second]) {
			await writeTimingOf(event)!.time('publish', async () => {});
			logWriteTiming(event);
		}

		const [firstLine, secondLine] = log.mock.calls.map(
			([line]) => line as { isolateRequest: number },
		);
		expect(secondLine!.isolateRequest - firstLine!.isolateRequest).toBe(2);
	});
});
