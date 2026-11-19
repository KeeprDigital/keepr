import { describe, expect, it } from 'vitest';
import { parseArguments, runProbe } from '../../scripts/realtime-probe.mjs';
import { foundDefect } from '../../scripts/realtime-probe/measure.mjs';
import { $fetch } from './client';
import { serverOrigin } from './realtimeFollower';

/**
 * The realtime probe against a running server (#1338), as an operator runs it
 * against an Installation. Its rules are at their homes, the
 * `test/unit/scripts/realtimeProbe*.test.ts` files. This is what only a server
 * shows: the routes it asks as a signed-in page and as a Screen Output answer
 * it, the Event's object lets each of its sockets in and delivers its write to
 * them, and a client it cut is replayed what it missed.
 */
describe('the realtime probe, against a running server', () => {
	it('hears every publish on every client, and a client cut for the rest of the run catches up exactly what it missed', async () => {
		const event = await $fetch<{ id: number }>('/api/events', {
			method: 'POST',
			body: { name: 'Realtime probe', game: 'mtg' },
		});
		const screens: { id: number }[] = [];
		for (const slug of ['probe-a', 'probe-b'])
			screens.push(
				await $fetch<{ id: number }>(`/api/events/${event.id}/screens`, {
					method: 'POST',
					body: { name: slug, slug },
				}),
			);
		const [first, second] = screens as [{ id: number }, { id: number }];

		// The second Screen's output is cut as the run starts and restored as it
		// ends, so every publish to its Screen is one it must be replayed.
		const { report } = await runProbe(
			parseArguments([
				serverOrigin(),
				'--event',
				String(event.id),
				'--screens',
				`${first.id},${second.id}`,
				'--sessions',
				'1',
				'--count',
				'8',
				'--every',
				'50ms',
				'--cut',
				`output-${second.id}@1ms+10m`,
			]),
			{ settleMs: 500 },
		);

		expect(foundDefect(report)).toBe(false);
		expect(
			report.clients.map(({ client, heard, expected }) => ({ client, heard, expected })),
		).toEqual([
			{ client: 'session-1', heard: 8, expected: 8 },
			{ client: `output-${first.id}`, heard: 4, expected: 4 },
			{ client: `output-${second.id}`, heard: 4, expected: 4 },
		]);
		const [cut] = report.clients.at(-1)!.cuts;
		expect(cut!.missed).toBeGreaterThan(0);
		expect(cut).toMatchObject({ replayed: cut!.missed, exact: true });
	});
});
