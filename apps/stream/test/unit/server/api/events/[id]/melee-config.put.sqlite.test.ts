import type { H3Event } from 'h3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { encryptMeleeCredential } from '~~/server/utils/meleeCredentialCrypto';
import { eventRealtimeChannel } from '~~/shared/utils/realtimeChannels';
import { installRealtimeObjectFake } from '~~/test/helpers/realtimeObjectFake';
import { stubH3Event } from '@keepr/nuxt-layer/test/helpers/h3Event';
import { refusalFrom } from '~~/test/helpers/publicServerFailure';
import { createSqliteD1Harness } from '@keepr/nuxt-layer/test/helpers/sqlite-d1';

// PUT /api/events/:id/melee-config over real SQL and the real credential keyring:
// what it stores, resets and announces, and what it refuses before writing. Only
// Melee.gg's HTTP, the realtime object and the deployment's keyring settings are faked.

interface StubRequest {
	params: Record<string, string>;
	body: unknown;
	headers: Record<string, string>;
}
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal(
	'getValidatedRouterParams',
	async (event: StubRequest, parse: (value: unknown) => unknown) => parse(event.params),
);
vi.stubGlobal('readValidatedBody', async (event: StubRequest, parse: (value: unknown) => unknown) =>
	parse(event.body),
);
vi.stubGlobal('getHeader', (event: StubRequest, name: string) => event.headers[name]);
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string; data?: unknown }) =>
	Object.assign(new Error(input.message ?? 'error'), input),
);
/** Each response header the route set, as `[name, value]`. */
const headersSet: [string, unknown][] = [];
vi.stubGlobal('setResponseHeader', (_event: unknown, name: string, value: unknown) => {
	headersSet.push([name, value]);
});

function base64Key(fill: number): string {
	return btoa(String.fromCharCode(...new Uint8Array(32).fill(fill)));
}
const keyring = {
	meleeCredentialEncryptionKey: base64Key(2),
	meleeCredentialKeyVersion: 'v2',
	meleeCredentialEncryptionPreviousKeys: {
		v1: base64Key(1),
	},
};
/** The deployment's keyring settings; a test may take a key away. */
let runtimeKeyring = keyring;
vi.stubGlobal('useRuntimeConfig', () => runtimeKeyring);

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

const realtime = await installRealtimeObjectFake();

/** The tournament Melee.gg answers with, each request it was sent, and a failure it answers instead. */
const melee = {
	tournament: { ID: 123, Game: 'Magic: The Gathering' },
	requests: [] as { url: string; authorization: string }[],
	failure: null as null | (() => Response),
};
vi.stubGlobal('fetch', async (url: string, init: { headers: Record<string, string> }) => {
	melee.requests.push({ url, authorization: init.headers.Authorization! });
	if (melee.failure) return melee.failure();
	return Response.json({ Name: 'Tournament', Phases: [], ...melee.tournament });
});

type Handler = (event: H3Event) => Promise<Record<string, unknown>>;
const putMeleeConfig = (await import('~~/server/api/events/[id]/melee-config.put'))
	.default as unknown as Handler;
const { revealMeleeClientSecret } = await import('~~/server/services/meleeCredentials');

/** `client-secret` as a deployment stored it before its key was rotated. */
const secretUnderRetiredKey = await encryptMeleeCredential('client-secret', {
	activeKeyVersion: 'v1',
	keys: new Map([['v1', base64Key(1)]]),
});
const switchedOff = { meleeEnabled: false, meleeEventId: null, meleeClientId: null };

/** An MTG Event configured for Melee tournament 123. */
async function stageEvent(values: Partial<typeof schema.events.$inferInsert> = {}) {
	const [event] = await db
		.insert(schema.events)
		.values({
			name: 'Melee Event',
			game: 'mtg',
			featureMatchOrientation: 'horizontal',
			meleeEnabled: true,
			meleeEventId: '123',
			meleeClientId: 'client-id',
			meleeClientSecret: secretUnderRetiredKey,
			...values,
		})
		.returning({ id: schema.events.id });
	return event!.id;
}

async function stageImportedPlayer(eventId: number) {
	const [player] = await db
		.insert(schema.players)
		.values({
			eventId,
			name: 'Imported',
			externalId: 'p-1',
			externalSource: 'melee',
		})
		.returning({ id: schema.players.id });
	return player!.id;
}

