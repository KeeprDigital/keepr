import type { H3Event } from 'h3';
import type { GraphicAssetId, GraphicsAssetEvidenceReading } from '~~/shared/types/graphicsAsset';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '~~/server/db';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import { replacementPng } from '~~/test/helpers/graphicsFixtures';
import {
	createTestGraphicsLibrary,
	ingestImage,
	publishedRevision,
} from '~~/test/helpers/graphicsLibrary';
import {
	AN_ADMINISTRATOR,
	keeprAccountsBinding,
	workerRequest,
} from '~~/test/helpers/keeprAccounts';
import { createSqliteD1Harness } from '@keepr/nuxt-layer/test/helpers/sqlite-d1';

// The Evidence Ledger as a Graphics Administrator queries it: the address names one
// subject as a kind and an identity, and the route reads that pair as one filter or
// refuses half of it. Only the guard, the byte stores and the connection to Keepr
// Accounts, which the Accounts Stand-in answers, are faked.

const harness = await createSqliteD1Harness();
const context = createTestGraphicsLibrary({
	catalogue: createD1GraphicsAssetCatalogue(harness.database),
	identityPrefix: 'evidence',
});
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', async (importOriginal) => ({
	...(await importOriginal<object>()),
	db,
}));
vi.doMock('~~/server/modules/graphics-asset-library/runtime', () => ({
	graphicsAssetLibraryForEvent: () => context.library,
}));
/** The Graphics Administrator who purges, and reads the ledger afterwards. */
const ADMINISTRATOR = { id: 'grace', name: 'Grace Hopper', email: 'grace@example.test' };
vi.doMock('~~/server/modules/graphics-administrator', () => ({
	requireGraphicsAdministratorUser: async () => ADMINISTRATOR,
}));

interface StubEvent {
	query: Record<string, string>;
}
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedQuery', async (event: StubEvent, parse: (value: unknown) => unknown) =>
	parse(event.query),
);
vi.stubGlobal('setResponseHeader', () => {});
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input),
);

type Handler = (event: H3Event) => Promise<GraphicsAssetEvidenceReading>;
const readEvidence = (await import('~~/server/api/admin/graphics-assets/evidence.get'))
	.default as unknown as Handler;

/** Keepr Accounts, as the Worker's binding reaches it. */
const accounts = keeprAccountsBinding();
/** Another Graphics Administrator, whom Keepr Accounts names to the one reading. */
const ANOTHER_ADMINISTRATOR = { user: 'ada', name: 'Ada Lovelace' };

async function evidence(query: Record<string, string> = {}) {
	const request: StubEvent = { query };
	return await readEvidence(
		Object.assign(
			workerRequest({ as: AN_ADMINISTRATOR, env: { KEEPR_ACCOUNTS: accounts } }),
			request,
		),
	);
}

/** A Graphic Asset the ledger holds entries against: Trashed, then purged early by `actor`. */
async function purgedAsset(
	name: string,
	bytes?: Uint8Array,
	actor = ADMINISTRATOR.id,
): Promise<GraphicAssetId> {
	const { assetId } = publishedRevision(
		await ingestImage(context, { idempotencyKey: name, name, bytes }),
	);
	await context.library.trashGraphicAsset({ assetId });
	await context.library.purgeTrashedGraphicAsset({
		assetId,
		actor,
		confirmation: 'purge-now',
	});
	return assetId;
}

let asked: GraphicAssetId;
let other: GraphicAssetId;
let anothers: GraphicAssetId;

beforeAll(async () => {
	asked = await purgedAsset('asked');
	other = await purgedAsset('other', replacementPng);
	anothers = await purgedAsset('anothers', undefined, ANOTHER_ADMINISTRATOR.user);
	await accounts.holds(ANOTHER_ADMINISTRATOR);
});

afterAll(async () => await harness.close());

describe('the Evidence Ledger read for one subject', () => {
	it('answers only the entries recorded against the subject the address names', async () => {
		const { entries } = await evidence({ subjectKind: 'graphic-asset', subjectId: asked });

		expect(entries).not.toHaveLength(0);
		expect(entries.map((entry) => entry.subject)).toEqual(
			entries.map(() => ({ kind: 'graphic-asset', id: asked })),
		);
		// The ledger holds the other subject's entries too, so the address narrowed the read.
		const everything = await evidence();
		expect(everything.entries.some((entry) => entry.subject.id === other)).toBe(true);
	});

	// Wiring for `graphicsActorNames`: the Graphics Administrator reading is who it names.
	it('names the actor of an entry the reading administrator caused', async () => {
		const { actorNames, entries } = await evidence({
			subjectKind: 'graphic-asset',
			subjectId: asked,
		});

		expect(entries.map((entry) => entry.actor)).toContain(ADMINISTRATOR.id);
		expect(actorNames[ADMINISTRATOR.id]).toBe('Grace Hopper');
	});

	// Wiring for `withActorNames`: another User is named as Keepr Accounts tells the reader.
	it('names the actor of an entry another User caused, by asking Keepr Accounts', async () => {
		const { actorNames, entries } = await evidence({
			subjectKind: 'graphic-asset',
			subjectId: anothers,
		});

		expect(entries.map((entry) => entry.actor)).toContain(ANOTHER_ADMINISTRATOR.user);
		expect(actorNames[ANOTHER_ADMINISTRATOR.user]).toBe('Ada Lovelace');
	});

	// Half a subject would silently widen the read to every subject, so it is refused instead.
	it.each<{ half: string; query: Record<string, string> }>([
		{
			half: 'a kind without an identity',
			query: { subjectKind: 'graphic-asset' },
		},
		{
			half: 'an identity without a kind',
			query: { subjectId: 'evidence-1' },
		},
	])('refuses $half', async ({ query }) => {
		await expect(evidence(query)).rejects.toMatchObject({
			name: 'ZodError',
			issues: [
				expect.objectContaining({
					message: 'A subject filter needs both a subject kind and a subject identity',
				}),
			],
		});
	});
});
