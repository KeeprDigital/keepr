/**
 * What a run of the realtime probe measured (#1338): the rules, with no socket,
 * clock or network in them. A run is a list of records in the order they
 * happened, and everything reported is read from that list.
 *
 * Two clocks are in a record, and no figure subtracts one from the other.
 * `at`, and a publish's `sentAt` and `answeredAt`, are the probe's. A
 * message's `sentAt` is the object's (`MessageFrame.sentAt`), and is used only
 * to say which publish a message is, and to give a time the Worker's log has.
 *
 * @typedef {{ kind: 'client', client: string, role: 'session' | 'output', channels: string[] }} ClientRecord
 * @typedef {{ kind: 'publish', n: number, channel: string, sentAt: number, answeredAt: number, ok: boolean, why?: string }} PublishRecord
 * @typedef {{ kind: 'attached', client: string, channel: string, at: number, resumed: boolean, seq: number, epoch: string }} AttachedRecord
 * @typedef {{ kind: 'message', client: string, channel: string, at: number, seq: number, name: string, sentAt: number, replayed: boolean, probe: boolean }} MessageRecord
 * @typedef {{ kind: 'state', client: string, at: number, state: string, why?: string }} StateRecord
 * @typedef {{ kind: 'cut' | 'restore', client: string, at: number }} CutRecord
 * @typedef {ClientRecord | PublishRecord | AttachedRecord | MessageRecord | StateRecord | CutRecord} ProbeRecord
 */

/** A message is late when it arrives more than this after its write was sent: the stall #1295 saw was 0.4 s. */
export const DEFAULT_LATE_MS = 400;

/**
 * How far outside a write's own window, from its being sent to its being
 * answered, a message's time may fall and still be that write's. It covers
 * what the two clocks drift apart over a run.
 */
export const ATTRIBUTION_TOLERANCE_MS = 250;

/**
 * The value at or below which `fraction` of `sorted` lie, by nearest rank: one
 * of the values measured, never a figure between two.
 *
 * @param {number[]} sorted Ascending.
 * @param {number} fraction
 */
export function percentile(sorted, fraction) {
	if (sorted.length === 0) return null;
	return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)];
}

/** @param {number[]} delays */
export function delayFigures(delays) {
	const sorted = [...delays].sort((a, b) => a - b);
	return {
		count: sorted.length,
		p50: percentile(sorted, 0.5),
		p95: percentile(sorted, 0.95),
		worst: sorted.at(-1) ?? null,
	};
}

/**
 * What to add to an object's time to have the probe's: the least any message
 * took to arrive, by the two clocks. So an object's time plus this is no
 * earlier than the moment it names, and later by the fastest delivery of the
 * run. `null` when nothing was heard.
 *
 * @param {ProbeRecord[]} records
 */
export function clockOffset(records) {
	let least = null;
	for (const record of records) {
		if (record.kind !== 'message') continue;
		const took = record.at - record.sentAt;
		if (least === null || took < least) least = took;
	}
	return least;
}

/**
 * Which publish a message is, by when the object published it.
 *
 * A Screen command's message carries nothing its sender chose, so it is known
 * by its time: the probe publishes one at a time, and the object published
 * each between the write being sent and being answered. A message whose time
 * falls in no write's window, within the tolerance, is not this run's: another
 * person's command.
 *
 * @param {PublishRecord[]} publishes
 * @param {number | null} offset
 * @param {number} toleranceMs
 * @returns {(message: MessageRecord) => PublishRecord | null}
 */
