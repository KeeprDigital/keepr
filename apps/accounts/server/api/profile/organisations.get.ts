import { getRequestHost, toWebRequest } from 'h3';
import { db } from '~~/server/db';
import { serverAuth } from '~~/server/utils/auth';
import { profileOrganisations } from '~~/server/utils/profileOrganisations';
import { answerRefusals } from '~~/server/utils/refusal';

/** The signed-in User's Organisations, the Apps they can use in each, and the one worked in. */
export default defineEventHandler(
	async (event) =>
		await answerRefusals(
			event,
			async () =>
				await profileOrganisations(
					serverAuth(getRequestHost(event)),
					db(),
					toWebRequest(event).headers,
				),
		),
);
