import { answerRoute } from '~~/server/utils/actorRoute';
import { profileOrganisations } from '~~/server/utils/profileOrganisations';

/** The signed-in User's Organisations, the Apps they can use in each, and the one worked in. */
export default defineEventHandler(
	async (event) =>
		await answerRoute(
			event,
			async ({ auth, database, request }) =>
				await profileOrganisations(auth, database, request.headers),
		),
);
