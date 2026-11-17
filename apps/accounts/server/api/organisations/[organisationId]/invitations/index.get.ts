import { getRouterParam } from 'h3';
import { answerAsActor } from '~~/server/utils/actorRoute';
import { listPendingInvitations } from '~~/server/utils/invitations';

/** The Organisation's pending Invitations, to whoever manages its members. */
export default defineEventHandler(
	async (event) =>
		await answerAsActor(
			event,
			async (database, actor) =>
				await listPendingInvitations(database, actor, getRouterParam(event, 'organisationId') ?? ''),
		),
);
