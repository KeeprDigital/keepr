import type { ProbeRecord } from '../../../scripts/realtime-probe/measure.mjs';
import { describe, expect, it } from 'vitest';
import {
	delayFigures,
	formatReport,
	foundDefect,
	measure,
} from '../../../scripts/realtime-probe/measure.mjs';

// What a run of the realtime probe reports of each client (#1338): its delays,
// and what was late, missing, repeated, reordered or skipped, read from the
// run's records alone.

const CHANNEL = 'screen:1:2';
const EPOCH = 'storage-a';
/** The object's clock is hours ahead of the probe's: no figure may subtract one from the other. */
const SKEW = 3 * 3_600_000;
/** The fastest any message arrives, which is what the two clocks are lined up by. */
const FASTEST = 5;

/**
 * A run as its records, built in the order things happen. Publish `n` is sent
 * at `n` seconds on the probe's clock, published by the object 10 ms later and
 * answered 20 ms after it was sent, under sequence `n` unless a case says
 * otherwise.
 */
function aRun(clients: Record<string, string[]> = { output: [CHANNEL] }) {
	const records: ProbeRecord[] = [];
	const sent = (n: number) => n * 1000;
	const published = (n: number) => sent(n) + 10 + SKEW;
	for (const [client, channels] of Object.entries(clients)) {
		records.push({ kind: 'client', client, role: 'output', channels });
		for (const channel of channels)
			records.push({
				kind: 'attached',
				client,
				channel,
				at: 0,
				resumed: false,
				seq: 0,
				epoch: EPOCH,
			});
		records.push({ kind: 'state', client, at: 0, state: 'connected' });
	}
	const run = {
		records,
		sent,
		publish(n: number, { ok = true, channel = CHANNEL } = {}) {
			records.push({
				kind: 'publish',
				n,
				channel,
				sentAt: sent(n),
				answeredAt: sent(n) + 20,
				ok,
				...(!ok && { why: 'HTTP 503' }),
			});
			return run;
		},
		/** `client` hears publish `n`, `took` ms after it was sent. */
		hears(
			client: string,
			n: number,
			heard: {
				took?: number;
				seq?: number;
				replayed?: boolean;
				at?: number;
				channel?: string;
			} = {},
		) {
			const { took = 10 + FASTEST, seq = n, replayed = false, channel = CHANNEL } = heard;
			const at = heard.at ?? sent(n) + took;
			records.push({
				kind: 'message',
				client,
				channel,
				at,
				seq,
				name: 'screen:command:debug',
				sentAt: published(n),
				replayed,
				probe: true,
			});
			return run;
		},
		/** Publish `n` is made, and heard by every client on its channel. */
		delivered(...numbers: number[]) {
			for (const n of numbers) {
				run.publish(n);
				for (const client of Object.keys(clients)) run.hears(client, n);
			}
			return run;
		},
		attached(
			client: string,
			at: number,
			seq: number,
			{ resumed = true, epoch = EPOCH, channel = CHANNEL } = {},
		) {
			records.push({ kind: 'attached', client, channel, at, resumed, seq, epoch });
			return run;
		},
		state(client: string, at: number, state: string, why?: string) {
			records.push({ kind: 'state', client, at, state, ...(why && { why }) });
			return run;
		},
		cut(client: string, at: number) {
			records.push({ kind: 'cut', client, at });
			return run;
		},
		restore(client: string, at: number) {
			records.push({ kind: 'restore', client, at });
			return run;
		},
		measured: (options?: Parameters<typeof measure>[1]) => measure(records, options),
		of(client: string, options?: Parameters<typeof measure>[1]) {
			return measure(records, options).clients.find((found) => found.client === client)!;
		},
	};
	return run;
}

