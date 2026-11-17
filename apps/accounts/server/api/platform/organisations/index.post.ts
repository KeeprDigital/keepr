import { getRequestURL, readBody } from 'h3';
import { answerAsActor } from '~~/server/utils/actorRoute';
import { runAfterResponse, serverEmailSender } from '~~/server/utils/email';
import { createOrganisation } from '~~/server/utils/keeprAdministration';
import { textField } from '~~/server/utils/textField';

/** Creates an Organisation and invites its first owner, as a Keepr Administrator. */
export default defineEventHandler(async (event) => {
	const body = await readBody<{ name?: unknown; ownerEmail?: unknown; appRoles?: unknown }>(event);
	return await answerAsActor(
		event,
		async (database, actor) =>
			await createOrganisation(
				database,
				actor,
				{
					name: textField(body?.name),
					ownerEmail: textField(body?.ownerEmail),
					appRoles: body?.appRoles,
				},
				{
					email: serverEmailSender(),
					origin: getRequestURL(event).origin,
					afterResponse: runAfterResponse,
				},
			),
	);
});
