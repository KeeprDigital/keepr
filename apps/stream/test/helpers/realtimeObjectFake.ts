import type { Delivery, PublishAnswer } from '@keepr/realtime/object';
import { vi } from 'vitest';

/**
 * A stand-in for the objects the server publishes to (ADR-0137), recording what
 * each channel was sent so a suite can drive the real `server/utils/realtimePublish`. It
 * stands where the Worker's `REALTIME` binding does, so the realtime layer's
 * own `useRealtimeScope` runs against it.
 *
 * Usage:
 *   const realtime = await installRealtimeObjectFake();
 */

/** One message as a page attached to `channel` would be handed it. */
interface PublishedRealtimeMessage {
	channel: string;
	type: string;
	/** The message without its envelope's `eventId` and `timestamp`. */
	payload: Record<string, unknown>;
}

/** One `publish` call, as the object named `scope` was sent it. */
interface RealtimePublishCall {
	scope: string;
	deliveries: Delivery[];
}

/** What a refused call rejects with, when a test names no error of its own. */
export const REFUSAL_MESSAGE = 'The object refused the call';

/** The channels a call must name to be meant: one channel, or every channel a test accepts. */
type Naming = string | ((channel: string) => boolean);

function names(naming: Naming, { deliveries }: RealtimePublishCall): boolean {
	return deliveries.some(({ channel }) =>
		typeof naming === 'string' ? channel === naming : naming(channel),
	);
}

function received({ channel, name, data }: Delivery): PublishedRealtimeMessage {
	// A page is sent a delivery's data as JSON, in a frame.
	const {
		eventId: _eventId,
		timestamp: _timestamp,
		...payload
	} = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
	return { channel, type: name, payload };
}

function createRealtimeObjectFake() {
	const calls: RealtimePublishCall[] = [];
	const published: PublishedRealtimeMessage[] = [];
	const heads = new Map<string, number>();
	let refusing: { naming: Naming; left: number; error: unknown }[] = [];
	let held: { naming: Naming; until: Promise<unknown> } | null = null;
	let asked: { naming: Naming; tell: () => void } | null = null;

	async function publish(scope: string, sent: readonly Delivery[]): Promise<PublishAnswer[]> {
		// An RPC's arguments cross as a structured clone, or the call is refused.
		const call = { scope, deliveries: structuredClone([...sent]) };
		calls.push(call);

		const hold = held && names(held.naming, call) ? held : null;
		if (hold) held = null;
		if (asked && names(asked.naming, call)) {
			asked.tell();
			asked = null;
		}
		await hold?.until;

		// A call fails as one: none of a refused call's deliveries is published.
		const refusal = refusing.find(({ naming, left }) => left > 0 && names(naming, call));
		if (refusal) {
			refusal.left -= 1;
			throw refusal.error;
		}

		return call.deliveries.map((delivery) => {
			published.push(received(delivery));
			const key = `${scope}\n${delivery.channel}`;
			const seq = (heads.get(key) ?? 0) + 1;
			heads.set(key, seq);
			return { channel: delivery.channel, seq, recipients: 0 };
		});
	}

	return {
		/** The Worker's bindings, as Nitro hands them to the server. */
		env: {
			REALTIME: {
				getByName: (scope: string) => {
					// A stub whose call failed is taken to be broken, as the runtime's can
					// be: it reaches the object no more, and a caller takes another.
					let broken = false;
					return {
						publish: async (deliveries: readonly Delivery[]) => {
							if (broken) throw new Error('This stub is broken: a call on it failed');
							try {
								return await publish(scope, deliveries);
							} catch (error) {
								broken = true;
								throw error;
							}
						},
						disconnect: async () => 0,
					};
				},
			},
		},
		/** Every call made, in order, refused or not. */
		calls,
		published,
		/** What `channel` received, in order. */
		on: (channel: string) => published.filter((message) => message.channel === channel),
		/** Fail the next `times` calls that name `naming`, each of them whole, with `error`. */
		refuse(
			naming: Naming,
			times = Number.POSITIVE_INFINITY,
			error: unknown = new Error(REFUSAL_MESSAGE),
		) {
			refusing.push({ naming, left: times, error });
		},
		/** Keep the next call naming `naming` pending until `until` settles; later calls are answered at once. */
		holdNext(naming: Naming, until: Promise<unknown>) {
			held = { naming, until };
		},
		/** Resolves once the next call naming `naming` has been made, answered or not. */
		nextAsked(naming: Naming) {
			return new Promise<void>((resolve) => {
				asked = { naming, tell: resolve };
			});
		},
		reset() {
			calls.length = 0;
			published.length = 0;
			heads.clear();
			refusing = [];
			held = null;
			asked = null;
		},
	};
}

/**
 * Give the server these Worker bindings, where Nitro puts a Worker's: the
 * fake's `env`, or `{}` for a Worker that binds no object. Set, not stubbed, so
 * a suite's `vi.unstubAllGlobals()` leaves them.
 */
export function setWorkerBindings(env: object) {
	(globalThis as { __env__?: object }).__env__ = env;
}

/**
 * The fake, bound where the server looks: on the Worker's bindings, under the
 * name the realtime layer's configuration gives it, with the layer's own
 * `useRealtimeScope` where Nitro auto-imports it.
 */
export async function installRealtimeObjectFake() {
	const realtime = createRealtimeObjectFake();
	// The layer reads its binding's name from Nitro's runtime configuration,
	// which only a Nitro build can load.
	vi.doMock('nitropack/runtime', () => ({
		useRuntimeConfig: () => ({ realtime: { binding: 'REALTIME' } }),
	}));
	const { useRealtimeScope } = await import('@keepr/realtime/nuxt/server/utils/realtime');
	Object.assign(globalThis, { useRealtimeScope });
	setWorkerBindings(realtime.env);
	return realtime;
}
