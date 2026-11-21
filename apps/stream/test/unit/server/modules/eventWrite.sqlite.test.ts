import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { eventRealtimeChannel } from '~~/shared/utils/realtimeChannels';
import { installRealtimeObjectFake } from '~~/test/helpers/realtimeObjectFake';
import { createSqliteD1Harness } from '@keepr/nuxt-layer/test/helpers/sqlite-d1';

// An Event write over real SQL: what it refuses, what it stores on the Event and
// its Feature Match Slots, and what it announces. Only the realtime object and the Screen Card's
// key-value store are faked. A Slot count change is `featureMatchSlotCountD1.test.ts`'s,
// and a refused Broadcast Deck List disable `deckSourceInvariants.sqlite.test.ts`'s.

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string; data?: unknown }) =>
	Object.assign(new Error(input.message ?? 'error'), input),
);

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

const realtime = await installRealtimeObjectFake();

/** Each Event whose Graphic Input Bindings were re-resolved, in order. */
const reResolved: number[] = [];
vi.doMock('~~/server/modules/broadcast-graphics-live-session', async (importOriginal) => ({
	...(await importOriginal<object>()),
	refreshBroadcastGraphicsBindings: async (eventId: number) => {
		reResolved.push(eventId);
	},
}));

/** Each Screen Card the write cleaned out of the key-value store, as `[eventId, screenId]`. */
const cleanedCards: [number, number][] = [];
vi.doMock('~~/server/services/card', () => ({
	cardService: () => ({
		cleanupDeletedScreenCard: async (eventId: number, screenId: number) => {
			cleanedCards.push([eventId, screenId]);
		},
	}),
}));

/** Runs once, after the write's Theme check answers and before the write commits. */
let afterThemeCheck: (() => Promise<void>) | undefined;
vi.doMock('~~/server/services/theme', async (importOriginal) => {
	const actual = await importOriginal<typeof import('~~/server/services/theme')>();
	return {
		...actual,
		themeService: () => {
			const service = actual.themeService();
			return {
				...service,
				async findById(id: string) {
					const found = await service.findById(id);
					const hook = afterThemeCheck;
					afterThemeCheck = undefined;
					await hook?.();
					return found;
				},
			};
		},
	};
});

const { eventWriteModule } = await import('~~/server/modules/event-write');
const { featureMatchService } = await import('~~/server/services/featureMatch');

async function stageEvent(values: Partial<typeof schema.events.$inferInsert> = {}) {
	const [event] = await db
		.insert(schema.events)
		.values({
			name: 'Event',
			game: 'mtg',
			featureMatchOrientation: 'horizontal',
			...values,
		})
		.returning({ id: schema.events.id });
	return event!.id;
}

async function stored(eventId: number) {
	return await db.query.events.findFirst({
		where: eq(schema.events.id, eventId),
	});
}

async function slotsOf(eventId: number) {
	return await db
		.select()
		.from(schema.featureMatches)
		.where(eq(schema.featureMatches.eventId, eventId))
		.orderBy(asc(schema.featureMatches.id));
}

/** What the Event's channel was sent, as `[type, payload]`. */
function announced(eventId: number) {
	return realtime
		.on(eventRealtimeChannel(eventId))
		.map(({ type, payload }) => [type, payload] as const);
}

beforeEach(() => {
	realtime.reset();
	cleanedCards.length = 0;
	afterThemeCheck = undefined;
	reResolved.length = 0;
});
afterAll(async () => await harness.close());

