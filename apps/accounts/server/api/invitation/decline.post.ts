import { readBody } from 'h3';
import { answerRoute } from '~~/server/utils/actorRoute';
import { declineInvitation } from '~~/server/utils/invitationAcceptance';
import { textField } from '~~/server/utils/textField';

/** The invitee declines, holding the link's secret, signed in or not. */
export default defineEventHandler(async (event) => {
	const body = await readBody<{ invitationId?: unknown; secret?: unknown }>(event);
	return await answerRoute(event, async ({ auth, database }) => {
		await declineInvitation(auth, database, {
			invitationId: textField(body?.invitationId),
			secret: textField(body?.secret),
		});
		return { declined: true };
	});
});
