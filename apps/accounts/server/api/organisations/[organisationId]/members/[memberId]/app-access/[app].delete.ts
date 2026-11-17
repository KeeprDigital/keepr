import { getRouterParam } from 'h3';
import { answerAsActor } from '~~/server/utils/actorRoute';
import { removeAppAccess } from '~~/server/utils/memberManagement';

/** Takes a member's access to one App away; they stay a member. */
export default defineEventHandler(
	async (event) =>
		await answerAsActor(event, async (database, actor) => {
			await removeAppAccess(database, actor, {
				organizationId: getRouterParam(event, 'organisationId') ?? '',
				memberId: getRouterParam(event, 'memberId') ?? '',
				app: getRouterParam(event, 'app') ?? '',
			});
			return { removed: true };
		}),
);
