/**
 * Measures the #1295 prototype with #189's rig: 3 Screen Outputs and 2
 * operator consoles on one Event. Every count is asserted, so a client that
 * never attached fails the run instead of reporting a flattering zero.
 *
 *   PROBE_ORIGIN=http://127.0.0.1:8911 PROBE_SECRET=... node probe.mjs
 *
 * PROBE_RETENTION_MS: set to the Worker's RETENTION_MS to also prove that a
 * reconnect from beyond the log is told it lost continuity.
 */
import assert from 'node:assert/strict';
import process from 'node:process';

const origin = process.env.PROBE_ORIGIN?.replace(/\/$/, '');
const secret = process.env.PROBE_SECRET;
if (!origin || !secret) throw new Error('PROBE_ORIGIN and PROBE_SECRET are required');
const eventId = Number(process.env.PROBE_EVENT ?? 900_000 + Math.floor(Math.random() * 99_999));
const CYCLES = Number(process.env.PROBE_CYCLES ?? 200);
const GAP = Number(process.env.PROBE_GAP ?? 25);
const IDLE_MS = Number(process.env.PROBE_IDLE_MS ?? 20_000);
const RETENTION_MS = process.env.PROBE_RETENTION_MS ? Number(process.env.PROBE_RETENTION_MS) : null;

const eventChannel = `event:${eventId}`;
const screenChannel = (screenId) => `screen:${eventId}:${screenId}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function connect(label, { channels, watch = [], since, epoch } = {}) {
	const url = new URL(`${origin.replace(/^http/, 'ws')}/connect`);
	url.searchParams.set('secret', secret);
	url.searchParams.set('event', String(eventId));
	url.searchParams.set('channels', channels.join(','));
	if (watch.length) url.searchParams.set('watch', watch.join(','));
	if (since) url.searchParams.set('since', JSON.stringify(since));
	if (epoch) url.searchParams.set('epoch', epoch);

	const startedAt = performance.now();
	const socket = new WebSocket(url);
	// A resuming client expects the message after the one it last held.
	const client = { label, socket, frames: [], seq: { ...since }, epoch: null, waiters: new Set() };
	socket.addEventListener('message', ({ data }) => {
		if (data === 'pong') return;
		const frame = { ...JSON.parse(data), receivedAt: performance.now() };
		client.frames.push(frame);
		if (frame.t === 'attached') {
			client.epoch = frame.epoch;
			if (!frame.resumed) client.seq[frame.channel] = frame.seq;
		}
		if (frame.t === 'msg') {
			// The order and completeness of every channel, checked on every frame.
			assert.equal(
				frame.seq,
				(client.seq[frame.channel] ?? 0) + 1,
				`${label} gap on ${frame.channel}`,
			);
			client.seq[frame.channel] = frame.seq;
		}
		for (const waiter of [...client.waiters]) waiter();
	});
	client.waitFor = (describe, predicate, timeoutMs = 10_000) =>
		new Promise((resolve, reject) => {
			const check = () => {
				const found = predicate(client.frames);
				if (!found) return false;
				clearTimeout(timer);
				client.waiters.delete(check);
				resolve(found);
				return true;
			};
			const timer = setTimeout(() => {
				client.waiters.delete(check);
				reject(new Error(`${label}: timed out waiting for ${describe}`));
			}, timeoutMs);
			if (!check()) client.waiters.add(check);
		});
	client.attached = client
		.waitFor('attach', (frames) => {
			const attached = frames.filter((frame) => frame.t === 'attached');
			return attached.length === channels.length && attached;
		})
		.then((attached) => ({ attached, ms: performance.now() - startedAt }));
	client.send = (frame) => socket.send(JSON.stringify(frame));
	client.messages = (channel) =>
		client.frames.filter((frame) => frame.t === 'msg' && (!channel || frame.channel === channel));
	client.lastPresence = (channel) =>
		client.frames.findLast((frame) => frame.t === 'presence' && frame.channel === channel);
	return client;
}

async function publish(deliveries) {
	const sentAt = performance.now();
	const response = await fetch(`${origin}/publish?event=${eventId}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-prototype-secret': secret },
		body: JSON.stringify(deliveries),
	});
	assert.equal(response.status, 200, `publish -> ${response.status}`);
	return { ...(await response.json()), sentAt, httpMs: performance.now() - sentAt };
}

