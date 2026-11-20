import type { H3Event } from 'h3';
import type { GraphicAssetId, GraphicsActorNaming } from '~~/shared/types/graphicsAsset';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import {
	createTestGraphicsLibrary,
	ingestImage,
	initiateImage,
	publishedRevision,
} from '~~/test/helpers/graphicsLibrary';
import {
	AN_ADMINISTRATOR,
	keeprAccountsBinding,
	workerRequest,
} from '~~/test/helpers/keeprAccounts';
import { createSqliteD1Harness } from '@keepr/nuxt-layer/test/helpers/sqlite-d1';

// Wiring for `withActorNames` in the Operations Cockpit and a queue inspection:
// each names a User other than its reader as Keepr Accounts names them
// (ADR-0145). The Evidence Ledger's is `evidence.get.sqlite.test.ts`'s. Only the
// guard, the byte stores and the connection to Keepr Accounts are faked.

const harness = await createSqliteD1Harness();
const context = createTestGraphicsLibrary({
	catalogue: createD1GraphicsAssetCatalogue(harness.database),
	identityPrefix: 'reading-actors',
});
vi.doMock('~~/server/modules/graphics-asset-library/runtime', () => ({
	graphicsAssetLibraryForEvent: () => context.library,
}));
vi.doMock('~~/server/modules/graphics-administrator', () => ({
	requireGraphicsAdministratorUser: async () => ({
		id: 'grace',
		name: 'Grace Hopper',
		email: 'grace@example.test',
	}),
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

type Handler = (event: H3Event) => Promise<GraphicsActorNaming>;
const readCockpit = (await import('~~/server/api/admin/graphics-assets/operations-cockpit.get'))
	.default as unknown as Handler;
const readInspection = (await import('~~/server/api/admin/graphics-assets/queues/inspection.get'))
	.default as unknown as Handler;

const accounts = keeprAccountsBinding();

function readBy(query: Record<string, string> = {}): H3Event {
	const request: StubEvent = { query };
	return Object.assign(
		workerRequest({ as: AN_ADMINISTRATOR, env: { KEEPR_ACCOUNTS: accounts } }),
		request,
	);
}

let trashed: GraphicAssetId;

beforeAll(async () => {
	await initiateImage(context, { idempotencyKey: 'waiting', initiatedBy: 'ada' });
	({ assetId: trashed } = publishedRevision(
		await ingestImage(context, { idempotencyKey: 'trashed' }),
	));
	await context.library.trashGraphicAsset({ assetId: trashed, actor: 'bo' });
	await accounts.holds({ user: 'ada', name: 'Ada Lovelace' });
	await accounts.holds({ user: 'bo', name: 'Bo Diddley' });
});

afterAll(async () => await harness.close());

describe('an administrator reading names a User who is not its reader', () => {
	it.each<[string, () => Promise<GraphicsActorNaming>, Record<string, string>]>([
		[
			'the Operations Cockpit, who started a waiting Graphics Ingestion Operation',
			async () => await readCockpit(readBy()),
			{ ada: 'Ada Lovelace' },
		],
		[
			'a queue inspection, who caused the Evidence it shows',
			async () => await readInspection(readBy({ queue: 'trashed-asset', subjectId: trashed })),
			{ bo: 'Bo Diddley' },
		],
	])('%s', async (_case, read, names) => {
		expect((await read()).actorNames).toMatchObject(names);
	});
});