describe("the probe's delay figures", () => {
	const upTo = (count: number) => Array.from({ length: count }, (_, index) => index + 1);

	it.each([
		['the middle value of an odd count', [3, 1, 2], { p50: 2, p95: 3, worst: 3 }],
		['the lower middle of an even count', upTo(20), { p50: 10, p95: 19, worst: 20 }],
		['the 95th of a hundred', upTo(100), { p50: 50, p95: 95, worst: 100 }],
		['the one value there is', [7], { p50: 7, p95: 7, worst: 7 }],
		['nothing, of nothing', [], { p50: null, p95: null, worst: null }],
	])('are %s, each a delay that was measured', (_, delays, figures) => {
		expect(delayFigures(delays)).toEqual({ count: delays.length, ...figures });
	});

	it('time a message from its write being sent to its arriving, on the probe’s clock alone', () => {
		const run = aRun().delivered(1).publish(2).hears('output', 2, { took: 120 });

		expect(run.of('output').delay).toEqual({ count: 2, p50: 15, p95: 120, worst: 120 });
	});

	it('name a message late past the bound, and not one that took exactly it', () => {
		const run = aRun()
			.delivered(1)
			.publish(2)
			.hears('output', 2, { took: 400 })
			.publish(3)
			.hears('output', 3, { took: 401 });

		expect(run.of('output', { lateMs: 400 }).late).toEqual([
			expect.objectContaining({
				n: 3,
				seq: 3,
				delay: 401,
				sentAt: run.sent(3),
				objectSentAt: run.sent(3) + 10 + SKEW,
			}),
		]);
	});
});

describe('which publish a message is', () => {
	it('is the one whose write was in flight when the object published it, however late it arrives', () => {
		// Publish 1 arrives after publish 2 was sent and heard: it is still publish 1.
		const run = aRun().publish(1).delivered(2).hears('output', 1, { took: 1500, seq: 1 });

		expect(run.of('output').heard).toBe(2);
		expect(run.of('output').late).toEqual([expect.objectContaining({ n: 1, delay: 1500 })]);
	});

	it('is the nearer write’s when the clocks have drifted its time to between two, in reach of both', () => {
		// Write 2 follows write 1 by 200 ms, and its message's time reads 10 ms early.
		const run = aRun().delivered(1);
		run.records.push(
			{ kind: 'publish', n: 2, channel: CHANNEL, sentAt: 1200, answeredAt: 1220, ok: true },
			{
				kind: 'message',
				client: 'output',
				channel: CHANNEL,
				at: 1230,
				seq: 2,
				name: 'screen:command:debug',
				sentAt: 1190 - FASTEST + SKEW,
				replayed: false,
				probe: true,
			},
		);

		expect(run.of('output')).toMatchObject({ heard: 2, expected: 2, repeated: [] });
	});

	it('is none of the run’s for another person’s command between two writes, which is counted apart', () => {
		const run = aRun().delivered(1);
		run.records.push({
			kind: 'message',
			client: 'output',
			channel: CHANNEL,
			at: 1500 + FASTEST,
			seq: 2,
			name: 'screen:command:debug',
			sentAt: 1500 + SKEW,
			replayed: false,
			probe: true,
		});
		run.publish(2).hears('output', 2, { seq: 3 });

		const report = run.measured();
		expect(report.foreign).toEqual([expect.objectContaining({ seq: 2 })]);
		expect(report.clients[0]).toMatchObject({ heard: 2, expected: 2, repeated: [], gaps: [] });
	});
});

