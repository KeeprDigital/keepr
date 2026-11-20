import { answerRoute } from '~~/server/utils/actorRoute';
import { answerUserNames } from '~~/server/utils/userNames';

/**
 * The names of the Users `?id=` asks about who share an Organisation with the
 * signed-in User (`USER_NAMES_PATH`, ADR-0145). An App asks it with the cookie
 * of the request it is answering.
 */
export default defineEventHandler(
	async (event) =>
		await answerRoute(
			event,
			async ({ auth, database, request }) => await answerUserNames(auth, database, request),
		),
);
