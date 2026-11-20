// Times one round of each field shape that has been slow to prove: Configurations the simulated
// event in simulate.ts never meets.
//
//   node packages/pairing/bench/configurations.ts <entrants> [--check] [shape ...]
//
// With --check it exits with an error if any round is not proven best, or is slower than the
// target for its size (2 s up to 10,000 Entrants, 10 s up to 20,000). Naming shapes runs only those.
import {
	pairRound,
	startingConfiguration,
	type Constraint,
	type PairingEntrant,
} from '../src/index.ts';

const [sizeText = '2001', ...rest] = process.argv.slice(2);
const size = Number(sizeText);
const check = rest.includes('--check');
const chosen = rest.filter((each) => each !== '--check');
const target = size <= 10_001 ? 2000 : size <= 20_001 ? 10_000 : Number.POSITIVE_INFINITY;

const keepCleanFirst: Constraint[] = [
	{ type: 'keep-top-clean' },
	...startingConfiguration.filter((constraint) => constraint.type !== 'keep-top-clean'),
];
const avoidClubFirst: Constraint[] = [
	{ type: 'avoid-same-group-label', kind: 'club' },
	...startingConfiguration,
];
const entrant = (at: number, score: number, club?: string): PairingEntrant => ({
	id: `e${at}`,
	score,
	opponents: [],
	byes: 0,
	...(club === undefined ? {} : { groups: { club } }),
});

const shapes: Record<
	string,
	{ configuration: Constraint[]; entrant: (at: number) => PairingEntrant }
> = {
	'two-clubs': {
		configuration: avoidClubFirst,
		entrant: (at) => entrant(at, 0, at % 2 === 0 ? 'a' : 'b'),
	},
	'one-club-70': {
		configuration: avoidClubFirst,
		entrant: (at) => entrant(at, 0, at % 10 < 7 ? 'big' : `own${at}`),
	},
	'keep-clean-300-scores': {
		configuration: keepCleanFirst,
		entrant: (at) => entrant(at, at % 300),
	},
	'keep-clean-distinct-scores': {
		configuration: keepCleanFirst,
		entrant: (at) => entrant(at, at),
	},
};

let failed = false;
for (const [name, shape] of Object.entries(shapes)) {
	if (chosen.length > 0 && !chosen.includes(name)) continue;
	const started = performance.now();
	const result = pairRound({
		system: 'swiss',
		entrants: Array.from({ length: size }, (_, at) => shape.entrant(at)),
		configuration: shape.configuration,
		randomSeed: 'bench',
		round: 1,
	});
	const took = performance.now() - started;
	const proven = result.ok && result.provenBest;
	console.log(
		`${name.padEnd(28)} ${took.toFixed(0).padStart(7)} ms  ${size} entrants  proven ${proven ? 'yes' : 'NO'}`,
	);
	if (!proven || took > target) failed = true;
}
if (check && failed) {
	console.log('FAILED: a round was not proven best, or was slower than the target');
	process.exit(1);
}
