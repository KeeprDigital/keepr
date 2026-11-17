import { appendResponseHeader, readBody } from 'h3';
import { answerRoute } from '~~/server/utils/actorRoute';
import { claimFirstAdministrator } from '~~/server/utils/firstAdministrator';
import { textField } from '~~/server/utils/textField';

/**
 * Claims a First Administrator Claim the command wrote, and signs the new Keepr
 * Administrator in. It creates one only from such a claim (ADR-0115).
 */
export default defineEventHandler(async (event) => {
	const body = await readBody<{ claimId?: unknown; name?: unknown; password?: unknown }>(event);
	return await answerRoute(event, async ({ auth, database, request }) => {
		const { setCookie } = await claimFirstAdministrator(
			auth,
			database,
			{
				claimId: textField(body?.claimId),
				name: textField(body?.name),
				password: textField(body?.password),
			},
			request.headers,
		);
		for (const cookie of setCookie) appendResponseHeader(event, 'set-cookie', cookie);
		return { claimed: true };
	});
});
