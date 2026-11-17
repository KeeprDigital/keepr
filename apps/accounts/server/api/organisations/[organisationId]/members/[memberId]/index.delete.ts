import { getRouterParam } from 'h3';
import { answerAsActor } from '~~/server/utils/actorRoute';
import { removeMember } from '~~/server/utils/memberManagement';

/** Removes a member from the Organisation, with all their App access. */
export default defineEventHandler(
	async (event) =>
		await answerAsActor(event, async (database, actor) => {
			await removeMember(database, actor, {
				organizationId: getRouterParam(event, 'organisationId') ?? '',
				memberId: getRouterParam(event, 'memberId') ?? '',
			});
			return { removed: true };
		}),
);