async function stored(eventId: number) {
	return (await db.query.events.findFirst({
		where: eq(schema.events.id, eventId),
	}))!;
}

function put(eventId: number, body: unknown) {
	return putMeleeConfig(
		stubH3Event({
			params: {
				id: String(eventId),
			},
			body,
			headers: { 'x-realtime-connection-id': 'origin-1' },
		}),
	);
}

/** What the Event's channel was sent, as `[type, payload]`. */
function announced(eventId: number) {
	return realtime
		.on(eventRealtimeChannel(eventId))
		.map(({ type, payload }) => [type, payload] as const);
}

beforeEach(() => {
	realtime.reset();
	melee.tournament = { ID: 123, Game: 'Magic: The Gathering' };
	melee.requests.length = 0;
	melee.failure = null;
	headersSet.length = 0;
	runtimeKeyring = keyring;
});
afterAll(async () => await harness.close());

describe('a configuration that keeps the Melee tournament', () => {
	it('asks Melee.gg with the stored secret when none is sent, and stores it again under the active key', async () => {
		const eventId = await stageEvent();

		const answer = await put(eventId, {
			meleeEnabled: true,
			meleeEventId: ' 123 ',
			meleeClientId: ' client-id ',
		});

		expect(answer).toMatchObject({ id: eventId, meleeConfigured: true });
		expect(melee.requests).toEqual([
			{
				url: 'https://www.melee.gg/api/tournament/123',
				authorization: `Basic ${btoa('client-id:client-secret')}`,
			},
		]);
		const event = await stored(eventId);
		expect(event).toMatchObject({
			meleeEventId: '123',
			meleeClientId: 'client-id',
			meleeSyncLeaseToken: null,
		});
		await expect(revealMeleeClientSecret(event.meleeClientSecret!)).resolves.toMatchObject({
			plaintext: 'client-secret',
			keyVersion: 'v2',
			needsReEncryption: false,
		});
		// The boundary did not move, so nothing was reset.
		expect(announced(eventId).map(([type]) => type)).toEqual(['event:updated']);
	});
});

describe('a configuration that moves the Melee boundary', () => {
	it.each([
		{
			change: 'naming another Melee tournament',
			input: { meleeEnabled: true, meleeEventId: '456', meleeClientId: 'client-id' },
			asked: ['https://www.melee.gg/api/tournament/456'],
			reason: 'event-changed',
			configured: { meleeEnabled: true, meleeEventId: '456' },
		},
		{
			change: 'switching the integration off',
			input: switchedOff,
			asked: [],
			reason: 'disabled',
			configured: { meleeEnabled: false, meleeEventId: null },
		},
	])(
		"$change resets the imported data and announces the reset after the Event, under the writer's origin",
		async ({ input, asked, reason, configured }) => {
			const eventId = await stageEvent();
			await stageImportedPlayer(eventId);
			melee.tournament = { ID: 456, Game: 'Magic: The Gathering' };

			const answer = await put(eventId, input);

			expect(answer).toMatchObject({ id: eventId, ...configured });
			expect(melee.requests.map((request) => request.url)).toEqual(asked);
			expect(await stored(eventId)).toMatchObject(configured);
			expect(
				await db.select().from(schema.players).where(eq(schema.players.eventId, eventId)),
			).toEqual([]);
			expect(announced(eventId)).toEqual([
				['event:updated', expect.objectContaining({ originConnectionId: 'origin-1' })],
				['melee:dataReset', { reason, originConnectionId: 'origin-1' }],
			]);
		},
	);

	// A Deck List Screen that re-read on the reset first would ask for the deleted
	// Player. No origin: the configuring client holds the Screen at its old version too.
	it('announces each Screen whose Deck Source the reset cleared, with no origin, before the reset itself', async () => {
		const eventId = await stageEvent();
		const playerId = await stageImportedPlayer(eventId);
		const [screen] = await db
			.insert(schema.screens)
			.values({
				eventId,
				name: 'Deck',
				slug: `deck-${eventId}`,
				currentMode: 'deck',
				modeConfigs: {
					deck: {
						deckSource: { type: 'player', playerId },
					},
				} as never,
				assetCapabilitySeed: `seed-${eventId}`,
				assetCapabilityDigest: `digest-${eventId}`,
			})
			.returning({ id: schema.screens.id });

		await put(eventId, switchedOff);

		expect(
			(
				await db.query.screens.findFirst({
					where: eq(schema.screens.id, screen!.id),
				})
			)?.modeConfigs,
		).toEqual({
			deck: {
				deckSource: { type: 'player', playerId: null },
			},
		});
		expect(announced(eventId).slice(1)).toEqual([
			['screen:updated', { screenId: screen!.id }],
			['melee:dataReset', { reason: 'disabled', originConnectionId: 'origin-1' }],
		]);
	});

	// The reset keeps imported structure still holding manual Rounds or Matches (ADR-0040).
	it('names each imported Phase and Round the reset kept because it holds manual structure', async () => {
		const eventId = await stageEvent();
		const [phase] = await db
			.insert(schema.phases)
			.values({
				eventId,
				name: 'Swiss',
				externalId: '500',
				externalSource: 'melee',
			})
			.returning({ id: schema.phases.id });
		const [round] = await db
			.insert(schema.rounds)
			.values({
				eventId,
				phaseId: phase!.id,
				name: 'Round 1',
				roundNumber: 1,
				externalId: '5001',
				externalSource: 'melee',
			})
			.returning({ id: schema.rounds.id });
		await db
			.insert(schema.matches)
			.values({ eventId, roundId: round!.id, externalSource: 'manual' });

		const answer = await put(eventId, switchedOff);

		expect(answer.warnings).toEqual([
			'Phase "Swiss" was imported from Melee.gg and holds manual Rounds or Matches, so it was kept as a manual Phase',
			'Round "Round 1" in "Swiss" was imported from Melee.gg and holds manual Matches, so it was kept as a manual Round',
		]);
	});
});

