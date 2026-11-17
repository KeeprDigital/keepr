import { getRouterParam } from 'h3';
import { answerAsActor } from '~~/server/utils/actorRoute';
import { cancelInvitation } from '~~/server/utils/invitations';

/** Cancels one of the Organisation's pending Invitations. */
export default defineEventHandler(
	async (event) =>
		await answerAsActor(event, async (database, actor) => {
			await cancelInvitation(database, actor, {
				organizationId: getRouterParam(event, 'organisationId') ?? '',
				invitationId: getRouterParam(event, 'invitationId') ?? '',
			});
			return { cancelled: true };
		}),
);
