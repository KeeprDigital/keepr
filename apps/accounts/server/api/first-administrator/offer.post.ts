import { getRequestHost, readBody } from 'h3';
import { db } from '~~/server/db';
import { serverAuth } from '~~/server/utils/auth';
import { firstAdministratorClaimOffer } from '~~/server/utils/firstAdministrator';
import { answerRefusals } from '~~/server/utils/refusal';
import { textField } from '~~/server/utils/textField';

/** What the claim page shows before claiming. A POST, so the claim is in no request line. */
export default defineEventHandler(async (event) => {
	const body = await readBody<{ claimId?: unknown }>(event);
	return await answerRefusals(
		event,
		async () =>
			await firstAdministratorClaimOffer(
				serverAuth(getRequestHost(event)),
				db(),
				textField(body?.claimId),
			),
	);
});
