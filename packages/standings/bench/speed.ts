// Times a whole recalculation under each Configuration the package ships, and Final Placings,
// at the size the README targets.
//
//   node packages/standings/bench/speed.ts [entrants] [rounds] [--check]
//
// With --check it exits with an error if Final Placings takes over 1 s, the README's target, or
// any call is refused. The recalculations are timed for reading only: on a shared CI machine
// they sit too close to the target to gate on.
import type { Result, StandingsInput } from '../src/index.ts';
import { computeStandings, finalPlacings, presets, startingConfiguration } from '../src/index.ts';

const [sizeText = '20001', roundsText = '15', ...flags] = process.argv.slice(2);
const size = Number(sizeText);
const rounds = Number(roundsText);
const check = flags.includes('--check');
const TARGET_MS = 1000;

// A small seeded generator, so every run times the same event.
let state = 12345;
const random = (): number => {
	state = (state + 0x6d2b79f5) | 0;
	let t = Math.imul(state ^ (state >>> 15), 1 | state);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Every round pairs neighbours in a fresh shuffle, with game scores so every Preset can read it.
const ids = Array.from({ length: size }, (_, at) => `e${at}`);
const results: Result[] = [];
for (let round = 1; round <= rounds; round++) {
	const order = [...ids];
	for (let at = order.length - 1; at > 0; at--) {
		const other = Math.floor(random() * (at + 1));
		[order[at], order[other]] = [order[other] as string, order[at] as string];
	}
	for (let at = 0; at + 1 < order.length; at += 2) {
		const first = random() < 0.5;
		results.push({
			round,
			entrants: [order[at] as string, order[at + 1] as string],
			outcomes: first ? ['win', 'loss'] : ['loss', 'win'],
			games: first ? [2, 1, 0] : [1, 2, 0],
		});
	}
	if (order.length % 2 === 1) results.push({ round, entrant: order.at(-1) as string, kind: 'bye' });
}

let failed = false;
const time = (label: string, run: () => { ok: boolean }, gated: boolean): void => {
	const started = performance.now();
	const result = run();
	const took = performance.now() - started;
	console.log(
		`${label.padEnd(40)} ${took.toFixed(0).padStart(6)} ms${result.ok ? '' : `  ${JSON.stringify(result).slice(0, 300)}`}`,
	);
	if (!result.ok || (gated && took > TARGET_MS)) failed = true;
};

const configurations: [string, StandingsInput['configuration']][] = [
	['starting', startingConfiguration],
	...Object.entries(presets).map(([name, preset]): [string, StandingsInput['configuration']] => [
		name,
		preset.configuration,
	]),
];
for (const [name, configuration] of configurations) {
	time(
		`computeStandings, ${name}`,
		() =>
			computeStandings({
				entrants: ids.map((id) => ({ id })),
				results,
				configuration,
				plannedRounds: rounds,
				randomSeed: 'bench',
			}),
		false,
	);
}

// A Top Cut of eight, decided, with everyone else outside it.
const cut = ids.slice(0, 8);
const entrant = (id: string): { entrant: string } => ({ entrant: id });
time(
	'finalPlacings, cut of 8',
	() =>
		finalPlacings({
			entrants: ids.map((id, at) => ({ id, rank: at + 1 })),
			rounds: [
				{
					byes: [],
					pairings: [
						{ number: 1, slots: [entrant(cut[0] as string), entrant(cut[7] as string)] },
						{ number: 2, slots: [entrant(cut[3] as string), entrant(cut[4] as string)] },
						{ number: 3, slots: [entrant(cut[1] as string), entrant(cut[6] as string)] },
						{ number: 4, slots: [entrant(cut[2] as string), entrant(cut[5] as string)] },
					],
				},
				{
					byes: [],
					pairings: [
						{ number: 5, slots: [{ winnerOf: 1 }, { winnerOf: 2 }] },
						{ number: 6, slots: [{ winnerOf: 3 }, { winnerOf: 4 }] },
					],
				},
				{ byes: [], pairings: [{ number: 7, slots: [{ winnerOf: 5 }, { winnerOf: 6 }] }] },
			],
			// The better Rank wins each quarter-final; the semi-finals and final are still to play.
			winners: [0, 3, 1, 2].map((at, pairing) => ({
				pairing: pairing + 1,
				winner: cut[at] as string,
			})),
		}),
	true,
);

if (check && failed) {
	console.log(`FAILED: Final Placings took over ${TARGET_MS} ms, or a call was refused`);
	process.exit(1);
}