describe('what a client did not hear as it was published', () => {
	it('is missing a publish on a channel it holds that never arrived, by number and time', () => {
		const run = aRun({ output: [CHANNEL], session: [CHANNEL] })
			.delivered(1)
			.publish(2)
			.hears('session', 2)
			.delivered(3);

		expect(run.of('output')).toMatchObject({
			heard: 2,
			expected: 3,
			missing: [{ n: 2, channel: CHANNEL, sentAt: run.sent(2), why: 'it never arrived' }],
			gaps: [{ channel: CHANNEL, from: 2, to: 2, lost: false }],
		});
		expect(run.of('session')).toMatchObject({ heard: 3, expected: 3, missing: [], gaps: [] });
	});

	it('expects nothing of a channel a client does not hold', () => {
		const run = aRun({ output: [CHANNEL] })
			.delivered(1)
			.publish(2, { channel: 'screen:1:9' });

		expect(run.of('output')).toMatchObject({ heard: 1, expected: 1, missing: [] });
	});

	it('expects nothing published before it first attached', () => {
		const run = aRun().publish(1);
		run.records.push(
			{ kind: 'client', client: 'latecomer', role: 'output', channels: [CHANNEL] },
			{
				kind: 'attached',
				client: 'latecomer',
				channel: CHANNEL,
				at: 1500,
				resumed: false,
				seq: 1,
				epoch: EPOCH,
			},
		);
		run.hears('output', 1).publish(2).hears('output', 2).hears('latecomer', 2);

		expect(run.of('latecomer')).toMatchObject({ heard: 1, expected: 1, missing: [] });
	});

	it.each([
		['is not missing a write that failed and nobody heard', false, 1, []],
		['is missing a write that failed and another client heard', true, 2, [{ n: 2 }]],
	])('%s', (_, heardElsewhere, expected, missing) => {
		const run = aRun({ output: [CHANNEL], session: [CHANNEL] })
			.delivered(1)
			.publish(2, {
				ok: false,
			});
		if (heardElsewhere) run.hears('session', 2);

		expect(run.of('output')).toMatchObject({
			expected,
			missing: missing.map((entry) => expect.objectContaining(entry)),
		});
		expect(run.measured().failed).toEqual([expect.objectContaining({ n: 2, why: 'HTTP 503' })]);
	});

	it('is repeated a sequence its socket carries twice, which is heard once', () => {
		const run = aRun().delivered(1, 2).hears('output', 2, { at: 2600 });

		expect(run.of('output')).toMatchObject({
			heard: 2,
			repeated: [{ n: 2, seq: 2, at: 2600, what: 'sequence' }],
		});
	});

	it('is repeated a publish the object sent under two sequences, which a page hears twice', () => {
		const run = aRun().delivered(1).publish(2).hears('output', 2).hears('output', 2, { seq: 3 });

		expect(run.of('output')).toMatchObject({
			heard: 2,
			repeated: [{ n: 2, seq: 3, what: 'publish' }],
			gaps: [],
		});
	});

	it('is reordered a sequence that arrives after a higher one, and is missing neither', () => {
		const run = aRun().delivered(1).publish(2).delivered(3).hears('output', 2, { at: 3400 });

		expect(run.of('output')).toMatchObject({
			heard: 3,
			missing: [],
			gaps: [],
			reordered: [{ n: 2, seq: 2, after: 3, at: 3400 }],
		});
	});

	it('has a gap for every sequence skipped while attached, as one range', () => {
		const run = aRun().delivered(1).publish(2).publish(3).delivered(4);

		expect(run.of('output').gaps).toEqual([{ channel: CHANNEL, from: 2, to: 3, lost: false }]);
	});

	it('has lost what an attach the object could not resume left behind, and says why it is missing', () => {
		const run = aRun({ output: [CHANNEL], session: [CHANNEL] })
			.delivered(1)
			.publish(2)
			.hears('session', 2)
			.attached('output', 2500, 2, { resumed: false })
			.delivered(3);

		expect(run.of('output')).toMatchObject({
			gaps: [{ channel: CHANNEL, from: 2, to: 2, at: 2500, lost: true }],
			missing: [{ n: 2, why: 'continuity was lost, so it was not replayed' }],
		});
	});

	it('cannot count what it lost when it attaches to another storage', () => {
		const run = aRun().delivered(1).attached('output', 1500, 0, { resumed: false, epoch: 'b' });

		expect(run.of('output').gaps).toEqual([
			{ channel: CHANNEL, at: 1500, lost: true, epoch: true },
		]);
	});
});

