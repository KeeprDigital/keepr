import type { ScreenResponse } from '~~/shared/api';
import type { FeatureMatchLayoutTemplateSummary } from '~~/shared/types/featureMatchLayoutTemplate';
import type { GraphicsIngestionOperation } from '../../shared/types/graphicsAsset';
import type { FeatureMatchLayoutConfig } from '../../shared/types/screenConfig';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectStream } from '../helpers/storedZipArchive';
import { $fetch, fetch, operatorSessionCookie } from './client';
import { expectResponseStatus } from './responseStatus';

// A four-Seat layout travels as a `.sklayout` Template Package: exported from a
// Commander Event's Screen, installed, listed as four-Seat, and placed on a
// Commander Event alone (ADR-0087, ADR-0080).

const runId = randomUUID().slice(0, 8);

describe('a four-Seat Template Package, end to end', () => {
	let cookie: string;
	let commander: { eventId: number; screenId: number };
	let twoPlayer: { eventId: number; screenId: number };
	let installedTemplateId: string;

	async function eventWithOverlayScreen(name: string, variant: 'commander' | 'two-player') {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: {
				name: `${name} ${runId}`,
				game: 'mtg',
				variant,
				featureMatchOrientation: 'horizontal',
			},
		});
		const screen = await $fetch<ScreenResponse>(`/api/events/${event.id}/screens`, {
			method: 'POST',
			body: { name, slug: `${variant}-overlay-${runId}`, currentMode: 'feature-match-overlay' },
		});
		return { eventId: event.id as number, screenId: screen.id };
	}

	async function storedLayout({ eventId, screenId }: { eventId: number; screenId: number }) {
		const screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens/${screenId}`);
		return screen.modeConfigs!['feature-match-overlay']!.layout as FeatureMatchLayoutConfig;
	}

	async function place({ eventId, screenId }: { eventId: number; screenId: number }, templateId: string) {
		const { stateVersion } = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens/${screenId}`);
		return await fetch(`/api/events/${eventId}/screens/${screenId}/feature-match-overlay/layout-placements`, {
			method: 'POST',
			headers: { 'cookie': cookie, 'content-type': 'application/json' },
			body: JSON.stringify({ templateId, stateVersion }),
		});
	}

	beforeAll(async () => {
		cookie = await operatorSessionCookie();
		commander = await eventWithOverlayScreen('Commander Package Overlay', 'commander');
		twoPlayer = await eventWithOverlayScreen('Two-Player Package Overlay', 'two-player');
		await expectResponseStatus(await place(commander, 'builtin:commander-table'), 201);
	});

	afterAll(async () => {
		for (const { eventId } of [commander, twoPlayer]) {
			try {
				await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
			}
			catch {}
		}
	});

	it('installs the Commander Table exported from a Commander Screen, and places it on a Commander Event alone', async () => {
		const placedLayout = await storedLayout(commander);
		const exported = await fetch(
			`/api/events/${commander.eventId}/screens/${commander.screenId}/template-packages/feature-match-layout`,
			{
				headers: { cookie },
			},
		);
		await expectResponseStatus(exported, 200);
		const archive = await collectStream(exported.body!);

		const initiated = await $fetch<GraphicsIngestionOperation>('/api/graphics-assets/ingestion-operations', {
			method: 'POST',
			headers: { cookie },
			body: {
				idempotencyKey: `commander-template-package-${runId}`,
				source: 'template-package',
				sourceFileName: 'commander-table.sklayout',
				declaredByteLength: archive.byteLength,
			},
		});
		const uploaded = await fetch(`/api/graphics-assets/ingestion-operations/${initiated.id}/content`, {
			method: 'PUT',
			headers: { cookie },
			body: archive,
		});
		await expectResponseStatus(uploaded, 200);
		const received = await uploaded.json() as GraphicsIngestionOperation;
		expect(received.stage).toBe('awaiting-installation');

		const completed = await $fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/ingestion-operations/${received.id}/template-package-installation`,
			{
				method: 'POST',
				headers: { cookie },
			},
		);
		expect(completed.stage).toBe('completed');
		installedTemplateId = completed.templatePackageInstallation!.templateId;

		const { templates } = await $fetch<{ templates: FeatureMatchLayoutTemplateSummary[] }>(
			'/api/graphics-templates/feature-match-layouts',
			{
				headers: { cookie },
			},
		);
		expect(templates.find(template => template.id === installedTemplateId)).toMatchObject({ fourSeat: true });

		const refused = await place(twoPlayer, installedTemplateId);
		expect(refused.status).toBe(409);
		await expectResponseStatus(await place(commander, installedTemplateId), 201);
		expect(await storedLayout(commander)).toEqual(placedLayout);
	});
});
