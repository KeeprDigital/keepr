import { describe, expect, test } from 'vitest';

import {
	pairRound,
	startingConfiguration,
	type PairingEntrant,
	type RoundInput,
} from '../src/index.ts';
import { mustPair } from './support/run.ts';

const entrant = (id: string, score = 0): PairingEntrant => ({ id, score, opponents: [], byes: 0 });

const round = (entrants: PairingEntrant[]): RoundInput => ({
	system: 'swiss',
	entrants,
	configuration: [],
	randomSeed: 'seed',
	round: 1,
});

describe('pairRound on the smallest fields', () => {
	test('no Entrants gives an empty result, not an error', () => {
		expect(pairRound(round([]))).toMatchObject({
			ok: true,
			pairings: [],
			bye: null,
			violations: [],
			provenBest: true,
			round: 1,
		});
	});

	test('one Entrant gets the Bye', () => {
		expect(pairRound(round([entrant('ann')]))).toMatchObject({
			ok: true,
			pairings: [],
			bye: 'ann',
		});
	});

	test('two Entrants are paired, higher Score first', () => {
		expect(pairRound(round([entrant('ann', 3), entrant('ben', 6)]))).toMatchObject({
			ok: true,
			pairings: [{ entrants: ['ben', 'ann'], scoreGap: 3 }],
			bye: null,
			provenBest: true,
		});
	});

	test('three Entrants give one Pairing and one Bye', () => {
		const result = mustPair(round([entrant('ann'), entrant('ben'), entrant('cal')]));
		expect(result.pairings).toHaveLength(1);
		const seen = [...result.pairings.flatMap((pairing) => pairing.entrants), result.bye];
		expect(new Set(seen)).toEqual(new Set(['ann', 'ben', 'cal']));
	});

	test.each(['constructor', '__proto__'])(
		'a Group Label kind named %s is an ordinary name',
		(kind) => {
			const labelled = (id: string): PairingEntrant => ({ ...entrant(id), groups: { club: 'x' } });
			const result = mustPair({
				...round([labelled('ann'), labelled('ben')]),
				configuration: [{ type: 'avoid-same-group-label', kind }],
			});
			// Neither has a Group Label of that kind, so nothing is broken.
			expect(result.violations).toEqual([]);
		},
	);

	test('the exported Configuration cannot be changed by a caller', () => {
		expect(Object.isFrozen(startingConfiguration)).toBe(true);
		expect(startingConfiguration.every((constraint) => Object.isFrozen(constraint))).toBe(true);
	});

	test('reports the engine version from package.json', async () => {
		const { default: manifest } = await import('../package.json', { with: { type: 'json' } });
		expect(mustPair(round([])).engineVersion).toBe(manifest.version);
	});
});
