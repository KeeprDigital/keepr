import { getRouterParam } from 'h3';
import { answerAsActor } from '~~/server/utils/actorRoute';
import { disableUser } from '~~/server/utils/keeprAdministration';

/** Disables a User and ends every Session they have. */
export default defineEventHandler(
	async (event) =>
		await answerAsActor(event, async (database, actor) => {
			await disableUser(database, actor, getRouterParam(event, 'userId') ?? '');
			return { disabled: true };
		}),
);