function publishFinder(publishes, offset, toleranceMs) {
	/** @type {Map<string, PublishRecord[]>} */
	const byChannel = new Map();
	for (const publish of [...publishes].sort((a, b) => a.sentAt - b.sentAt)) {
		const held = byChannel.get(publish.channel) ?? [];
		byChannel.set(publish.channel, held);
		held.push(publish);
	}
	const outside = (publish, at) =>
		at < publish.sentAt
			? publish.sentAt - at
			: at > publish.answeredAt
				? at - publish.answeredAt
				: 0;

	return (message) => {
		const held = byChannel.get(message.channel);
		if (!message.probe || offset === null || !held) return null;
		const at = message.sentAt + offset;
		// The last write sent at or before it, by bisection, and the one after.
		let low = 0;
		let high = held.length;
		while (low < high) {
			const middle = (low + high) >> 1;
			if (held[middle].sentAt <= at) low = middle + 1;
			else high = middle;
		}
		let found = null;
		for (const candidate of [held[low - 1], held[low]]) {
			if (!candidate || outside(candidate, at) > toleranceMs) continue;
			if (!found || outside(candidate, at) < outside(found, at)) found = candidate;
		}
		return found;
	};
}

/** Consecutive sequences as ranges. @param {number[]} sequences Ascending. */
function ranges(sequences) {
	const found = [];
	for (const seq of sequences) {
		const last = found.at(-1);
		if (last && last.to === seq - 1) last.to = seq;
		else found.push({ from: seq, to: seq });
	}
	return found;
}

/**
 * Read a run's records into what each client heard.
 *
 * For each client:
 *
 * - **delay**: for each publish it heard, from the write being sent to the
 *   message arriving, on the probe's clock. What a cut client is replayed after
 *   the probe restores it is that cut's catch-up, and is not in these figures.
 * - **late**: a delay over `lateMs`.
 * - **missing**: a publish on a channel it holds that it never heard.
 * - **repeated**: a sequence its socket carried twice, or one publish under
 *   two sequences, which is the one a page hears twice.
 * - **reordered**: a sequence that arrived after a higher one.
 * - **gaps**: sequences of a channel it never heard, skipped while attached or
 *   lost at an attach the object could not resume.
 * - **drops**: each time it lost its connection, why, and for how long.
 * - **cuts**: for each cut the probe made, what the client missed and what it
 *   was replayed. A catch-up is `exact` when every channel resumed and was
 *   replayed each sequence it missed, once, in order, and nothing else.
 *
 * @param {ProbeRecord[]} records
 * @param {{ lateMs?: number, toleranceMs?: number }} [options]
 */
