import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Grant } from '../../src/object/grant.ts';
import { CLOSE_REFUSED, CLOSE_SUPERSEDED } from '../../src/protocol.ts';
import { anyone, startServer } from './server.ts';
import type { Server } from './server.ts';

let server: Server;
beforeAll(async () => {
	server = await startServer();
}, 60_000);
afterEach(() => server.closeSockets());
afterAll(() => server.close());

/** May hear and enter `news`, and nothing else. */
const newsOnly: Grant = { identity: 'reader', hear: ['news'], enter: ['news'] };

describe('a socket reaches the object', () => {
	it('only through the hand-off: a request sent straight to it is not accepted', async () => {
		const scope = server.scope();

		const bare = scope.connect(anyone, { door: 'bare' });

		expect(await bare.opened).toBe(false);
	});

	it('as a refusal it can read when the app refuses it: accepted, then closed with the code', async () => {
		const scope = server.scope();

		const refused = scope.connect(null);

		expect(await refused.opened).toBe(true);
		expect(await refused.closed).toMatchObject({ code: CLOSE_REFUSED });
	});

	it('only as a socket: a plain request is told to upgrade', async () => {
		const scope = server.scope();

		const response = await scope.request();

		expect(response.status).toBe(426);
	});

	it('not at all with a grant the object cannot hold', async () => {
		const scope = server.scope();

		const unnamed = scope.connect({ identity: '', hear: ['*'] });

		expect(await unnamed.opened).toBe(false);
	});
});

describe('outside its grant', () => {
	it('an attach is refused, and the channel is not heard', async () => {
		const scope = server.scope();
		const client = scope.connect(newsOnly);
		await client.hello();

		client.send({ t: 'attach', channel: 'sport' });
		await client.sync();
		const [answer] = await scope.publish({ channel: 'sport', name: 'said', data: 1 });
		await client.sync();

		expect(client.refusals()).toEqual([{ t: 'refused', channel: 'sport', what: 'attach' }]);
		expect(answer?.recipients).toBe(0);
		expect(client.frames).toHaveLength(1);
	});

	it('a watch is refused, and the channel is not told of', async () => {
		const scope = server.scope();
		const client = scope.connect(newsOnly);
		await client.hello();

		client.send({ t: 'watch', channel: 'sport' });
		await client.sync();
		const entering = scope.connect();
		await entering.hello({ presence: { sport: 1 } });
		await client.sync();

		expect(client.refusals()).toEqual([{ t: 'refused', channel: 'sport', what: 'watch' }]);
		expect(client.presence('sport')).toEqual([]);
	});

	it.each(['enter', 'update'] as const)('an %s is refused, and nobody is present', async (how) => {
		const scope = server.scope();
		const watching = scope.connect();
		await watching.hello({ watch: ['sport'] });
		const client = scope.connect(newsOnly);
		await client.hello();

		client.send({ t: how, channel: 'sport', data: 1 });
		await client.sync();
		await watching.sync();

		expect(client.refusals()).toEqual([{ t: 'refused', channel: 'sport', what: 'enter' }]);
		expect(watching.presence('sport')).toEqual([{ t: 'presence', channel: 'sport', members: [] }]);
	});

	it('a hello is given what the grant covers and refused the rest, each by name', async () => {
		const scope = server.scope();
		const client = scope.connect(newsOnly);

		await client.hello({
			attach: [{ channel: 'news' }, { channel: 'sport' }],
			watch: ['news', 'sport'],
			presence: { news: 'here', sport: 'here' },
		});

		expect(client.refusals()).toEqual([
			{ t: 'refused', channel: 'sport', what: 'attach' },
			{ t: 'refused', channel: 'sport', what: 'watch' },
			{ t: 'refused', channel: 'sport', what: 'enter' },
		]);
		expect(client.attached('sport')).toBeUndefined();
		expect(client.members('news')).toEqual([
			{ connectionId: client.attached('news')?.connectionId, data: 'here' },
		]);
	});

	it('a prefix covers the channels under it, and no channel that only starts alike', async () => {
		const scope = server.scope();
		const client = scope.connect({ identity: 'reader', hear: ['room:1:*'] });

		await client.hello({ attach: [{ channel: 'room:1:news' }, { channel: 'room:12:news' }] });

		expect(client.attached('room:1:news')).toBeDefined();
		expect(client.refusals()).toEqual([{ t: 'refused', channel: 'room:12:news', what: 'attach' }]);
	});
});

