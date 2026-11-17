import { getRequestHost, readBody, toWebRequest } from 'h3';
import { db } from '~~/server/db';
import { serverAuth } from '~~/server/utils/auth';
import { declineInvitation } from '~~/server/utils/invitationAcceptance';
import { answerRefusals, textField } from '~~/server/utils/refusal';

/** The invitee declines, from the Invitation's link, signed in or not. */
export default defineEventHandler(async (event) => {
	const body = await readBody<{ invitationId?: unknown }>(event);
	return await answerRefusals(event, async () => {
		await declineInvitation(
			serverAuth(getRequestHost(event)),
			db(),
			textField(body?.invitationId),
			toWebRequest(event),
		);
		return { declined: true };
	});
});
