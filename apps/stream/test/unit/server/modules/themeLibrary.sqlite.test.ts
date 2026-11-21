import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { eventRealtimeChannel } from '~~/shared/utils/realtimeChannels';
import { installRealtimeObjectFake } from '~~/test/helpers/realtimeObjectFake';
import { createSqliteD1Harness } from '@keepr/nuxt-layer/test/helpers/sqlite-d1';

// The Theme library at its home, over real SQL: what it refuses, and which Events
// hear of a token write. Only the realtime object and the Graphics Asset Library are faked.

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string; data?: unknown }) =>
	Object.assign(new Error(input.message ?? 'error'), input),
);

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));
const realtime = await installRealtimeObjectFake();

const { themeLibraryModule } = await import('~~/server/modules/theme-library');

function unusedLibrary(): never {
	throw new Error('A token naming no library content must not build the library');
}

async function stageEvent(name: string, themeId: string | null = null) {
	const [event] = await db
		.insert(schema.events)
		.values({ name, game: 'mtg', featureMatchOrientation: 'horizontal', themeId })
		.returning({ id: schema.events.id });
	return event!.id;
}

function announcedOn(eventId: number) {
	return realtime.on(eventRealtimeChannel(eventId)).map(({ type }) => type);
}

beforeEach(() => realtime.reset());
afterAll(async () => await harness.close());

describe('the Theme library', () => {
	it.each([
		{ action: 'reads', run: () => themeLibraryModule().get('missing') },
		{ action: 'renames', run: () => themeLibraryModule().rename('missing', 'Name') },
		{ action: 'deletes', run: () => themeLibraryModule().remove('missing') },
		{
			action: 'clears a token of',
			run: () => themeLibraryModule().clearToken({ themeId: 'missing', token: 'accent' }),
		},
	])('answers 404 when it $action a Theme that does not exist', async ({ run }) => {
		await expect(run()).rejects.toMatchObject({ statusCode: 404, message: 'Theme not found' });
	});

	it('refuses to delete a Theme Events use, naming each of them', async () => {
		const theme = await themeLibraryModule().create('House');
		await stageEvent('Spring Open', theme.id);
		await stageEvent('Summer Open', theme.id);

		await expect(themeLibraryModule().remove(theme.id)).rejects.toMatchObject({
			statusCode: 409,
			message: 'This Theme cannot be deleted while Events use it: Spring Open, Summer Open',
			data: { code: 'THEME_IN_USE' },
		});
		expect(
			await db.query.themes.findFirst({ where: eq(schema.themes.id, theme.id) }),
		).toBeDefined();
	});

	// A token write reaches every Event using the Theme at once, and no other.
	it('announces a token it sets on every Event using the Theme, and a clear only when it cleared one', async () => {
		const theme = await themeLibraryModule().create('House');
		const using = await stageEvent('Using', theme.id);
		const other = await stageEvent('Other');

		await themeLibraryModule().setToken({
			themeId: theme.id,
			token: 'accent',
			value: '#123456',
			graphicsAssets: unusedLibrary,
		});
		expect(announcedOn(using)).toEqual(['theme:updated']);
		expect(announcedOn(other)).toEqual([]);

		realtime.reset();
		await themeLibraryModule().clearToken({ themeId: theme.id, token: 'accent' });
		await themeLibraryModule().clearToken({ themeId: theme.id, token: 'accent' });
		expect(announcedOn(using)).toEqual(['theme:updated']);
	});

	it('refuses a token value that is not one, storing and announcing nothing', async () => {
		const theme = await themeLibraryModule().create('House');
		const using = await stageEvent('Using', theme.id);

		await expect(
			themeLibraryModule().setToken({
				themeId: theme.id,
				token: 'accent',
				value: 42,
				graphicsAssets: unusedLibrary,
			}),
		).rejects.toMatchObject({ statusCode: 400 });
		expect((await themeLibraryModule().get(theme.id)).tokens).toEqual({});
		expect(announcedOn(using)).toEqual([]);
	});
});
