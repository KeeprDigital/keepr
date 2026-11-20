import { readBody } from 'h3';
import { answerRoute } from '~~/server/utils/actorRoute';
import { acceptInvitationSignedIn } from '~~/server/utils/invitationAcceptance';
import { textField } from '~~/server/utils/textField';

/** An invitee who has a User accepts, signed in with the invited address and holding the link's secret. */
export default defineEventHandler(async (event) => {
	const body = await readBody<{ invitationId?: unknown; secret?: unknown }>(event);
	return await answerRoute(event, async ({ auth, database, request }) => {
		await acceptInvitationSignedIn(
			auth,
			database,
			{ invitationId: textField(body?.invitationId), secret: textField(body?.secret) },
			request,
		);
		return { accepted: true };
	});
});
