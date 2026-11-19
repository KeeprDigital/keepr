import type { AttachRequest, ClientFrame } from '../protocol.ts';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
/** A channel's name. It keys a socket's presence, so it is never the one name an object cannot hold. */
export const isChannel = (value: unknown): value is string =>
	typeof value === 'string' && value !== '' && value !== '__proto__';
const isSequence = (value: unknown): value is number | undefined =>
	value === undefined || (Number.isSafeInteger(value) && (value as number) >= 0);
const isEpoch = (value: unknown): value is string | undefined =>
	value === undefined || typeof value === 'string';

function readAttachRequest(value: unknown): AttachRequest | undefined {
	if (!isRecord(value) || !isChannel(value.channel) || !isSequence(value.since)) return undefined;
	return { channel: value.channel, ...(value.since !== undefined && { since: value.since }) };
}

/**
 * The frame a client sent, or nothing when it is not one: whatever a socket
 * sends is a stranger's until read. A part of a `hello` that is not what the
 * protocol says is left out, and the rest stands.
 */
export function readClientFrame(raw: string): ClientFrame | undefined {
	let frame: unknown;
	try {
		frame = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!isRecord(frame)) return undefined;
	if (frame.t === 'hello') {
		const attach = Array.isArray(frame.attach) ? frame.attach : [];
		const watch = Array.isArray(frame.watch) ? frame.watch : [];
		return {
			t: 'hello',
			...(typeof frame.epoch === 'string' && { epoch: frame.epoch }),
			attach: attach.map(readAttachRequest).filter((request) => request !== undefined),
			watch: watch.filter(isChannel),
			presence: isRecord(frame.presence) ? frame.presence : {},
		};
	}
	const { t, channel } = frame;
	if (!isChannel(channel)) return undefined;
	if (t === 'attach') {
		if (!isSequence(frame.since) || !isEpoch(frame.epoch)) return undefined;
		return {
			t,
			channel,
			...(frame.since !== undefined && { since: frame.since }),
			...(frame.epoch !== undefined && { epoch: frame.epoch }),
		};
	}
	if (t === 'detach' || t === 'watch' || t === 'unwatch' || t === 'leave') return { t, channel };
	if (t === 'enter' || t === 'update') return { t, channel, data: frame.data };
	return undefined;
}
