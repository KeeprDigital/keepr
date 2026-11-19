/**
 * The realtime probe (#1338): measures what each realtime client of one Event
 * hears, for the gates on delivery that are otherwise judged by eye (#1318).
 *
 * It holds sockets as the pages do, through the package's own client transport:
 * some as a signed-in page, and one as a Screen Output of each Screen. It
 * publishes on a timer through a real write, a Screen command to each Screen
 * in turn, and records for each client the delay of every message and any gap,
 * repeat or reorder. It can cut a client's socket and restore it, to time its
 * catch-up. `README.md` § Realtime probe says how it is run.
 *
 *   pnpm probe:realtime <origin> --event <id> [options]
 *
 * It carries no credential and nothing in the app is opened for it
 * (`realtime-probe/installation.mjs`).
 */

import { writeFile } from 'node:fs/promises';
import process from 'node:process';
import { createProbeClient } from './realtime-probe/client.mjs';
import {
	createSignedInPage,
	isProbeMessage,
	loadEnvironmentOrigins,
	openScreenOutput,
	openSession,
	PROBE_COMMAND,
	ProbeRefusal,
	probeTarget,
} from './realtime-probe/installation.mjs';
import { DEFAULT_LATE_MS, formatReport, foundDefect, measure } from './realtime-probe/measure.mjs';

export const USAGE = `Usage: pnpm probe:realtime <origin> --event <id> [options]

  <origin>               The Installation: http://127.0.0.1:8787, or Staging's.
  --event <id>           The Event to probe. A test Event: every output of its Screens hears the write.
  --screens <id,id>      Its Screens to probe, by id. Every Screen of the Event when not given.
  --sessions <n>         Sockets held as a signed-in page holds one. 2.
  --count <n>            Publishes to make. 400, unless --for is given.
  --for <duration>       Publish for this long instead: 90s, 20m, 8h.
  --every <duration>     From one publish to the next. 1s.
  --late <duration>      A message is late when it takes longer than this. ${DEFAULT_LATE_MS}ms.
  --cut <client>@<after>+<for>
                         Cut that client's socket <after> into the run and restore it <for> later:
                         --cut output-3@20s+10s. May be given more than once.
  --log <file>           Write every record of the run there, one JSON object a line.
  --said-by <person>     Who said to probe an origin that is neither local nor Staging's.

A duration is a number and ms, s, m or h. Clients are named session-1, session-2 and
output-<Screen id>. Ctrl-C ends a run early and reports what it has.`;

const DURATION_UNITS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };

/** A duration as written (`250ms`, `90s`, `20m`, `8h`), in milliseconds. */
function duration(flag, value) {
	const written = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value ?? '');
	if (!written) throw new ProbeRefusal(`${flag} takes a duration such as 250ms, 90s, 20m or 8h`);
	return Number(written[1]) * DURATION_UNITS[written[2]];
}

function count(flag, value) {
	if (!/^[1-9]\d*$/.test(value ?? '')) throw new ProbeRefusal(`${flag} takes a whole number`);
	return Number(value);
}

/**
 * What a run was asked for. Refuses what it cannot read, rather than run
 * something else: a mistyped flag on a long run is found when it ends.
 *
 * @param {string[]} argv
 */
export function parseArguments(argv) {
	const options = {
		origin: /** @type {string | undefined} */ (undefined),
		eventId: /** @type {number | undefined} */ (undefined),
		screenIds: /** @type {number[] | undefined} */ (undefined),
		sessions: 2,
		count: /** @type {number | undefined} */ (undefined),
		forMs: /** @type {number | undefined} */ (undefined),
		everyMs: 1000,
		lateMs: DEFAULT_LATE_MS,
		cuts: /** @type {{ client: string, afterMs: number, forMs: number }[]} */ ([]),
		log: /** @type {string | undefined} */ (undefined),
		saidBy: /** @type {string | undefined} */ (undefined),
	};
	for (let index = 0; index < argv.length; index++) {
		const flag = argv[index];
		if (!flag.startsWith('--')) {
			if (options.origin !== undefined) throw new ProbeRefusal(`One origin: ${flag} is a second`);
			options.origin = flag;
			continue;
		}
		const value = argv[++index];
		if (value === undefined) throw new ProbeRefusal(`${flag} takes a value`);
		if (flag === '--event') options.eventId = count(flag, value);
		else if (flag === '--screens')
			options.screenIds = value.split(',').map((id) => count(flag, id));
		else if (flag === '--sessions') options.sessions = count(flag, value);
		else if (flag === '--count') options.count = count(flag, value);
		else if (flag === '--for') options.forMs = duration(flag, value);
		else if (flag === '--every') options.everyMs = duration(flag, value);
		else if (flag === '--late') options.lateMs = duration(flag, value);
		else if (flag === '--log') options.log = value;
		else if (flag === '--said-by') options.saidBy = value;
		else if (flag === '--cut') {
			const written = /^([\w-]+)@([\d.]+[a-z]+)\+([\d.]+[a-z]+)$/.exec(value);
			if (!written) throw new ProbeRefusal('--cut takes <client>@<after>+<for>: output-3@20s+10s');
			options.cuts.push({
				client: written[1],
				afterMs: duration(flag, written[2]),
				forMs: duration(flag, written[3]),
			});
		} else throw new ProbeRefusal(`Unknown option ${flag}`);
	}
	if (options.origin === undefined || options.eventId === undefined)
		throw new ProbeRefusal('An origin and --event are required');
	if (options.count !== undefined && options.forMs !== undefined)
		throw new ProbeRefusal('--count or --for, not both');
	if (options.count === undefined && options.forMs === undefined) options.count = 400;
	return /** @type {typeof options & { origin: string, eventId: number }} */ (options);
}

