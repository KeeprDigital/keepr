import { readBody } from 'h3';
import { answerRoute } from '~~/server/utils/actorRoute';
import { invitationOffer } from '~~/server/utils/invitationAcceptance';
import { textField } from '~~/server/utils/textField';

/** What an invitee is shown before accepting. A POST, so the id is in no request line. */
export default defineEventHandler(async (event) => {
	const body = await readBody<{ invitationId?: unknown }>(event);
	return await answerRoute(
		event,
		async ({ auth }) => await invitationOffer(auth, textField(body?.invitationId)),
	);
});
