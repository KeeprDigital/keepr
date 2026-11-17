import { getRouterParam } from 'h3';
import { answerAsActor } from '~~/server/utils/actorRoute';
import { listMembers } from '~~/server/utils/memberManagement';

/** The Organisation's members, with their Organisation role and App roles. */
export default defineEventHandler(
	async (event) =>
		await answerAsActor(
			event,
			async (database, actor) =>
				await listMembers(database, actor, getRouterParam(event, 'organisationId') ?? ''),
		),
);
