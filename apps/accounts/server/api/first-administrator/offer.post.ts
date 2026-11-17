import { readBody } from 'h3';
import { answerRoute } from '~~/server/utils/actorRoute';
import { firstAdministratorClaimOffer } from '~~/server/utils/firstAdministrator';
import { textField } from '~~/server/utils/textField';

/** What the claim page shows before claiming. A POST, so the claim is in no request line. */
export default defineEventHandler(async (event) => {
	const body = await readBody<{ claimId?: unknown }>(event);
	return await answerRoute(
		event,
		async ({ auth, database }) =>
			await firstAdministratorClaimOffer(auth, database, textField(body?.claimId)),
	);
});