function percentiles(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
	const round = (value) => Math.round(value * 10) / 10;
	return {
		n: sorted.length,
		p50: round(at(50)),
		p95: round(at(95)),
		p99: round(at(99)),
		max: round(sorted.at(-1)),
	};
}

/** A Take as the server announces it: the Event message, then the Screen's own. */
const take = (screenId, index) => [
	{
		channel: eventChannel,
		name: 'broadcastGraphicsLiveSession:commandApplied',
		data: { index, pad: 'x'.repeat(1_300) },
	},
	{
		channel: screenChannel(screenId),
		name: 'broadcastGraphicsLiveSession:commandApplied',
		data: { index, pad: 'x'.repeat(1_300) },
	},
];

const report = { origin, eventId, cycles: CYCLES };

// --- Rig -------------------------------------------------------------------
const screens = [1, 2, 3];
const outputs = screens.map((screenId) =>
	connect(`output-${screenId}`, { channels: [eventChannel, screenChannel(screenId)] }),
);
const operators = [1, 2].map((n) =>
	connect(`operator-${n}`, { channels: [eventChannel], watch: screens.map(screenChannel) }),
);
const rig = [...outputs, ...operators];
report.connectMs = percentiles(
	(await Promise.all(rig.map((client) => client.attached))).map(({ ms }) => ms),
);

// --- Presence: enter ---------------------------------------------------------
outputs.forEach((output, index) =>
	output.send({ t: 'enter', channel: screenChannel(screens[index]), data: { protocol: 2 } }),
);
await Promise.all(
	operators.flatMap((operator) =>
		screens.map((screenId) =>
			operator.waitFor(
				`presence on ${screenId}`,
				() => operator.lastPresence(screenChannel(screenId))?.members.length === 1,
			),
		),
	),
);

// --- Fan-out and latency -----------------------------------------------------
const publishes = [];
for (let index = 0; index < CYCLES; index++) {
	const screenId = screens[index % screens.length];
	const result = await publish(take(screenId, index));
	assert.deepEqual(
		result.answers.map(({ recipients }) => recipients),
		[rig.length, 1],
		'fan-out',
	);
	publishes.push({ ...result, screenId, index });
}
await Promise.all(
	rig.map((client) =>
		client.waitFor('every Event message', () => client.messages(eventChannel).length === CYCLES),
	),
);
const eventLatency = [];
const screenLatency = [];
for (const { sentAt, screenId, index } of publishes) {
	for (const client of rig)
		eventLatency.push(
			client.messages(eventChannel).find((frame) => frame.data.index === index).receivedAt - sentAt,
		);
	const output = outputs[screens.indexOf(screenId)];
	screenLatency.push(
		output.messages(screenChannel(screenId)).find((frame) => frame.data.index === index)
			.receivedAt - sentAt,
	);
}
const delivered = rig.reduce((total, client) => total + client.messages().length, 0);
assert.equal(delivered, CYCLES * rig.length + CYCLES, 'delivered');
report.fanOut = { eventChannel: rig.length, screenChannel: 1, published: CYCLES * 2, delivered };
report.publishHttpMs = percentiles(publishes.map(({ httpMs }) => httpMs));
report.publishRpcMs = percentiles(publishes.map(({ rpcMs }) => rpcMs));
report.eventDeliveryMs = percentiles(eventLatency);
report.screenDeliveryMs = percentiles(screenLatency);

// --- Reconnect and catch-up --------------------------------------------------
const dropped = outputs[0];
const held = { since: { ...dropped.seq }, epoch: dropped.epoch };
dropped.socket.close();
await Promise.all(
	operators.map((operator) =>
		operator.waitFor(
			'output-1 leaving',
			() => operator.lastPresence(screenChannel(1))?.members.length === 0,
		),
	),
);
for (let index = 0; index < GAP; index++) await publish(take(1, CYCLES + index));
const reconnectAt = performance.now();
const back = connect('output-1-back', { channels: [eventChannel, screenChannel(1)], ...held });
const { attached } = await back.attached;
assert.deepEqual(
	attached.map(({ resumed }) => resumed),
	[true, true],
	'resumed',
);
await back.waitFor('the gap', () => back.messages().length === GAP * 2);
report.catchUp = {
	missed: GAP * 2,
	replayed: back.messages().filter((frame) => frame.replayed).length,
	ms: Math.round((performance.now() - reconnectAt) * 10) / 10,
};
assert.equal(report.catchUp.replayed, GAP * 2, 'replayed');
await publish(take(1, CYCLES + GAP));
await back.waitFor('a live message after the replay', () => back.messages().length === GAP * 2 + 2);
assert.ok(!back.messages().at(-1).replayed, 'live after replay');
back.send({ t: 'enter', channel: screenChannel(1), data: { protocol: 2 } });

