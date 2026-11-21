import { findBroadcastGraphicTemplateLibraryEntry } from '~~/server/modules/broadcast-graphic-template-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { screenWriteModule } from '~~/server/modules/screen-write';
import { placeBroadcastGraphicTemplateSchema } from '~~/server/schemas/api/broadcastGraphicTemplate';
import { screenParamsSchema } from '~~/server/schemas/api/screen';
import { screenService } from '~~/server/services/screen';
import { getOriginConnectionId } from '~~/server/utils/realtimePublish';
import { optionalBrowserSessionId } from '~~/server/utils/session';
import { placeBroadcastGraphicTemplate } from '~~/shared/modules/graphics';
import { templatePlacementError } from '~~/server/utils/templatePlacementError';
import { randomUuid } from '~~/shared/utils/uuid';

/**
 * Place a Broadcast Graphic Template on this Screen as a fully unlinked copy.
 *
 * Placement happens here rather than in the client for two reasons that are really
 * one: the copy has to be *the* copy. The server reads the template, builds the
 * Broadcast Graphic, and writes it through the Screen's ordinary mode-configuration
 * write path — so the placed graphic is validated by the same schema, counted
 * against the same Screen-wide Graphic Item and Graphic Input caps, indexed into the
 * same Graphic Asset Reference index, and published by the same notification as a
 * hand-authored one. A placement is an authoring action that produces nothing
 * special, which is precisely what "unlinked copy" has to mean.
 *
 * The write is admitted by the Screen's graphics Edit workspace lease, not by the
 * template's: placing reads a template and writes a Screen, so two authors may
 * place the same template at the same instant.
 */
export default defineEventHandler(async (event) => {
	const { id: eventId, screenId } = await getValidatedRouterParams(event, screenParamsSchema.parse);
	const body = placeBroadcastGraphicTemplateSchema.parse((await readBody(event)) ?? {});

	const screen = await screenService().findById(screenId, eventId);
	if (!screen)
		throw createError({ statusCode: 404, statusMessage: 'Not Found', message: 'Screen not found' });

	// A Broadcast Graphic Template initializes a copy of a Broadcast Graphic on a
	// Broadcast Graphics Screen. Placing one anywhere else would author a stack the
	// Screen does not compose and no output would ever show.
	if (screen.currentMode !== 'broadcast-graphics') {
		throw createError({
			statusCode: 409,
			statusMessage: 'Conflict',
			message: 'Screen is not in Broadcast Graphics mode',
		});
	}

	// Resolved from the library as a whole. A design a Template Package installed is
	// placed by exactly this path — its document already names local Graphic Asset
	// identities and revisions, so there is nothing about it for placement to treat
	// differently.
	const template = await findBroadcastGraphicTemplateLibraryEntry(event, body.templateId);
	if (!template) {
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Broadcast Graphic Template not found',
		});
	}

	const existing = screen.modeConfigs?.['broadcast-graphics']?.graphics ?? [];
	// Kept so a failure about a placed Graphic Item can be reported against the
	// template Graphic Item an author can actually go and look at.
	const idMap = new Map<string, string>();
	const graphic = placeBroadcastGraphicTemplate(
		{ id: template.id, name: template.name, document: template.document },
		{ generateId: randomUuid, existing, idMap },
	);

	try {
		const updated = await screenWriteModule().updateModeConfig({
			eventId,
			screenId,
			mode: 'broadcast-graphics',
			graphicsAssets: () => graphicsAssetLibraryForEvent(event),
			// The copy joins the front of the Graphic Layer Order, where a newly authored
			// Broadcast Graphic also lands.
			config: {
				graphics: [...existing, graphic],
			},
			stateVersion: body.stateVersion,
			originConnectionId: getOriginConnectionId(event),
			authoringSessionId: await optionalBrowserSessionId(event),
		});

		setResponseStatus(event, 201);
		return { screen: updated, graphic };
	} catch (error) {
		throw templatePlacementError(error, {
			artifact: 'Broadcast Graphic Template',
			templateName: template.name,
			placedToTemplateIds: new Map([
				[graphic.id, template.document.id],
				...[...idMap].map(
					([templateItemId, placedItemId]) => [placedItemId, templateItemId] as const,
				),
			]),
		});
	}
});