/** How long every client is given to connect and attach before the run gives up. */
const ATTACH_TIMEOUT_MS = 30_000;
/** How long after the last publish, or after a restored client is back, the run goes on hearing. */
const SETTLE_MS = 2000;
/** How long a client restored at the end is given to come back. */
const RETURN_TIMEOUT_MS = 30_000;

/**
 * Run the probe: open its clients, publish, and answer the run's records.
 *
 * @param {ReturnType<typeof parseArguments>} options
 * @param {object} [boundary] What a run reaches outside itself, for a test to stand in for.
 * @param {typeof fetch} [boundary.fetchRequest]
 * @param {any} [boundary.WebSocket]
 * @param {Record<string, string | undefined>} [boundary.env]
 * @param {Record<string, string>} [boundary.environments] Each Environment's origin.
 * @param {(line: string) => void} [boundary.say] Progress, as it happens.
 * @param {AbortSignal} [boundary.stop] Ends the run early.
 * @param {number} [boundary.settleMs] How long the run goes on hearing after its last publish.
 */
export async function runProbe(options, boundary = {}) {
	const fetchRequest = boundary.fetchRequest ?? fetch;
	const say = boundary.say ?? (() => {});
	const now = () => performance.timeOrigin + performance.now();
	const stopped = () => boundary.stop?.aborted === true;
	/** A wait that a stop cuts short. */
	const wait = (ms) =>
		new Promise((resolve) => {
			if (stopped()) return resolve(undefined);
			const timer = setTimeout(resolve, ms);
			boundary.stop?.addEventListener('abort', () => (clearTimeout(timer), resolve(undefined)), {
				once: true,
			});
		});

	const target = probeTarget(
		options.origin,
		boundary.environments ?? (await loadEnvironmentOrigins()),
		options.saidBy,
	);
	const { eventId } = options;
	const cookie = await openSession(target.origin, { env: boundary.env, fetchRequest });
	const page = createSignedInPage({ origin: target.origin, cookie, fetchRequest });

	const known = await page.screens(eventId);
	const screens = options.screenIds
		? options.screenIds.map((id) => {
				const screen = known.find((candidate) => candidate.id === id);
				if (!screen) throw new ProbeRefusal(`Event ${eventId} has no Screen ${id}`);
				return screen;
			})
		: known;
	if (screens.length === 0) throw new ProbeRefusal(`Event ${eventId} has no Screen to probe`);

	/** @type {import('./realtime-probe/measure.mjs').ProbeRecord[]} */
	const records = [];
	const record = (entry) => records.push(entry);
	const shared = { record, now, isProbeMessage, WebSocket: boundary.WebSocket };
	const clients = [];
	/** Where each publish goes in turn: a Screen, and its own channel. */
	const targets = [];
	try {
		for (let index = 1; index <= options.sessions; index++) {
			clients.push(
				createProbeClient({
					...shared,
					name: `session-${index}`,
					role: 'session',
					channels: page.channels(
						eventId,
						screens.map((screen) => screen.id),
					),
					address: () => page.socketAddress(eventId),
					headers: page.socketHeaders,
				}),
			);
		}
		for (const screen of screens) {
			// Handed its URL as an operator is, and from there on its own.
			const output = await openScreenOutput(await page.outputUrl(eventId, screen), {
				fetchRequest,
			});
			targets.push({ screenId: output.screenId, channel: output.channel });
			clients.push(
				createProbeClient({
					...shared,
					name: `output-${screen.id}`,
					role: 'output',
					channels: [output.channel],
					address: output.address,
					// A Screen Output is in its Screen's presence, so the object asks and
					// sweeps this socket as it does an output's (ADR-0139). It says of itself
					// what an output does (`ScreenPresenceData`), so an operator's page counts
					// it as one, and `probe` tells it apart. `protocol` is
					// `SCREEN_CHANNEL_PROTOCOL`, in an app module no script can import.
					enter: {
						channel: output.channel,
						data: {
							screenId: output.screenId,
							connectedAt: Date.now(),
							outputMode: 'overlay',
							assetAccess: 'granted',
							protocol: 2,
							probe: true,
						},
					},
				}),
			);
		}
		for (const cut of options.cuts)
			if (!clients.some((client) => client.name === cut.client))
				throw new ProbeRefusal(
					`--cut names ${cut.client}, and the clients are ${clients.map((client) => client.name).join(', ')}`,
				);

		let late;
		const everyone = Promise.all(clients.map((client) => client.attached));
		const inTime = await Promise.race([
			everyone.then(() => true),
			new Promise((resolve) => (late = setTimeout(resolve, ATTACH_TIMEOUT_MS, false))),
		]);
		clearTimeout(late);
		if (!inTime)
			throw new Error(
				`Not every client attached in ${ATTACH_TIMEOUT_MS / 1000} s: ` +
					clients.map((client) => `${client.name} (${client.whyNot()})`).join(', '),
			);
		say(
			`${clients.length} clients attached on ${target.origin} (${target.where}), Event ${eventId}: ` +
				`${clients.map((client) => client.name).join(', ')}. The write is ${JSON.stringify(PROBE_COMMAND)}.`,
		);

		const startedAt = now();
		const timers = options.cuts.flatMap((cut) => {
			const client = clients.find((candidate) => candidate.name === cut.client);
			return [
				setTimeout(() => (client.cut(), say(`${client.name} cut`)), cut.afterMs),
				setTimeout(
					() => (client.restore(), say(`${client.name} restored`)),
					cut.afterMs + cut.forMs,
				),
			];
		});

		let n = 0;
		const more = () =>
			!stopped() &&
			(options.count !== undefined ? n < options.count : now() - startedAt < options.forMs);
		while (more()) {
			n += 1;
			const { screenId, channel } = targets[(n - 1) % targets.length];
			const sentAt = now();
			const answer = await page.publish(eventId, screenId);
			record({
				kind: 'publish',
				n,
				channel,
				sentAt,
				answeredAt: now(),
				...answer,
			});
			if (!answer.ok) say(`write #${n} failed: ${answer.why}`);
			else if (n % 100 === 0) say(`${n} published`);
			if (more()) await wait(Math.max(0, sentAt + options.everyMs - now()));
		}

		// A cut still open is restored, so the run ends with every client heard out.
		for (const timer of timers) clearTimeout(timer);
		for (const client of clients) if (client.isCut) client.restore();
		const deadline = now() + RETURN_TIMEOUT_MS;
		while (clients.some((client) => !client.connected) && now() < deadline)
			await new Promise((resolve) => setTimeout(resolve, 50));
		await new Promise((resolve) => setTimeout(resolve, boundary.settleMs ?? SETTLE_MS));
	} finally {
		for (const client of clients) client.stop();
	}

	return { target, records, report: measure(records, { lateMs: options.lateMs }) };
}

