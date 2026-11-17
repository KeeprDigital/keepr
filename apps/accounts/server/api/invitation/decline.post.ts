import { readBody } from 'h3';
import { answerRoute } from '~~/server/utils/actorRoute';
import { declineInvitation } from '~~/server/utils/invitationAcceptance';
import { textField } from '~~/server/utils/textField';

/** The invitee declines, from the Invitation's link, signed in or not. */
export default defineEventHandler(async (event) => {
	const body = await readBody<{ invitationId?: unknown }>(event);
	return await answerRoute(event, async ({ auth, database, request }) => {
		await declineInvitation(auth, database, textField(body?.invitationId), request);
		return { declined: true };
	});
});
