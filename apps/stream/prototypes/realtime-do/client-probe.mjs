/**
 * Drives the #1295 client prototype (`client.ts`) against the Worker through a
 * TCP proxy it can cut or silence, and asserts what ADR-0023 asks of a
 * transport: nothing forgotten, nothing delivered twice, a loss always said.
 *
 *   wrangler dev --var PROTOTYPE_SECRET:s --var RETENTION_MS:10000 --var STALE_MS:6000
 *   PROBE_ORIGIN=http://127.0.0.1:8911 PROBE_SECRET=s node client-probe.mjs
 *
 * The heartbeat here is 1 s with a 1 s wait for the pong, so a run takes about a
 * minute; the client's defaults are 15 s and 5 s.
 */
import assert from 'node:assert/strict';
import net from 'node:net';
import process from 'node:process';
import { createSocketTransport } from './client.ts';

const origin = new URL(process.env.PROBE_ORIGIN ?? 'http://127.0.0.1:8911');
const secret = process.env.PROBE_SECRET;
if (!secret) throw new Error('PROBE_SECRET is required');
const RETENTION_MS = Number(process.env.PROBE_RETENTION_MS ?? 10_000);
const STALE_MS = Number(process.env.PROBE_STALE_MS ?? 6000);
const eventId = 800_000 + Math.floor(Math.random() * 99_999);
const eventChannel = `event:${eventId}`;
const screenChannel = (screenId) => `screen:${eventId}:${screenId}`;
const HEARTBEAT = { heartbeatMs: 1000, pongTimeoutMs: 1000, connectTimeoutMs: 2000 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (ms) => Math.round(ms);

async function until(describe, predicate, timeoutMs = 10_000) {
	const startedAt = performance.now();
	for (;;) {
		const found = predicate();
		if (found) return performance.now() - startedAt;
		if (performance.now() - startedAt > timeoutMs) throw new Error(`timed out: ${describe}`);
		await sleep(5);
	}
}

/** A TCP hop that can cut every connection, or go silent the way a dead network does. */
function hop() {
	const pairs = new Set();
	const waiting = new Set();
	let silent = false;
	let accepted = 0;
	const server = net.createServer((down) => {
		accepted += 1;
		down.on('error', () => {});
		if (silent) {
			waiting.add(down);
			down.on('close', () => waiting.delete(down));
			return;
		}
		const up = net.connect(Number(origin.port), origin.hostname);
		const pair = { down, up, silent: false };
		pairs.add(pair);
		up.on('error', () => {});
		down.on('data', (chunk) => pair.silent || up.write(chunk));
		up.on('data', (chunk) => pair.silent || down.write(chunk));
		const end = () => {
			pairs.delete(pair);
			down.destroy();
			up.destroy();
		};
		down.on('close', end);
		up.on('close', end);
	});
	return {
		listen: () =>
			new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port))),
		get accepted() {
			return accepted;
		},
		/** Both ends see their connection close. */
		cut() {
			for (const { down, up } of pairs) {
				down.destroy();
				up.destroy();
			}
		},
		/** Nothing passes and nothing closes; new connections are taken and never answered. */
		silence() {
			silent = true;
			for (const pair of pairs) pair.silent = true;
		},
		/** New connections work again. The silenced ones stay as they are: that path is dead. */
		restore() {
			silent = false;
			for (const down of waiting) down.destroy();
		},
		close() {
			for (const { down, up } of pairs) {
				down.destroy();
				up.destroy();
			}
			for (const down of waiting) down.destroy();
			server.close();
		},
	};
}

function socketUrl(port, withSecret = secret) {
	const url = new URL(`ws://127.0.0.1:${port}/connect`);
	url.searchParams.set('secret', withSecret);
	url.searchParams.set('event', String(eventId));
	return url.href;
}

const published = new Map();
async function publish(channel) {
	const index = (published.get(channel) ?? 0) + 1;
	published.set(channel, index);
	const response = await fetch(new URL(`/publish?event=${eventId}`, origin), {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-prototype-secret': secret },
		body: JSON.stringify([{ channel, name: 'take', data: { index, pad: 'x'.repeat(1_300) } }]),
	});
	assert.equal(response.status, 200, `publish -> ${response.status}`);
}