describe('an Event update', () => {
	it("stores the change, answers the Event and announces it under the writer's origin", async () => {
		const eventId = await stageEvent();

		const answered = await eventWriteModule().updateEvent({
			eventId,
			input: { name: 'Renamed' },
			originConnectionId: 'origin-1',
		});

		expect(answered).toMatchObject({ id: eventId, name: 'Renamed' });
		expect((await stored(eventId))?.name).toBe('Renamed');
		expect(announced(eventId)).toEqual([
			[
				'event:updated',
				expect.objectContaining({
					originConnectionId: 'origin-1',
					event: expect.objectContaining({ id: eventId, name: 'Renamed' }),
				}),
			],
		]);
	});

	it('answers 404 for an Event that does not exist, announcing nothing', async () => {
		await expect(
			eventWriteModule().updateEvent({
				eventId: 999_999,
				input: { name: 'Nobody' },
			}),
		).rejects.toMatchObject({ statusCode: 404, message: 'Event not found' });

		expect(realtime.published).toEqual([]);
	});

	// Which Events hold Broadcast Deck Lists is `holdsBroadcastDeckLists`'s; the write stores or refuses by it.
	it.each([
		{ variant: 'two-player', enabled: true },
		{ variant: 'commander', enabled: false },
	] as const)(
		'enables Broadcast Deck Lists for a Magic: The Gathering Event of Variant $variant: $enabled',
		async ({ variant, enabled }) => {
			const eventId = await stageEvent({ game: 'mtg', variant });

			const enabling = eventWriteModule().updateEvent({
				eventId,
				input: { broadcastDeckListsEnabled: true },
			});

			if (enabled) {
				await enabling;
			} else {
				await expect(enabling).rejects.toMatchObject({
					statusCode: 400,
					message:
						'Broadcast Deck Lists can only be enabled for Two-Player Magic: The Gathering Events',
				});
			}
			expect((await stored(eventId))?.broadcastDeckListsEnabled).toBe(enabled);
			expect(announced(eventId).map(([type]) => type)).toEqual(enabled ? ['event:updated'] : []);
		},
	);

	it('refuses to disable Broadcast Deck Lists while Screens select one, naming every such Screen', async () => {
		const eventId = await stageEvent({ broadcastDeckListsEnabled: true });
		const [list] = await db
			.insert(schema.broadcastDeckLists)
			.values({
				eventId,
				name: 'List',
				normalizedName: 'list',
				sourceText: '1 Island',
			})
			.returning({ id: schema.broadcastDeckLists.id });
		const selecting = {
			currentMode: 'deck' as const,
			modeConfigs: {
				deck: {
					deckSource: { type: 'broadcast' as const, broadcastDeckListId: list!.id },
				},
			},
		};
		await db.insert(schema.screens).values([
			{
				eventId,
				name: 'Alpha',
				slug: 'alpha',
				assetCapabilitySeed: 'seed-a',
				assetCapabilityDigest: 'digest-a',
				...selecting,
			},
			{
				eventId,
				name: 'Stage',
				slug: 'stage',
				assetCapabilitySeed: 'seed-s',
				assetCapabilityDigest: 'digest-s',
				...selecting,
			},
		]);

		await expect(
			eventWriteModule().updateEvent({
				eventId,
				input: { broadcastDeckListsEnabled: false },
			}),
		).rejects.toMatchObject({
			statusCode: 409,
			message: expect.stringContaining('Alpha, Stage'),
			data: {
				code: 'BROADCAST_DECK_LISTS_IN_USE',
				screens: [
					expect.objectContaining({ name: 'Alpha' }),
					expect.objectContaining({ name: 'Stage' }),
				],
			},
		});

		expect((await stored(eventId))?.broadcastDeckListsEnabled).toBe(true);
		expect(realtime.published).toEqual([]);
	});

	it("takes a commentator from the Event's own Talent, and refuses another Event's before storing anything", async () => {
		const eventId = await stageEvent();
		const [own] = await db
			.insert(schema.eventTalents)
			.values({ eventId, name: 'Own' })
			.returning({ id: schema.eventTalents.id });
		const [foreign] = await db
			.insert(schema.eventTalents)
			.values({ eventId: await stageEvent(), name: 'Foreign' })
			.returning({ id: schema.eventTalents.id });

		await expect(
			eventWriteModule().updateEvent({
				eventId,
				input: {
					name: 'Not stored',
					commentator1TalentId: own!.id,
					commentator2TalentId: foreign!.id,
				},
			}),
		).rejects.toMatchObject({ statusCode: 404 });
		expect(await stored(eventId)).toMatchObject({ name: 'Event', commentator1TalentId: null });

		await eventWriteModule().updateEvent({
			eventId,
			input: { commentator1TalentId: own!.id },
		});
		expect((await stored(eventId))?.commentator1TalentId).toBe(own!.id);
	});

	// The check refuses a missing Theme; the foreign key, re-checked, refuses one deleted after it.
	it.each([
		{ theme: 'that does not exist', staged: false },
		{ theme: 'deleted between its check and the write', staged: true },
	])('refuses an Event Theme $theme as not found, storing nothing', async ({ staged }) => {
		const eventId = await stageEvent();
		const themeId = `theme-${staged ? 'deleted' : 'missing'}`;
		if (staged) {
			await db.insert(schema.themes).values({ id: themeId, name: 'Doomed' });
			afterThemeCheck = async () => {
				await db.delete(schema.themes).where(eq(schema.themes.id, themeId));
			};
		}

		await expect(
			eventWriteModule().updateEvent({ eventId, input: { name: 'Not stored', themeId } }),
		).rejects.toMatchObject({ statusCode: 400, message: 'Theme not found' });

		expect(await stored(eventId)).toMatchObject({ name: 'Event', themeId: null });
		expect(announced(eventId)).toEqual([]);
	});
});

