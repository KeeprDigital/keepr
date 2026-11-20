import type {
	GraphicAsset,
	GraphicAssetPurgeOutcome,
	GraphicAssetRetentionView,
	GraphicsAssetEvidencePage,
	GraphicsAssetEvidenceReading,
	GraphicsIngestionOperation,
	GraphicsRetentionOverview,
	GraphicsRetentionSweepResult,
} from '~~/shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
	GRAPHICS_EVIDENCE_CATEGORY_GROUP_VALUES,
	GRAPHICS_EVIDENCE_CATEGORY_GROUPS,
} from '../../shared/utils/graphicsAssetEvidence';
import { GRAPHICS_RETENTION_GUARANTEES } from '../../shared/utils/graphicsAssetRetention';
import { $fetch, fetch, operatorSessionCookie } from './client';
import { graphicsIngestionRequest } from './graphicsIngestionRequest';
import { anotherUser, aUserWithoutTheRole } from './identities';
import { expectOperationResult } from './responseStatus';

const transparentPixelPng = Uint8Array.from(
	Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
		'base64',
	),
);
const emptyTextChunk = Uint8Array.of(0, 0, 0, 0, 0x74, 0x45, 0x58, 0x74, 0x96, 0x42, 0xc5, 0x85);

/**
 * Integration suites share one database, and identical bytes deduplicate across
 * Graphic Assets by design. Padding each fixture with a chunk count no other
 * suite uses keeps this suite's content digests to itself.
 */
function pngWithTextChunks(count: number) {
	return Uint8Array.from(
		Buffer.concat([
			transparentPixelPng.slice(0, -12),
			...(Array.from({ length: count }).fill(emptyTextChunk) as Uint8Array[]),
			transparentPixelPng.slice(-12),
		]),
	);
}

const retentionPixelPng = pngWithTextChunks(30);
const retentionReplacementPng = pngWithTextChunks(31);

function decodeEvidence(bytes: Uint8Array) {
	return {
		outcome: 'decoded' as const,
		sourceDigest: createHash('sha256').update(bytes).digest('hex'),
		width: 1,
		height: 1,
	};
}

