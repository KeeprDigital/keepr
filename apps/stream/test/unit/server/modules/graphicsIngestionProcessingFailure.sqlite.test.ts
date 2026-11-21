import type { SqliteD1Harness } from '@keepr/nuxt-layer/test/helpers/sqlite-d1';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import { pixelPng } from '~~/test/helpers/graphicsFixtures';
import {
	boundedBytes,
	createTestGraphicsIngestion,
	decodeEvidence,
} from '~~/test/helpers/graphicsLibrary';
import { createSqliteD1Harness } from '@keepr/nuxt-layer/test/helpers/sqlite-d1';

// A failure processing could not classify is logged, and one that recurs on every
// retry stops being offered for retry. The catalogue is real; one of its writes is
// made to throw as an unforeseen defect would.

let harness: SqliteD1Harness;
beforeEach(async () => {
	harness = await createSqliteD1Harness();
});
afterEach(async () => await harness.close());

function failingIngestion() {
	const catalogue = createD1GraphicsAssetCatalogue(harness.database);
	return createTestGraphicsIngestion({
		catalogue: {
			...catalogue,
			reserveGraphicAssetPublication: async () => {
				throw new TypeError('Cannot read properties of undefined');
			},
		},
		identityPrefix: 'processing-failure',
	}).ingestion;
}

describe('an unexpected failure during ingestion processing', () => {
	it('is logged, retryable at first, and not retried once it has recurred', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const ingestion = failingIngestion();
		const operation = await ingestion.initiateGraphicsIngestion({
			idempotencyKey: 'always-fails',
			initiatedBy: 'graphics-author-1',
			name: 'Always fails',
			declaredMime: 'image/png',
			browserDecodeEvidence: decodeEvidence(pixelPng),
			declaredByteLength: pixelPng.byteLength,
		});
		const owner = { operationId: operation.id, initiatedBy: operation.initiatedBy };

		const first = await ingestion.uploadGraphicAsset({
			...owner,
			declaredMime: 'image/png',
			bytes: boundedBytes(pixelPng),
		});
		const second = await ingestion.retryGraphicsIngestion(owner);
		const third = await ingestion.retryGraphicsIngestion(owner);

		expect([first, second, third].map(({ stage, failure }) => [stage, failure?.retryable])).toEqual(
			[
				['failed', true],
				['failed', true],
				['failed', false],
			],
		);
		expect(third.failure).toMatchObject({ code: 'ingestion-processing-failed', attempts: 3 });
		await expect(ingestion.retryGraphicsIngestion(owner)).rejects.toMatchObject({
			code: 'ingestion-operation-not-uploadable',
		});
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('"message":"graphics_ingestion_processing_failed"'),
		);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('"errorName":"TypeError"'));
	});
});