describe('a configuration refused before it is stored', () => {
	it('refuses a tournament of another game, storing and announcing nothing and giving its lease back', async () => {
		const eventId = await stageEvent();
		melee.tournament = { ID: 123, Game: 'One Piece Card Game' };

		await expect(
			put(eventId, { meleeEnabled: true, meleeEventId: '123', meleeClientId: 'client-id' }),
		).rejects.toMatchObject({
			statusCode: 422,
			message: 'The selected Melee.gg tournament uses a different game than this Event',
			data: { code: 'MELEE_GAME_MISMATCH' },
		});

		expect(await stored(eventId)).toMatchObject({
			meleeEventId: '123',
			meleeClientSecret: secretUnderRetiredKey,
			meleeSyncLeaseToken: null,
		});
		expect(realtime.published).toEqual([]);
	});

	// A sync command still running could repopulate what this change resets.
	it('refuses while a sync command holds the Event, without asking Melee.gg or taking its lease', async () => {
		const eventId = await stageEvent({
			meleeSyncLeaseToken: 'holder-token',
			meleeSyncLeaseCommand: 'players',
			meleeSyncLeaseExpiresAt: new Date('2999-01-01T00:00:00.000Z'),
		});
		const before = await stored(eventId);

		await expect(put(eventId, switchedOff)).rejects.toMatchObject({
			statusCode: 409,
			data: { code: 'MELEE_SYNC_IN_PROGRESS', command: 'players' },
		});

		expect(await stored(eventId)).toEqual(before);
		expect(melee.requests).toEqual([]);
		expect(realtime.published).toEqual([]);
	});
});

