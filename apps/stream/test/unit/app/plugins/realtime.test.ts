import type { RealtimeTransport } from '~/types/realtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSocket, settle } from '~~/test/helpers/realtimeSocketFake';

/**
 * The realtime plugin's own rules: which address a page asks for, what a
 * refused ticket becomes, and when the page is gone. It is driven through what
 * it provides, on a fake socket, `$fetch` and window. What the transport does
 * with an address is tested at its home
 * (`test/unit/app/modules/realtimeSocketTransport.test.ts`, `packages/realtime`).
 */

const CAPABILITY = 'capability-of-a-screen-output-0123456789';
const EVENT = 'event:7';

/** Every socket the page opened, oldest first. */
const sockets: FakeSocket[] = [];

class PageSocket extends FakeSocket {
	constructor(url: string) {
		super(url);
		sockets.push(this);
	}
}

vi.stubGlobal(
	'defineNuxtPlugin',
	vi.fn((plugin) => plugin),
);
/** The ticket's route, as the page's `$fetch` reaches it. */
const ticketRoute = vi.fn();
vi.stubGlobal('$fetch', ticketRoute);
vi.stubGlobal('WebSocket', PageSocket);
vi.stubGlobal('window', {
	addEventListener: vi.fn(),
	location: { protocol: 'https:', host: 'stream.example', hash: '', reload: vi.fn() },
});

/** Deliver a window event to every listener the plugin registered for it. */
function dispatchWindowEvent(type: string, event: object = {}) {
	for (const [registered, listener] of vi.mocked(window.addEventListener).mock.calls) {
		if (registered === type) (listener as (event: object) => void)(event);
	}
}

/** The page's realtime, as the plugin provides it to the app. */
async function providedRealtime(): Promise<RealtimeTransport> {
	const plugin = (await import('~~/app/plugins/realtime.client')).default as unknown as {
		setup: () => { provide: { realtime: RealtimeTransport } };
	};
	return plugin.setup().provide.realtime;
}

/** The route answers each request with the next of `tickets`. */
function ticketsGiven(...tickets: string[]) {
	for (const ticket of tickets) ticketRoute.mockResolvedValueOnce({ ticket });
}

/** The route answers `status`, as `$fetch` rejects for one; with none, nothing answered at all. */
function ticketFails(status?: number) {
	ticketRoute.mockRejectedValueOnce(
		Object.assign(new Error('ticket request failed'), status ? { statusCode: status } : {}),
	);
}

/** The address of each socket opened, without the client transport's own `client` id. */
function addresses(): string[] {
	return sockets.map((socket) => socket.url.replace(/&client=[^&]+$/, ''));
}

