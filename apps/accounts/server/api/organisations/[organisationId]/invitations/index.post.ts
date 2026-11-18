import { getRequestHost, getRequestURL, getRouterParam, readBody } from 'h3';
import { answerAsActor } from '~~/server/utils/actorRoute';
import { runAfterResponse, serverEmailSender } from '~~/server/utils/email';
import { inviteMember } from '~~/server/utils/invitations';
import { textField } from '~~/server/utils/textField';

/** Invites an address to the Organisation, with an Organisation role and App roles. */
export default defineEventHandler(async (event) => {
	const body = await readBody<{ email?: unknown; role?: unknown; appRoles?: unknown }>(event);
	return await answerAsActor(
		event,
		async (database, actor) =>
			await inviteMember(
				database,
				actor,
				{
					organizationId: getRouterParam(event, 'organisationId') ?? '',
					email: textField(body?.email),
					role: textField(body?.role),
					appRoles: body?.appRoles,
				},
				{
					email: serverEmailSender(getRequestHost(event)),
					origin: getRequestURL(event).origin,
					afterResponse: runAfterResponse,
				},
			),
	);
});