/** Hears a channel and checks every message follows the last, except across a loss it was told of. */
function listen(transport, channel) {
	const heard = { count: 0, last: null, lost: 0, firstAttach: 0, faults: [] };
	transport.onMessage(channel, 'take', ({ index }) => {
		if (heard.last !== null && index !== heard.last + 1)
			heard.faults.push(`${channel}: ${String(index)} after ${String(heard.last)}`);
		heard.last = index;
		heard.count += 1;
	});
	transport.onContinuityLost(channel, () => {
		heard.lost += 1;
		heard.last = null;
	});
	transport.onceAttached(channel, () => {
		heard.firstAttach += 1;
	});
	return heard;
}

const report = { eventId, heartbeat: HEARTBEAT };
const hopA = hop();
const hopB = hop();
const [portA, portB] = await Promise.all([hopA.listen(), hopB.listen()]);
const directPort = Number(origin.port);

// --- Rig: one Screen Output behind a hop, one operator page straight to the Worker.
const states = [];
const output = createSocketTransport({
	url: () => socketUrl(portA),
	...HEARTBEAT,
	onState: (state) => states.push({ state, at: performance.now() }),
});
const operator = createSocketTransport({ url: () => socketUrl(directPort), ...HEARTBEAT });

const members = { 1: [], 2: [] };
for (const screenId of [1, 2])
	operator.watchPresence(screenChannel(screenId), (list) =>
		members[screenId].push({
			at: performance.now(),
			n: list.length,
			data: list.map((m) => m.data),
		}),
	);
const operatorEvent = listen(operator, eventChannel);
const onEvent = listen(output, eventChannel);
const onScreen = listen(output, screenChannel(1));
await output.enterPresence(screenChannel(1), { instance: 'a', version: 1 });

const take = async () => {
	await publish(eventChannel);
	await publish(screenChannel(1));
};
const caughtUp = () =>
	onEvent.last === published.get(eventChannel) && onScreen.last === published.get(screenChannel(1));

// --- 1. Steady.
await until('output connected', () => output.isConnected);
await until('operator sees the output', () => members[1].at(-1)?.n === 1);
for (let index = 0; index < 50; index += 1) await take();
await until('50 heard', caughtUp);
assert.equal(onEvent.count, 50);
assert.equal(onScreen.count, 50);
assert.equal(onEvent.firstAttach, 1, 'onceAttached told of the first attach');
report.steady = { heardEach: 50, lost: onEvent.lost + onScreen.lost };

// --- 2. Connection cut five times while 200 Takes are published.
const recoveries = [];
let cutting = true;
const cuts = (async () => {
	for (let cut = 0; cut < 5; cut += 1) {
		await sleep(600);
		const mark = states.length;
		hopA.cut();
		const cutAt = performance.now();
		await until('reconnected after a cut', () =>
			states.slice(mark).some(({ state }) => state === 'connected'),
		);
		recoveries.push(performance.now() - cutAt);
	}
	cutting = false;
})();
const flickersBefore = members[1].filter(({ n }) => n === 0).length;
for (let index = 0; index < 200; index += 1) {
	await take();
	await sleep(15);
}
await cuts;
assert.equal(cutting, false);
await until('everything heard after the cuts', caughtUp);
assert.deepEqual([...onEvent.faults, ...onScreen.faults], [], 'no gap, no duplicate');
assert.equal(onEvent.count, 250);
assert.equal(onScreen.count, 250);
assert.equal(onEvent.lost + onScreen.lost, 0, 'every cut resumed');
report.cut = {
	cuts: 5,
	publishedDuring: 200,
	heardEach: onEvent.count - 50,
	lost: 0,
	recoveryMs: recoveries.map(round),
	presenceLeavesSeen: members[1].filter(({ n }) => n === 0).length - flickersBefore,
};

