/**
 * One client of the realtime probe (#1338): a socket on an Event's object, held
 * as a page holds one, by the package's own client transport
 * (`@keepr/realtime/client`). Reconnecting, catching up and the heartbeat are
 * the transport's, as they are a page's. The probe adds two things at the
 * socket itself, under the transport: a tap that records what the socket
 * carries, and a way to cut it.
 */

import { createSocketTransport } from '@keepr/realtime/client';

/**
 * @typedef {import('./measure.mjs').ProbeRecord} ProbeRecord
 *
 * @typedef {object} ProbeClientOptions
 * @property {string} name What the report calls this client.
 * @property {'session' | 'output'} role
 * @property {string[]} channels The channels it holds, as a page of its kind does.
 * @property {() => string | Promise<string>} address Its socket's address, asked for each socket.
 * @property {Record<string, string>} [headers] What its browser would send with the socket.
 * @property {{ channel: string, data: unknown }} [enter] The presence it enters, as a Screen Output does.
 * @property {(frame: { name: string, data: any }) => boolean} isProbeMessage Whether a message is one the probe's write announces.
 * @property {(record: ProbeRecord) => void} record
 * @property {() => number} now The probe's clock, in epoch milliseconds.
 * @property {new (url: string, init: { headers: Record<string, string> }) => any} [WebSocket] Node's when not given.
 * @property {object} [transport] The client transport's own options, for a test's clock and timings.
 */

/** @param {ProbeClientOptions} options */
export function createProbeClient(options) {
	const { name, role, channels, record, now } = options;
	const Socket = options.WebSocket ?? globalThis.WebSocket;
	const sockets = new Set();
	let cut = false;
	let stopped = false;

	const keep = (entry) => {
		if (!stopped) record({ ...entry, client: name });
	};

	function tap(raw) {
		if (!raw.startsWith('{')) return;
		let frame;
		try {
			frame = JSON.parse(raw);
		} catch {
			return;
		}
		if (frame.t === 'attached') {
			const { channel, resumed, seq, epoch } = frame;
			keep({ kind: 'attached', channel, at: now(), resumed, seq, epoch });
		} else if (frame.t === 'msg') {
			const { channel, seq, name: type, sentAt } = frame;
			keep({
				kind: 'message',
				channel,
				at: now(),
				seq,
				name: type,
				sentAt,
				replayed: frame.replayed === true,
				probe: options.isProbeMessage(frame),
			});
		}
	}

	/** The runtime's WebSocket as the transport is handed it, heard by the tap first. */
	class Tapped {
		#socket;

		constructor(url) {
			// Node's WebSocket takes headers; a browser's sends its own.
			this.#socket = new Socket(url, { headers: options.headers ?? {} });
			sockets.add(this.#socket);
		}

		get readyState() {
			return this.#socket.readyState;
		}

		send(data) {
			this.#socket.send(data);
		}

		close(code, reason) {
			this.#socket.close(code, reason);
		}

		addEventListener(type, listener) {
			this.#socket.addEventListener(type, (event) => {
				if (type === 'close') sockets.delete(this.#socket);
				if (type === 'message') {
					// A cut socket carries nothing more, whatever was already on its way.
					if (cut) return;
					tap(String(event.data));
				}
				listener(event);
			});
		}
	}

	const transport = createSocketTransport({
		...options.transport,
		// No address while cut, and so no Realtime Ticket fetched for a socket
		// that will not open: a failed attempt, which the transport retries.
		address: async () => {
			if (cut) throw new Error('The probe has cut this socket');
			return await options.address();
		},
		WebSocket: Tapped,
	});

	keep({ kind: 'client', role, channels });
	let state = transport.connectionState;
	transport.onChange(() => {
		if (transport.connectionState === state) return;
		state = transport.connectionState;
		keep({
			kind: 'state',
			at: now(),
			state,
			...(transport.error && { why: transport.error.message }),
		});
	});

	// Asked before anything attaches: `onceAttached` tells of the next attach only.
	const attached = Promise.all(
		channels.map(
			(channel) =>
				new Promise((resolve) => {
					transport.onContinuityLost(channel, () => {});
					transport.onceAttached(channel, resolve);
				}),
		),
	);
	if (options.enter) transport.enterPresence(options.enter.channel, options.enter.data);

	return {
		name,
		role,
		channels,
		/** Settles once every channel has attached. */
		attached,
		get connected() {
			return transport.isConnected;
		},
		/** Why it is not connected, or what the object refused it, in the transport's words. */
		whyNot() {
			const refused = transport.channelRefusals.map(({ what, channel }) => `${what} on ${channel}`);
			return (
				transport.refusal?.message ??
				(refused.length > 0 ? `refused ${refused.join(', ')}` : transport.error?.message) ??
				transport.connectionState
			);
		},
		get isCut() {
			return cut;
		},
		/**
		 * Close its socket and let none open until `restore`. The close is a clean
		 * one, which the object hears; a machine that loses power is #1318's gate 7,
		 * and is not this.
		 */
		cut() {
			if (cut || stopped) return;
			keep({ kind: 'cut', at: now() });
			cut = true;
			for (const socket of sockets) socket.close();
		},
		/** Let its socket open again, at once: the transport reconnects and catches up. */
		restore() {
			if (!cut || stopped) return;
			cut = false;
			keep({ kind: 'restore', at: now() });
			transport.checkNow();
		},
		/** End it. Nothing after this is recorded: its own closing is not a drop. */
		stop() {
			stopped = true;
			transport.dispose();
		},
	};
}
