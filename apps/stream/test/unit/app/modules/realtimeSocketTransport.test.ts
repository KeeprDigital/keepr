import type { EffectScope } from 'vue';
import type { SocketRealtimeRig } from '~~/test/helpers/realtimeSocketFake';
import { RefusedError } from '@keepr/realtime/client';
import { CLOSE_REFUSED } from '@keepr/realtime/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed, effectScope, nextTick, toValue, watch } from 'vue';
import { useRealtimeMessageGate } from '~~/app/composables/core/useRealtimeMessageGate';
import { useReconnectResync } from '~~/app/composables/core/useReconnectResync';
import { settle, socketRealtimeRig } from '~~/test/helpers/realtimeSocketFake';

/**
 * The realtime transport over an Event's object, driven at its socket: the test
 * plays the object, on a clock it moves. Reconnection, catch-up and heartbeat
 * are the client transport's own and tested there (`packages/realtime`); each
 * has one case here, for the wiring.
 */

// Reconnect Resync's Nuxt auto-imports, as Vue's own.
vi.stubGlobal('computed', computed);
vi.stubGlobal('watch', watch);
vi.stubGlobal('toValue', toValue);

const EVENT = 'event:1';
const SCREEN = 'screen:1:7';

const scopes: EffectScope[] = [];

