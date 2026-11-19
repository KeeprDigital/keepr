import { screenOutputAssetCapabilityManagerForEvent } from '~~/server/modules/screen-output-assets/runtime';
import { screenParamsSchema } from '~~/server/schemas/api/screen';
import { requireUserId } from '~~/server/utils/session';

export default defineEventHandler(async (event) => {
	await requireUserId(event);
	const { id: eventId, screenId } = await getValidatedRouterParams(event, screenParamsSchema.parse);
	const result = await screenOutputAssetCapabilityManagerForEvent(event).rotate({
		eventId,
		screenId,
	});
	if (result.outcome === 'missing') {
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Screen not found',
		});
	}
	setResponseHeader(event, 'cache-control', 'private, no-store');
	// `outputsClosed` false is still a regeneration: the page tells the Operator
	// what was left open, and to regenerate again (ADR-0142).
	return {
		assetCapability: result.capability,
		outputLink: result.link,
		outputsClosed: result.outputsClosed,
	};
});