export function measure(records, options = {}) {
	const lateMs = options.lateMs ?? DEFAULT_LATE_MS;
	const publishes = /** @type {PublishRecord[]} */ (
		records.filter((record) => record.kind === 'publish')
	);
	const offset = clockOffset(records);
	const publishOf = publishFinder(
		publishes,
		offset,
		options.toleranceMs ?? ATTRIBUTION_TOLERANCE_MS,
	);

	/** Every sequence each publish was heard under, by any client. @type {Map<number, Set<number>>} */
	const sequencesOf = new Map();
	/** Messages like the probe's that are no publish of this run, each once. @type {Map<string, MessageRecord>} */
	const foreign = new Map();

	const clients = new Map();
	const clientOf = (name) => {
		let client = clients.get(name);
		if (!client) {
			client = {
				client: name,
				role: 'session',
				channels: [],
				/** @type {Map<string, { epoch: string, max: number, holes: Set<number>, since: number }>} */
				held: new Map(),
				/** @type {Map<number, any>} */
				heard: new Map(),
				repeated: [],
				reordered: [],
				gaps: [],
				drops: [],
				cuts: [],
				connected: false,
			};
			clients.set(name, client);
		}
		return client;
	};

	for (const record of records) {
		if (record.kind === 'publish') continue;
		const client = clientOf(record.client);
		const cut = client.cuts.at(-1);

		if (record.kind === 'client') {
			client.role = record.role;
			client.channels = record.channels;
		} else if (record.kind === 'cut') {
			client.cuts.push({ cutAt: record.at, restoredAt: null, channels: new Map(), publishes: [] });
		} else if (record.kind === 'restore') {
			if (cut && cut.restoredAt === null) cut.restoredAt = record.at;
		} else if (record.kind === 'state') {
			const drop = client.drops.at(-1);
			if (record.state === 'connected') {
				if (drop && drop.backAt === null) drop.backAt = record.at;
			} else if (client.connected) {
				client.drops.push({
					at: record.at,
					backAt: null,
					why: record.why ?? record.state,
					fault: false,
					byProbe: Boolean(cut && cut.restoredAt === null),
				});
			}
			if (record.state === 'suspended' && drop && drop.backAt === null) drop.fault = true;
			client.connected = record.state === 'connected';
		} else if (record.kind === 'attached') {
			const held = client.held.get(record.channel);
			// The first attach after the probe restored its cut starts that cut's catch-up.
			if (cut && cut.restoredAt !== null && !cut.channels.has(record.channel)) {
				cut.channels.set(record.channel, {
					channel: record.channel,
					from: held?.max ?? record.seq,
					head: record.seq,
					resumed: record.resumed,
					replayed: [],
					lastAt: record.at,
				});
			}
			if (!held) {
				client.held.set(record.channel, {
					epoch: record.epoch,
					max: record.seq,
					holes: new Set(),
					since: record.at,
				});
			} else if (held.epoch !== record.epoch) {
				// Another storage: its sequences join nothing this client held.
				client.gaps.push({ channel: record.channel, at: record.at, lost: true, epoch: true });
				Object.assign(held, { epoch: record.epoch, max: record.seq, holes: new Set() });
			} else if (!record.resumed && record.seq > held.max) {
				// The object could not replay what followed: it is not coming.
				client.gaps.push({
					channel: record.channel,
					from: held.max + 1,
					to: record.seq,
					at: record.at,
					lost: true,
				});
				held.max = record.seq;
			}
		} else if (record.kind === 'message') {
			const held = client.held.get(record.channel);
			if (!held) continue;
			const publish = publishOf(record);
			if (record.probe && !publish)
				foreign.set(`${record.channel} ${record.seq} ${record.sentAt}`, record);
			const named = { channel: record.channel, seq: record.seq, at: record.at, n: publish?.n };

			if (held.holes.delete(record.seq)) {
				client.reordered.push({ ...named, after: held.max });
			} else if (record.seq <= held.max) {
				client.repeated.push({ ...named, what: 'sequence' });
				continue;
			} else {
				for (let seq = held.max + 1; seq < record.seq; seq++) held.holes.add(seq);
				held.max = record.seq;
			}

			const catchUp = cut?.channels.get(record.channel);
			const caughtUp = Boolean(catchUp && record.replayed && record.seq <= catchUp.head);
			if (caughtUp) {
				catchUp.replayed.push(record.seq);
				catchUp.lastAt = record.at;
			}
			if (!publish) continue;
			const sequences = sequencesOf.get(publish.n) ?? new Set();
			sequencesOf.set(publish.n, sequences);
			sequences.add(record.seq);
			if (client.heard.has(publish.n)) {
				client.repeated.push({ ...named, what: 'publish' });
				continue;
			}
			if (caughtUp) cut.publishes.push(publish.n);
			client.heard.set(publish.n, {
				...named,
				sentAt: publish.sentAt,
				objectSentAt: record.sentAt,
				delay: record.at - publish.sentAt,
				replayed: record.replayed,
				caughtUp,
			});
		}
	}

	const reported = [...clients.values()].map((client) => {
		for (const [channel, held] of client.held)
			for (const { from, to } of ranges([...held.holes].sort((a, b) => a - b)))
				client.gaps.push({ channel, from, to, lost: false });

		const timed = [...client.heard.values()].filter((heard) => !heard.caughtUp);
		const missing = [];
		let expected = 0;
		for (const publish of publishes) {
			const held = client.held.get(publish.channel);
			const sequences = sequencesOf.get(publish.n);
			// A write that failed and that nobody heard published nothing.
			if (!client.channels.includes(publish.channel) || (!publish.ok && !sequences)) continue;
			if (held && publish.sentAt < held.since) continue;
			expected += 1;
			if (client.heard.has(publish.n)) continue;
			const lost = client.gaps.some(
				(gap) =>
					gap.lost &&
					gap.channel === publish.channel &&
					(gap.epoch || [...(sequences ?? [])].some((seq) => seq >= gap.from && seq <= gap.to)),
			);
			missing.push({
				n: publish.n,
				channel: publish.channel,
				sentAt: publish.sentAt,
				why: !sequences
					? 'no client heard it'
					: lost
						? 'continuity was lost, so it was not replayed'
						: 'it never arrived',
			});
		}

		const cuts = client.cuts.map((cut) => {
			const channels = [...cut.channels.values()];
			return {
				cutAt: cut.cutAt,
				restoredAt: cut.restoredAt,
				missed: channels.reduce((sum, channel) => sum + (channel.head - channel.from), 0),
				replayed: channels.reduce((sum, channel) => sum + channel.replayed.length, 0),
				// A client of several channels is replayed one channel after another.
				publishes: cut.publishes.sort((a, b) => a - b),
				catchUpMs:
					cut.restoredAt === null || channels.length === 0
						? null
						: Math.max(...channels.map((channel) => channel.lastAt)) - cut.restoredAt,
				exact:
					channels.length > 0 &&
					channels.every(
						(channel) =>
							channel.resumed &&
							channel.replayed.length === channel.head - channel.from &&
							channel.replayed.every((seq, index) => seq === channel.from + 1 + index),
					),
			};
		});

		return {
			client: client.client,
			role: client.role,
			expected,
			heard: client.heard.size,
			delay: delayFigures(timed.map((heard) => heard.delay)),
			late: timed.filter((heard) => heard.delay > lateMs),
			missing,
			repeated: client.repeated,
			reordered: client.reordered,
			gaps: client.gaps,
			drops: client.drops,
			cuts,
		};
	});

	return {
		lateMs,
		published: publishes.length,
		failed: publishes.filter((publish) => !publish.ok),
		foreign: [...foreign.values()],
		clients: reported,
	};
}

