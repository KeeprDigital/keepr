import { appendResponseHeader, getRequestHost, readBody, toWebRequest } from 'h3';
import { db } from '~~/server/db';
import { serverAuth } from '~~/server/utils/auth';
import { claimFirstAdministrator } from '~~/server/utils/firstAdministrator';
import { answerRefusals, textField } from '~~/server/utils/refusal';

/**
 * Claims a First Administrator Claim the command wrote, and signs the new Keepr
 * Administrator in. It creates one only from such a claim (ADR-0115).
 */
export default defineEventHandler(async (event) => {
	const body = await readBody<{ claimId?: unknown; name?: unknown; password?: unknown }>(event);
	return await answerRefusals(event, async () => {
		const { setCookie } = await claimFirstAdministrator(
			serverAuth(getRequestHost(event)),
			db(),
			{
				claimId: textField(body?.claimId),
				name: textField(body?.name),
				password: textField(body?.password),
			},
			toWebRequest(event).headers,
		);
		for (const cookie of setCookie) appendResponseHeader(event, 'set-cookie', cookie);
		return { claimed: true };
	});
});
