import { deepFrozen, type Constraint } from '@keepr/engine-core';

/**
 * A generic Configuration to pass in or adapt. The engine never applies it on its own.
 * It needs no Rank, so it works without Standings. It is frozen: adapt a copy.
 */
export const startingConfiguration: readonly Constraint[] = deepFrozen([
	{ type: 'no-rematch' },
	{ type: 'bye-cap', max: 1 },
	{ type: 'bye-to-lowest-score' },
	{ type: 'pair-close-in-score' },
	{ type: 'keep-top-clean' },
]);