describe('a client id', () => {
	it("replaces only its own identity's socket: another identity naming it gains nothing", async () => {
		const scope = server.scope();
		const watching = scope.connect();
		await watching.hello({ watch: ['news'] });
		const owner = scope.connect({ ...anyone, identity: 'owner' }, { client: 'client-1' });
		await owner.hello({ presence: { news: 'owner' } });
		await watching.sync();
		const told = watching.presence('news').length;

		const other = scope.connect({ ...anyone, identity: 'other' }, { client: 'client-1' });
		await other.hello({ watch: ['news'] });
		await owner.sync();
		await watching.sync();

		expect(owner.isClosed()).toBe(false);
		expect(watching.presence('news')).toHaveLength(told);
		// The newcomer inherited nothing: the one member is still the owner's.
		expect(other.members('news')).toEqual([{ connectionId: expect.any(String), data: 'owner' }]);
	});

	it('keeps only the places its new grant lets it enter, and watchers are told at once', async () => {
		const scope = server.scope();
		const watching = scope.connect();
		await watching.hello({ watch: ['news'] });
		const earlier = scope.connect(newsOnly, { client: 'client-1' });
		await earlier.hello({ presence: { news: 'here' } });

		const again = scope.connect({ ...newsOnly, enter: [] }, { client: 'client-1' });
		await again.opened;
		await again.sync();
		await watching.sync();

		expect(await earlier.closed).toMatchObject({ code: CLOSE_SUPERSEDED });
		expect(watching.members('news')).toEqual([]);
	});
});

describe('a disconnect by tag', () => {
	it('closes every socket whose grant carried it, tells watchers at once, and leaves the rest', async () => {
		const scope = server.scope();
		const watching = scope.connect();
		await watching.hello({ watch: ['news'] });
		const present = scope.connect({ ...anyone, tags: ['key:1'] }, { client: 'client-1' });
		await present.hello({ presence: { news: 1 } });
		const hearing = scope.connect({ ...anyone, tags: ['key:1', 'key:9'] });
		await hearing.hello({ attach: [{ channel: 'news' }] });
		const untouched = scope.connect({ ...anyone, tags: ['key:2'] });
		await untouched.hello({ attach: [{ channel: 'news' }] });

		const closed = await scope.disconnect('key:1');
		await watching.sync();
		const [answer] = await scope.publish({ channel: 'news', name: 'said', data: 1 });
		await untouched.sync();

		expect(closed).toBe(2);
		expect(await present.closed).toMatchObject({ code: CLOSE_REFUSED });
		expect(await hearing.closed).toMatchObject({ code: CLOSE_REFUSED });
		// No grace period: the member named a client, and is gone all the same.
		expect(watching.members('news')).toEqual([]);
		expect(answer?.recipients).toBe(1);
		expect(untouched.messages('news')).toHaveLength(1);
	});

	it('ends the grace period of a member whose socket had already closed', async () => {
		const scope = server.scope();
		const watching = scope.connect();
		await watching.hello({ watch: ['news'] });
		const present = scope.connect({ ...anyone, tags: ['key:1'] }, { client: 'client-1' });
		await present.hello({ presence: { news: 1 } });
		present.close();
		await present.closed;
		await watching.sync();
		const held = watching.members('news');

		await scope.disconnect('key:1');
		await watching.sync();

		expect(held).toHaveLength(1);
		expect(watching.members('news')).toEqual([]);
	});
});
