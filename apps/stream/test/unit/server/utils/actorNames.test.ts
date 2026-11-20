import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	ANONYMOUS_ERA_ACTOR_NAME,
	graphicsActorNames,
	withActorNames,
} from '~~/server/utils/actorNames';
import {
	AN_ADMINISTRATOR,
	keeprAccountsBinding,
	workerRequest,
} from '~~/test/helpers/keeprAccounts';

// What an administrator reading calls the actors it carries (ADR-0010,
// ADR-0141, ADR-0145). Stream Keepr holds no Users: the reader's name reaches it
// in their Identity Proof, and another User's by asking Keepr Accounts.

const ANONYMOUS_AUTHOR = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const reader = (name: string) => ({ id: 'grace', name, email: 'grace@example.test' });

describe('graphicsActorNames', () => {
	it.each([
		[
			'the reader, by the name their Identity Proof vouches for',
			'grace',
			reader('Grace Hopper'),
			{ grace: 'Somebody Else' },
			'Grace Hopper',
		],
		[
			'the reader, by address when their name is blank',
			'grace',
			reader('   '),
			{},
			'grace@example.test',
		],
		[
			'another User, by the name Keepr Accounts told the reader',
			'ada',
			reader('Grace Hopper'),
			{ ada: 'Ada Lovelace' },
			'Ada Lovelace',
		],
		[
			'a User Keepr Accounts did not name, by the id the ledger recorded',
			'ada',
			reader('Grace Hopper'),
			{ bo: 'Bo' },
			'ada',
		],
		[
			'a machine actor, by its own spelling',
			'graphics-retention-policy',
			reader('G'),
			{ 'graphics-retention-policy': 'A Person' },
			'graphics-retention-policy',
		],
		[
			'an anonymous-era author, as the era',
			ANONYMOUS_AUTHOR,
			reader('G'),
			{ [ANONYMOUS_AUTHOR]: 'A Person' },
			ANONYMOUS_ERA_ACTOR_NAME,
		],
		['a User, by id, when nobody is reading', 'grace', null, {}, 'grace'],
	])('names %s', (_case, actor, readBy, userNames, name) => {
		expect(graphicsActorNames([actor], readBy, userNames)).toEqual({ [actor]: name });
	});

	it('answers each actor asked about once, and nothing for a blank one', () => {
		expect(graphicsActorNames(['ada', '', 'ada', 'grace'], reader('Grace'))).toEqual({
			ada: 'ada',
			grace: 'Grace',
		});
	});
});

// A reading as its route ends it. The Accounts Stand-in answers as Keepr Accounts
// behind the Worker's binding; only that connection is faked.
describe('withActorNames', () => {
	const accounts = keeprAccountsBinding();
	const reading = { outcome: 'complete' };
	const readBy = (env: Record<string, unknown> = { KEEPR_ACCOUNTS: accounts }) =>
		workerRequest({ as: AN_ADMINISTRATOR, env });

	beforeEach(() => {
		accounts.asked.length = 0;
		accounts.askedToName.length = 0;
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	it('names another User as Keepr Accounts names them to the reader, and asks about nobody else', async () => {
		await accounts.holds({ user: 'ada', name: 'Ada Lovelace' });

		const named = await withActorNames(readBy(), reader('Grace Hopper'), reading, [
			'ada',
			'grace',
			'',
			ANONYMOUS_AUTHOR,
			'graphics-retention-policy',
			'graphics-reconciliation-policy',
			'ada',
		]);

		expect(named).toEqual({
			outcome: 'complete',
			actorNames: {
				ada: 'Ada Lovelace',
				grace: 'Grace Hopper',
				[ANONYMOUS_AUTHOR]: ANONYMOUS_ERA_ACTOR_NAME,
				'graphics-retention-policy': 'graphics-retention-policy',
				'graphics-reconciliation-policy': 'graphics-reconciliation-policy',
			},
		});
		expect(accounts.askedToName).toEqual([['ada']]);
	});

	it('asks Keepr Accounts nothing for a reading that names no other User', async () => {
		await withActorNames(readBy(), reader('Grace Hopper'), reading, [
			'grace',
			ANONYMOUS_AUTHOR,
			'graphics-retention-policy',
		]);

		expect(accounts.asked).toEqual([]);
	});

	// Deploy order: Stream Keepr may reach a Keepr Accounts of an earlier Release,
	// which answers a path it does not serve with its page.
	it('answers the reading whole, with ids, from a Keepr Accounts that has no such route yet', async () => {
		const earlier = {
			fetch: async () =>
				new Response('<!DOCTYPE html><html></html>', {
					headers: { 'content-type': 'text/html;charset=utf-8' },
				}),
		};

		const named = await withActorNames(
			readBy({ KEEPR_ACCOUNTS: earlier }),
			reader('Grace Hopper'),
			reading,
			['bo', 'grace'],
		);

		expect(named).toEqual({
			outcome: 'complete',
			actorNames: { bo: 'bo', grace: 'Grace Hopper' },
		});
	});
});
