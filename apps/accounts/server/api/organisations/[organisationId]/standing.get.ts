import { getRouterParam } from 'h3';
import { answerAsActor } from '~~/server/utils/actorRoute';
import { managingStanding } from '~~/server/utils/memberManagement';

/** Whether the signed-in User manages this Organisation's members, and as what. */
export default defineEventHandler(
	async (event) =>
		await answerAsActor(
			event,
			async (database, actor) =>
				await managingStanding(database, actor, getRouterParam(event, 'organisationId') ?? ''),
		),
);
