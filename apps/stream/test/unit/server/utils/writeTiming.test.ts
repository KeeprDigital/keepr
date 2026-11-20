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
			failedStep: null,
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
			// The call made once more succeeded, so no step stands failed.
			failedStep: null,
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

	// A write that failed before its object still says where its time went.
	it('logs one for a write that failed before calling its Event’s object, naming the step that failed', async () => {
		const { clock, takes, fails } = manualClock();
		const timing = createWriteTiming(1, clock);

		await timing.time('identity', takes(2));
		await expect(timing.time('d1', fails(16_600))).rejects.toThrow('refused');

		expect(timing.fields({ ...COMMAND, statusCode: 500 })).toMatchObject({
			statusCode: 500,
			totalMs: 16_602,
			identityMs: 2,
			d1Ms: 16_600,
			d1Queries: 1,
			publishCalls: 0,
			failedStep: 'd1',
		});
	});

	it('logs a write once, though both its failure and its answer would log it', async () => {
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		const event = stubH3Event({
			method: 'POST',
			path: COMMAND.path,
			context: {},
			node: { res: { statusCode: 200 } },
		});

		beginWriteTiming(event);
		logWriteTiming(event, 500);
		logWriteTiming(event);

		expect(log.mock.calls.map(([line]) => (line as { statusCode: number }).statusCode)).toEqual([
			500,
		]);
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
