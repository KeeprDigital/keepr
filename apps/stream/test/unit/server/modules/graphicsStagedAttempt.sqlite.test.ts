import type { InMemoryGraphicsStagingObjectStore } from '~~/server/modules/graphics-asset-library/object-store';
import type { SqliteD1Harness } from '@keepr/nuxt-layer/test/helpers/sqlite-d1';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import { createInMemoryStagingGraphicsObjectStore } from '~~/server/modules/graphics-asset-library/in-memory-object-store';
import {
	createBoundedByteStream,
	unavailableObjectStoreOutcome,
} from '~~/server/modules/graphics-asset-library/object-store';
import { createGraphicsRemoteSourceFetcher } from '~~/server/modules/graphics-asset-library/remote-source';
import { GRAPHICS_MULTIPART_PART_BYTES } from '~~/shared/utils/graphicsAssetCompatibility';
import { collectStream } from '~~/test/helpers/storedZipArchive';
import { digestOf, pixelPng, pngOfByteLength } from '~~/test/helpers/graphicsFixtures';
import {
	boundedBytes,
	createTestGraphicsIngestion,
	decodeEvidence,
	stagedSourceIdentity,
} from '~~/test/helpers/graphicsLibrary';
import { createSqliteD1Harness } from '@keepr/nuxt-layer/test/helpers/sqlite-d1';

// Bytes found at an operation's staging key are its source only when this attempt
// wrote them: an earlier attempt's bytes of the same length are not.

let harness: SqliteD1Harness;
beforeEach(async () => {
	harness = await createSqliteD1Harness();
});
afterEach(async () => await harness.close());

function ingestionOver(staging: InMemoryGraphicsStagingObjectStore) {
	return createTestGraphicsIngestion({
		catalogue: createD1GraphicsAssetCatalogue(harness.database),
		staging,
		identityPrefix: 'staged-attempt',
	}).ingestion;
}

/** What an earlier attempt of the operation left at its staging key. */
async function leaveEarlierBytes(
	staging: InMemoryGraphicsStagingObjectStore,
	operationId: string,
	bytes: Uint8Array,
) {
	await staging.createImmutable({
		identity: stagedSourceIdentity(operationId),
		bytes: boundedBytes(bytes),
		metadata: { contentType: 'application/octet-stream', custom: { operationId } },
	});
}

describe('bytes already at a staging key', () => {
	it('are replaced, not adopted, by a single-request upload', async () => {
		const staging = createInMemoryStagingGraphicsObjectStore();
		const ingestion = ingestionOver(staging);
		const bytes = pixelPng;
		const earlier = new Uint8Array(bytes.byteLength).fill(7);
		const operation = await ingestion.initiateGraphicsIngestion({
			idempotencyKey: 'replaced-earlier-bytes',
			initiatedBy: 'graphics-author-1',
			name: 'Fresh',
			declaredMime: 'image/png',
			browserDecodeEvidence: decodeEvidence(bytes),
			declaredByteLength: bytes.byteLength,
		});
		await leaveEarlierBytes(staging, operation.id, earlier);

		const uploaded = await ingestion.uploadGraphicAsset({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			declaredMime: 'image/png',
			bytes: boundedBytes(bytes),
		});

		expect(uploaded).toMatchObject({
			stage: 'completed',
			report: { facts: { sha256: digestOf(bytes) } },
		});
	});

	it('are replaced, not adopted, by an approved remote copy of a declared length', async () => {
		const staging = createInMemoryStagingGraphicsObjectStore();
		const { ingestion } = createTestGraphicsIngestion({
			catalogue: createD1GraphicsAssetCatalogue(harness.database),
			staging,
			identityPrefix: 'staged-attempt-remote',
			remoteSource: createGraphicsRemoteSourceFetcher({
				resolver: { resolve: async () => ({ outcome: 'resolved', addresses: ['93.184.216.34'] }) },
				fetch: async () =>
					new Response(pixelPng, { headers: { 'content-length': String(pixelPng.byteLength) } }),
			}),
		});
		const operation = await ingestion.initiateRemoteGraphicAssetCopy({
			idempotencyKey: 'remote-replaced-earlier-bytes',
			initiatedBy: 'graphics-author-1',
			name: 'Remote',
			sourceFileName: 'remote.png',
		});
		await leaveEarlierBytes(staging, operation.id, new Uint8Array(pixelPng.byteLength).fill(7));

		await ingestion.copyRemoteGraphicAssetSource({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			sourceUrl: 'https://cdn.example.test/remote.png',
		});

		const staged = await staging.read(stagedSourceIdentity(operation.id));
		if (staged.outcome !== 'available') throw new Error('expected staged bytes');
		expect(digestOf(await collectStream(staged.body))).toBe(digestOf(pixelPng));
	});

	it.each([
		{ found: 'its own completed upload', earlier: false, completes: true },
		{ found: 'an earlier attempt’s bytes', earlier: true, completes: false },
	])(
		'are adopted after an ambiguous multipart completion only when they are $found',
		async ({ earlier, completes }) => {
			const delegate = createInMemoryStagingGraphicsObjectStore();
			const bytes = pngOfByteLength(GRAPHICS_MULTIPART_PART_BYTES + 1);
			const staging: InMemoryGraphicsStagingObjectStore = {
				...delegate,
				async completeMultipart(input) {
					if (earlier) {
						await leaveEarlierBytes(delegate, operation.id, bytes);
						return unavailableObjectStoreOutcome();
					}
					await delegate.completeMultipart(input);
					return unavailableObjectStoreOutcome();
				},
			};
			const ingestion = ingestionOver(staging);
			const operation = await ingestion.initiateGraphicsIngestion({
				idempotencyKey: `ambiguous-completion-${earlier}`,
				initiatedBy: 'graphics-author-1',
				name: 'Large',
				declaredMime: 'image/png',
				browserDecodeEvidence: decodeEvidence(bytes),
				declaredByteLength: bytes.byteLength,
			});
			const owner = { operationId: operation.id, initiatedBy: operation.initiatedBy };
			await ingestion.startGraphicAssetMultipartUpload(owner);
			for (const [index, part] of [
				bytes.subarray(0, GRAPHICS_MULTIPART_PART_BYTES),
				bytes.subarray(GRAPHICS_MULTIPART_PART_BYTES),
			].entries()) {
				await ingestion.uploadGraphicAssetMultipartPart({
					...owner,
					partNumber: index + 1,
					bytes: createBoundedByteStream(part, {
						byteLength: part.byteLength,
						maximumByteLength: GRAPHICS_MULTIPART_PART_BYTES,
					}),
				});
			}

			const completing = ingestion.completeGraphicAssetMultipartUpload(owner);

			if (completes) await expect(completing).resolves.toMatchObject({ stage: 'completed' });
			else
				await expect(completing).rejects.toMatchObject({
					code: 'graphics-asset-library-unavailable',
				});
		},
	);
});