// What each failure answers, after the error plugin's sanitizer, and that none stores anything.
describe('a configuration Melee.gg or the keyring fails', () => {
	/** What a configuration stores, and the lease it holds while it runs. */
	const configurationOf = async (eventId: number) => {
		const { meleeEnabled, meleeEventId, meleeClientId, meleeClientSecret, meleeSyncLeaseToken } =
			await stored(eventId);
		return { meleeEnabled, meleeEventId, meleeClientId, meleeClientSecret, meleeSyncLeaseToken };
	};
	const sameTournament = { meleeEnabled: true, meleeEventId: '123', meleeClientId: 'client-id' };
	const unavailable = 'Melee.gg is temporarily unavailable. Try again later.';
	const invalid =
		'Could not validate Melee.gg credentials. Check the event ID, client ID, and client secret.';

	it.each([
		{
			case: 'an outage',
			failure: () => new Response('down', { status: 503 }),
			answer: { statusCode: 502, statusMessage: 'Bad Gateway', message: unavailable },
			retryAfter: [['retry-after', 5]],
		},
		{
			case: 'a timeout',
			failure: () => {
				throw new DOMException('timed out', 'TimeoutError');
			},
			answer: { statusCode: 504, message: unavailable },
			retryAfter: [['retry-after', 5]],
		},
		{
			case: 'refused credentials',
			failure: () => new Response('no', { status: 401 }),
			answer: { statusCode: 400, message: invalid },
			retryAfter: [],
		},
		{
			case: 'another tournament than the one named',
			failure: () =>
				Response.json({ ID: 999, Name: 'Other', Game: 'Magic: The Gathering', Phases: [] }),
			answer: { statusCode: 400, message: invalid },
			retryAfter: [],
		},
	])('answers $case as such, storing nothing', async ({ failure, answer, retryAfter }) => {
		const eventId = await stageEvent();
		const before = await configurationOf(eventId);
		melee.failure = failure;
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});

		const refusal = await refusalFrom(put(eventId, sameTournament));

		vi.restoreAllMocks();
		expect(refusal).toMatchObject(answer);
		expect(headersSet).toEqual(retryAfter);
		expect(await configurationOf(eventId)).toEqual(before);
		expect(realtime.published).toEqual([]);
	});

	// A keyring fault names the setting to fix and survives the sanitizer; a
	// corrupt stored secret stays a sanitized 500. Neither puts a crypto code in the body.
	const missingKey =
		'NUXT_MELEE_CREDENTIAL_ENCRYPTION_KEY or NUXT_MELEE_CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS is missing a key version that stored Melee credentials need';
	it.each([
		{
			case: 'a stored secret under a key version the deployment lacks',
			stage: async () =>
				await stageEvent({
					meleeClientSecret: await encryptMeleeCredential('client-secret', {
						activeKeyVersion: 'v9',
						keys: new Map([['v9', base64Key(9)]]),
					}),
				}),
			input: {},
			answer: { statusCode: 503, statusMessage: 'Service Unavailable', message: missingKey },
		},
		{
			case: 'an active key version the deployment lacks, when storing',
			stage: async () => {
				runtimeKeyring = { ...keyring, meleeCredentialEncryptionKey: '' };
				return await stageEvent();
			},
			input: { meleeClientSecret: 'new-secret' },
			answer: { statusCode: 503, message: missingKey },
		},
		{
			case: 'a stored secret that does not decrypt',
			// Sealed under key version v1, but not by the deployment's v1 key.
			stage: async () =>
				await stageEvent({
					meleeClientSecret: await encryptMeleeCredential('client-secret', {
						activeKeyVersion: 'v1',
						keys: new Map([['v1', base64Key(7)]]),
					}),
				}),
			input: {},
			answer: { statusCode: 500, message: 'Internal Server Error' },
		},
	])(
		'answers $case, storing nothing and giving the lease back',
		async ({ stage, input, answer }) => {
			const eventId = await stage();
			const before = await configurationOf(eventId);
			vi.spyOn(console, 'error').mockImplementation(() => {});

			const refusal = await refusalFrom(put(eventId, { ...sameTournament, ...input }));

			vi.restoreAllMocks();
			expect(refusal).toMatchObject(answer);
			expect((refusal as { data?: unknown }).data).toBeUndefined();
			expect(refusal.message).not.toContain('v9');
			expect(await configurationOf(eventId)).toEqual(before);
		},
	);

	it('answers an Event with no stored secret and none sent as unconfigured', async () => {
		const eventId = await stageEvent({ meleeClientSecret: null });

		await expect(put(eventId, sameTournament)).rejects.toMatchObject({ statusCode: 400 });

		expect(melee.requests).toEqual([]);
		expect(await stored(eventId)).toMatchObject({
			meleeClientSecret: null,
			meleeSyncLeaseToken: null,
		});
	});

	// Cleanup is subordinate: the configuration has committed by then, and the lease expires.
	it('keeps a committed configuration when giving the lease back fails', async () => {
		const eventId = await stageEvent();
		const execute = harness.client.execute.bind(harness.client);
		vi.spyOn(harness.client, 'execute').mockImplementation((async (statement: unknown) => {
			const sql = typeof statement === 'string' ? statement : (statement as { sql: string }).sql;
			if (/"melee_sync_lease_token" = null/i.test(sql)) throw new Error('D1 unavailable');
			return await execute(statement as never);
		}) as never);
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		const answer = put(eventId, { ...sameTournament, meleeClientId: 'new-client' });

		await expect(answer).resolves.toMatchObject({ id: eventId, meleeConfigured: true });
		vi.restoreAllMocks();
		expect(await stored(eventId)).toMatchObject({ meleeClientId: 'new-client' });
	});
});
