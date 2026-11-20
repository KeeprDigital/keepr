import { readBody } from 'h3';
import { answerRoute } from '~~/server/utils/actorRoute';
import { invitationOffer } from '~~/server/utils/invitationAcceptance';
import { textField } from '~~/server/utils/textField';

/**
 * What an invitee is shown before accepting, to the holder of the link's secret.
 * A POST, so neither the id nor the secret is in a request line.
 */
export default defineEventHandler(async (event) => {
	const body = await readBody<{ invitationId?: unknown; secret?: unknown }>(event);
	return await answerRoute(
		event,
		async ({ auth, database }) =>
			await invitationOffer(auth, database, {
				invitationId: textField(body?.invitationId),
				secret: textField(body?.secret),
			}),
	);
});
