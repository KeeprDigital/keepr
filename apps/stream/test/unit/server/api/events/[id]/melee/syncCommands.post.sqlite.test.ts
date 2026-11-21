import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { mapMeleePlayersToDb } from '~~/server/mappers/melee';
import { meleeCompetitor, meleeMatch, meleePlayer } from '~~/test/helpers/meleeFixtures';
import { createSqliteD1Harness } from '@keepr/nuxt-layer/test/helpers/sqlite-d1';

// Each POST /api/events/:id/melee/* route, one wiring pass apiece over real SQL:
// it reads the Event and its body, runs its command, and the command's writes land.
// What each command does is meleeSync.sqlite's and meleeSyncWorkflows.sqlite's.

interface StubEvent {
	params: Record<string, string>;
	body?: unknown;
	headers: Record<string, string>;
}
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal(
	'getValidatedRouterParams',
	async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.params),
);
vi.stubGlobal('readValidatedBody', async (event: StubEvent, parse: (value: unknown) => unknown) =>
	parse(event.body),
);
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input),
);

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

const players = [1, 2, 3, 4].map((teamId) =>
	meleePlayer(
		teamId,
		teamId === 1
			? {
					Decklists: [
						{
							Guid: 'deck-burn',
							FormatId: 'modern',
							DecklistName: 'Burn',
							Records: [],
							Attributes: [],
						},
					],
				}
			: {},
	),
);
const melee = {
	fetchEvent: async () => ({
		ID: 1,
		Name: 'Melee Championship',
		Game: 'Magic: The Gathering',
		Phases: [
			{
				ID: 10,
				Name: 'Swiss',
				FormatId: 'modern',
				SortOrder: 0,
				Rounds: [{ ID: 101, Name: 'Round 1', SortOrder: 0 }],
			},
		],
	}),
	fetchPlayers: async () => players,
	fetchCurrentStandings: async () => [],
	fetchMergedPlayers: async () => mapMeleePlayersToDb(players, []),
	fetchMatchesByRound: async () =>
		[[1, 2] as const, [3, 4] as const].map(([first, second]) =>
			meleeMatch(`101-${first}`, {
				TableNumber: first,
				HasResult: false,
				Competitors: [
					meleeCompetitor(first, { SortOrder: 0 }),
					meleeCompetitor(second, { SortOrder: 1 }),
				],
			}),
		),
	fetchStandingsByRound: async () => [],
};

vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/services/meleeIntegration', () => ({ requireMeleeService: () => melee }));
vi.doMock('~~/server/services/importedMtgCardResolver', () => ({
	importedMtgCardResolverService: () => ({
		resolveBatch: async () => ({ resolutions: new Map() }),
	}),
}));
vi.doMock('~~/server/utils/realtimePublish', () => ({
	getOriginConnectionId: () => 'origin-1',
	publishMessage: vi.fn(),
	publishMessageStrict: vi.fn(),
	publishScreenCommand: vi.fn(),
}));
vi.doMock('~~/server/modules/broadcast-graphics-live-session', async (importOriginal) => ({
	...(await importOriginal<object>()),
	refreshBroadcastGraphicsBindings: async () => {},
}));

type Handler = (event: StubEvent) => Promise<unknown>;
const routes: Record<string, Handler> = {
	'initial-setup': (await import('~~/server/api/events/[id]/melee/initial-setup.post')).default,
	'sync-event': (await import('~~/server/api/events/[id]/melee/sync-event.post')).default,
	'sync-players': (await import('~~/server/api/events/[id]/melee/sync-players.post')).default,
	'sync-decklists': (await import('~~/server/api/events/[id]/melee/sync-decklists.post')).default,
	'sync-round': (await import('~~/server/api/events/[id]/melee/sync-round.post')).default,
	update: (await import('~~/server/api/events/[id]/melee/update.post')).default,
} as never;
const route = async (path: string) => routes[path]!;

afterAll(async () => await harness.close());

let eventId: number;
beforeEach(async () => {
	const [event] = await db
		.insert(schema.events)
		.values({
			name: 'Melee Championship',
			game: 'mtg',
			featureMatchOrientation: 'horizontal',
			meleeEnabled: true,
			meleeEventId: 'melee-1',
		})
		.returning({ id: schema.events.id });
	eventId = event!.id;
});

async function stored() {
	const [event] = await db.select().from(schema.events).where(eq(schema.events.id, eventId));
	const count = async (
		table:
			| typeof schema.players
			| typeof schema.rounds
			| typeof schema.matches
			| typeof schema.playerDecks,
	) => (await db.select().from(table).where(eq(table.eventId, eventId))).length;
	return {
		setUp: event!.initialSetupCompletedAt !== null,
		structureSynced: event!.lastEventSyncedAt !== null,
		playersSynced: event!.lastPlayersSyncedAt !== null,
		deckListsSynced: event!.lastDecklistsSyncedAt !== null,
		rounds: await count(schema.rounds),
		players: await count(schema.players),
		matches: await count(schema.matches),
		deckLists: await count(schema.playerDecks),
	};
}

/** Event structure, as the Event structure route stores it, for the routes that need a Round. */
async function roundOne() {
	await (
		await route('sync-event')
	)({ params: { id: String(eventId) }, headers: {} });
	const [round] = await db.select().from(schema.rounds).where(eq(schema.rounds.eventId, eventId));
	return round!.id;
}

describe('the Melee Sync routes', () => {
	it.each([
		{
			path: 'initial-setup',
			body: async () => undefined,
			outcome: { setUp: true, rounds: 1, players: 4, deckLists: 1, matches: 0 },
		},
		{
			path: 'sync-event',
			body: async () => undefined,
			outcome: { structureSynced: true, rounds: 1, players: 0 },
		},
		{
			path: 'sync-players',
			body: async () => undefined,
			outcome: { playersSynced: true, players: 4, deckLists: 0 },
		},
		{
			path: 'sync-decklists',
			body: async () => undefined,
			outcome: { deckListsSynced: true, deckLists: 1 },
		},
		{
			path: 'sync-round',
			body: async () => ({ roundId: String(await roundOne()) }),
			outcome: { playersSynced: true, matches: 2 },
		},
		{
			path: 'update',
			body: async () => ({ includeDeckLists: false, advanceRound: true }),
			outcome: { structureSynced: true, playersSynced: true, matches: 2 },
		},
	])('POST melee/$path runs its command for the Event', async ({ path, body, outcome }) => {
		const handler = await route(path);

		await handler({ params: { id: String(eventId) }, body: await body(), headers: {} });

		expect(await stored()).toMatchObject(outcome);
	});
});
