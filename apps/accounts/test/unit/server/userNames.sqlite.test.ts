import type { TestAccounts } from '~~/test/helpers/keeprAccounts';
import type { AccountsConnection } from '@keepr/nuxt-layer/server/utils/requestIdentity';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUserNameReader } from '@keepr/nuxt-layer/server/utils/userNames';
import { USER_NAMES_MAX_IDS, userNamesAddress } from '@keepr/nuxt-layer/shared/utils/userNames';
import { identityDatabase, schema } from '~~/server/db';
import { KeeprRefusal } from '~~/server/utils/refusal';
import { answerUserNames } from '~~/server/utils/userNames';
import { createTestAccounts, fakeBreachedPasswordService } from '~~/test/helpers/keeprAccounts';

// Whose name Keepr Accounts tells a Session, by id: a User who shares an
// Organisation with its own User, and nobody else's (ADR-0145). Request in,
// response out, on the real identity schema.

const ASKER = 'grace@keepr.digital';
const DAY_MS = 24 * 60 * 60 * 1000;

let accounts: TestAccounts;
let asker: string;

beforeEach(async () => {
	fakeBreachedPasswordService();
	accounts = await createTestAccounts();
	({ id: asker } = await accounts.createUser(ASKER));
	await accounts.addMember(asker, 'keepr');
});

afterEach(async () => await accounts.harness.close());

const database = () => identityDatabase(accounts.harness.database);

/** A User called by the part of `email` before the `@`, in each of `organisations`. */
async function userIn(email: string, ...organisations: string[]): Promise<string> {
	const { id } = await accounts.createUser(email);
	for (const slug of organisations) await accounts.addMember(id, slug);
	return id;
}

async function update(userId: string, change: Record<string, unknown>) {
	await (await accounts.auth.$context).internalAdapter.updateUser(userId, change);
}

async function namesOf(ids: string[], cookie?: string) {
	return await answerUserNames(
		accounts.auth,
		database(),
		new Request(`https://accounts.keepr.digital${userNamesAddress(ids)}`, {
			headers: { cookie: cookie ?? (await accounts.signIn(ASKER)) },
		}),
	);
}

describe('a User is named to a Session', () => {
	it.each<[string, () => Promise<string>]>([
		['who shares the Organisation it works in', async () => await userIn('ada@x.test', 'keepr')],
		[
			'who shares an Organisation its User belongs to and is not working in',
			async () => {
				await accounts.addMember(asker, 'club');
				return await userIn('ada@x.test', 'club');
			},
		],
		[
			'who has since been disabled, and is still a member',
			async () => {
				const id = await userIn('ada@x.test', 'keepr');
				await update(id, { banned: true });
				return id;
			},
		],
	])('%s', async (_case, someone) => {
		const id = await someone();

		expect(await namesOf([id])).toEqual({ names: { [id]: 'ada' } });
	});

	it('by their name alone, among everyone asked about', async () => {
		const ada = await userIn('ada@x.test', 'keepr');
		const bo = await userIn('bo@x.test', 'keepr');
		const outsider = await userIn('cy@x.test', 'elsewhere');

		expect(await namesOf([ada, 'no-such-user', outsider, bo, ada])).toEqual({
			names: { [ada]: 'ada', [bo]: 'bo' },
		});
	});
});

describe('nobody is named, and the answer does not say why', () => {
	it.each<[string, () => Promise<string>]>([
		['for an id no User has', async () => 'no-such-user'],
		[
			'in an Organisation the asker does not belong to',
			async () => await userIn('ada@x.test', 'elsewhere'),
		],
		['in no Organisation', async () => await userIn('ada@x.test')],
		[
			// No path saves a blank name any more (`userName`): this is a row from
			// before that rule, written as the database held it.
			'whose name is blank, from before a name was required',
			async () => {
				const id = await userIn('ada@x.test', 'keepr');
				await database().update(schema.user).set({ name: '  ' }).where(eq(schema.user.id, id));
				return id;
			},
		],
		[
			'outside their Organisations, to a Keepr Administrator',
			async () => {
				await update(asker, { role: 'admin' });
				return await userIn('ada@x.test', 'elsewhere');
			},
		],
	])('%s', async (_case, someone) => {
		expect(await namesOf([await someone()])).toEqual({ names: {} });
	});
});

describe('the question is refused', () => {
	it.each<[string, (cookie: string) => Promise<string>]>([
		['with no cookie, as an App asking for itself would send', async () => ''],
		[
			'for an ended Session',
			async (cookie) => {
				await accounts.send('/sign-out', { body: {}, headers: { cookie } });
				return cookie;
			},
		],
		[
			'for a disabled User whose Session was left open',
			async (cookie) => {
				await update(asker, { banned: true });
				return cookie;
			},
		],
	])('%s', async (_case, cookieFor) => {
		const ada = await userIn('ada@x.test', 'keepr');
		const cookie = await cookieFor(await accounts.signIn(ASKER));

		await expect(namesOf([ada], cookie)).rejects.toMatchObject({
			statusCode: 401,
			code: 'SIGNED_OUT',
		});
	});

	it('about more Users than one question holds, and answered about exactly that many', async () => {
		const ada = await userIn('ada@x.test', 'keepr');
		const ids = (count: number) => [
			...Array.from({ length: count - 1 }, (_, index) => `nobody-${index}`),
			ada,
		];

		await expect(namesOf(ids(USER_NAMES_MAX_IDS + 1))).rejects.toMatchObject({
			statusCode: 400,
			code: 'TOO_MANY_USER_IDS',
		});
		expect(await namesOf(ids(USER_NAMES_MAX_IDS))).toEqual({ names: { [ada]: 'ada' } });
	});
});

it('renews no Session: the answer carries no cookie back to the browser', async () => {
	const cookie = await accounts.signIn(ASKER);
	// Five days left of seven: any other read of this Session would renew it.
	const dueForRenewal = new Date(Date.now() + 5 * DAY_MS);
	await database()
		.update(schema.session)
		.set({ expiresAt: dueForRenewal })
		.where(eq(schema.session.userId, asker));

	await namesOf([asker], cookie);

	const [session] = await database()
		.select({ expiresAt: schema.session.expiresAt })
		.from(schema.session)
		.where(eq(schema.session.userId, asker));
	expect(session?.expiresAt).toEqual(dueForRenewal);
});

// Wiring for the layer's `createUserNameReader`: it asks in questions Keepr
// Accounts accepts, and reads what Keepr Accounts answers.
it('answers the shared layer, however many Users an App asks about', async () => {
	const ada = await userIn('ada@x.test', 'keepr');
	const connection: AccountsConnection = {
		async fetch(input, init) {
			try {
				return Response.json(
					await answerUserNames(accounts.auth, database(), new Request(input, init)),
				);
			} catch (refusal) {
				if (!(refusal instanceof KeeprRefusal)) throw refusal;
				return Response.json({ code: refusal.code }, { status: refusal.statusCode });
			}
		},
	};

	const names = await createUserNameReader()({
		cookie: await accounts.signIn(ASKER),
		accounts: connection,
		// First, so a question one id too long would be the one that asks about them.
		ids: [ada, ...Array.from({ length: USER_NAMES_MAX_IDS + 5 }, (_, index) => `nobody-${index}`)],
	});

	expect(names).toEqual({ [ada]: 'ada' });
});