/**
 * Whether the run found a defect of delivery: something missing, repeated,
 * reordered or skipped, a write that failed, or a cut client that did not
 * catch up exactly what it missed. A late message is recorded and is not one.
 *
 * @param {ReturnType<typeof measure>} report
 */
export function foundDefect(report) {
	return (
		report.failed.length > 0 ||
		report.clients.some(
			(client) =>
				client.missing.length > 0 ||
				client.repeated.length > 0 ||
				client.reordered.length > 0 ||
				client.gaps.length > 0 ||
				client.cuts.some((cut) => !cut.exact),
		)
	);
}

const time = (ms) => new Date(ms).toISOString();
const milliseconds = (ms) => (ms === null ? '-' : `${Math.round(ms)} ms`);

/** Rows as columns, each as wide as its widest cell. @param {string[][]} rows */
function table(rows) {
	const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
	return rows
		.map((row) =>
			row
				.map((cell, column) => cell.padEnd(widths[column]))
				.join('  ')
				.trimEnd(),
		)
		.join('\n');
}

/**
 * The report as an operator reads it: a line of figures for each client, then
 * each cut, then every message that was late, missing, repeated, reordered or
 * skipped, by name and time. A time marked `object` is the object's own, which
 * the Worker's log has.
 *
 * @param {ReturnType<typeof measure>} report
 */