describe('the realtime plugin', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		sockets.length = 0;
		vi.mocked(window.addEventListener).mockClear();
		ticketRoute.mockReset();
		Object.assign(window.location, { protocol: 'https:', host: 'stream.example', hash: '' });
	});

	afterEach(() => {
		// The page goes away, and its transport's timers with it.
		dispatchWindowEvent('pagehide');
		vi.useRealTimers();
	});

	describe('a page with no Screen Output Asset Capability', () => {
		it.each([
			{ protocol: 'https:', address: 'wss://stream.example/realtime/socket?eventId=7' },
			{ protocol: 'http:', address: 'ws://stream.example/realtime/socket?eventId=7' },
		])(
			"opens its Session's socket on the page's own host over $protocol, with nothing fetched first",
			async ({ protocol, address }) => {
				window.location.protocol = protocol;
				const realtime = await providedRealtime();

				realtime.onChannel(EVENT, 'player:updated', vi.fn());
				await settle();

				expect(addresses()).toEqual([address]);
				expect(ticketRoute).not.toHaveBeenCalled();
			},
		);
	});

	describe('a Screen Output, which holds its capability in the URL fragment', () => {
		beforeEach(() => {
			window.location.hash = `#asset-capability=${CAPABILITY}`;
		});

		it('presents the capability for a ticket of the Event, and opens the socket with it', async () => {
			ticketsGiven('ticket-1');
			const realtime = await providedRealtime();

			realtime.onChannel('screen:7:3', 'output:modeDataChanged', vi.fn());
			await settle();

			// The route's call is #1315's contract: where, how, and with which credential.
			expect(ticketRoute.mock.calls).toEqual([
				[
					'/api/realtime/ticket',
					{
						method: 'POST',
						query: { eventId: 7 },
						headers: { authorization: `Bearer ${CAPABILITY}` },
					},
				],
			]);
			expect(addresses()).toEqual([
				'wss://stream.example/realtime/socket?eventId=7&ticket=ticket-1',
			]);
		});

		it('fetches another ticket for the socket that replaces a cut one', async () => {
			ticketsGiven('ticket-1', 'ticket-2');
			const realtime = await providedRealtime();
			realtime.onChannel('screen:7:3', 'output:modeDataChanged', vi.fn());
			await settle();

			sockets[0]!.letIn().drop();
			await vi.advanceTimersByTimeAsync(250);

			expect(addresses()).toEqual([
				'wss://stream.example/realtime/socket?eventId=7&ticket=ticket-1',
				'wss://stream.example/realtime/socket?eventId=7&ticket=ticket-2',
			]);
		});

		it.each([
			{ answered: 'refuses 401', status: 401, refused: true },
			{ answered: 'refuses 403', status: 403, refused: true },
			{ answered: 'fails 503', status: 503, refused: false },
			{ answered: 'does not answer', status: undefined, refused: false },
		])(
			'reports a refusal=$refused, and opens no socket, when the ticket route $answered',
			async ({ status, refused }) => {
				ticketFails(status);
				const realtime = await providedRealtime();

				realtime.onChannel('screen:7:3', 'output:modeDataChanged', vi.fn());
				await settle();

				expect(realtime.tokenError !== null).toBe(refused);
				expect(sockets).toEqual([]);
			},
		);

		// An output that can never be let in (its Screen deleted, its capability
		// regenerated) stops costing the server a ticket request every 30 s (ADR-0162).
		it('asks for a ticket ever more rarely once refused for a while, and stays refused', async () => {
			ticketRoute.mockRejectedValue(Object.assign(new Error('refused'), { statusCode: 401 }));
			const realtime = await providedRealtime();
			realtime.onChannel('screen:7:3', 'output:modeDataChanged', vi.fn());
			await settle();

			await vi.advanceTimersByTimeAsync(5 * 60_000);
			const inFiveMinutes = ticketRoute.mock.calls.length;
			await vi.advanceTimersByTimeAsync(60 * 60_000);
			const inTheHourAfter = ticketRoute.mock.calls.length - inFiveMinutes;

			// Every 30 s, an hour would be 120 asks.
			expect(inTheHourAfter).toBeLessThanOrEqual(7);
			expect(inTheHourAfter).toBeGreaterThan(0);
			expect(realtime.tokenError).not.toBeNull();
			expect(sockets).toEqual([]);
		});

		it('asks again at once for a capability it now holds instead', async () => {
			ticketRoute.mockRejectedValue(Object.assign(new Error('refused'), { statusCode: 401 }));
			const realtime = await providedRealtime();
			realtime.onChannel('screen:7:3', 'output:modeDataChanged', vi.fn());
			await vi.advanceTimersByTimeAsync(10 * 60_000);

			ticketRoute.mockReset();
			ticketsGiven('ticket-new');
			window.location.hash = `#asset-capability=${CAPABILITY}-new`;
			realtime.onChannel('screen:7:4', 'output:modeDataChanged', vi.fn());
			await settle();

			expect(ticketRoute).toHaveBeenCalledOnce();
		});

		it('takes an answer that carries no ticket for a failed attempt, not a refusal', async () => {
			ticketRoute.mockResolvedValueOnce({});
			const realtime = await providedRealtime();

			realtime.onChannel('screen:7:3', 'output:modeDataChanged', vi.fn());
			await settle();

			expect(realtime.tokenError).toBeNull();
			expect(sockets).toEqual([]);
		});

		it('tries again after a ticket that could not be had, and is let in on the next', async () => {
			ticketFails(503);
			ticketsGiven('ticket-2');
			const realtime = await providedRealtime();
			realtime.onChannel('screen:7:3', 'output:modeDataChanged', vi.fn());
			await settle();

			await vi.advanceTimersByTimeAsync(250);
			sockets[0]?.letIn();

			expect(addresses()).toEqual([
				'wss://stream.example/realtime/socket?eventId=7&ticket=ticket-2',
			]);
			expect(realtime.isConnected).toBe(true);
		});
	});

	it('reads what the page holds as each socket is asked for, not once as the app starts', async () => {
		ticketsGiven('ticket-1');
		const realtime = await providedRealtime();

		// The app started on an operator's page and has since gone to a Screen Output's.
		window.location.hash = `#asset-capability=${CAPABILITY}`;
		realtime.onChannel('screen:7:3', 'output:modeDataChanged', vi.fn());
		await settle();

		expect(addresses()).toEqual(['wss://stream.example/realtime/socket?eventId=7&ticket=ticket-1']);
	});

	describe('a page unload', () => {
		async function hearingPage() {
			const realtime = await providedRealtime();
			const heard = vi.fn();
			realtime.onChannel(EVENT, 'player:updated', heard);
			await settle();
			const socket = sockets[0]!.letIn().attach(EVENT);
			return { realtime, heard, socket };
		}

		// `beforeunload` also fires for an unload the operator then cancels ("Stay"
		// on the unsaved-changes prompt): the page lives on and must keep hearing.
		it('keeps its socket and its handlers through an unload that may be cancelled', async () => {
			const { realtime, heard, socket } = await hearingPage();

			dispatchWindowEvent('beforeunload');
			socket.publish(EVENT, 'player:updated');

			expect(heard).toHaveBeenCalledOnce();
			expect(socket.closed).toBe(false);
			expect(realtime.connectionState).toBe('connected');
		});

		it('closes its socket and stops delivering once the page is hidden for good', async () => {
			const { realtime, heard, socket } = await hearingPage();

			dispatchWindowEvent('pagehide', { persisted: false });
			socket.publish(EVENT, 'player:updated');

			expect(heard).not.toHaveBeenCalled();
			expect(socket.closed).toBe(true);
			expect(realtime.connectionState).toBe('closed');
		});

		// A page restored from the back/forward cache was disposed at `pagehide`.
		it.each([
			{ persisted: true, reloads: 1 },
			{ persisted: false, reloads: 0 },
		])(
			'reloads a page shown again with persisted=$persisted $reloads time(s)',
			async ({ persisted, reloads }) => {
				vi.mocked(window.location.reload).mockClear();
				await providedRealtime();

				dispatchWindowEvent('pageshow', { persisted });

				expect(window.location.reload).toHaveBeenCalledTimes(reloads);
			},
		);
	});
});