// --- Continuity lost: another epoch, and a gap older than the log ------------
const stranger = connect('output-1-stale-epoch', {
	channels: [screenChannel(1)],
	since: { [screenChannel(1)]: 1 },
	epoch: 'another',
});
assert.equal((await stranger.attached).attached[0].resumed, false, 'stale epoch resumes nothing');
stranger.socket.close();
if (RETENTION_MS !== null) {
	const since = { ...back.seq };
	await sleep(RETENTION_MS + 500);
	await publish(take(1, CYCLES + GAP + 1));
	const late = connect('output-1-late', {
		channels: [eventChannel, screenChannel(1)],
		since,
		epoch: back.epoch,
	});
	// The publish above pruned everything before it, itself excepted; a client one behind still resumes.
	assert.deepEqual(
		(await late.attached).attached.map(({ resumed }) => resumed),
		[true, true],
		'one behind resumes',
	);
	late.socket.close();
	const older = {
		[eventChannel]: since[eventChannel] - 5,
		[screenChannel(1)]: since[screenChannel(1)] - 5,
	};
	const tooLate = connect('output-1-too-late', {
		channels: [eventChannel, screenChannel(1)],
		since: older,
		epoch: back.epoch,
	});
	assert.deepEqual(
		(await tooLate.attached).attached.map(({ resumed }) => resumed),
		[false, false],
		'pruned gap',
	);
	assert.equal(tooLate.messages().length, 0, 'nothing replayed across a pruned gap');
	tooLate.socket.close();
	report.continuityLost = {
		staleEpoch: 'resumed=false',
		prunedGap: 'resumed=false, nothing replayed',
	};
} else {
	report.continuityLost = {
		staleEpoch: 'resumed=false',
		prunedGap: 'not run (PROBE_RETENTION_MS unset)',
	};
}

// --- Presence: an output that goes away --------------------------------------
await Promise.all(
	operators.map((operator) =>
		operator.waitFor(
			'output-1 back',
			() => operator.lastPresence(screenChannel(1))?.members.length === 1,
		),
	),
);
const closedAt = performance.now();
outputs[1].socket.close();
await Promise.all(
	operators.map((operator) =>
		operator.waitFor(
			'output-2 leaving',
			() => operator.lastPresence(screenChannel(2))?.members.length === 0,
		),
	),
);
report.presence = {
	entered: 3,
	leaveNoticedMs: Math.round((performance.now() - closedAt) * 10) / 10,
};

// --- Idle, then publish: sockets and presence survive the object sleeping ----
await sleep(IDLE_MS);
const afterIdle = await publish(take(3, 10_000));
assert.deepEqual(
	afterIdle.answers.map(({ recipients }) => recipients),
	[4, 1],
	'recipients after idle',
);
await outputs[2].waitFor(
	'a message after idle',
	() => outputs[2].messages(screenChannel(3)).at(-1)?.data.index === 10_000,
);
const watcher = connect('late-watcher', {
	channels: [eventChannel],
	watch: screens.map(screenChannel),
});
await watcher.attached;
await watcher.waitFor('presence', () =>
	screens.every((screenId) => watcher.lastPresence(screenChannel(screenId))),
);
assert.deepEqual(
	screens.map((screenId) => watcher.lastPresence(screenChannel(screenId)).members.length),
	[1, 0, 1],
	'presence after idle',
);
report.afterIdle = {
	idleMs: IDLE_MS,
	publishHttpMs: Math.round(afterIdle.httpMs * 10) / 10,
	presence: 'intact',
};

report.stats = await (
	await fetch(`${origin}/stats?event=${eventId}`, { headers: { 'x-prototype-secret': secret } })
).json();
for (const client of [...rig, back, watcher]) client.socket.close();
console.log(JSON.stringify(report, null, 2));