// --- 3. The network goes silent: nothing closes. Only the heartbeat can tell.
await until('operator sees the output again', () => members[1].at(-1)?.n === 1);
const presenceMark = members[1].length;
hopA.silence();
const silentAt = performance.now();
for (let index = 0; index < 20; index += 1) await take();
const detectedMs = await until('the output notices', () => !output.isConnected);
await sleep(500);
hopA.restore();
const restoredAt = performance.now();
await until('everything heard after the silence', caughtUp);
const backMs = performance.now() - restoredAt;
assert.deepEqual([...onEvent.faults, ...onScreen.faults], []);
assert.equal(onEvent.count, 270);
assert.equal(onEvent.lost + onScreen.lost, 0, 'the log covered the silence');
await sleep(300);
const seenDuring = members[1].slice(presenceMark).map(({ n }) => n);
assert.ok(
	seenDuring.every((n) => n === 1),
	`the output was counted once throughout, saw ${seenDuring.join(',')}`,
);
report.silence = {
	publishedDuring: 20,
	noticedMs: round(detectedMs),
	outageMs: round(restoredAt - silentAt),
	caughtUpMs: round(backMs),
	lost: 0,
	presenceCountsSeen: seenDuring,
};

// --- 4. A machine vanishes: its socket never closes. How long is it counted?
const vanishing = createSocketTransport({ url: () => socketUrl(portB), ...HEARTBEAT });
await vanishing.enterPresence(screenChannel(2), { instance: 'b' });
await until('operator sees the second output', () => members[2].at(-1)?.n === 1);
await sleep(1200);
hopB.silence();
vanishing.dispose();
const ghostMs = await until(
	'the vanished output leaves presence',
	() => members[2].at(-1)?.n === 0,
	STALE_MS * 3,
);
report.vanished = { leftAfterMs: round(ghostMs), staleMs: STALE_MS };

// --- 5. An outage longer than the log, with things asked for while down.
const stateMark = states.length;
const lostBefore = { event: onEvent.lost, screen: onScreen.lost, heard: onEvent.count };
hopA.silence();
for (let index = 0; index < 5; index += 1) await take();
await until('the output notices', () => !output.isConnected);
const lateScreen = listen(output, screenChannel(2));
await output.updatePresence(screenChannel(1), { instance: 'a', version: 2 });
await sleep(RETENTION_MS + 500);
await take();
hopA.restore();
const longRestoredAt = performance.now();
await until(
	'reattached after the long outage',
	() => output.isConnected && lateScreen.firstAttach,
	40_000,
);
report.beyondTheLog = { reattachedMs: round(performance.now() - longRestoredAt) };
await sleep(200);
assert.equal(onEvent.lost - lostBefore.event, 1, 'the Event channel was told of the loss once');
assert.equal(onScreen.lost - lostBefore.screen, 1, "the Screen's channel was told once");
assert.equal(lateScreen.lost, 1, 'a channel first asked for while down attaches as a loss');
assert.equal(lateScreen.firstAttach, 1);
assert.equal(onEvent.count, lostBefore.heard, 'nothing from the outage was replayed');
await take();
await publish(screenChannel(2));
await until('live again', () => caughtUp() && lateScreen.count === 1);
await until('the update made while down is what watchers see', () =>
	members[1].at(-1)?.data.some((data) => data?.version === 2),
);
Object.assign(report.beyondTheLog, {
	outageMs: RETENTION_MS + 500,
	statesSeen: [...new Set(states.slice(stateMark).map(({ state }) => state))],
	lossesTold: { event: 1, screen: 1, askedWhileDown: 1 },
	replayed: 0,
	presenceUpdateHeldAndEntered: true,
});

// --- 6. Refused, then let in: the same transport, a credential that changes.
let credential = 'wrong';
const refused = createSocketTransport({
	url: () => socketUrl(directPort, credential),
	...HEARTBEAT,
});
const refusedEvent = listen(refused, eventChannel);
await until('the refusal is known', () => refused.refusal);
assert.equal(refused.connectionState, 'suspended');
assert.equal(refused.isConnected, false);
credential = secret;
const letInMs = await until('attached once let in', () => refused.isConnected, 12_000);
assert.equal(refused.refusal, null);
await take();
await until('the once-refused transport hears', () => refusedEvent.count === 1);
report.refused = { known: true, attachedAfterCredentialMs: round(letInMs) };

// --- 7. The operator page, never disturbed, heard everything in order.
await until('operator heard all', () => operatorEvent.last === published.get(eventChannel));
assert.deepEqual(operatorEvent.faults, []);
assert.equal(operatorEvent.lost, 0);
report.operator = { heard: operatorEvent.count, connectionsThroughHopA: hopA.accepted };

for (const transport of [output, operator, refused]) transport.dispose();
assert.equal(output.connectionState, 'closed');
hopA.close();
hopB.close();
console.log(JSON.stringify(report, null, 2));
process.exit(0);