/** @param {string[]} argv */
export async function main(argv) {
	const stop = new AbortController();
	const onSignal = () => stop.abort();
	process.once('SIGINT', onSignal);
	process.once('SIGTERM', onSignal);
	try {
		const options = parseArguments(argv);
		const { target, records, report } = await runProbe(options, {
			stop: stop.signal,
			say: (line) => process.stderr.write(`${new Date().toISOString()} ${line}\n`),
		});
		if (options.log)
			await writeFile(options.log, records.map((entry) => `${JSON.stringify(entry)}\n`).join(''));
		process.stdout.write(
			`Realtime probe of ${target.origin} (${target.where}${target.saidBy ? `, on the say of ${target.saidBy}` : ''}), Event ${options.eventId}\n` +
				`${formatReport(report)}\n`,
		);
		return foundDefect(report) ? 1 : 0;
	} catch (failure) {
		// 2, not 1: a run that could not be made found nothing about delivery.
		if (failure instanceof ProbeRefusal) process.stderr.write(`${failure.message}\n\n${USAGE}\n`);
		else process.stderr.write(`The probe could not run: ${failure?.message ?? failure}\n`);
		return 2;
	} finally {
		process.off('SIGINT', onSignal);
		process.off('SIGTERM', onSignal);
	}
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
