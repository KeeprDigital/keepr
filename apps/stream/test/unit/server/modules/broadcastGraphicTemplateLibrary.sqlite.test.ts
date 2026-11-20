import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { InstalledGraphicsTemplateSummary } from '~~/shared/types/graphicsAsset';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { stubH3Event } from '@keepr/nuxt-layer/test/helpers/h3Event';
import { createSqliteD1Harness } from '@keepr/nuxt-layer/test/helpers/sqlite-d1';

// The Broadcast Graphic Template library at its home: one library read from the
// authored store, over real SQL, and the Graphics Asset Library's installed records,
// stood in at its port.

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

const installed: InstalledGraphicsTemplateSummary[] = [];
vi.doMock('~~/server/modules/graphics-asset-library/runtime', () => ({
	graphicsAssetLibraryForEvent: () => ({
		listInstalledGraphicsTemplates: async ({ kind }: { kind: string }) =>
			installed.filter((template) => template.kind === kind),
		findInstalledGraphicsTemplate: async ({ templateId }: { templateId: string }) =>
			installed.find((template) => template.id === templateId),
	}),
}));

const {
	broadcastGraphicTemplateLibrarySummary,
	findBroadcastGraphicTemplateLibraryEntry,
	listBroadcastGraphicTemplateLibrary,
} = await import('~~/server/modules/broadcast-graphic-template-library');

function graphic(id: string, items: BroadcastGraphicConfig['items'] = []): BroadcastGraphicConfig {
	return { id, name: id, items };
}

async function author(id: string, name: string) {
	await db.insert(schema.broadcastGraphicTemplates).values({ id, name, document: graphic(id) });
}

function install(
	id: string,
	name: string,
	overrides: Partial<InstalledGraphicsTemplateSummary> = {},
): void {
	installed.push({
		id,
		kind: 'broadcast-graphic',
		name,
		revisionNumber: 2,
		document: graphic(`${id}-document`),
		sourceTemplateIdentity: `source-${id}`,
		sourceTemplateRevision: 7,
		installedByOperationId: 'operation-1',
		installedAt: '2026-11-01T00:00:00.000Z',
		...overrides,
	} as InstalledGraphicsTemplateSummary);
}

const event = stubH3Event();

beforeEach(async () => {
	installed.length = 0;
	await db.delete(schema.broadcastGraphicTemplates);
});
afterAll(async () => await harness.close());

describe('the Broadcast Graphic Template library', () => {
	it('lists authored and installed designs as one library, by name then identity', async () => {
		await author('authored-b', 'Bug');
		await author('authored-a', 'Lower third');
		install('installed-a', 'Lower third');
		install('installed-b', 'Ad break');

		const listed = await listBroadcastGraphicTemplateLibrary(event);

		expect(listed.map(({ id, authored }) => [id, authored])).toEqual([
			['installed-b', false],
			['authored-b', true],
			['authored-a', true],
			['installed-a', false],
		]);
		expect(listed.find((entry) => entry.id === 'installed-a')).toMatchObject({
			revision: 2,
			provenance: { sourceTemplateIdentity: 'source-installed-a', sourceTemplateRevision: 7 },
		});
	});

	it('leaves out an installed document that is not a Broadcast Graphic', async () => {
		install('unreadable', 'Broken', { document: { not: 'a graphic' } });

		expect(await listBroadcastGraphicTemplateLibrary(event)).toEqual([]);
		expect(await findBroadcastGraphicTemplateLibraryEntry(event, 'unreadable')).toBeUndefined();
	});

	it.each([
		{ identity: 'an authored design', id: 'authored-a', found: { authored: true } },
		{ identity: 'an installed design', id: 'installed-a', found: { authored: false } },
		{ identity: 'an installed Feature Match Layout', id: 'installed-layout', found: undefined },
		{ identity: 'nothing', id: 'nothing', found: undefined },
	])('finds $identity by its identity', async ({ id, found }) => {
		await author('authored-a', 'Lower third');
		install('installed-a', 'Lower third');
		install('installed-layout', 'Layout', { kind: 'feature-match-layout' });

		const entry = await findBroadcastGraphicTemplateLibraryEntry(event, id);

		expect(entry).toEqual(found && expect.objectContaining({ id, ...found }));
	});

	it('counts a Graphic Group’s children among a summary’s Graphic Items', () => {
		const text = { id: 'text', type: 'text' } as never;
		const summary = broadcastGraphicTemplateLibrarySummary({
			id: 'grouped',
			name: 'Grouped',
			description: null,
			revision: 1,
			document: {
				...graphic('grouped', [{ id: 'group', type: 'group', children: [text, text] } as never]),
				inputs: [{ key: 'name' } as never],
			},
			authored: true,
			createdAt: new Date(0),
			updatedAt: new Date(0),
		});

		expect(summary).toMatchObject({ itemCount: 3, inputCount: 1 });
	});
});
