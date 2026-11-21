import type { InstalledGraphicsTemplateSummary } from '~~/shared/types/graphicsAsset';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { BUILT_IN_FEATURE_MATCH_LAYOUT_TEMPLATES } from '~~/shared/builtInFeatureMatchLayoutTemplates';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import { stubH3Event } from '@keepr/nuxt-layer/test/helpers/h3Event';
import { createSqliteD1Harness } from '@keepr/nuxt-layer/test/helpers/sqlite-d1';

// The Feature Match Layout Template library at its home: the built-in layouts, the
// authored store over real SQL, and the Graphics Asset Library's installed records,
// stood in at its port, read as one library.

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
	featureMatchLayoutTemplateLibrarySummary,
	findFeatureMatchLayoutTemplateLibraryEntry,
	listFeatureMatchLayoutTemplateLibrary,
} = await import('~~/server/modules/feature-match-layout-template-library');

const layout = () => structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout);
const [firstBuiltIn] = BUILT_IN_FEATURE_MATCH_LAYOUT_TEMPLATES;
const event = stubH3Event();

function install(id: string, overrides: Partial<InstalledGraphicsTemplateSummary> = {}): void {
	installed.push({
		id,
		kind: 'feature-match-layout',
		name: `Installed ${id}`,
		revisionNumber: 3,
		document: layout(),
		sourceTemplateIdentity: `source-${id}`,
		installedByOperationId: 'operation-1',
		installedAt: '2026-11-01T00:00:00.000Z',
		...overrides,
	} as InstalledGraphicsTemplateSummary);
}

beforeEach(async () => {
	installed.length = 0;
	await db.delete(schema.featureMatchLayoutTemplates);
});
afterAll(async () => await harness.close());

describe('the Feature Match Layout Template library', () => {
	it('lists every built-in, authored and installed layout, leaving out an unreadable one', async () => {
		await db
			.insert(schema.featureMatchLayoutTemplates)
			.values({ id: 'authored-1', name: 'Authored', document: layout() });
		install('installed-1');
		install('unreadable', { document: { not: 'a layout' } });

		const listed = await listFeatureMatchLayoutTemplateLibrary(event);

		expect(listed).toHaveLength(BUILT_IN_FEATURE_MATCH_LAYOUT_TEMPLATES.length + 2);
		expect(listed.map((entry) => entry.name)).toEqual(
			[...listed.map((entry) => entry.name)].sort((left, right) => left.localeCompare(right)),
		);
		expect(listed.find((entry) => entry.id === 'installed-1')).toMatchObject({
			authored: false,
			provenance: { sourceTemplateIdentity: 'source-installed-1', sourceTemplateRevision: null },
		});
		expect(listed.find((entry) => entry.id === `builtin:${firstBuiltIn!.id}`)).toMatchObject({
			builtIn: true,
			authored: false,
		});
	});

	it.each([
		{ identity: 'a built-in layout', id: `builtin:${firstBuiltIn!.id}`, found: { builtIn: true } },
		{ identity: 'a built-in prefix naming no layout', id: 'builtin:nothing', found: undefined },
		{ identity: 'an authored layout', id: 'authored-1', found: { authored: true } },
		{ identity: 'an installed layout', id: 'installed-1', found: { authored: false } },
		{ identity: 'an installed Broadcast Graphic', id: 'installed-graphic', found: undefined },
	])('finds $identity by its identity', async ({ id, found }) => {
		await db
			.insert(schema.featureMatchLayoutTemplates)
			.values({ id: 'authored-1', name: 'Authored', document: layout() });
		install('installed-1');
		install('installed-graphic', { kind: 'broadcast-graphic' });

		const entry = await findFeatureMatchLayoutTemplateLibraryEntry(event, id);

		expect(entry).toEqual(found && expect.objectContaining({ id, ...found }));
	});

	// Every read is answered from the layout the application ships, never from a copy a caller changed.
	it('hands out a built-in layout as a copy', async () => {
		const id = `builtin:${firstBuiltIn!.id}`;
		const first = await findFeatureMatchLayoutTemplateLibraryEntry(event, id);
		first!.document.sources.length = 0;

		const second = await findFeatureMatchLayoutTemplateLibraryEntry(event, id);

		expect(second!.document).toEqual(firstBuiltIn!.config.layout);
	});

	it.each([
		{ layout: 'a pair', document: layout(), fourSeat: undefined },
		{
			layout: 'four Seats',
			document: {
				...layout(),
				sources: [...layout().sources, { ...layout().sources[0]!, sourceRole: 'player3' }],
			},
			fourSeat: true,
		},
	])('summarises $layout with its counts and Seat count', ({ document, fourSeat }) => {
		const summary = featureMatchLayoutTemplateLibrarySummary({
			id: 'summarised',
			name: 'Summarised',
			description: null,
			revision: 1,
			document: document as never,
			authored: true,
			createdAt: new Date(0),
			updatedAt: new Date(0),
		});

		expect(summary.fourSeat).toBe(fourSeat);
		expect(summary.sourceCount).toBe(document.sources.length);
	});
});
