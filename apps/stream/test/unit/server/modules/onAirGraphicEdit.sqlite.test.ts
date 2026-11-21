import type { BroadcastGraphicsCommand } from '~~/shared/types/broadcastGraphicsLiveSession';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { seedBroadcastGraphicsScreen } from '~~/test/helpers/broadcastGraphicsScreen';
import { createSqliteD1Harness } from '@keepr/nuxt-layer/test/helpers/sqlite-d1';

/**
 * A Broadcast Graphic on air is not edited (ADR-0081): the server refuses a stack
 * write that changes, removes or reorders one, whoever sends it.
 */

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input),
);

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('~~/server/db', () => ({
	db,
	schema: {
		...schema,
	},
}));
vi.doMock('~~/server/utils/realtimePublish', () => ({
	publishMessage: async () => {},
	publishMessageStrict: async () => {},
	publishScreenCommand: async () => {},
	getOriginConnectionId: () => undefined,
}));

/** Commits a Take between a save's on-air read and its commit; fired once. */
let afterOnAirRead: (() => Promise<void>) | undefined;

vi.doMock('~~/server/modules/broadcast-graphics-live-session', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('~~/server/modules/broadcast-graphics-live-session')>();
	return {
		...actual,
		broadcastGraphicsLiveSessionModule: () => {
			const module = actual.broadcastGraphicsLiveSessionModule();
			return {
				...module,
				async onAirGraphics(...args: Parameters<typeof module.onAirGraphics>) {
					const read = await module.onAirGraphics(...args);
					const hook = afterOnAirRead;
					afterOnAirRead = undefined;
					await hook?.();
					return read;
				},
			};
		},
	};
});

const { screenWriteModule } = await import('~~/server/modules/screen-write');
const { broadcastGraphicsLiveSessionModule } =
	await import('~~/server/modules/broadcast-graphics-live-session');

function graphic(id: string, name = id): BroadcastGraphicConfig {
	return { id, name, items: [] };
}

const STACK = [graphic('slate'), graphic('bug'), graphic('lower-third')];

let eventId: number;
let screenId: number;
let commands = 0;

async function take(graphicId: string) {
	const module = broadcastGraphicsLiveSessionModule();
	const session = await module.loadSession(eventId, screenId);
	await module.applyCommand({
		eventId,
		screenId,
		sessionId: session.id,
		command: {
			commandId: `00000000-0000-4000-8000-${String(++commands).padStart(12, '0')}`,
			type: 'Take',
			payload: { graphicId, cut: true },
		} as unknown as BroadcastGraphicsCommand,
		graphicsAssets: () => ({}) as never,
	});
}

async function screenRow() {
	return (await db.query.screens.findFirst({
		where: eq(schema.screens.id, screenId),
	}))!;
}

async function storedIds() {
	return (await screenRow()).modeConfigs!['broadcast-graphics']!.graphics!.map((entry) => entry.id);
}

async function patch(config: Record<string, unknown>) {
	return await screenWriteModule().updateModeConfig({
		eventId,
		screenId,
		mode: 'broadcast-graphics',
		config,
		stateVersion: (await screenRow()).stateVersion,
		graphicsAssets: () => ({}) as never,
		authoringSessionId: 'author',
	});
}

beforeEach(async () => {
	afterOnAirRead = undefined;
	const seeded = await seedBroadcastGraphicsScreen(db, {
		stack: { graphics: STACK },
	});
	eventId = seeded.eventId;
	screenId = seeded.screenId;
	await take('slate');
	await take('lower-third');
});

afterAll(async () => await harness.close());

describe('a Broadcast Graphics stack write while graphics are on air', () => {
	const [slate, bug, lowerThird] = STACK as [
		BroadcastGraphicConfig,
		BroadcastGraphicConfig,
		BroadcastGraphicConfig,
	];

	it.each<[string, BroadcastGraphicConfig[]]>([
		['changes one', [graphic('slate', 'Renamed'), bug, lowerThird]],
		['removes one', [bug, lowerThird]],
		['reorders two of them', [lowerThird, bug, slate]],
	])('is refused when it %s', async (_, graphics) => {
		await expect(patch({ graphics })).rejects.toMatchObject({ statusCode: 409 });

		expect(await storedIds()).toEqual(['slate', 'bug', 'lower-third']);
	});

	it.each<[string, BroadcastGraphicConfig[], string[]]>([
		[
			'changes one off air',
			[slate, graphic('bug', 'Renamed'), lowerThird],
			['slate', 'bug', 'lower-third'],
		],
		['moves one off air past them', [bug, slate, lowerThird], ['bug', 'slate', 'lower-third']],
		[
			'moves one of them to another Graphic Channel',
			[{ ...slate, channelId: 'thirds' }, bug, lowerThird],
			['slate', 'bug', 'lower-third'],
		],
	])('is admitted when it %s', async (_, graphics, stored) => {
		await patch({
			graphics,
			channels: [{ id: 'thirds', name: 'Lower thirds', handoff: 'cut' }],
		});

		expect(await storedIds()).toEqual(stored);
	});

	// The save's on-air read is fenced on the Live Session it read, so a Take that
	// commits in between refuses the save rather than taking the edit to program.
	it.each([
		{
			path: 'mode config patch',
			save: () => patch({ graphics: [slate, graphic('bug', 'Renamed'), lowerThird] }),
		},
		{
			path: 'generic Screen write',
			save: async () =>
				screenWriteModule().updateScreen({
					eventId,
					screenId,
					input: {
						stateVersion: (await screenRow()).stateVersion,
						modeConfigs: {
							'broadcast-graphics': { graphics: [slate, graphic('bug', 'Renamed'), lowerThird] },
						},
					} as never,
					authoringSessionId: 'author',
				}),
		},
	])('is refused through the $path when a Take of the edited graphic interleaves', async (row) => {
		afterOnAirRead = () => take('bug');

		await expect(row.save()).rejects.toMatchObject({ statusCode: 409 });

		const stored = (await screenRow()).modeConfigs!['broadcast-graphics']!.graphics!;
		expect(stored.find((entry) => entry.id === 'bug')?.name).toBe('bug');
	});

	it('is refused through the generic Screen write too', async () => {
		const current = await screenRow();

		await expect(
			screenWriteModule().updateScreen({
				eventId,
				screenId,
				input: {
					stateVersion: current.stateVersion,
					modeConfigs: {
						'broadcast-graphics': {
							graphics: [bug, lowerThird],
						},
					},
				} as never,
				authoringSessionId: 'author',
			}),
		).rejects.toMatchObject({ statusCode: 409 });
	});
});
