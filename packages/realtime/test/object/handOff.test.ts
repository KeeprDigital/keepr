import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TICKET_MS } from '../../src/object/limits.ts';
import { startServer } from './server.ts';
import type { Server } from './server.ts';

let server: Server;
beforeAll(async () => {
	server = await startServer();
}, 60_000);
afterEach(() => server.closeSockets());
afterAll(() => server.close());

// A ticket is what stands between a request and the object: `connectSocket`
// asks for one by RPC and spends it at once. Here a test holds it instead.
describe('a ticket', () => {
	it('admits one socket, which hears what its grant covers', async () => {
		const scope = server.scope();
		const ticket = await scope.admit({ identity: 'reader', hear: ['news'] });

		const socket = ticket.connect();
		await socket.hello({ attach: [{ channel: 'news' }, { channel: 'other' }] });
		await scope.publish({ channel: 'news', name: 'said', data: 1 });
		await socket.sync();

		expect(socket.messages('news')).toMatchObject([{ name: 'said', data: 1 }]);
		expect(socket.refusals()).toMatchObject([{ channel: 'other', what: 'attach' }]);
	});

	it('admits no second socket', async () => {
		const scope = server.scope();
		const ticket = await scope.admit();
		const first = ticket.connect();
		expect(await first.opened).toBe(true);

		const second = ticket.connect();

		expect(await second.opened).toBe(false);
	});

	it('is spent by a request that is no socket, and admits none after it', async () => {
		const scope = server.scope();
		const ticket = await scope.admit();

		const plain = await ticket.request();
		const after = ticket.connect();

		expect(plain.status).toBe(403);
		expect(await after.opened).toBe(false);
	});

	it("admits no socket to another scope's object", async () => {
		const [issuer, other] = [server.scope(), server.scope()];
		const ticket = await issuer.admit();

		const elsewhere = other.carry(ticket).connect();

		expect(await elsewhere.opened).toBe(false);
	});

	// The object never sleeps here: asleep it forgets the ticket, which is the
	// restart's case below, and would hide a ticket that never ran out.
	it('admits no socket once its time has passed, though the object never slept', async () => {
		const scope = server.scope();
		const ticket = await scope.admit();

		await scope.advance(TICKET_MS);
		const late = ticket.connect();

		expect(await late.opened).toBe(false);
		expect(await scope.call('wakes')).toBe(1);
	});

	it("is not kept through the object's restart", async () => {
		const scope = server.scope();
		const ticket = await scope.admit();

		await scope.restart();
		const after = ticket.connect();

		expect(await after.opened).toBe(false);
	});
});
