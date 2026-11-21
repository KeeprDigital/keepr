import { findFeatureMatchLayoutTemplateLibraryEntry } from '~~/server/modules/feature-match-layout-template-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { screenWriteModule } from '~~/server/modules/screen-write';
import { placeFeatureMatchLayoutTemplateSchema } from '~~/server/schemas/api/featureMatchLayoutTemplate';
import { screenParamsSchema } from '~~/server/schemas/api/screen';
import { eventService } from '~~/server/services/event';
import { screenService } from '~~/server/services/screen';
import { getOriginConnectionId } from '~~/server/utils/realtimePublish';
import { optionalBrowserSessionId } from '~~/server/utils/session';
import { templatePlacementError } from '~~/server/utils/templatePlacementError';
import { eventKind } from '~~/shared/config/games';
import {
	isFeatureMatchLayoutOfferedTo,
	isFourSeatFeatureMatchLayout,
} from '~~/shared/featureMatchLayoutSeats';

/**
 * Place a Feature Match Layout Template on this Screen as a fully unlinked copy.
 *
 * ## Why placing replaces rather than adds
 *
 * A Feature Match Overlay renders exactly one Feature Match Layout, so there is no
 * stack to append to and no ordering decision to make. Placing a layout template
 * replaces the Frame, the Source Items, and the composition together — all three or
 * none, because a Frame from one design under Source Items from another is not a
 * layout anybody authored. What survives is everything that was never part of the
 * layout: the Screen's Feature Match Slot assignment, its canvas size, and its live
 * session all belong to the Screen and are untouched.
 *
 * A built-in template is placed by this path like any other, and nothing records
 * which template a layout came from.
 *
 * ## Why it happens here rather than in the client
 *
 * The copy has to be *the* copy. The server reads the template and writes it through
 * the Screen's ordinary mode-configuration write path, so the placed layout is
 * validated by the same schema, capped the same way, indexed into the same Graphic
 * Asset Reference index, and published by the same notification as a hand-authored
 * one. A placement is an authoring action that produces nothing special, which is
 * what "unlinked copy" has to mean.
 *
 * The write is admitted and fenced by the Screen's graphics Edit workspace lease,
 * in the Screen write module (ADR-0030), not by the template's: placing reads a
 * template and writes a Screen.
 */
export default defineEventHandler(async (event) => {
	const { id: eventId, screenId } = await getValidatedRouterParams(event, screenParamsSchema.parse);
	const body = placeFeatureMatchLayoutTemplateSchema.parse((await readBody(event)) ?? {});

	const screen = await screenService().findById(screenId, eventId);
	if (!screen)
		throw createError({ statusCode: 404, statusMessage: 'Not Found', message: 'Screen not found' });

	// A Feature Match Layout Template initialises the layout a Feature Match Overlay
	// renders. Placing one anywhere else would author a layout the Screen does not
	// render and no output would ever show.
	if (screen.currentMode !== 'feature-match-overlay') {
		throw createError({
			statusCode: 409,
			statusMessage: 'Conflict',
			message: 'Screen is not in Feature Match Overlay mode',
		});
	}

	// Resolved from the library as a whole. A layout a Template Package installed is
	// placed by exactly this path — its document already names local Graphic Asset
	// identities and revisions, so there is nothing about it for placement to treat
	// differently.
	const template = await findFeatureMatchLayoutTemplateLibraryEntry(event, body.templateId);
	if (!template) {
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Feature Match Layout Template not found',
		});
	}

	// A four-Seat template is a Commander Event's alone, and every other template
	// every other Event's: its content decides (ADR-0087).
	const eventData = await eventService().findById(eventId);
	if (!eventData)
		throw createError({ statusCode: 404, statusMessage: 'Not Found', message: 'Event not found' });
	if (!isFeatureMatchLayoutOfferedTo(template.document, eventKind(eventData))) {
		throw createError({
			statusCode: 409,
			statusMessage: 'Conflict',
			message: isFourSeatFeatureMatchLayout(template.document)
				? `"${template.name}" is a four-Seat template, offered to Commander Events alone`
				: `"${template.name}" is not a four-Seat template, and a Commander Event is offered those alone`,
		});
	}

	// Deep-copied so nothing the Screen later carries can alias the library entry
	// this request happened to read.
	const layout = structuredClone(template.document);

	try {
		const updated = await screenWriteModule().updateModeConfig({
			eventId,
			screenId,
			mode: 'feature-match-overlay',
			config: { layout },
			graphicsAssets: () => graphicsAssetLibraryForEvent(event),
			stateVersion: body.stateVersion,
			originConnectionId: getOriginConnectionId(event),
			authoringSessionId: await optionalBrowserSessionId(event),
		});

		setResponseStatus(event, 201);
		return { screen: updated, layout };
	} catch (error) {
		throw templatePlacementError(error, {
			artifact: 'Feature Match Layout Template',
			templateName: template.name,
		});
	}
});