describe('an Event update and its Feature Match Slots', () => {
	async function stageEventWithSlots() {
		const eventId = await stageEvent({ featureMatchDefaultBestOf: 3 });
		await featureMatchService().syncFeatureMatches(eventId, 2);
		realtime.reset();
		return eventId;
	}

	/** The Slots the Event's channel was told of, in order, and the origin each notice carried. */
	function slotNotices(eventId: number) {
		return announced(eventId)
			.filter(([type]) => type === 'featureMatch:updated')
			.map(([, payload]) => ({
				slotId: (payload.featureMatch as { id: number }).id,
				origin: payload.originConnectionId,
			}));
	}

	it("gives every Slot the Event's new best of, and announces each with no origin", async () => {
		const eventId = await stageEventWithSlots();

		await eventWriteModule().updateEvent({
			eventId,
			input: { featureMatchDefaultBestOf: 5 },
			originConnectionId: 'origin-1',
		});

		const slots = await slotsOf(eventId);
		expect(slots.map((slot) => slot.bestOf)).toEqual([5, 5]);
		expect(slotNotices(eventId)).toEqual(
			slots.map((slot) => ({ slotId: slot.id, origin: undefined })),
		);
	});

	it('announces each Slot whose active Session a changed default corrects', async () => {
		const eventId = await stageEventWithSlots();

		await eventWriteModule().updateEvent({
			eventId,
			input: {
				featureMatchDefaultCountUpAfterCountdown: true,
				featureMatchDefaultCountUpLimit: 10,
			},
			originConnectionId: 'origin-1',
		});

		const slots = await slotsOf(eventId);
		expect(slots).toHaveLength(2);
		expect(slotNotices(eventId)).toEqual(
			slots.map((slot) => ({ slotId: slot.id, origin: undefined })),
		);
	});

	/** Each active Session's snapshot of its Slot's best of and Event's count-up limit, by Slot. */
	async function sessionSnapshots(eventId: number) {
		const sessions = await db.query.featureMatchSessions.findMany({
			where: eq(schema.featureMatchSessions.eventId, eventId),
		});
		return sessions
			.filter((session) => session.status === 'active')
			.map((session) => ({
				slotId: session.slotId,
				bestOf: session.sourceSnapshot.bestOf,
				countUpLimit: session.sourceSnapshot.defaults.countUpLimit,
			}))
			.toSorted((a, b) => a.slotId - b.slotId);
	}

	/** The round trips to the database a settings save makes, for an Event of so many Slots. */
	async function roundTripsOfSave(slotCount: number, input: Parameters<typeof save>[1]) {
		const eventId = await stageEvent({ featureMatchDefaultBestOf: 3 });
		await featureMatchService().syncFeatureMatches(eventId, slotCount);
		const before = harness.roundTrips();
		await save(eventId, input);
		return { eventId, roundTrips: harness.roundTrips() - before };
	}

	async function save(eventId: number, input: Record<string, unknown>) {
		await eventWriteModule().updateEvent({ eventId, input, originConnectionId: 'origin-1' });
	}

	// A save corrected each Slot's Session one by one: hundreds of sequential queries at fifty Slots.
	it.each([
		['the best of', { featureMatchDefaultBestOf: 5 }, { bestOf: 5, countUpLimit: null }],
		[
			'another Feature Match default',
			{ featureMatchDefaultCountUpAfterCountdown: true, featureMatchDefaultCountUpLimit: 10 },
			{ bestOf: 3, countUpLimit: 10 },
		],
	])(
		"corrects every Slot's Session to %s in as many round trips, however many Slots it has",
		async (_, input, snapshot) => {
			const few = await roundTripsOfSave(1, input);
			const many = await roundTripsOfSave(6, input);

			expect(many.roundTrips).toBe(few.roundTrips);
			const corrected = await sessionSnapshots(many.eventId);
			expect(corrected).toHaveLength(6);
			for (const session of corrected) expect(session).toMatchObject(snapshot);
		},
	);

	it('re-resolves Graphic Input Bindings once for a save changing its Slots and the Event', async () => {
		const eventId = await stageEventWithSlots();

		await save(eventId, {
			name: 'Renamed',
			featureMatchDefaultBestOf: 5,
			featureMatchDefaultCountUpLimit: 10,
		});

		expect(reResolved).toEqual([eventId]);
	});

	it('leaves the Slots alone, and announces none, for a write naming no Feature Match default', async () => {
		const eventId = await stageEventWithSlots();
		const before = await slotsOf(eventId);

		await eventWriteModule().updateEvent({
			eventId,
			input: { name: 'Renamed' },
		});

		expect(await slotsOf(eventId)).toEqual(before);
		expect(announced(eventId).map(([type]) => type)).toEqual(['event:updated']);
	});
});

