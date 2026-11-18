// Throwaway for #1295: what a Nuxt Worker does with a Durable Object's WebSocket.
import process from 'node:process';

const origin = process.argv[2];
const eventId = 700_000 + Math.floor(Math.random() * 99_999);
const channel = `event:${eventId}`;
const results = {};

function open(path, headers) {
	return new Promise((resolve) => {
		const url = `${origin.replace(/^http/, 'ws')}${path}?event=${eventId}&channels=${channel}`;
		const socket = new WebSocket(url, { headers });
		const frames = [];
		const timer = setTimeout(() => resolve({ outcome: 'timeout', frames, socket }), 4000);
		socket.addEventListener('message', ({ data }) => {
			frames.push(JSON.parse(data));
			if (frames.length === 1) {
				clearTimeout(timer);
				resolve({ outcome: 'open', frames, socket });
			}
		});
		socket.addEventListener('error', (event) => {
			clearTimeout(timer);
			resolve({
				outcome: `error: ${event.message ?? event.error?.message ?? 'refused'}`,
				frames,
				socket,
			});
		});
	});
}

// A: an ordinary h3 route returning the object's 101.
const viaRoute = await open('/realtime-spike/via-route', {});
results.viaRoute = viaRoute.outcome;
const plain = await fetch(`${origin}/realtime-spike/via-route?event=${eventId}`, {
	headers: {
		upgrade: 'websocket',
		connection: 'Upgrade',
		'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
		'sec-websocket-version': '13',
	},
}).then(
	async (response) => `${response.status} ${(await response.text()).slice(0, 160)}`,
	(error) => `fetch failed: ${error.cause?.message ?? error.message}`,
);
results.viaRouteHttp = plain;

// B: the custom entry, refused without the stand-in credential, then allowed.
const refused = await open('/realtime-spike/connect', {});
results.entryWithoutCredential = refused.outcome;
const allowed = await open('/realtime-spike/connect', { cookie: 'spike=allowed' });
results.entryWithCredential = `${allowed.outcome} ${JSON.stringify(allowed.frames[0] ?? null)}`;

// C: a route publishes by RPC on the Worker's own binding; the socket hears it.
if (allowed.outcome === 'open') {
	const heard = new Promise((resolve) => {
		allowed.socket.addEventListener('message', ({ data }) => resolve(JSON.parse(data)));
		setTimeout(() => resolve(null), 4000);
	});
	const published = await fetch(`${origin}/realtime-spike/publish?event=${eventId}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify([{ channel, name: 'spike', data: { hello: 1 } }]),
	});
	results.publish = `${published.status} ${(await published.text()).slice(0, 200)}`;
	results.heard = JSON.stringify(await heard);
	allowed.socket.close();
}
console.log(JSON.stringify(results, null, 2));
process.exit(0);