describe('the Graphics Asset Library retention API', () => {
	let authorHeaders: Record<string, string>;

	beforeAll(async () => {
		authorHeaders = { cookie: await operatorSessionCookie() };
	});

	async function ingest(name: string, idempotencyKey: string, bytes = retentionPixelPng) {
		const initiated = await $fetch<GraphicsIngestionOperation>(
			'/api/graphics-assets/ingestion-operations',
			{
				method: 'POST',
				headers: authorHeaders,
				body: graphicsIngestionRequest({
					idempotencyKey,
					name,
					sourceFileName: 'logo.png',
					declaredMime: 'image/png',
					browserDecodeEvidence: decodeEvidence(bytes),
					declaredByteLength: bytes.byteLength,
				}),
			},
		);
		return await fetch(`/api/graphics-assets/ingestion-operations/${initiated.id}/content`, {
			method: 'PUT',
			headers: { ...authorHeaders, 'content-type': 'image/png' },
			body: bytes,
		}).then(expectOperationResult);
	}

	async function replace(assetId: string, idempotencyKey: string) {
		const initiated = await $fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/${assetId}/replacement-operations`,
			{
				method: 'POST',
				headers: authorHeaders,
				body: {
					idempotencyKey,
					sourceFileName: 'replacement.png',
					declaredMime: 'image/png',
					browserDecodeEvidence: decodeEvidence(retentionReplacementPng),
					declaredByteLength: retentionReplacementPng.byteLength,
				},
			},
		);
		return await fetch(`/api/graphics-assets/ingestion-operations/${initiated.id}/content`, {
			method: 'PUT',
			headers: { ...authorHeaders, 'content-type': 'image/png' },
			body: retentionReplacementPng,
		}).then(expectOperationResult);
	}

	it('keeps retention deadlines on the administrator surface', async () => {
		const cookie = await aUserWithoutTheRole('retention-1293-no-role');
		const overview = await fetch('/api/admin/graphics-assets/retention', { headers: { cookie } });
		expect(overview.status).toBe(403);
		const sweep = await fetch('/api/admin/graphics-assets/retention', {
			method: 'POST',
			headers: { cookie },
		});
		expect(sweep.status).toBe(403);
		const evidence = await fetch('/api/admin/graphics-assets/evidence', { headers: { cookie } });
		expect(evidence.status).toBe(403);
	});

	it('exposes exact recovery and cleanup deadlines without shortening them', async () => {
		const operation = await ingest('Retention deadline logo', 'retention-deadlines');
		const assetId = operation.result!.assetId;
		const replacement = await replace(assetId, 'retention-deadlines-replacement');

		const superseded = await $fetch<GraphicAssetRetentionView>(
			`/api/graphics-assets/${assetId}/retention`,
			{ headers: authorHeaders },
		);
		expect(superseded).toMatchObject({
			assetId,
			lifecycle: { state: 'active' },
			revisions: [
				{
					revisionId: operation.result!.revisionId,
					revisionNumber: 1,
					retention: {
						policy: 'unreferenced-superseded',
						pruneAfter: expect.any(String),
						unreferencedSince: expect.any(String),
					},
				},
				{
					revisionId: replacement.result!.revisionId,
					revisionNumber: 2,
					retention: { policy: 'latest-revision' },
				},
			],
		});
		const supersededRetention = superseded.revisions[0]!.retention;
		if (supersededRetention.policy !== 'unreferenced-superseded')
			throw new Error('Superseded revision should carry a pruning deadline');
		expect(
			new Date(supersededRetention.pruneAfter).getTime() -
				new Date(supersededRetention.unreferencedSince).getTime(),
		).toBe(GRAPHICS_RETENTION_GUARANTEES.supersededRevisionMilliseconds);

		await $fetch(`/api/graphics-assets/${assetId}/lifecycle-actions`, {
			method: 'POST',
			headers: authorHeaders,
			body: { action: 'trash' },
		});
		const trashed = await $fetch<GraphicAssetRetentionView>(
			`/api/graphics-assets/${assetId}/retention`,
			{ headers: authorHeaders },
		);
		if (trashed.lifecycle.state !== 'trashed') throw new Error('Graphic Asset should be Trashed');
		expect(
			new Date(trashed.lifecycle.recoverableUntil).getTime() -
				new Date(trashed.lifecycle.trashedAt).getTime(),
		).toBe(GRAPHICS_RETENTION_GUARANTEES.trashRecoveryMilliseconds);
		expect(trashed.revisions[0]!.retention).toMatchObject({ policy: 'pruning-frozen' });

		const overview = await $fetch<GraphicsRetentionOverview>(
			'/api/admin/graphics-assets/retention',
		);
		expect(overview.guarantees).toEqual({ ...GRAPHICS_RETENTION_GUARANTEES });
		expect(overview.guaranteesShortenedUnderPressure).toBe(false);
		expect(overview.trashedAssets).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					assetId,
					recoverableUntil: trashed.lifecycle.recoverableUntil,
					referenceCount: 0,
				}),
			]),
		);

		// A sweep at ordinary time reclaims nothing whose window is still open.
		const swept = await $fetch<GraphicsRetentionSweepResult>(
			'/api/admin/graphics-assets/retention',
			{ method: 'POST' },
		);
		expect(swept.trash.purged).toBe(0);
		expect(swept.revisions.pruned).toBe(0);
		expect(swept.stagedInput).toEqual({
			expiredIncompleteTransfers: 0,
			expiredCompletedInput: 0,
		});
		await expect(
			$fetch<GraphicAssetRetentionView>(`/api/graphics-assets/${assetId}/retention`, {
				headers: authorHeaders,
			}),
		).resolves.toMatchObject({
			lifecycle: { state: 'trashed' },
		});

		// Restore so this asset does not affect the other cases.
		await $fetch(`/api/graphics-assets/${assetId}/lifecycle-actions`, {
			method: 'POST',
			headers: authorHeaders,
			body: { action: 'restore' },
		});
	});

	it('purges confirmed unreferenced Trash early and records auditable Evidence', async () => {
		const operation = await ingest('Early purge logo', 'retention-early-purge');
		const assetId = operation.result!.assetId;

		const unconfirmed = await fetch(`/api/admin/graphics-assets/${assetId}/purge`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ confirmation: 'yes' }),
		});
		expect(unconfirmed.status).toBe(400);

		const active = await fetch(`/api/admin/graphics-assets/${assetId}/purge`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ confirmation: 'purge-now' }),
		});
		expect(active.status).toBe(409);

		await $fetch(`/api/graphics-assets/${assetId}/lifecycle-actions`, {
			method: 'POST',
			headers: authorHeaders,
			body: { action: 'trash' },
		});
		const purged = await $fetch<GraphicAssetPurgeOutcome>(
			`/api/admin/graphics-assets/${assetId}/purge`,
			{
				method: 'POST',
				body: { confirmation: 'purge-now' },
			},
		);
		expect(purged).toMatchObject({
			outcome: 'purged',
			assetId,
			revisionCount: 1,
			referenceCount: 0,
			reason: 'early-purge',
		});

		await expect(
			$fetch<GraphicAsset[]>('/api/graphics-assets', {
				headers: authorHeaders,
				query: { search: 'Early purge logo', lifecycleStates: 'active,retired,trashed' },
			}),
		).resolves.toEqual([]);
		const restored = await fetch(`/api/graphics-assets/${assetId}/lifecycle-actions`, {
			method: 'POST',
			headers: { ...authorHeaders, 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'restore' }),
		});
		expect(restored.status).toBe(404);

		const evidence = await $fetch<GraphicsAssetEvidencePage>(
			'/api/admin/graphics-assets/evidence',
			{
				query: { category: 'graphic-asset-purged' },
			},
		);
		expect(evidence.entries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					category: 'graphic-asset-purged',
					subject: { kind: 'graphic-asset', id: assetId },
					outcome: 'graphic-asset-purged',
					reason: 'early-purge',
				}),
			]),
		);
	});

	// Wiring, through the Worker's own connection to Keepr Accounts, which the
	// Accounts Stand-in answers: whose name is told is Keepr Accounts' rule (ADR-0145).
	it('names another Graphics Administrator to the one reading the ledger', async () => {
		const purger = 'retention-1341-purger';
		const { assetId } = (await ingest('Named purge logo', 'retention-named-purge')).result!;
		await $fetch(`/api/graphics-assets/${assetId}/lifecycle-actions`, {
			method: 'POST',
			headers: authorHeaders,
			body: { action: 'trash' },
		});
		await $fetch<GraphicAssetPurgeOutcome>(`/api/admin/graphics-assets/${assetId}/purge`, {
			method: 'POST',
			headers: { cookie: await anotherUser(purger) },
			body: { confirmation: 'purge-now' },
		});

		const ledger = await $fetch<GraphicsAssetEvidenceReading>(
			'/api/admin/graphics-assets/evidence',
			{ query: { actor: purger } },
		);

		expect(ledger.entries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ actor: purger, subject: { kind: 'graphic-asset', id: assetId } }),
			]),
		);
		expect(ledger.actorNames[purger]).toBe(`Integration ${purger}`);
	});

	it('reads the ledger by group, actor, correlation, and cursor', async () => {
		const page = await $fetch<GraphicsAssetEvidencePage>('/api/admin/graphics-assets/evidence', {
			query: { group: 'lifecycle', limit: 1 },
		});
		expect(page.entries).toHaveLength(1);
		const entry = page.entries[0]!;
		// A group names a set of categories, so the entry it found is one of them
		// rather than whatever happened to be newest.
		expect(GRAPHICS_EVIDENCE_CATEGORY_GROUPS.lifecycle as readonly string[]).toContain(
			entry.category,
		);
		expect(page.newer).toBeNull();
		expect(page.older).toEqual({ recordedAt: entry.recordedAt, id: entry.id });

		// Turning one page and coming back lands on the entry it started from,
		// which an offset that shifted under a concurrent sweep would not.
		const older = await $fetch<GraphicsAssetEvidencePage>('/api/admin/graphics-assets/evidence', {
			query: {
				group: 'lifecycle',
				limit: 1,
				cursorRecordedAt: page.older!.recordedAt,
				cursorId: page.older!.id,
			},
		});
		expect(older.entries[0]!.id).not.toBe(entry.id);
		const back = await $fetch<GraphicsAssetEvidencePage>('/api/admin/graphics-assets/evidence', {
			query: {
				group: 'lifecycle',
				limit: 1,
				direction: 'newer',
				cursorRecordedAt: older.newer!.recordedAt,
				cursorId: older.newer!.id,
			},
		});
		expect(back.entries[0]!.id).toBe(entry.id);

		await expect(
			$fetch<GraphicsAssetEvidencePage>('/api/admin/graphics-assets/evidence', {
				query: { actor: entry.actor, limit: 5 },
			}),
		).resolves.toMatchObject({
			entries: expect.arrayContaining([expect.objectContaining({ actor: entry.actor })]),
		});
		const correlated = await $fetch<GraphicsAssetEvidencePage>(
			'/api/admin/graphics-assets/evidence',
			{
				query: { correlationId: entry.correlationId, limit: 50 },
			},
		);
		expect(correlated.entries.length).toBeGreaterThan(0);
		for (const correlatedEntry of correlated.entries)
			expect(correlatedEntry.correlationId).toBe(entry.correlationId);

		// Half a subject filter and half a cursor are both refused, because each
		// would answer a different question from the one that was asked.
		expect(
			(await fetch('/api/admin/graphics-assets/evidence?subjectKind=graphic-asset', {})).status,
		).toBe(400);
		expect((await fetch('/api/admin/graphics-assets/evidence?cursorId=entry', {})).status).toBe(
			400,
		);
		expect((await fetch('/api/admin/graphics-assets/evidence?group=not-a-group', {})).status).toBe(
			400,
		);
	});

	it('never stores or displays anything the ledger promised to keep out', async () => {
		// Read the ledger this suite has already written. The cases above retire,
		// Trash, restore, replace, and purge, so several category groups are
		// present without this test adding churn of its own to a database every
		// integration suite shares.
		//
		// Quarantine and ingestion expiry are absent on purpose: both need days
		// to elapse, which only the controlled-clock module tests can offer.
		const page = await $fetch<GraphicsAssetEvidencePage>('/api/admin/graphics-assets/evidence', {
			query: { limit: 500 },
		});
		expect(page.entries.length).toBeGreaterThan(0);
		const covered = new Set(
			page.entries.flatMap((entry) =>
				GRAPHICS_EVIDENCE_CATEGORY_GROUP_VALUES.filter((group) =>
					(GRAPHICS_EVIDENCE_CATEGORY_GROUPS[group] as readonly string[]).includes(entry.category),
				),
			),
		);
		for (const group of ['lifecycle', 'pruning', 'purge', 'restoration'] as const)
			expect([...covered], `no Evidence from the ${group} group`).toContain(group);

		const serialised = JSON.stringify(page);
		// Source filenames, raw object keys and canonical prefixes, digests, and
		// delivery or signed URLs. Subjects are opaque domain identities, so none
		// of these has any reason to appear even inside a detail payload.
		for (const forbidden of [
			'logo.png',
			'.png',
			'sha256/',
			'graphics/',
			'staging/',
			'http://',
			'https://',
			'X-Amz-Signature',
		])
			expect(serialised, `leaked ${forbidden}`).not.toContain(forbidden);

		// A digest is 64 hex characters; nothing in the ledger may look like one.
		expect(serialised).not.toMatch(/[0-9a-f]{64}/);
		// Nor may anything report bytes that were deleted as recoverable content.
		for (const entry of page.entries) {
			expect(Object.keys(entry.detail)).not.toContain('digest');
			expect(Object.keys(entry.detail)).not.toContain('objectKey');
			expect(Object.keys(entry.detail)).not.toContain('fileName');
			expect(Object.keys(entry.detail)).not.toContain('url');
		}
	});
});
