import { appendResponseHeader, getRequestHost, readBody, toWebRequest } from 'h3';
import { serverAuth } from '~~/server/utils/auth';
import { acceptInvitationAsNewUser } from '~~/server/utils/invitationAcceptance';
import { answerRefusals } from '~~/server/utils/refusal';
import { textField } from '~~/server/utils/textField';

/** An invitee with no User accepts, choosing a name and a password, and is signed in. */
export default defineEventHandler(async (event) => {
	const body = await readBody<{ invitationId?: unknown; name?: unknown; password?: unknown }>(
		event,
	);
	return await answerRefusals(event, async () => {
		const { setCookie } = await acceptInvitationAsNewUser(
			serverAuth(getRequestHost(event)),
			{
				invitationId: textField(body?.invitationId),
				name: textField(body?.name),
				password: textField(body?.password),
			},
			toWebRequest(event).headers,
		);
		for (const cookie of setCookie) appendResponseHeader(event, 'set-cookie', cookie);
		return { accepted: true };
	});
});
