import { describe, expect, it } from 'vitest';
import { ANONYMOUS_ERA_ACTOR_NAME, graphicsActorNames } from '~~/server/utils/actorNames';

// What an administrator reading calls the actors it carries (ADR-0010,
// ADR-0141). Stream Keepr holds no Users: only the reader's own name reaches
// it, in their Identity Proof, so every other User's id is answered as recorded.

const ANONYMOUS_AUTHOR = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const reader = (name: string) => ({ id: 'grace', name, email: 'grace@example.test' });

describe('graphicsActorNames', () => {
	it.each([
		[
			'the reader, by the name Keepr Accounts vouches for',
			'grace',
			reader('Grace Hopper'),
			'Grace Hopper',
		],
		[
			'the reader, by address when their name is blank',
			'grace',
			reader('   '),
			'grace@example.test',
		],
		['another User, by the id the ledger recorded', 'ada', reader('Grace Hopper'), 'ada'],
		[
			'a machine actor, by its own spelling',
			'graphics-retention-policy',
			reader('G'),
			'graphics-retention-policy',
		],
		[
			'an anonymous-era author, as the era',
			ANONYMOUS_AUTHOR,
			reader('G'),
			ANONYMOUS_ERA_ACTOR_NAME,
		],
		['a User, by id, when nobody is reading', 'grace', null, 'grace'],
	])('names %s', (_case, actor, readBy, name) => {
		expect(graphicsActorNames([actor], readBy)).toEqual({ [actor]: name });
	});

	it('answers each actor asked about once, and nothing for a blank one', () => {
		expect(graphicsActorNames(['ada', '', 'ada', 'grace'], reader('Grace'))).toEqual({
			ada: 'ada',
			grace: 'Grace',
		});
	});
});
