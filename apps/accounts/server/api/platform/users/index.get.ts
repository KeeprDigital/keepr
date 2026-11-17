import { getQuery } from 'h3';
import { answerAsActor } from '~~/server/utils/actorRoute';
import { findUsers } from '~~/server/utils/keeprAdministration';
import { textField } from '~~/server/utils/refusal';

/** The Users whose name or email contains `?q=`, for a Keepr Administrator. */
export default defineEventHandler(
	async (event) =>
		await answerAsActor(
			event,
			async (database, actor) => await findUsers(database, actor, textField(getQuery(event).q)),
		),
);
