import { scenarioSuite } from '@keepr/testkit';
import { describe } from 'vitest';

import { pairRound } from '../src/index.ts';
import { describeRound, roundFromScenario } from './support/scenario.ts';

describe('pairing scenarios', () => {
	scenarioSuite(new URL('./scenarios/', import.meta.url), (scenario) =>
		describeRound(pairRound(roundFromScenario(scenario))),
	);
});
