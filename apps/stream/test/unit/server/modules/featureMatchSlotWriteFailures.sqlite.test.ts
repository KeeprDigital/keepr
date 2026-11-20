import type { ManualPlayerSlotData } from '~~/shared/api';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { mapFeatureMatchToResponse } from '~~/server/mappers/featureMatch';
import { SEAT_VALUES } from '~~/shared/types/enums';
import { ATRAXA, KRAUM, typedSeat as seat, TYMNA } from '~~/test/helpers/commanders';
import { MOXFIELD_CARDS, MOXFIELD_COPY } from '~~/test/helpers/magicDeckText';
import { fakeOpCardBulkLookup, knownOpCard } from '~~/test/helpers/opCards';
import { createScryfallFake } from '~~/test/helpers/scryfallFake';
import { createSqliteD1Harness } from '@keepr/nuxt-layer/test/helpers/sqlite-d1';

/**
 * What a Slot write leaves when it, or what follows it, fails: Slot and Session
 * never crossed, a stale save refused before it writes anything, and no Deck
 * List deleted that the Slot still names. The database and the realtime
 * publish are the boundaries made to fail.
 */

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input),
);
const runtimeConfig = { bandaiKeeprApiKey: 'test-key', bandaiKeeprApiUrl: 'https://op-api.test' };
vi.stubGlobal('useRuntimeConfig', () => runtimeConfig);

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

/** Armed, the next database batch fails before it writes anything. */
let failNextBatch = false;
/** Armed, the next write to a Slot row fails before it is made. */
let failNextSlotUpdate = false;
const failingDb = new Proxy(db, {
	get(target, property, receiver) {
		if (property === 'update') {
			return (table: Parameters<typeof db.update>[0]) => {
				if (failNextSlotUpdate && table === schema.featureMatches) {
					failNextSlotUpdate = false;
					throw new Error('D1 unavailable');
				}
				return target.update(table);
			};
		}
		if (property === 'batch') {
			return async (queries: Parameters<typeof db.batch>[0]) => {
				if (failNextBatch) {
					failNextBatch = false;
					throw new Error('D1 unavailable');
				}
				return await target.batch(queries);
			};
		}
		const value = Reflect.get(target, property, receiver);
		return typeof value === 'function' ? value.bind(target) : value;
	},
});

/** Armed, the next realtime publish fails, after the write it announces committed. */
let failNextPublish = false;
const publish = async () => {
	if (failNextPublish) {
		failNextPublish = false;
		throw new Error('realtime unavailable');
	}
};

const ZORO = knownOpCard({
	number: 'OP01-001',
	name: 'Roronoa Zoro',
	category: 'leader',
	colors: ['Red'],
});
const RED = knownOpCard({
	number: 'OP01-025',
	name: 'Roronoa Zoro',
	category: 'character',
	colors: ['Red'],
	cost: 3,
	power: 5000,
	counter: 1000,
});

vi.doMock('~~/server/db', () => ({ db: failingDb }));
vi.doMock('~~/server/utils/realtimePublish', () => ({
	publishMessage: publish,
	publishMessageStrict: publish,
	publishScreenCommand: async () => {},
	getOriginConnectionId: () => undefined,
}));
vi.doMock('~~/server/modules/broadcast-graphics-live-session', async (importOriginal) => ({
	...(await importOriginal<object>()),
	refreshBroadcastGraphicsBindings: async () => {},
}));
vi.doMock('~~/server/utils/bandaiKeepr', async (importOriginal) => ({
	...(await importOriginal<object>()),
	lookUpOpCards: (...args: Parameters<ReturnType<typeof fakeOpCardBulkLookup>['lookUpOpCards']>) =>
		fakeOpCardBulkLookup([ZORO, RED]).lookUpOpCards(...args),
}));

const { featureMatchSlotWriteModule } = await import('~~/server/modules/feature-match-slot-write');
const { featureMatchSessionModule } = await import('~~/server/modules/feature-match-session');
const { commanderDeckListModule } = await import('~~/server/modules/feature-match-deck-list');
const { opDeckListWriteModule } = await import('~~/server/modules/op-deck-list-write');
const { featureMatchService } = await import('~~/server/services/featureMatch');
const { featureMatchStateService } = await import('~~/server/services/featureMatchState');

beforeEach(async () => {
	failNextBatch = false;
	failNextSlotUpdate = false;
	failNextPublish = false;
	vi.stubGlobal('fetch', createScryfallFake(Object.values(MOXFIELD_CARDS)).fetch);
	await db.delete(schema.cards);
});

afterAll(async () => {
	await harness.close();
});

async function stageEvent(values: Partial<typeof schema.events.$inferInsert>) {
	const [created] = await db
		.insert(schema.events)
		.values({ name: 'Event', game: 'mtg', featureMatchOrientation: 'horizontal', ...values })
		.returning({ id: schema.events.id });
	return created!.id;
}

/** Ana, Ben and Cyd in Seats 1 to 3 of a Commander Slot. */
async function commanderSlot() {
	const eventId = await stageEvent({ variant: 'commander' });
	const slot = await featureMatchService().create(eventId, {});
	await featureMatchSlotWriteModule().updateSetup({
		eventId,
		slotId: slot.id,
		input: {
			player1Data: seat('Ana', [ATRAXA]),
			player2Data: seat('Ben', [TYMNA]),
			player3Data: seat('Cyd', [TYMNA, KRAUM]),
		},
	});
	return { eventId, slotId: slot.id };
}

async function reloaded(eventId: number, slotId: number) {
	return mapFeatureMatchToResponse((await featureMatchService().findById(slotId, eventId))!);
}