describe("the realtime transport over an Event's object", () => {
	afterEach(() => {
		scopes.splice(0).forEach((scope) => scope.stop());
	});

	describe('one socket for each Event', () => {
		it("hears an Event's channels on its one socket, and another Event's on its own", async () => {
			const { realtime, asked, sockets, open } = socketRealtimeRig();

			realtime.onChannel(EVENT, 'player:updated', vi.fn());
			realtime.onChannel(SCREEN, 'output:modeDataChanged', vi.fn());
			realtime.onChannel('event:2', 'player:updated', vi.fn());
			const first = await open(1);
			const second = await open(2);

			expect(asked).toEqual([1, 2]);
			expect(sockets).toHaveLength(2);
			expect(first.hello?.attach).toEqual([{ channel: EVENT }, { channel: SCREEN }]);
			expect(second.hello?.attach).toEqual([{ channel: 'event:2' }]);
		});

		it('hears nothing on a channel that names no Event, and says so', async () => {
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const { realtime, asked } = socketRealtimeRig();

			const stop = realtime.onChannel('lobby', 'player:updated', vi.fn());
			await realtime.enterPresence('lobby', {});
			await settle();
			stop();

			expect(asked).toEqual([]);
			expect(realtime.connectionState).toBe('initialized');
			expect(warn).toHaveBeenCalledWith(expect.stringContaining('"lobby" names no Event'));
		});

		it('ends every socket and Realtime Subscription when the page goes away', async () => {
			const { realtime, asked, open } = socketRealtimeRig();
			const heard = vi.fn();
			realtime.onChannel(EVENT, 'player:updated', heard);
			realtime.onChannel('event:2', 'player:updated', heard);
			const first = await open(1, EVENT);
			const second = await open(2, 'event:2');

			realtime.dispose();
			first.publish(EVENT, 'player:updated');
			realtime.onChannel('event:3', 'player:updated', heard);
			await settle();

			expect([first.closed, second.closed]).toEqual([true, true]);
			expect(realtime.connectionState).toBe('closed');
			expect(heard).not.toHaveBeenCalled();
			expect(asked).toEqual([1, 2]);
		});
	});

	// The hold's rules are the client transport's, tested there (`packages/realtime`).
	// These are the adapter's: which Event's socket it holds, and until when.
	describe('the Event the page is on', () => {
		it('keeps its socket when its last Realtime Subscription is disposed, and hears the next on it', async () => {
			const { realtime, asked, sockets, open } = socketRealtimeRig();
			const heard = vi.fn();
			const stop = realtime.onChannel(EVENT, 'player:updated', vi.fn());
			const socket = await open(1, EVENT);

			stop();
			realtime.onChannel(EVENT, 'player:updated', heard);
			await settle();
			socket.attach(EVENT).publish(EVENT, 'player:updated');

			expect(socket.closed).toBe(false);
			// The address stands for a Screen Output's ticket fetch: none was asked for again.
			expect(asked).toEqual([1]);
			expect(sockets).toHaveLength(1);
			expect(heard).toHaveBeenCalledOnce();
		});

		it.each<[string, (realtime: SocketRealtimeRig['realtime']) => void]>([
			[
				'asks something of another Event',
				(realtime) => realtime.onChannel('event:2', 'player:updated', vi.fn()),
			],
			['leaves its room for none', (realtime) => realtime.setRoom(null)],
		])(
			'closes the socket of the Event it leaves once it %s, and holds it again when it comes back',
			async (_, leave) => {
				const { realtime, open } = socketRealtimeRig();
				realtime.setRoom(EVENT);
				const left = await open(1);

				leave(realtime);
				expect(left.closed).toBe(true);

				const stop = realtime.onChannel(EVENT, 'player:updated', vi.fn());
				const back = await open(1, EVENT);
				stop();
				expect(back).not.toBe(left);
				expect(back.closed).toBe(false);
			},
		);

		it('ends with the page, though nothing is asked there', async () => {
			const { realtime, clock, asked, open } = socketRealtimeRig();
			realtime.setRoom(EVENT);
			const held = await open(1);

			realtime.dispose();
			held.drop();
			await clock.advance(60_000);

			expect(held.closed).toBe(true);
			expect(asked).toEqual([1]);
			expect(realtime.connectionState).toBe('closed');
		});
	});

	it('gives a channel handler each message of its type, whole, until it is disposed', async () => {
		const { realtime, open } = socketRealtimeRig();
		const updated = vi.fn();
		const deleted = vi.fn();
		const stop = realtime.onChannel(EVENT, 'player:updated', updated);
		realtime.onChannel(EVENT, 'player:deleted', deleted);
		const socket = await open(1, EVENT);
		const message = { eventId: 1, timestamp: 5, player: { id: 3 } };

		socket.publish(EVENT, 'player:updated', message);
		stop();
		socket.publish(EVENT, 'player:updated', message);

		expect(updated).toHaveBeenCalledExactlyOnceWith(
			message,
			expect.objectContaining({ channel: EVENT, name: 'player:updated', seq: 1 }),
		);
		expect(deleted).not.toHaveBeenCalled();
	});

	describe('the room', () => {
		it("gives every owner's handlers the room's messages, each of its own type", async () => {
			const { realtime, open } = socketRealtimeRig();
			const session = vi.fn();
			const page = vi.fn();
			const pageDeleted = vi.fn();
			realtime.onRoom('session', { 'player:updated': session });
			realtime.onRoom('page', { 'player:updated': page, 'player:deleted': pageDeleted });
			realtime.setRoom(EVENT);
			const socket = await open(1, EVENT);

			socket.publish(EVENT, 'player:updated', { eventId: 1 });

			expect(session).toHaveBeenCalledExactlyOnceWith({ eventId: 1 }, expect.anything());
			expect(page).toHaveBeenCalledOnce();
			expect(pageDeleted).not.toHaveBeenCalled();
		});

		it('moves the handlers to the room it is changed to, closing the socket of an Event it leaves with nothing asked there', async () => {
			const { realtime, open } = socketRealtimeRig();
			const heard = vi.fn();
			realtime.onRoom('session', { 'player:updated': heard });
			realtime.setRoom(EVENT);
			const first = await open(1, EVENT);
			const states: string[] = [];
			scopes.push(effectScope());
			scopes.at(-1)!.run(() =>
				watch(
					() => realtime.connectionState,
					(state) => states.push(state),
					{ flush: 'sync' },
				),
			);

			realtime.setRoom('event:2');
			const second = await open(2, 'event:2');
			first.publish(EVENT, 'player:updated', { eventId: 1 });
			second.publish('event:2', 'player:updated', { eventId: 2 });

			expect(first.closed).toBe(true);
			expect(heard).toHaveBeenCalledExactlyOnceWith({ eventId: 2 }, expect.anything());
			// From one Event to the next, never through standing by.
			expect(states).toEqual(['connecting', 'connected']);
		});

		it('keeps handlers while it is in no room, and they hear the next one', async () => {
			const { realtime, asked, open } = socketRealtimeRig();
			const heard = vi.fn();
			realtime.onRoom('session', { 'player:updated': heard });
			await settle();
			expect(asked).toEqual([]);

			realtime.setRoom(EVENT);
			realtime.setRoom(null);
			realtime.setRoom(EVENT);
			(await open(1, EVENT)).publish(EVENT, 'player:updated');

			expect(heard).toHaveBeenCalledOnce();
		});

		it.each<
			[string, (realtime: SocketRealtimeRig['realtime'], replacement: () => void) => void, number]
		>([
			[
				'registers again',
				(realtime, replacement) => realtime.onRoom('page', { 'player:updated': replacement }),
				1,
			],
			['leaves', (realtime) => realtime.offRoom('page'), 0],
		])("stops an owner's handlers when it %s", async (_, change, replacementHeard) => {
			const { realtime, open } = socketRealtimeRig();
			const original = vi.fn();
			const replacement = vi.fn();
			const other = vi.fn();
			realtime.setRoom(EVENT);
			realtime.onRoom('page', { 'player:updated': original });
			realtime.onRoom('session', { 'player:updated': other });
			const socket = await open(1, EVENT);

			change(realtime, replacement);
			socket.publish(EVENT, 'player:updated');

			expect(original).not.toHaveBeenCalled();
			expect(replacement).toHaveBeenCalledTimes(replacementHeard);
			expect(other).toHaveBeenCalledOnce();
		});

		it('lets an owner that has left hear nothing in the next room either', async () => {
			const { realtime, open } = socketRealtimeRig();
			const left = vi.fn();
			const stays = vi.fn();
			realtime.setRoom(EVENT);
			realtime.onRoom('page', { 'player:updated': left });
			realtime.onRoom('session', { 'player:updated': stays });

			realtime.offRoom('page');
			realtime.setRoom('event:2');
			(await open(2, 'event:2')).publish('event:2', 'player:updated');

			expect(left).not.toHaveBeenCalled();
			expect(stays).toHaveBeenCalledOnce();
		});
	});

	describe('the connection it reports', () => {
		type Step = (rig: SocketRealtimeRig) => Promise<unknown>;
		const asks: Step = async ({ realtime }) => realtime.onChannel(EVENT, 'player:updated', vi.fn());
		const connects: Step = async (rig) => {
			await asks(rig);
			await rig.open(1, EVENT);
		};
		const isCut: Step = async (rig) => {
			await connects(rig);
			(await rig.socket()).drop();
		};

		it.each<[string, Step, string, { connected: boolean; failing: boolean }]>([
			[
				'nothing is asked of it',
				async () => {},
				'initialized',
				{ connected: false, failing: false },
			],
			['its first socket is opening', asks, 'connecting', { connected: false, failing: false }],
			[
				"its Event's object has answered",
				connects,
				'connected',
				{ connected: true, failing: false },
			],
			['its socket is cut', isCut, 'disconnected', { connected: false, failing: true }],
			[
				'it has had no connection for 8 s',
				async (rig) => {
					await isCut(rig);
					await rig.clock.advance(8000);
				},
				'suspended',
				{ connected: false, failing: true },
			],
			[
				'everything asked of its Event is disposed, the page still on it',
				async (rig) => {
					const stop = rig.realtime.onChannel(EVENT, 'player:updated', vi.fn());
					await rig.open(1, EVENT);
					stop();
				},
				// Its Event's socket is held.
				'connected',
				{ connected: true, failing: false },
			],
			[
				'it has left its Event for none',
				async (rig) => {
					rig.realtime.setRoom(EVENT);
					await rig.open(1, EVENT);
					rig.realtime.setRoom(null);
				},
				// Standing by, where the client transport says `closed`.
				'initialized',
				{ connected: false, failing: false },
			],
			[
				'the page is gone',
				async (rig) => {
					await connects(rig);
					rig.realtime.dispose();
				},
				'closed',
				{ connected: false, failing: false },
			],
		])('is, once %s, %s', async (_, arrange, state, { connected, failing }) => {
			const rig = socketRealtimeRig();

			await arrange(rig);

			expect(rig.realtime.connectionState).toBe(state);
			expect(rig.realtime.isConnected).toBe(connected);
			expect(rig.realtime.error !== null).toBe(failing);
		});

		it('is that of the Event last asked for, and a watcher is told as it changes', async () => {
			const rig = socketRealtimeRig();
			const states: string[] = [];
			scopes.push(effectScope());
			scopes.at(-1)!.run(() =>
				watch(
					() => rig.realtime.connectionState,
					(state) => states.push(state),
					{ flush: 'sync' },
				),
			);

			await connects(rig);
			rig.realtime.onChannel('event:2', 'player:updated', vi.fn());
			expect(rig.realtime.connectionState).toBe('connecting');
			(await rig.open(2)).attach('event:2');
			(await rig.socket(1)).drop();

			// Event 2's, which the cut socket of Event 1 says nothing about.
			expect(states).toEqual(['connecting', 'connected', 'connecting', 'connected']);
		});
	});

	describe('a refusal, which `tokenError` stands for', () => {
		it.each<[string, (rig: SocketRealtimeRig) => Promise<void>, RegExp, string]>([
			[
				'its socket is closed as refused',
				async (rig) => (await rig.socket()).drop(CLOSE_REFUSED, 'no Session'),
				/refused: no Session/,
				'disconnected',
			],
			[
				"its Event's object refuses a channel it asks for",
				async (rig) => (await rig.open(1)).hear({ t: 'refused', channel: SCREEN, what: 'attach' }),
				/attach on screen:1:7/,
				'connected',
			],
		])('is reported when %s', async (_, refuse, why, state) => {
			const rig = socketRealtimeRig();
			rig.realtime.onChannel(SCREEN, 'output:modeDataChanged', vi.fn());

			await refuse(rig);

			expect(rig.realtime.tokenError?.message).toMatch(why);
			// One error while what is refused is the same, so a watcher is told once.
			expect(rig.realtime.tokenError).toBe(rig.realtime.tokenError);
			expect(rig.realtime.connectionState).toBe(state);
		});

		it('is reported when the route that gives its address refuses it', async () => {
			const refused = new RefusedError('capability regenerated');
			const { realtime } = socketRealtimeRig({ address: () => Promise.reject(refused) });

			realtime.onChannel(SCREEN, 'output:modeDataChanged', vi.fn());
			await settle();

			expect(realtime.tokenError?.cause).toBe(refused);
		});

		it('is not reported for a network that does not answer, however long', async () => {
			const rig = socketRealtimeRig();
			rig.realtime.onChannel(EVENT, 'player:updated', vi.fn());
			(await rig.socket()).drop();

			await rig.clock.advance(60_000);

			expect(rig.realtime.connectionState).toBe('suspended');
			expect(rig.realtime.tokenError).toBeNull();
		});

		it('stands while the client is retried, and ends once it is let in with its handlers still held', async () => {
			const rig = socketRealtimeRig();
			const heard = vi.fn();
			rig.realtime.onChannel(EVENT, 'player:updated', heard);
			(await rig.socket()).drop(CLOSE_REFUSED);

			await rig.clock.advance(5000);
			const retry = await rig.socket();
			expect(rig.sockets).toHaveLength(2);
			expect(rig.realtime.tokenError).not.toBeNull();

			retry.letIn().attach(EVENT);
			retry.publish(EVENT, 'player:updated');
			expect(rig.realtime.tokenError).toBeNull();
			expect(heard).toHaveBeenCalledOnce();
		});

		it('ends, when of a channel, once what was asked of the channel is disposed', async () => {
			const rig = socketRealtimeRig();
			const stopRefused = rig.realtime.onChannel(SCREEN, 'output:modeDataChanged', vi.fn());
			(await rig.open(1)).hear({ t: 'refused', channel: SCREEN, what: 'attach' });
			expect(rig.realtime.tokenError).not.toBeNull();

			stopRefused();

			expect(rig.realtime.tokenError).toBeNull();
		});

		it('stands, when of its socket, whatever the page disposes on its Event, and ends once it leaves', async () => {
			const rig = socketRealtimeRig();
			rig.realtime.setRoom(EVENT);
			const stopRefused = rig.realtime.onChannel(SCREEN, 'output:modeDataChanged', vi.fn());
			(await rig.socket()).drop(CLOSE_REFUSED);

			// Still on its Event, and still refused there: the next thing asked would be too.
			stopRefused();
			expect(rig.realtime.tokenError).not.toBeNull();

			rig.realtime.setRoom(null);
			expect(rig.realtime.tokenError).toBeNull();
		});

		it('is of the Event last asked for, not of one left behind', async () => {
			const rig = socketRealtimeRig();
			rig.realtime.onChannel(EVENT, 'player:updated', vi.fn());
			(await rig.socket()).drop(CLOSE_REFUSED);

			rig.realtime.onChannel('event:2', 'player:updated', vi.fn());

			expect(rig.realtime.tokenError).toBeNull();
		});
	});

	// The echo filter: a write names this id, the server puts it on the message,
	// and the page that wrote it ignores the message (`useRealtimeMessageGate`).
	describe("the page's own id", () => {
		it('is one a write can name before any socket, and the same through a reconnect and on another Event', async () => {
			const rig = socketRealtimeRig();
			const own = rig.realtime.connectionId;
			// What the server takes for an origin connection id (`server/utils/realtimePublish.ts`).
			expect(own).toMatch(/^[\w!-]{1,64}$/);

			rig.realtime.onChannel(EVENT, 'player:updated', vi.fn());
			(await rig.open(1)).attach(EVENT, { connectionId: 'connection-1' });
			(await rig.socket(1)).drop();
			await rig.clock.advance(250);
			(await rig.open(1)).attach(EVENT, { connectionId: 'connection-2' });
			rig.realtime.onChannel('event:2', 'player:updated', vi.fn());
			(await rig.open(2)).attach('event:2', { connectionId: 'connection-3' });

			expect(rig.realtime.connectionId).toBe(own);
			expect(socketRealtimeRig().realtime.connectionId).not.toBe(own);
		});

		it('is how a page ignores the message its own write caused, whatever the object calls its socket', async () => {
			const rig = socketRealtimeRig();
			const own = rig.realtime.connectionId;
			const { accept } = useRealtimeMessageGate(computed(() => rig.realtime.connectionId));
			const heard = vi.fn();
			rig.realtime.onChannel(EVENT, 'player:updated', accept('player:updated', heard));

			const socket = (await rig.open(1)).attach(EVENT, { connectionId: 'connection-9' });
			socket.publish(EVENT, 'player:updated', { eventId: 1, originConnectionId: own });
			socket.publish(EVENT, 'player:updated', { eventId: 1, originConnectionId: 'connection-9' });
			socket.publish(EVENT, 'player:updated', { eventId: 1 });

			expect(heard.mock.calls.map(([message]) => message.originConnectionId)).toEqual([
				'connection-9',
				undefined,
			]);
		});
	});

	describe("the client transport's own rules, wired", () => {
		it.each<[string, boolean, number]>([
			['resumed, hearing what it missed and losing nothing', true, 0],
			['not resumed, having lost continuity', false, 1],
		])('holds a handler through a cut and reattaches it %s', async (_, resumed, losses) => {
			const rig = socketRealtimeRig();
			const heard = vi.fn();
			const lost = vi.fn();
			rig.realtime.onChannel(EVENT, 'player:updated', heard);
			rig.realtime.onContinuityLost(EVENT, lost);
			const first = await rig.open(1, EVENT);
			first.publish(EVENT, 'player:updated', { eventId: 1, heard: 'before' });

			first.drop();
			await rig.clock.advance(250);
			const second = (await rig.socket()).letIn();
			second.attach(EVENT, { resumed, seq: resumed ? 2 : 1 });
			second.publish(EVENT, 'player:updated', { eventId: 1, heard: 'after' }, 2);

			expect(second.hello?.attach).toEqual([{ channel: EVENT, since: 1 }]);
			expect(heard.mock.calls.map(([message]) => message.heard)).toEqual(['before', 'after']);
			expect(lost).toHaveBeenCalledTimes(losses);
		});

		it("tells of a channel's first attach once, and never of one attached already", async () => {
			const rig = socketRealtimeRig();
			const first = vi.fn();
			const late = vi.fn();
			rig.realtime.onceAttached(EVENT, first);
			const socket = await rig.open(1, EVENT);

			rig.realtime.onceAttached(EVENT, late);
			socket.attach(EVENT);

			expect(first).toHaveBeenCalledOnce();
			expect(late).not.toHaveBeenCalled();
		});

		it('gives up a socket that stops answering its heartbeat', async () => {
			const rig = socketRealtimeRig();
			rig.realtime.onChannel(EVENT, 'player:updated', vi.fn());
			const socket = await rig.open(1, EVENT);

			await rig.clock.advance(20_000);

			expect(socket.pings).toBe(2);
			expect(rig.realtime.connectionState).toBe('disconnected');
		});

		it('retries at once when the page comes online, and no more once the page is gone', async () => {
			const rig = socketRealtimeRig();
			rig.realtime.onChannel(EVENT, 'player:updated', vi.fn());
			(await rig.socket()).drop(CLOSE_REFUSED);

			rig.online();
			await settle();
			expect(rig.asked).toEqual([1, 1]);

			rig.realtime.dispose();
			rig.online();
			await settle();
			expect(rig.asked).toEqual([1, 1]);
			// And the page is let go of, not only unheard.
			expect(rig.listening()).toBe(0);
		});
	});

	describe('presence', () => {
		it('holds an entry made with no socket, without waiting, and enters it with its latest data', async () => {
			const rig = socketRealtimeRig();

			await rig.realtime.enterPresence(SCREEN, { protocol: 1 });
			await rig.realtime.updatePresence(SCREEN, { protocol: 2 });
			const socket = await rig.open(1);

			expect(socket.hello?.presence).toEqual({ [SCREEN]: { protocol: 2 } });
		});

		it('updates nothing on a channel it has not entered', async () => {
			const rig = socketRealtimeRig();
			rig.realtime.onChannel(SCREEN, 'output:modeDataChanged', vi.fn());
			const socket = await rig.open(1, SCREEN);

			await rig.realtime.updatePresence(SCREEN, { protocol: 2 });
			await rig.realtime.updatePresence('screen:2:1', { protocol: 2 });

			expect(socket.frames.map((frame) => frame.t)).toEqual(['hello']);
			expect(rig.asked).toEqual([1]);
		});

		it.each<[string, boolean, string[], Record<string, unknown>]>([
			['entered', true, ['hello', 'leave', 'detach'], { [SCREEN]: { protocol: 2 } }],
			['still held', false, ['hello'], {}],
		])('withdraws an entry %s when it leaves', async (_, entered, frames, saidOnOpening) => {
			const rig = socketRealtimeRig();
			await rig.realtime.enterPresence(SCREEN, { protocol: 2 });
			if (entered) await rig.open(1, SCREEN);

			await rig.realtime.leavePresence(SCREEN);
			// The page is still on its Event, whose socket is held: one not yet open opens now.
			if (!entered) await rig.open(1);

			expect(rig.sockets.flatMap((socket) => socket.frames.map((frame) => frame.t))).toEqual(
				frames,
			);
			expect(rig.sockets[0]?.hello?.presence).toEqual(saidOnOpening);
		});

		it("tells a watcher its channel's members, whole, until it stops watching", async () => {
			const rig = socketRealtimeRig();
			const told: (number | undefined)[][] = [];
			const stop = rig.realtime.watchPresence<{ protocol: number }>(SCREEN, (members) => {
				told.push(members.map((member) => member.data?.protocol));
			});
			const socket = await rig.open(1);

			socket.members(SCREEN, [{ connectionId: 'a', data: { protocol: 2 } }, { connectionId: 'b' }]);
			stop();
			socket.members(SCREEN, []);

			expect(socket.hello?.watch).toEqual([SCREEN]);
			expect(told).toEqual([[2, undefined]]);
		});
	});

	// Reconnect Resync's rules are tested at its home, on a stand-in transport.
	// These are its wiring to this one: the signals it re-reads off arrive.
	describe('Reconnect Resync, listening on it', () => {
		function consumer(rig: SocketRealtimeRig, channel: string | null) {
			const resync = vi.fn();
			const onFirstAttach = vi.fn();
			const scope = effectScope();
			scopes.push(scope);
			const { disconnected } = scope.run(() =>
				useReconnectResync(resync, channel, rig.realtime, { onFirstAttach }),
			)!;
			return { resync, onFirstAttach, disconnected };
		}

		it.each<[string, boolean, number]>([
			['having lost continuity, re-reads once it has', false, 1],
			['resumed, re-reads nothing', true, 0],
		])('after a cut, when its channel reattaches %s', async (_, resumed, resyncs) => {
			const rig = socketRealtimeRig();
			const { resync, onFirstAttach, disconnected } = consumer(rig, EVENT);
			const first = await rig.open(1, EVENT);
			expect(onFirstAttach).toHaveBeenCalledOnce();

			first.drop();
			expect(disconnected.value).toBe(true);
			await rig.clock.advance(250);
			const second = (await rig.socket()).letIn();
			// The connection is back and nothing listens yet (#641).
			expect(disconnected.value).toBe(false);
			expect(resync).not.toHaveBeenCalled();
			second.attach(EVENT, { resumed });

			expect(resync).toHaveBeenCalledTimes(resyncs);
			expect(onFirstAttach).toHaveBeenCalledOnce();
		});

		it('re-reads when the connection comes back, for a consumer listening on no channel', async () => {
			const rig = socketRealtimeRig();
			rig.realtime.watchPresence(SCREEN, vi.fn());
			const { resync } = consumer(rig, null);
			const first = await rig.open(1);
			await nextTick();
			expect(resync).not.toHaveBeenCalled();

			first.drop();
			await rig.clock.advance(250);
			(await rig.socket()).letIn();
			await nextTick();

			expect(resync).toHaveBeenCalledOnce();
		});
	});
});