export function formatReport(report) {
	const lines = [
		`Published ${report.published}, of which ${report.failed.length} failed. A delay is from the write being sent to its message arriving; late is over ${report.lateMs} ms.`,
		'',
		table([
			[
				'client',
				'heard',
				'p50',
				'p95',
				'worst',
				'late',
				'missing',
				'repeated',
				'reordered',
				'gaps',
				'drops',
			],
			...report.clients.map((client) => [
				client.client,
				`${client.heard}/${client.expected}`,
				milliseconds(client.delay.p50),
				milliseconds(client.delay.p95),
				milliseconds(client.delay.worst),
				String(client.late.length),
				String(client.missing.length),
				String(client.repeated.length),
				String(client.reordered.length),
				String(client.gaps.length),
				String(client.drops.filter((drop) => !drop.byProbe).length),
			]),
		]),
	];

	const found = [];
	for (const publish of report.failed)
		found.push(
			`write #${publish.n} to ${publish.channel} failed at ${time(publish.answeredAt)}: ${publish.why ?? 'no reason given'}`,
		);
	for (const client of report.clients) {
		for (const cut of client.cuts) {
			const span =
				cut.restoredAt === null
					? 'and not restored'
					: `for ${milliseconds(cut.restoredAt - cut.cutAt)}`;
			// Each by number while they are few; otherwise how many, and the first and last.
			const numbers =
				cut.publishes.length === 0
					? ''
					: cut.publishes.length <= 8
						? ` (publishes ${cut.publishes.map((n) => `#${n}`).join(', ')})`
						: ` (${cut.publishes.length} publishes, #${cut.publishes[0]} to #${cut.publishes.at(-1)})`;
			found.push(
				`${client.client} cut at ${time(cut.cutAt)} ${span}: missed ${cut.missed} messages${numbers}, was replayed ${cut.replayed}, ` +
					(cut.exact
						? `exactly what it missed, once and in order, ${milliseconds(cut.catchUpMs)} after its socket was restored`
						: 'which is NOT exactly what it missed'),
			);
		}
		for (const drop of client.drops) {
			if (drop.byProbe) continue;
			const out =
				drop.backAt === null ? 'not back' : `back after ${milliseconds(drop.backAt - drop.at)}`;
			found.push(
				`${client.client} lost its connection at ${time(drop.at)}, ${out}${drop.fault ? ', and showed the fault' : ''}: ${drop.why}`,
			);
		}
		for (const late of client.late)
			found.push(
				`${client.client} late: publish #${late.n} sent ${time(late.sentAt)} (object ${time(late.objectSentAt)}) on ${late.channel} seq ${late.seq} took ${milliseconds(late.delay)}${late.replayed ? ', replayed after a reconnect' : ''}`,
			);
		for (const missing of client.missing)
			found.push(
				`${client.client} missing: publish #${missing.n} sent ${time(missing.sentAt)} on ${missing.channel}: ${missing.why}`,
			);
		for (const repeated of client.repeated)
			found.push(
				`${client.client} repeated: ${repeated.n === undefined ? 'a message' : `publish #${repeated.n}`} on ${repeated.channel} seq ${repeated.seq} at ${time(repeated.at)}: ` +
					(repeated.what === 'publish'
						? 'one publish under a second sequence, which a page hears twice'
						: 'a sequence its socket had carried, which the transport drops'),
			);
		for (const reordered of client.reordered)
			found.push(
				`${client.client} reordered: ${reordered.channel} seq ${reordered.seq} arrived at ${time(reordered.at)}, after seq ${reordered.after}`,
			);
		for (const gap of client.gaps)
			found.push(
				`${client.client} gap: ${gap.channel} ` +
					(gap.epoch
						? `attached to another storage at ${time(gap.at)}, so what it missed cannot be counted`
						: `seq ${gap.from} to ${gap.to} never arrived${gap.lost ? `: continuity was lost at ${time(gap.at)}` : ''}`),
			);
	}
	if (report.foreign.length > 0)
		found.push(
			`${report.foreign.length} messages like the probe's were no publish of this run (another person's command): the first on ${report.foreign[0].channel} seq ${report.foreign[0].seq}, object ${time(report.foreign[0].sentAt)}`,
		);

	lines.push(
		'',
		...(found.length > 0 ? found : ['Nothing late, missing, repeated, reordered or skipped.']),
	);
	return lines.join('\n');
}
