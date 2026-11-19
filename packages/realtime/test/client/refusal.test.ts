import { describe, expect, it } from 'vitest';

import { RefusedError } from '../../src/client/index.ts';
import type { SocketTransport } from '../../src/client/index.ts';
import { CLOSE_REFUSED } from '../../src/protocol.ts';
import type { HelloFrame } from '../../src/protocol.ts';
import { attached, refused, rig } from './helpers/rig.ts';

describe('a socket closed as refused', () => {
	it.each([
		{
			close: 'refused',
			code: CLOSE_REFUSED,
			refusal: 'The realtime connection was refused: not yours',
			firstRetry: 5000,
		},
		{ close: 'by a dead network', code: 1006, refusal: null, firstRetry: 250 },
	])(
		'closed $close is told apart by its refusal, and retried after $firstRetry ms',
		async (row) => {
			const { transport, clock, sockets, socket } = rig();
			transport.onMessage('a', 'note', () => {});
			// A refusal is an accepted socket closed with a code: it opens first.
			const accepted = await socket();
			accepted.open();

			accepted.drop(row.code, 'not yours');

			expect(transport.refusal?.message ?? null).toBe(row.refusal);
			expect(transport.error).toBeInstanceOf(Error);
			expect(transport.connectionState).toBe('disconnected');
			await clock.advance(row.firstRetry - 1);
			expect(sockets).toHaveLength(1);
			await clock.advance(1);
			expect(sockets).toHaveLength(2);
		},
	);

	it('goes on being retried at the slow rhythm, stands until a connect succeeds, then clears', async () => {
		const { transport, clock, sockets, socket, letIn } = rig();
		transport.onMessage('a', 'note', () => {});
		transport.enterPresence('a', { version: 1 });
		// Refused, refused, a dead network, refused: the refusal stands through all of it.
		const closes = [CLOSE_REFUSED, CLOSE_REFUSED, 1006, CLOSE_REFUSED];
		const waits = [5000, 10_000, 20_000, 30_000];

		for (const [attempt, code] of closes.entries()) {
			const accepted = await socket();
			accepted.open();
			accepted.drop(code, 'not yours');
			await clock.advance(waits[attempt]! - 1);
			expect(sockets, `before retry ${attempt + 1}`).toHaveLength(attempt + 1);
			expect(transport.refusal).toBeInstanceOf(Error);
			await clock.advance(1);
			expect(sockets, `retry ${attempt + 1}`).toHaveLength(attempt + 2);
		}
		const letInAtLast = await letIn();

		expect([transport.refusal, transport.error, transport.connectionState]).toEqual([
			null,
			null,
			'connected',
		]);
		expect(letInAtLast.frames).toEqual([
			{ t: 'hello', attach: [{ channel: 'a' }], watch: [], presence: { a: { version: 1 } } },
		]);
	});
});

describe('an address that rejects', () => {
	it.each([
		{
			rejects: 'a RefusedError',
			rejection: () => new RefusedError('ticket revoked'),
			refusal: 'The realtime connection was refused: ticket revoked',
			refused: true,
			firstRetry: 5000,
		},
		{
			rejects: 'any other error',
			rejection: () => new Error('ticket revoked'),
			refusal: null,
			refused: false,
			firstRetry: 250,
		},
	])(
		'with $rejects reads as refused: $refused, is retried after $firstRetry ms, and recovers',
		async (row) => {
			const rejection = row.rejection();
			const { transport, clock, asks, letIn } = rig({
				answer: (ask) => (ask === 1 ? Promise.reject(rejection) : 'wss://object.test/socket'),
			});
			transport.onMessage('a', 'note', () => {});
			await clock.advance(0);

			expect(transport.refusal?.message ?? null).toBe(row.refusal);
			// What the caller rejected with is kept, for whoever shows the refusal.
			expect(transport.refusal?.cause === rejection).toBe(row.refused);
			expect(transport.error).toBeInstanceOf(Error);
			expect(transport.connectionState).toBe('disconnected');
			await clock.advance(row.firstRetry - 1);
			expect(asks()).toBe(1);
			await clock.advance(1);
			expect(asks()).toBe(2);
			await letIn();

			expect([transport.refusal, transport.error, transport.connectionState]).toEqual([
				null,
				null,
				'connected',
			]);
		},
	);
});

describe('a refused frame', () => {
	it.each<{
		what: 'attach' | 'watch' | 'enter';
		ask: (transport: SocketTransport) => () => void;
		wanted: Partial<HelloFrame>;
	}>([
		{
			what: 'attach',
			ask: (transport) => transport.onMessage('b', 'note', () => {}),
			wanted: { attach: [{ channel: 'a', since: 0 }, { channel: 'b' }] },
		},
		{
			what: 'watch',
			ask: (transport) => transport.watchPresence('b', () => {}),
			wanted: { watch: ['b'] },
		},
		{
			what: 'enter',
			ask: (transport) => {
				transport.enterPresence('b', { version: 1 });
				return () => transport.leavePresence('b');
			},
			wanted: { presence: { b: { version: 1 } } },
		},
	])(
		'for $what is readable for its channel, and what was asked stays wanted until its consumer ends it',
		async (row) => {
			const { transport, clock, letIn } = rig();
			let changes = 0;
			transport.onChange(() => {
				changes += 1;
			});
			transport.onMessage('a', 'note', () => {});
			const first = await letIn();
			first.hear(attached('a'));
			const end = row.ask(transport);
			const changesBefore = changes;

			first.hear(refused('b', row.what));

			expect(transport.channelRefusals).toEqual([{ channel: 'b', what: row.what }]);
			expect(changes).toBe(changesBefore + 1);
			expect([transport.connectionState, transport.refusal]).toEqual(['connected', null]);

			// Still wanted: the next socket asks again, and the answer it gets is the one that stands.
			first.drop();
			await clock.advance(250);
			const second = await letIn();
			expect(second.frames[0]).toMatchObject(row.wanted);
			expect(transport.channelRefusals).toEqual([]);
			second.hear(refused('b', row.what));
			expect(transport.channelRefusals).toEqual([{ channel: 'b', what: row.what }]);

			end();
			expect(transport.channelRefusals).toEqual([]);
		},
	);

	it('for a channel nothing is asked of is not kept', async () => {
		const { transport, letIn } = rig();
		transport.onMessage('a', 'note', () => {});
		const open = await letIn();

		open.hear(refused('b', 'attach'));
		open.hear(refused('a', 'watch'));
		open.hear(refused('a', 'enter'));

		expect(transport.channelRefusals).toEqual([]);
	});
});