describe('a client the probe cut', () => {
	/** Publishes 2 to 4 are made while `output` is cut, from 1.5 s to 4.5 s. */
	function cutAcrossThree() {
		const run = aRun({ output: [CHANNEL], session: [CHANNEL] })
			.delivered(1)
			.cut('output', 1500)
			.state('output', 1510, 'disconnected', 'The realtime connection closed (1000)');
		for (const n of [2, 3, 4]) run.publish(n).hears('session', n);
		return run.restore('output', 4500);
	}
	const replayed = (run: ReturnType<typeof aRun>, ...numbers: number[]) => {
		for (const [index, n] of numbers.entries())
			run.hears('output', n, { replayed: true, at: 4600 + index });
		return run;
	};

	it('caught up exactly what it missed when it is replayed each sequence once, in order', () => {
		const run = replayed(cutAcrossThree().attached('output', 4590, 4), 2, 3, 4)
			.state('output', 4590, 'connected')
			.delivered(5);

		expect(run.of('output')).toMatchObject({
			heard: 5,
			expected: 5,
			missing: [],
			gaps: [],
			cuts: [
				{
					cutAt: 1500,
					restoredAt: 4500,
					missed: 3,
					replayed: 3,
					publishes: [2, 3, 4],
					catchUpMs: 102,
					exact: true,
				},
			],
		});
	});

	const OTHER = 'screen:1:3';
	/** A client of two channels, cut across two publishes on one and one on the other; the first is replayed. */
	function cutAcrossTwoChannels() {
		return aRun({ session: [CHANNEL, OTHER] })
			.delivered(1)
			.cut('session', 1500)
			.publish(2, { channel: OTHER })
			.publish(3)
			.publish(4, { channel: OTHER })
			.restore('session', 4500)
			.attached('session', 4590, 2, { channel: OTHER })
			.hears('session', 2, { channel: OTHER, seq: 1, replayed: true, at: 4591 })
			.hears('session', 4, { channel: OTHER, seq: 2, replayed: true, at: 4592 });
	}

	it('caught up exactly across every channel it holds, each replayed in turn, its publishes by number', () => {
		const run = cutAcrossTwoChannels()
			.attached('session', 4595, 2)
			.hears('session', 3, { seq: 2, replayed: true, at: 4596 });

		expect(run.of('session').cuts).toEqual([
			expect.objectContaining({
				missed: 3,
				replayed: 3,
				publishes: [2, 3, 4],
				catchUpMs: 96,
				exact: true,
			}),
		]);
	});

	it('did not catch up exactly when one of its channels did not, though another did', () => {
		const run = cutAcrossTwoChannels().attached('session', 4595, 2, { resumed: false });

		expect(run.of('session').cuts).toEqual([
			expect.objectContaining({ missed: 3, replayed: 2, exact: false }),
		]);
	});

	it('keeps what it was replayed out of the delay figures, and its own cut out of the drops', () => {
		const run = replayed(cutAcrossThree().attached('output', 4590, 4), 2, 3, 4).delivered(5);

		expect(run.of('output')).toMatchObject({
			delay: { count: 2, worst: 15 },
			late: [],
			drops: [{ at: 1510, byProbe: true }],
		});
	});

	it.each([
		[
			'one sequence short',
			(run: ReturnType<typeof aRun>) => replayed(run.attached('output', 4590, 4), 2, 3),
		],
		[
			'out of order',
			(run: ReturnType<typeof aRun>) => replayed(run.attached('output', 4590, 4), 3, 2, 4),
		],
		[
			'nothing, by an attach the object could not resume',
			(run: ReturnType<typeof aRun>) => run.attached('output', 4590, 4, { resumed: false }),
		],
	])('did not catch up exactly when it is replayed %s', (_, replay) => {
		const [cut] = replay(cutAcrossThree()).of('output').cuts;

		expect(cut).toMatchObject({ missed: 3, exact: false });
	});

	it('caught up exactly when it missed nothing', () => {
		const run = aRun().delivered(1).cut('output', 1500).restore('output', 1700);

		expect(run.attached('output', 1750, 1).of('output').cuts).toEqual([
			expect.objectContaining({ missed: 0, replayed: 0, catchUpMs: 50, exact: true }),
		]);
	});
});

