import { getRequestHost, readBody } from 'h3';
import { serverAuth } from '~~/server/utils/auth';
import { invitationOffer } from '~~/server/utils/invitationAcceptance';
import { answerRefusals, textField } from '~~/server/utils/refusal';

/** What an invitee is shown before accepting. A POST, so the id is in no request line. */
export default defineEventHandler(async (event) => {
	const body = await readBody<{ invitationId?: unknown }>(event);
	return await answerRefusals(
		event,
		async () =>
			await invitationOffer(serverAuth(getRequestHost(event)), textField(body?.invitationId)),
	);
});