async function deckListIds(slotId: number) {
	const rows = await db
		.select({ id: schema.featureMatchDeckLists.id })
		.from(schema.featureMatchDeckLists)
		.where(eq(schema.featureMatchDeckLists.slotId, slotId));
	return rows.map((row) => row.id);
}

describe('swap Seats that fails', () => {
	it('leaves Slot and Session agreeing once retried: each player beside their own life', async () => {
		const { eventId, slotId } = await commanderSlot();
		const opened = (await reloaded(eventId, slotId)).activeSession!;
		await featureMatchSessionModule().applyCommand(opened.id, eventId, {
			commandId: 'ana-hit',
			type: 'AdjustLife',
			payload: { player: 'player1', delta: -9 },
		});

		failNextBatch = true;
		await expect(
			featureMatchSlotWriteModule().swapSeats({ eventId, slotId, seats: ['player1', 'player3'] }),
		).rejects.toThrow();
		await featureMatchSlotWriteModule().swapSeats({
			eventId,
			slotId,
			seats: ['player1', 'player3'],
		});

		const slot = await reloaded(eventId, slotId);
		const session = slot.activeSession!;
		const seated = (key: 'player1Data' | 'player3Data') => slot[key]?.name;
		expect([seated('player1Data'), seated('player3Data')]).toEqual(['Cyd', 'Ana']);
		expect(SEAT_VALUES.map((key) => session.sourceSnapshot[key]?.data?.name ?? null)).toEqual([
			'Cyd',
			'Ben',
			'Ana',
			null,
		]);
		// Ana took 9 from the Event's starting 20, and takes it to Seat 3.
		expect(SEAT_VALUES.map((key) => session.currentState[key]?.lifeTotal)).toEqual([
			20, 20, 11, 20,
		]);
	});
});

describe('a setup save from a form the Slot has moved past', () => {
	it('is refused to the second of two Operators saving one Commander Seat', async () => {
		const { eventId, slotId } = await commanderSlot();
		const { version } = await reloaded(eventId, slotId);

		await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId,
			input: { version, player2Data: seat('Bea', [TYMNA]) },
		});
		await expect(
			featureMatchSlotWriteModule().updateSetup({
				eventId,
				slotId,
				input: { version, player2Data: seat('Bo', [TYMNA]) },
			}),
		).rejects.toMatchObject({ statusCode: 409 });

		const slot = await reloaded(eventId, slotId);
		expect([slot.player2Data?.name, slot.activeSession?.sourceSnapshot.player2.data?.name]).toEqual(
			['Bea', 'Bea'],
		);
	});

	it("writes no Player rename it carried: the Player is written only once the Slot's write commits", async () => {
		const eventId = await stageEvent({ variant: 'two-player' });
		const [mia] = await db
			.insert(schema.players)
			.values({ eventId, name: 'Mia' })
			.returning({ id: schema.players.id });
		const slot = await featureMatchService().create(eventId, { player1Id: mia!.id });
		const { version } = await reloaded(eventId, slot.id);
		await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId: slot.id,
			input: { version, tableNumber: 4 },
		});

		await expect(
			featureMatchSlotWriteModule().updateSetup({
				eventId,
				slotId: slot.id,
				input: { version, player1Data: { name: 'Mia K.' } },
			}),
		).rejects.toMatchObject({ statusCode: 409 });

		const player = await db.query.players.findFirst({ where: eq(schema.players.id, mia!.id) });
		expect(player?.name).toBe('Mia');
	});
});

describe('a pasted Deck List whose save fails after the Slot took it', () => {
	it('is kept on a Commander Seat, which names it', async () => {
		const { eventId, slotId } = await commanderSlot();

		failNextPublish = true;
		await expect(
			commanderDeckListModule().save({
				eventId,
				slotId,
				seat: 'player2',
				text: MOXFIELD_COPY,
				commanders: [MOXFIELD_CARDS.ashling.id],
			}),
		).rejects.toThrow('realtime unavailable');

		const named = (await reloaded(eventId, slotId)).player2Data?.gameData;
		const id = named?.type === 'mtg' ? named.featureMatchDeckList?.id : undefined;
		expect(id).toBeDefined();
		expect(await deckListIds(slotId)).toEqual([id]);
	});

	it('is kept on a One Piece Card Game side, which names it', async () => {
		const eventId = await stageEvent({ game: 'op' });
		const [slot] = await db
			.insert(schema.featureMatches)
			.values({ eventId, player1Data: { name: 'Ana' } satisfies ManualPlayerSlotData })
			.returning();
		await featureMatchStateService().createSessionForSlot(slot!.id, eventId);

		failNextPublish = true;
		await expect(
			opDeckListWriteModule().write({
				eventId,
				owner: { kind: 'slotSide', slotId: slot!.id, side: 'player1' },
				input: { text: '1x OP01-001\n4x OP01-025' },
				source: 'hand',
			}),
		).rejects.toThrow('realtime unavailable');

		const named = (await reloaded(eventId, slot!.id)).player1Data?.gameData;
		const id = named?.type === 'op' ? named.featureMatchDeckList?.id : undefined;
		expect(id).toBeDefined();
		expect(await deckListIds(slot!.id)).toEqual([id]);
	});

	it('is deleted when the Slot never took it', async () => {
		const { eventId, slotId } = await commanderSlot();

		failNextSlotUpdate = true;
		await expect(
			commanderDeckListModule().save({
				eventId,
				slotId,
				seat: 'player2',
				text: MOXFIELD_COPY,
				commanders: [MOXFIELD_CARDS.ashling.id],
			}),
		).rejects.toThrow();

		expect(await deckListIds(slotId)).toEqual([]);
	});
});