describe('a connection a client lost', () => {
	it('is a drop with its reason and how long it was out, and shows the fault when suspended', () => {
		const run = aRun()
			.delivered(1)
			.state('output', 1500, 'disconnected', 'The realtime connection closed (1006)')
			.state('output', 9500, 'suspended', 'The realtime connection closed (1006)')
			.state('output', 12_000, 'connected');

		expect(run.of('output').drops).toEqual([
			{
				at: 1500,
				backAt: 12_000,
				why: 'The realtime connection closed (1006)',
				fault: true,
				byProbe: false,
			},
		]);
	});

	it('is late, not caught up, for what it is replayed after a drop the probe did not make', () => {
		const run = aRun()
			.delivered(1)
			.state('output', 1500, 'disconnected', 'closed')
			.publish(2)
			.attached('output', 3000, 2)
			.hears('output', 2, { replayed: true, at: 3001 });

		expect(run.of('output').late).toEqual([
			expect.objectContaining({ n: 2, delay: 1001, replayed: true }),
		]);
	});
});

describe('whether a run found a defect of delivery', () => {
	it.each<[string, (run: ReturnType<typeof aRun>) => unknown, boolean]>([
		['nothing', (run) => run, false],
		[
			'a late message alone',
			(run) => run.publish(3).hears('output', 3, { took: 900 }).hears('session', 3),
			false,
		],
		['a missing publish', (run) => run.publish(3).hears('session', 3), true],
		['a repeated sequence', (run) => run.hears('output', 2, { at: 2600 }), true],
		[
			'a reordered sequence',
			(run) => run.publish(3).hears('session', 3).delivered(4).hears('output', 3, { at: 4400 }),
			true,
		],
		[
			'a skipped sequence',
			(run) => run.publish(3).hears('output', 3, { seq: 4 }).hears('session', 3, { seq: 4 }),
			true,
		],
		['a write that failed', (run) => run.publish(3, { ok: false }), true],
		[
			'a cut that did not catch up exactly',
			(run) =>
				run
					.cut('output', 2500)
					.restore('output', 2600)
					.attached('output', 2700, 2, { resumed: false }),
			true,
		],
	])('%s: %s', (_, happens, defect) => {
		const run = aRun({ output: [CHANNEL], session: [CHANNEL] }).delivered(1, 2);
		happens(run);

		expect(foundDefect(run.measured())).toBe(defect);
	});
});

describe('the report an operator reads', () => {
	it('names a late message by its publish, both clocks’ times, its sequence and its delay', () => {
		const run = aRun().delivered(1).publish(2).hears('output', 2, { took: 512 });

		expect(formatReport(run.measured())).toContain(
			`output late: publish #2 sent 1970-01-01T00:00:02.000Z (object 1970-01-01T03:00:02.010Z) on ${CHANNEL} seq 2 took 512 ms`,
		);
	});

	it('gives each client its figures, and says so when nothing was found', () => {
		// Twenty publishes, the nth taking 10n ms: the 10th, the 19th and the 20th are the figures.
		const run = aRun();
		for (let n = 1; n <= 20; n++) run.publish(n).hears('output', n, { took: n * 10 });

		const text = formatReport(run.measured());

		expect(text).toMatch(/^output\s+20\/20\s+100 ms\s+190 ms\s+200 ms\s+0\s+0\s+0\s+0\s+0\s+0$/m);
		expect(text).toContain('Nothing late, missing, repeated, reordered or skipped.');
	});
});
