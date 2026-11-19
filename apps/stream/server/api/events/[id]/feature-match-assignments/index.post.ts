import { featureMatchAssignmentModule } from '~~/server/modules/feature-match-assignment';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { createFeatureMatchAssignmentSchema } from '~~/server/schemas/api/featureMatchAssignment';
import { getOriginConnectionId } from '~~/server/utils/realtimePublish';

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);
	const input = await readValidatedBody(event, createFeatureMatchAssignmentSchema.parse);
	return await featureMatchAssignmentModule().save(id, input, getOriginConnectionId(event));
});
