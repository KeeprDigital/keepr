import { getRouterParam, readBody } from 'h3';
import { answerAsActor } from '~~/server/utils/actorRoute';
import { changeOrganisationRole } from '~~/server/utils/memberManagement';
import { textField } from '~~/server/utils/refusal';

/** Changes a member's Organisation role. */
export default defineEventHandler(async (event) => {
	const body = await readBody<{ role?: unknown }>(event);
	return await answerAsActor(event, async (database, actor) => {
		await changeOrganisationRole(database, actor, {
			organizationId: getRouterParam(event, 'organisationId') ?? '',
			memberId: getRouterParam(event, 'memberId') ?? '',
			role: textField(body?.role),
		});
		return { changed: true };
	});
});
