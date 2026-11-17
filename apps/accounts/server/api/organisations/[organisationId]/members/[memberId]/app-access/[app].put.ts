import { getRouterParam, readBody } from 'h3';
import { answerAsActor } from '~~/server/utils/actorRoute';
import { setAppAccess } from '~~/server/utils/memberManagement';
import { textField } from '~~/server/utils/refusal';

/** Gives a member an App role in one App, in place of any they held there. */
export default defineEventHandler(async (event) => {
	const body = await readBody<{ role?: unknown }>(event);
	return await answerAsActor(event, async (database, actor) => {
		await setAppAccess(database, actor, {
			organizationId: getRouterParam(event, 'organisationId') ?? '',
			memberId: getRouterParam(event, 'memberId') ?? '',
			app: getRouterParam(event, 'app') ?? '',
			role: textField(body?.role),
		});
		return { set: true };
	});
});
