import { appendResponseHeader, readBody } from 'h3';
import { answerRoute } from '~~/server/utils/actorRoute';
import { acceptInvitationAsNewUser } from '~~/server/utils/invitationAcceptance';
import { textField } from '~~/server/utils/textField';

/** An invitee with no User accepts, choosing a name and a password, and is signed in. */
export default defineEventHandler(async (event) => {
	const body = await readBody<{ invitationId?: unknown; name?: unknown; password?: unknown }>(
		event,
	);
	return await answerRoute(event, async ({ auth, request }) => {
		const { setCookie } = await acceptInvitationAsNewUser(
			auth,
			{
				invitationId: textField(body?.invitationId),
				name: textField(body?.name),
				password: textField(body?.password),
			},
			request.headers,
		);
		for (const cookie of setCookie) appendResponseHeader(event, 'set-cookie', cookie);
		return { accepted: true };
	});
});