describe('an Event delete', () => {
	it("removes the Event and its Screens, cleans out each Screen's Card, then announces the delete", async () => {
		const eventId = await stageEvent();
		const screens = await db
			.insert(schema.screens)
			.values([
				{
					eventId,
					name: 'One',
					slug: 'one',
					assetCapabilitySeed: 'seed-1',
					assetCapabilityDigest: 'digest-1',
				},
				{
					eventId,
					name: 'Two',
					slug: 'two',
					assetCapabilitySeed: 'seed-2',
					assetCapabilityDigest: 'digest-2',
				},
			])
			.returning({ id: schema.screens.id });

		const answered = await eventWriteModule().deleteEvent({
			eventId,
			originConnectionId: 'origin-1',
		});

		expect(answered).toEqual({ success: true });
		expect(await stored(eventId)).toBeUndefined();
		expect(
			await db.select().from(schema.screens).where(eq(schema.screens.eventId, eventId)),
		).toEqual([]);
		// The Screens are gone by now, so their ids were read before the cascade removed them.
		expect(cleanedCards).toEqual(screens.map((screen) => [eventId, screen.id]));
		expect(announced(eventId)).toEqual([
			['event:deleted', expect.objectContaining({ originConnectionId: 'origin-1' })],
		]);
	});

	it('answers 404 for an Event that does not exist, cleaning and announcing nothing', async () => {
		await expect(eventWriteModule().deleteEvent({ eventId: 999_999 })).rejects.toMatchObject({
			statusCode: 404,
			message: 'Event not found',
		});

		expect(cleanedCards).toEqual([]);
		expect(realtime.published).toEqual([]);
		expect(realtime.disconnects).toEqual([]);
	});

	// ADR-0146: everyone in the Event's object, after the announcement an
	// operator's page leaves on.
	it('closes every realtime socket of the Event, after announcing the delete', async () => {
		const eventId = await stageEvent();
		let announcedFirst: boolean | undefined;
		const disconnecting = realtime.env.REALTIME.getByName;
		realtime.env.REALTIME.getByName = (scope: string) => {
			const stub = disconnecting(scope);
			return {
				...stub,
				disconnectAll: async () => {
					announcedFirst ??= announced(eventId).length > 0;
					return await stub.disconnectAll();
				},
			};
		};

		try {
			await eventWriteModule().deleteEvent({ eventId });
		} finally {
			realtime.env.REALTIME.getByName = disconnecting;
		}

		expect(realtime.disconnects).toEqual([{ scope: `event:${eventId}` }]);
		expect(announcedFirst).toBe(true);
	});

	describe('when the sockets cannot be closed', () => {
		let logged: ReturnType<typeof vi.spyOn>;
		beforeEach(() => {
			logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		});
		afterEach(() => logged.mockRestore());

		it('asks once more, and says nothing when that closes them', async () => {
			const eventId = await stageEvent();
			realtime.refuseDisconnect(1);

			await eventWriteModule().deleteEvent({ eventId });

			expect(realtime.disconnects).toHaveLength(2);
			expect(logged).not.toHaveBeenCalled();
		});

		// The row is gone either way, so the delete answers.
		it('deletes all the same, and logs which Event may still have sockets connected', async () => {
			const eventId = await stageEvent();
			realtime.refuseDisconnect();

			const answered = await eventWriteModule().deleteEvent({ eventId });

			expect(answered).toEqual({ success: true });
			expect(await stored(eventId)).toBeUndefined();
			expect(realtime.disconnects).toHaveLength(2);
			expect(logged).toHaveBeenCalledTimes(1);
			expect(JSON.parse(logged.mock.calls[0]![0] as string)).toMatchObject({
				message: 'event_realtime_disconnect_failed',
				eventId,
			});
		});
	});
});
